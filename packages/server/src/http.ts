// `rehearse serve`: the built UI plus a JSON API, on 127.0.0.1 only (R12, R20).
// Remote access goes through `bb connect expose <port>`, never through this server.
// The only record writes are approve and sign-off, from the UI (R13, R14, D41). The story thread
// panel (T12) writes local state only (.rehearse/story-threads.json) and runs `bb`. Each POST needs
// the session token, a same-origin Origin (when sent) and a JSON body; the identity and the signing
// key are the server process's, never the request's. The code reads (`/api/code-index`,
// `/api/box-code`) and the story-thread reads run git or bb; the Birdview routes read the e2e player and, for the actions in
// PLAYER_ACTIONS only (switch the player to this repo, write a story playlist, play it; T45), call it on 127.0.0.1. The story-tests routes (T47)
// start or feed the test thread of a story, writing only .rehearse/story-threads.json. The code graph route (`/api/graph`, G20) answers show, near, find,
// path and the code map's levels (T40) from @rehearse/graph, and a file watcher keeps the graph fresh (graph-route.ts). All of them need
// the same token and Origin check. The sign-off preview (`GET /api/sign-off/preview`, T39) reads
// git history too, with the same check. The thread merge routes (T48) read git and bb and, on the
// owner's press only, run `git merge --no-ff` of a thread's branch in this checkout; same check.
// The Design tab (T50) reads design/links.yaml and the files it links (`/api/design`,
// `/api/design/file`; same check) and the linked PNGs (`GET /design/<file>.png`, no token: an <img>).
// The only design write is `POST /api/design/save`: the owner's Save in the embedded FigCraft, from
// the UI, for a .figcraft file linked in links.yaml only; agents never call it. `POST /api/figcraft/fetch`
// (owner's button) downloads the FigCraft web build into .rehearse/figcraft-web/, checked against its
// SHA-256; `GET /figcraft/…` hosts it, framed by this origin only.
// T51: `POST /api/design/link` (the owner's click in the picker or on a suggestion) rewrites
// design/links.yaml, keeping its comments; `POST /api/design/refresh` asks a running FigCraft
// (127.0.0.1:4800, read-only: doc.list and ui.render) for the linked frames' pictures. Both need
// the token and Origin; agents never call them. `GET /design-thumbnail?file=` is an indexed file's
// thumbnail.png (no token: an <img>).

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, relative, sep } from 'node:path';
import { approveScenarios, defaultVerifier, readFigcraftThumbnail, repoTopOf, signOff, simulateRecord, type Finding, type Id, type Verifier } from '@rehearse/core';
import { MAP_LEVELS, type CoverageStats, type MapLevel } from '@rehearse/graph';
import { boxCode, codeIndex, epicBoxPaths, execGit, type GitRunner } from './box-code.js';
import { buildDeckHtml, chromiumPrinter, deckFileName, epicSlugOf, PrinterUnavailable, type DeckOptions, type DeckSources, type Printer } from './present.js';
import { writeZip } from './zip-write.js';
import { birdviewInfo, DEFAULT_BIRDVIEW_PORT, findTestProject, PLAYER_ACTIONS, type BirdviewSetup, type PlayerAction } from './birdview.js';
import { BirdviewError, playStory, useProject } from './birdview-play.js';
import { gatherBriefCode } from './brief-code.js';
import { designView, figcraftFile, FIGCRAFT_PATH, MAX_DESIGN_BODY_BYTES, readLinkedDesignFile, saveDesign } from './design-route.js';
import { linkDesign, refreshDesignPictures } from './design-link.js';
import { FIGCRAFT_CONTROL_HOST, FIGCRAFT_CONTROL_PORT, type FigcraftControlAddress } from './figcraft-control.js';
import { FIGCRAFT_VERSION, FigcraftFetchError, fetchFigcraftWeb, type Fetcher } from './figcraft-web.js';
import { graphServiceFor, repoRoot, type GraphService } from './graph-route.js';
import { createSession, sessionInfo, tokenMatches, type ServerSession } from './session.js';
import { MAX_PREVIEW_STORIES, signOffPreview } from './signoff-preview.js';
import { bbProjectFrom } from './bb-project.js';
import { createStoryThreads, processRunner, StoryThreadError, type Runner, type StoryThreadService } from './story-thread.js';
import { createThreadMerge, MergeConflictError, type MergeKind, type ThreadMergeService } from './thread-merge.js';
import { buildTrustedEpicView } from './trust-view.js';

/** The only address `rehearse serve` listens on (R20). */
export const LISTEN_HOST = '127.0.0.1';

export interface ServeOptions {
  /** Absolute path of the EPIC folder. Read again on each API request. */
  epicDir: string;
  /** Folder of the built UI (index.html and assets). A missing folder serves a short notice page. */
  uiDir: string;
  /** 0 picks a free port. */
  port: number;
  /** Token, identity and signer. Default: a new session from git config and BB_THREAD_ID. */
  session?: ServerSession;
  /** Checks signatures. Default: the allowed_signers file of the EPIC folder's repo (D41). */
  verifier?: Verifier;
  /** Runs git for the box code routes. Default: `git` from PATH (tests pass a fake). */
  git?: GitRunner;
  /** Runs `git` and `bb` for the story thread panel. Default: the real programs. */
  run?: Runner;
  /** bb project for new story threads. Default: REHEARSE_BB_PROJECT, else BB_PROJECT_ID, else found from `bb project list` (bb-project.ts). */
  bbProject?: string;
  /** The Birdview e2e player. Default: port 3298 and the nearest `e2e/` test project above the EPIC folder. */
  birdview?: BirdviewSetup;
  /** The code graph and its watcher. Default: the graph of the EPIC folder's repo, opened on the first request. */
  graph?: GraphService;
  /** `--model` of a build thread (T44). Default: REHEARSE_THREAD_MODEL; unset: bb's default. */
  threadModel?: string;
  /** `--reasoning-level` of a build thread (T44). Default: REHEARSE_THREAD_REASONING; unset: bb's default. */
  threadReasoning?: string;
  /** The repo top: design/links.yaml, design/ and .rehearse/figcraft-web/ (T50). Default: the git top above the EPIC folder. */
  repoTop?: string;
  /** Downloads for `POST /api/figcraft/fetch`. Default: fetch from GitHub (tests pass a fake). */
  figcraftFetcher?: Fetcher;
  /** The FigCraft desktop app's control port for "Refresh pictures" (T51). Default: 127.0.0.1:4800. */
  figcraftControl?: FigcraftControlAddress;
  /** Prints the deck of `GET /api/present?format=pdf` (T52). Default: Playwright's Chromium from e2e/ (tests pass a fake). */
  printer?: Printer;
  /** Proof sources of the deck (T53): Birdview's saved results, the unit report; asked on each deck. Default: none (`rehearse serve` finds them). */
  deckSources?: () => Promise<DeckSources>;
}

/** The header every POST must carry, with the session token. */
export const TOKEN_HEADER = 'x-rehearse-token';
/** Largest JSON body a POST may send. */
export const MAX_BODY_BYTES = 64 * 1024;

export interface RunningServer {
  server: Server;
  host: string;
  port: number;
  /** `http://127.0.0.1:<port>/` */
  url: string;
  close: () => Promise<void>;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const NOT_BUILT = `<!doctype html>
<html><head><meta charset="utf-8"><title>rehearse</title></head>
<body><div id="root"><p>The rehearse UI is not built. Run <code>pnpm -r build</code>, then start <code>rehearse serve</code> again.</p></div></body></html>
`;

type HandlerOptions = Pick<ServeOptions, 'epicDir' | 'uiDir' | 'session' | 'verifier' | 'git' | 'run' | 'bbProject' | 'birdview' | 'graph' | 'threadModel' | 'threadReasoning' | 'repoTop' | 'figcraftFetcher' | 'figcraftControl' | 'printer' | 'deckSources'>;

const ROUTES: Record<string, string> = {
  '/api/session': 'GET, HEAD',
  '/api/epic': 'GET, HEAD',
  '/api/approve': 'POST',
  '/api/sign-off': 'POST',
  '/api/sign-off/preview': 'GET',
  '/api/code-index': 'GET',
  '/api/box-code': 'GET',
  '/api/graph': 'GET',
  '/api/story-thread': 'GET, HEAD',
  '/api/story-thread/link': 'POST',
  '/api/story-thread/start': 'POST',
  '/api/story-thread/build': 'POST',
  '/api/story-thread/send-change': 'POST',
  '/api/story-progress': 'GET, HEAD',
  '/api/story-thread/send': 'POST',
  '/api/story-thread/open': 'POST',
  '/api/story-tests/thread': 'GET, HEAD, POST',
  '/api/story-tests/send': 'POST',
  '/api/thread/merge': 'GET, POST',
  '/api/thread/ask-rebase': 'POST',
  '/api/birdview': 'GET',
  '/api/present': 'GET',
  '/api/design': 'GET, HEAD',
  '/api/design/file': 'GET',
  '/api/design/save': 'POST',
  '/api/design/link': 'POST',
  '/api/design/refresh': 'POST',
  '/api/figcraft/fetch': 'POST',
  ...Object.fromEntries(PLAYER_ACTIONS.map((a) => [`/api/birdview/${a}`, 'POST'])),
};

const STORY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** A Birdview test key: a file relative to the test project, and a line. */
const TEST_KEY = /^[A-Za-z0-9_][\w./-]{0,250}:\d{1,6}$/;
/** Longest graph target the route takes. */
const MAX_TARGET = 512;

/** The request handler, without listening. */
export function createHandler(opts: HandlerOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const session = opts.session ?? createSession(opts.epicDir);
  const verifier = opts.verifier ?? defaultVerifier(opts.epicDir);
  const git = opts.git ?? execGit;
  const bbProject = bbProjectFrom(opts.bbProject, process.env);
  const threadModel = opts.threadModel ?? (process.env.REHEARSE_THREAD_MODEL || undefined);
  const threadReasoning = opts.threadReasoning ?? (process.env.REHEARSE_THREAD_REASONING || undefined);
  const birdview = opts.birdview ?? { port: DEFAULT_BIRDVIEW_PORT, projectDir: findTestProject(opts.epicDir) };
  const graph = opts.graph ?? graphServiceFor(opts.epicDir);
  const run = opts.run ?? processRunner();
  const top = opts.repoTop ?? repoTopOf(opts.epicDir);
  const threads = createStoryThreads({
    epicDir: opts.epicDir,
    run,
    ...(bbProject ? { bbProject } : {}),
    ...(threadModel ? { threadModel } : {}),
    ...(threadReasoning ? { threadReasoning } : {}),
    ...(birdview.projectDir ? { testProject: birdview.projectDir } : {}),
    // The code a brief starts from (T49): the graph is brought up to date first; when it cannot
    // open, the brief says so in one line.
    briefCode: (record, boxes) =>
      gatherBriefCode({ epicDir: opts.epicDir, record, boxes, graph: (fn) => graph.withGraph(fn), git, ...(birdview.projectDir ? { testProject: relative(repoRoot(opts.epicDir), birdview.projectDir).split(sep).join('/') } : {}) }),
    // Coverage only from a graph that is indexed already: progress never starts an index run.
    coverage: async () => {
      if (!graph.status().indexed) return undefined;
      const [, answer] = await readCoverage(new URLSearchParams(), graph, opts.epicDir, git);
      return (answer as { ok?: boolean; boxes?: Record<string, CoverageStats> }).boxes;
    },
    testResults: async (storyId) => {
      const info = await birdviewInfo(birdview, storyId, opts.epicDir);
      return info.player.kind === 'ours' ? info.player.results : undefined;
    },
  });
  const merges = createThreadMerge({ epicDir: opts.epicDir, run, threads, ...(birdview.projectDir ? { testProject: birdview.projectDir } : {}) });
  return (req, res) => {
    let path: string;
    let query: URLSearchParams;
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      path = decodeURIComponent(url.pathname);
      query = url.searchParams;
    } catch {
      send(res, 400, 'text/plain; charset=utf-8', 'bad path\n');
      return;
    }
    const allow = path.startsWith('/api/') ? ROUTES[path] : 'GET, HEAD';
    if (allow === undefined) {
      sendJson(res, 404, { error: `no endpoint ${path}` });
      return;
    }
    if (!allow.split(', ').includes(req.method ?? '')) {
      send(res, 405, 'text/plain; charset=utf-8', `only ${allow}\n`, { allow });
      return;
    }
    if (path === '/api/session') {
      sendJson(res, 200, sessionInfo(session));
      return;
    }
    if (path === '/api/epic') {
      try {
        sendJson(res, 200, buildTrustedEpicView(opts.epicDir, verifier));
      } catch (e) {
        sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    if (path === '/api/code-index' || path === '/api/box-code') {
      // Code reads git history: the same session token and Origin check as a write.
      if (!tokenMatches(session, req.headers[TOKEN_HEADER])) {
        sendJson(res, 403, { error: `missing or wrong ${TOKEN_HEADER} header` });
        return;
      }
      if (!sameOrigin(req)) {
        sendJson(res, 403, { error: 'Origin does not match Host' });
        return;
      }
      void readCode(path, query, opts.epicDir, git).then(
        ([status, body]) => sendJson(res, status, body),
        (e: unknown) => sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) }),
      );
      return;
    }
    if (path === '/api/graph') {
      // Box serve-query: the token and the Origin before any graph work (S9-A4).
      const refused = checkRequest(req, session);
      if (refused) {
        sendJson(res, refused.status, { ok: false, error: refused.error });
        return;
      }
      void readGraph(query, graph, opts.epicDir, git).then(
        ([status, body]) => sendJson(res, status, body),
        (e: unknown) => sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) }),
      );
      return;
    }
    if (path === '/api/birdview') {
      const refused = checkRequest(req, session);
      if (refused) {
        sendJson(res, refused.status, { error: refused.error });
        return;
      }
      const story = new URL(req.url ?? '/', 'http://localhost').searchParams.get('story') ?? '';
      if (!STORY_ID.test(story)) {
        sendJson(res, 400, { error: 'query must be ?story=<story id>' });
        return;
      }
      void birdviewInfo(birdview, story, opts.epicDir).then(
        (info) => sendJson(res, 200, info),
        (e: unknown) => sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) }),
      );
      return;
    }
    if (path.startsWith('/api/birdview/')) {
      const action = path.slice('/api/birdview/'.length) as PlayerAction;
      void readJsonPost(req, session).then((body) => {
        if ('status' in body) {
          sendJson(res, body.status, { ok: false, error: body.error });
          return;
        }
        void playerAction(birdview, opts.epicDir, action, body.json).then(
          ([status, out]) => sendJson(res, status, out),
          (e: unknown) =>
            e instanceof BirdviewError
              ? sendJson(res, e.status, { ok: false, reason: e.kind, error: e.message })
              : sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) }),
        );
      });
      return;
    }
    if (path === '/api/sign-off/preview') {
      // Reads the record and git history: the token and the Origin first (T39).
      const refused = checkRequest(req, session);
      if (refused) {
        sendJson(res, refused.status, { ok: false, error: refused.error });
        return;
      }
      const ids = (query.get('stories') ?? '').split(',').filter((id) => id !== '');
      if (ids.length === 0 || ids.length > MAX_PREVIEW_STORIES || !ids.every((id) => STORY_ID.test(id))) {
        sendJson(res, 400, { ok: false, error: `query must be ?stories=<story id>,… (1 to ${MAX_PREVIEW_STORIES} ids)` });
        return;
      }
      void signOffPreview(git, opts.epicDir, ids).then(
        (preview) => sendJson(res, 200, preview),
        (e: unknown) => sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) }),
      );
      return;
    }
    if (path === '/api/approve' || path === '/api/sign-off') {
      const field = path === '/api/approve' ? 'scenarioIds' : 'storyIds';
      void readPost(req, session, field).then((ids) => {
        if (!Array.isArray(ids)) {
          sendJson(res, ids.status, { ok: false, error: ids.error });
          return;
        }
        try {
          write(res, path, ids, opts.epicDir, session, verifier);
        } catch (e) {
          sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      });
      return;
    }
    if (path.startsWith('/api/story-thread')) {
      void storyThread(req, res, path, session, threads);
      return;
    }
    if (path.startsWith('/api/story-tests/')) {
      void storyTests(req, res, path, session, threads);
      return;
    }
    if (path.startsWith('/api/thread/')) {
      void threadMerge(req, res, path, session, merges);
      return;
    }
    if (path === '/api/story-progress') {
      // Box watch-build: the token and the Origin before any git or bb call.
      const refused = checkRequest(req, session);
      if (refused) {
        sendJson(res, refused.status, { ok: false, error: refused.error });
        return;
      }
      const story = query.get('story');
      const work = story === null ? threads.progressAll().then((stories) => ({ ok: true, stories })) : threads.progress(story).then((p) => ({ ok: true, progress: p }));
      void work.then(
        (body) => sendJson(res, 200, body),
        (e) => {
          if (e instanceof StoryThreadError) sendJson(res, e.status, { ok: false, error: e.message, ...(e.details ? { details: e.details } : {}) });
          else sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
        },
      );
      return;
    }
    if (path === '/api/present') {
      void (opts.deckSources ? opts.deckSources().catch(() => ({})) : Promise.resolve({})).then((sources) => present(req, res, query, session, {
        epicDir: opts.epicDir,
        repoTop: top,
        git: (args) => git(args, opts.epicDir),
        verifier,
        ...(birdview.projectDir ? { testProject: birdview.projectDir } : {}),
        ...sources,
        testResults: async (storyId) => {
          const info = await birdviewInfo(birdview, storyId, opts.epicDir);
          return info.player.kind === 'ours' ? info.player.results : undefined;
        },
        coverage: async () => {
          if (!graph.status().indexed) return undefined;
          const [, answer] = await readCoverage(new URLSearchParams(), graph, opts.epicDir, git);
          return coveragePercent((answer as { boxes?: Record<string, CoverageStats> }).boxes);
        },
      }, opts.printer ?? chromiumPrinter(top)));
      return;
    }
    if (path.startsWith('/api/design') || path === '/api/figcraft/fetch') {
      void design(req, res, path, query, top, opts.epicDir, session, opts.figcraftFetcher, opts.figcraftControl ?? { host: FIGCRAFT_CONTROL_HOST, port: FIGCRAFT_CONTROL_PORT });
      return;
    }
    if (path.startsWith('/design/')) {
      // A linked PNG, for an <img>: no token, linked files only.
      const png = readLinkedDesignFile(top, path.slice(1), 'png');
      if (png) send(res, 200, TYPES['.png']!, png);
      else send(res, 404, 'text/plain; charset=utf-8', 'not found: only PNGs linked in design/links.yaml or shown by the design index are served\n');
      return;
    }
    if (path === '/design-thumbnail') {
      // The thumbnail.png of an indexed design file, for an <img>: no token.
      const png = readFigcraftThumbnail(top, query.get('file') ?? '');
      if (png) send(res, 200, TYPES['.png']!, png);
      else send(res, 404, 'text/plain; charset=utf-8', 'not found: only the thumbnails of design files under design/ are served\n');
      return;
    }
    if (path === '/figcraft') {
      const search = new URL(req.url ?? '/', 'http://localhost').search;
      send(res, 301, 'text/plain; charset=utf-8', '', { location: `${FIGCRAFT_PATH}${search}` });
      return;
    }
    if (path.startsWith(FIGCRAFT_PATH)) {
      const [status, type, body, headers] = figcraftFile(top, path);
      send(res, status, type, body, headers);
      return;
    }
    serveStatic(opts.uiDir, path, res);
  };
}

/** `GET /api/code-index` (every box: commits and files) or `GET /api/box-code?box=&before=&after=&file=`. */
async function readCode(path: string, query: URLSearchParams, epicDir: string, git: GitRunner): Promise<[number, unknown]> {
  const boxes = epicBoxPaths(epicDir);
  if (path === '/api/code-index') return [200, await codeIndex(git, epicDir, boxes)];
  const box = query.get('box');
  if (box === null) return [400, { ok: false, error: 'box is required' }];
  const opt = (name: string) => query.get(name) ?? undefined;
  const result = await boxCode(git, epicDir, boxes, { box, before: opt('before'), after: opt('after'), file: opt('file') });
  return result.ok ? [200, result] : [result.status, { ok: false, error: result.error }];
}

/**
 * `GET /api/graph?verb=…`: 200 with the answer, 404 when the target is not found, 400 for a bad query.
 *   show|near&target=…[&depth=n]      a node and its edges; the nodes around it (S9)
 *   find&target=<words>               the hits, each with its place on the code map (T40)
 *   path&target=<from>&to=<to>        the shortest chain of edges (T40)
 *   map&level=packages|package|file[&target=…][&tests=hide][&outside=hide][&epic=<folder>]
 *                                     one level of the code map (T40)
 *   status                            indexed? busy? Answers at once, no update (T40)
 *   coverage[&target=<file|symbol|box <path>>]
 *                                     unit test coverage of one target, or of every box of the EPIC (T43)
 * The map and show answers carry coverage too (T43): the badges and line marks come with the nodes
 * the UI already asks for, so only the boxes, which are not graph answers, need `verb=coverage`.
 */
async function readGraph(query: URLSearchParams, graph: GraphService, epicDir: string, git: GitRunner): Promise<[number, unknown]> {
  const verb = query.get('verb');
  if (verb === 'status') return [200, { ok: true, ...graph.status() }];
  if (verb === 'map') return readMap(query, graph);
  if (verb === 'coverage') return readCoverage(query, graph, epicDir, git);
  if (verb !== 'show' && verb !== 'near' && verb !== 'find' && verb !== 'path') return [400, { ok: false, error: 'verb must be show, near, find, path, map, coverage or status' }];
  const target = query.get('target') ?? '';
  if (target.trim() === '' || target.length > MAX_TARGET) return [400, { ok: false, error: `target is required, at most ${MAX_TARGET} characters` }];
  if (verb === 'find') return [200, await graph.find(target)];
  if (verb === 'path') {
    const to = query.get('to') ?? '';
    if (to.trim() === '' || to.length > MAX_TARGET) return [400, { ok: false, error: `to is required, at most ${MAX_TARGET} characters` }];
    const answer = await graph.path(target, to);
    return [answer.ok || answer.notes.includes('no path') ? 200 : 404, answer];
  }
  const depthText = query.get('depth');
  const depth = depthText === null ? 1 : Number(depthText);
  if (verb === 'near' && !(Number.isInteger(depth) && depth >= 1 && depth <= 3)) return [400, { ok: false, error: 'depth must be 1, 2 or 3' }];
  const answer = await graph.answer({ verb, target, depth });
  return [answer.ok ? 200 : 404, answer];
}

/** `verb=coverage`: one target (404 when not found), or every box of the served EPIC with code. */
async function readCoverage(query: URLSearchParams, graph: GraphService, epicDir: string, git: GitRunner): Promise<[number, unknown]> {
  const target = query.get('target');
  if (target !== null) {
    if (target.trim() === '' || target.length > MAX_TARGET) return [400, { ok: false, error: `target is at most ${MAX_TARGET} characters, not empty` }];
    const answer = await graph.coverage({ target });
    return [answer.ok ? 200 : 404, answer];
  }
  const boxes = epicBoxPaths(epicDir);
  // A box with no builds edge: the code of the files of its Flow-Box commits, as the drill-down does.
  const index = await codeIndex(git, epicDir, boxes);
  const flowBoxFiles = new Map(index.ok ? Object.entries(index.boxes).map(([box, c]) => [box, c.files] as const) : []);
  return [200, await graph.coverage({ boxes, flowBoxFiles })];
}

const EPIC_FOLDER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** `verb=map`: one level of the code map (T40). */
async function readMap(query: URLSearchParams, graph: GraphService): Promise<[number, unknown]> {
  const level = query.get('level') ?? '';
  if (!(MAP_LEVELS as readonly string[]).includes(level)) return [400, { ok: false, error: `level must be ${MAP_LEVELS.join(', ')}` }];
  const target = query.get('target') ?? '';
  if (level !== 'packages' && (target.trim() === '' || target.length > MAX_TARGET)) return [400, { ok: false, error: `target is required for level ${level}, at most ${MAX_TARGET} characters` }];
  const epic = query.get('epic');
  if (epic !== null && !EPIC_FOLDER.test(epic)) return [400, { ok: false, error: 'epic must be an EPIC folder name' }];
  const map = await graph.map({
    level: level as MapLevel,
    ...(level !== 'packages' ? { target } : {}),
    hideTests: query.get('tests') === 'hide' ? true : query.get('tests') === 'auto' ? 'auto' : false,
    hideOutside: query.get('outside') === 'hide',
    ...(epic !== null ? { epic } : {}),
  });
  return [map.ok ? 200 : 404, map];
}

/** The story thread panel (T12): read, link, start, send and open. Each needs the token and a same-origin Origin. */
async function storyThread(req: IncomingMessage, res: ServerResponse, path: string, session: ServerSession, threads: StoryThreadService): Promise<void> {
  try {
    if (path === '/api/story-thread') {
      const refused = checkRequest(req, session);
      if (refused) {
        sendJson(res, refused.status, { ok: false, error: refused.error });
        return;
      }
      const story = new URL(req.url ?? '/', 'http://localhost').searchParams.get('story') ?? '';
      sendJson(res, 200, await threads.view(story));
      return;
    }
    const body = await readJsonPost(req, session);
    if ('status' in body) {
      sendJson(res, body.status, { ok: false, error: body.error });
      return;
    }
    const text = (key: string): string | undefined => (typeof body.json[key] === 'string' ? (body.json[key] as string) : undefined);
    const story = text('story');
    if (story === undefined) {
      sendJson(res, 400, { ok: false, error: 'body must have "story": string' });
      return;
    }
    if (path === '/api/story-thread/link') {
      sendJson(res, 200, await threads.link(story, text('threadId') ?? ''));
    } else if (path === '/api/story-thread/start') {
      sendJson(res, 200, await threads.start(story));
    } else if (path === '/api/story-thread/build') {
      sendJson(res, 200, await threads.build(story));
    } else if (path === '/api/story-thread/send-change') {
      sendJson(res, 200, await threads.sendChange(story));
    } else if (path === '/api/story-thread/send') {
      const message = text('text');
      if (message === undefined) {
        sendJson(res, 400, { ok: false, error: 'body must have "text": string' });
        return;
      }
      sendJson(res, 200, await threads.send(story, message, text('context')));
    } else {
      await threads.open(story);
      sendJson(res, 200, { ok: true });
    }
  } catch (e) {
    if (e instanceof StoryThreadError) sendJson(res, e.status, { ok: false, error: e.message, ...(e.details ? { details: e.details } : {}) });
    else sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * The story's test thread (T47, box start-test-thread): read it, start one for approved scenarios
 * without a test, or send more scenarios to it. Each needs the token and a same-origin Origin.
 */
async function storyTests(req: IncomingMessage, res: ServerResponse, path: string, session: ServerSession, threads: StoryThreadService): Promise<void> {
  try {
    if (req.method !== 'POST') {
      const refused = checkRequest(req, session);
      if (refused) {
        sendJson(res, refused.status, { ok: false, error: refused.error });
        return;
      }
      const story = new URL(req.url ?? '/', 'http://localhost').searchParams.get('story') ?? '';
      sendJson(res, 200, await threads.testView(story));
      return;
    }
    const body = await readJsonPost(req, session);
    if ('status' in body) {
      sendJson(res, body.status, { ok: false, error: body.error });
      return;
    }
    const story = body.json.story;
    if (typeof story !== 'string') {
      sendJson(res, 400, { ok: false, error: 'body must have "story": string' });
      return;
    }
    const list = body.json.scenarios;
    if (list !== undefined && !(Array.isArray(list) && list.length <= 200 && list.every((id) => typeof id === 'string' && STORY_ID.test(id)))) {
      sendJson(res, 400, { ok: false, error: '"scenarios" must be a list of scenario ids' });
      return;
    }
    const scenarios = list as string[] | undefined;
    sendJson(res, 200, path === '/api/story-tests/thread' ? await threads.startTests(story, scenarios) : await threads.sendTests(story, scenarios));
  } catch (e) {
    if (e instanceof StoryThreadError) sendJson(res, e.status, { ok: false, error: e.message, ...(e.details ? { details: e.details } : {}) });
    else sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

const MERGE_KINDS: readonly string[] = ['build', 'tests'];
/** A file path the UI sends back from a conflict, for the rebase message. */
const MAX_PATH = 500;

/**
 * Land a thread's work (T48): `GET /api/thread/merge?story=&kind=build|tests` says what the
 * thread's branch brings; `POST /api/thread/merge {story, kind}` merges it with --no-ff into the
 * checked-out branch; `POST /api/thread/ask-rebase {story, kind, files?}` tells the thread to rebase.
 * Each needs the token and a same-origin Origin. Owner only: no CLI command calls these.
 */
async function threadMerge(req: IncomingMessage, res: ServerResponse, path: string, session: ServerSession, merges: ThreadMergeService): Promise<void> {
  try {
    if (req.method !== 'POST') {
      const refused = checkRequest(req, session);
      if (refused) {
        sendJson(res, refused.status, { ok: false, error: refused.error });
        return;
      }
      const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
      const story = query.get('story') ?? '';
      const kind = query.get('kind') ?? '';
      if (!STORY_ID.test(story) || !MERGE_KINDS.includes(kind)) {
        sendJson(res, 400, { ok: false, error: 'query must be ?story=<story id>&kind=build|tests' });
        return;
      }
      sendJson(res, 200, await merges.summary(story, kind as MergeKind));
      return;
    }
    const body = await readJsonPost(req, session);
    if ('status' in body) {
      sendJson(res, body.status, { ok: false, error: body.error });
      return;
    }
    const { story, kind } = body.json;
    if (typeof story !== 'string' || !STORY_ID.test(story) || typeof kind !== 'string' || !MERGE_KINDS.includes(kind)) {
      sendJson(res, 400, { ok: false, error: 'body must be { "story": <story id>, "kind": "build" | "tests" }' });
      return;
    }
    if (path === '/api/thread/merge') {
      sendJson(res, 200, await merges.merge(story, kind as MergeKind));
      return;
    }
    const files = body.json.files ?? [];
    if (!(Array.isArray(files) && files.length <= 200 && files.every((f) => typeof f === 'string' && f !== '' && f.length <= MAX_PATH && !/[\n\r]/.test(f)))) {
      sendJson(res, 400, { ok: false, error: '"files" must be a list of file paths' });
      return;
    }
    sendJson(res, 200, await merges.askRebase(story, kind as MergeKind, files as string[]));
  } catch (e) {
    if (e instanceof MergeConflictError) sendJson(res, e.status, { ok: false, error: e.message, conflict: { files: e.files, canAskRebase: true }, ...(e.details ? { details: e.details } : {}) });
    else if (e instanceof StoryThreadError) sendJson(res, e.status, { ok: false, error: e.message, ...(e.details ? { details: e.details } : {}) });
    else sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * `GET /api/present?epic=<slug>[&format=pdf|zip][&full=1]` (T52, box present-view): the served EPIC's deck as
 * one HTML file, or printed to PDF, or (T53, box download-with-recordings) a zip of the HTML and
 * `<name>-media/` with the videos it links. The token and a same-origin Origin first; no Chromium
 * is a 503 in plain words.
 */
async function present(req: IncomingMessage, res: ServerResponse, query: URLSearchParams, session: ServerSession, deckOptions: DeckOptions, printer: Printer): Promise<void> {
  const refused = checkRequest(req, session);
  if (refused) {
    sendJson(res, refused.status, { ok: false, error: refused.error });
    return;
  }
  const format = query.get('format') ?? 'html';
  if (format !== 'html' && format !== 'pdf' && format !== 'zip') {
    sendJson(res, 400, { ok: false, error: 'format must be html, pdf or zip' });
    return;
  }
  try {
    const slug = epicSlugOf(deckOptions.epicDir);
    const epic = query.get('epic');
    if (epic !== null && epic !== slug) {
      sendJson(res, 404, { ok: false, error: `this server shows the EPIC ${slug}, not ${epic}` });
      return;
    }
    // T54: the executive summary by default; `full=1` adds every story slide as an appendix.
    const full = query.get('full') === '1';
    const built = await buildDeckHtml({ ...deckOptions, ...(format === 'zip' ? { media: {} } : {}), ...(full ? { full } : {}) });
    const name = `${deckFileName(slug, built.facts)}${full ? '-full' : ''}`;
    if (format === 'zip') {
      const entries = [{ name: `${name}.html`, data: Buffer.from(built.html) }];
      const missing: string[] = [];
      for (const v of built.videos) {
        try {
          entries.push({ name: `${built.mediaFolder}/${v.name}`, data: readFileSync(v.src) });
        } catch {
          missing.push(v.name);
        }
      }
      send(res, 200, 'application/zip', writeZip(entries), {
        'content-disposition': `attachment; filename="${name}.zip"`,
        'x-deck-slides': String(built.deck.slides.length),
        'x-deck-videos': String(entries.length - 1),
        ...(missing.length > 0 ? { 'x-deck-missing-videos': missing.join(', ') } : {}),
      });
      return;
    }
    if (format === 'html') {
      send(res, 200, 'text/html; charset=utf-8', built.html, { 'content-disposition': `inline; filename="${name}.html"`, 'x-deck-slides': String(built.deck.slides.length) });
      return;
    }
    const pdf = await printer(built.html);
    send(res, 200, 'application/pdf', Buffer.from(pdf), { 'content-disposition': `attachment; filename="${name}.pdf"` });
  } catch (e) {
    if (e instanceof PrinterUnavailable) sendJson(res, 503, { ok: false, error: e.message });
    else sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Lines covered by unit tests over every box with code, in whole percent rounded down. */
function coveragePercent(boxes: Record<string, CoverageStats> | undefined): number | undefined {
  if (!boxes) return undefined;
  let lines = 0;
  let covered = 0;
  for (const s of Object.values(boxes)) {
    lines += s.lines;
    covered += s.covered;
  }
  return lines > 0 ? Math.floor((covered / lines) * 100) : undefined;
}

/**
 * The Design tab (T50). Each needs the token and a same-origin Origin.
 *   GET  /api/design?story=<id>          the story's links, findings, the FigCraft build's state
 *   GET  /api/design/file?file=<path>    the bytes of a .figcraft file linked in links.yaml
 *   POST /api/design/save {file, bytes}  the owner's Save: base64 bytes of a linked .figcraft file
 *   POST /api/figcraft/fetch {version?}  download and check the FigCraft web build
 *   POST /api/design/link {epic, story, box?, file, page, frame?} or {…, unlink: true}   (T51)
 *   POST /api/design/refresh {story}     pictures of the story's linked frames from FigCraft (T51)
 */
async function design(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  query: URLSearchParams,
  top: string,
  epicDir: string,
  session: ServerSession,
  fetcher: Fetcher | undefined,
  control: FigcraftControlAddress,
): Promise<void> {
  try {
    if (req.method !== 'POST') {
      const refused = checkRequest(req, session);
      if (refused) {
        sendJson(res, refused.status, { ok: false, error: refused.error });
        return;
      }
      if (path === '/api/design') {
        const story = query.get('story') ?? '';
        if (!STORY_ID.test(story)) {
          sendJson(res, 400, { ok: false, error: 'query must be ?story=<story id>' });
          return;
        }
        const [status, body] = designView(epicDir, top, story, session.identity.by);
        sendJson(res, status, body);
        return;
      }
      const file = query.get('file') ?? '';
      const bytes = readLinkedDesignFile(top, file, 'file');
      if (bytes) send(res, 200, 'application/octet-stream', bytes);
      else sendJson(res, 404, { ok: false, error: `${file} is not a .figcraft file linked in design/links.yaml, or it does not exist` });
      return;
    }
    const body = await readJsonPost(req, session, path === '/api/design/save' ? MAX_DESIGN_BODY_BYTES : MAX_BODY_BYTES);
    if ('status' in body) {
      sendJson(res, body.status, { ok: false, error: body.error });
      return;
    }
    if (path === '/api/design/save') {
      const [status, out] = saveDesign(top, body.json);
      sendJson(res, status, out);
      return;
    }
    if (path === '/api/design/link') {
      const [status, out] = linkDesign(epicDir, top, body.json);
      sendJson(res, status, out);
      return;
    }
    if (path === '/api/design/refresh') {
      const [status, out] = await refreshDesignPictures(epicDir, top, body.json, control);
      sendJson(res, status, out);
      return;
    }
    const version = body.json.version;
    if (version !== undefined && !(typeof version === 'string' && FIGCRAFT_VERSION.test(version))) {
      sendJson(res, 400, { ok: false, error: '"version" must be a FigCraft version, like "0.16.0"' });
      return;
    }
    const fetched = await fetchFigcraftWeb({ top, ...(version !== undefined ? { version } : {}), ...(fetcher ? { fetcher } : {}) });
    sendJson(res, 200, { ok: true, version: fetched.version });
  } catch (e) {
    if (e instanceof FigcraftFetchError) sendJson(res, e.kind === 'hash mismatch' ? 409 : 502, { ok: false, reason: e.kind, error: e.message });
    else sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Run approve or sign-off as the server's identity, with the server's key. */
function write(res: ServerResponse, path: string, ids: Id[], epicDir: string, session: ServerSession, verifier: Verifier): void {
  if (!session.signer.ok) {
    sendJson(res, 503, { ok: false, reason: session.signer.reason });
    return;
  }
  const opts = { signer: session.signer.signer, verifier };
  const result =
    path === '/api/approve'
      ? approveScenarios(epicDir, ids, session.identity, opts)
      : signOff(epicDir, ids, session.identity, { ...opts, simulate: simulateRecord });
  if (result.ok) {
    sendJson(res, 200, 'approvals' in result ? { ok: true, approved: result.approvals } : { ok: true, signOff: result.signOff });
  } else if (result.reason !== undefined) {
    sendJson(res, 503, { ok: false, reason: result.reason });
  } else {
    sendJson(res, 409, { ok: false, findings: result.findings satisfies Finding[] });
  }
}

type PostError = { status: number; error: string };

/** The session token (403) and a same-origin Origin when one is sent (403). */
function checkRequest(req: IncomingMessage, session: ServerSession): PostError | undefined {
  if (!tokenMatches(session, req.headers[TOKEN_HEADER])) return { status: 403, error: `missing or wrong ${TOKEN_HEADER} header` };
  if (!sameOrigin(req)) return { status: 403, error: 'Origin does not match Host' };
  return undefined;
}

/**
 * Check a POST and read its JSON object: the token and Origin (403), a JSON content type (415),
 * a body under `limit` (default MAX_BODY_BYTES; 413) that is a JSON object (400).
 */
async function readJsonPost(req: IncomingMessage, session: ServerSession, limit = MAX_BODY_BYTES): Promise<{ json: Record<string, unknown> } | PostError> {
  const refused = checkRequest(req, session);
  if (refused) return drain(req, refused);
  const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'application/json') return drain(req, { status: 415, error: 'body must be application/json' });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) return { status: 413, error: `body is larger than ${limit} bytes` };
    chunks.push(chunk);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return { status: 400, error: 'body is not JSON' };
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { status: 400, error: 'body must be a JSON object' };
  return { json: body as Record<string, unknown> };
}

/** A POST whose `field` is a list of strings (400 otherwise). */
async function readPost(req: IncomingMessage, session: ServerSession, field: string): Promise<Id[] | PostError> {
  const body = await readJsonPost(req, session);
  if ('status' in body) return body;
  const ids = body.json[field];
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return { status: 400, error: `body must be { "${field}": string[] }` };
  return ids as Id[];
}

/**
 * The Birdview actions of the Tests tab (T45). `play-story {story}` switches the player to this
 * repo's test project, writes the story playlist through it and plays it; `play-test {story, test}`
 * does the same for one test of the story, or a list of them; `use-project {to: "this" | "default"}` only switches.
 * A failure is a BirdviewError: 409 busy, 503 not running, 404, 400 or 502, in plain words.
 */
async function playerAction(setup: BirdviewSetup, epicDir: string, action: PlayerAction, body: Record<string, unknown>): Promise<[number, unknown]> {
  if (action === 'use-project') {
    if (body.to !== 'this' && body.to !== 'default') return [400, { ok: false, error: 'body must be { "to": "this" | "default" }' }];
    return [200, { ok: true, ...(await useProject(setup, body.to)) }];
  }
  const story = body.story;
  if (typeof story !== 'string' || !STORY_ID.test(story)) return [400, { ok: false, error: 'story must be a story id' }];
  if (action === 'play-story') return [200, { ok: true, ...(await playStory(setup, epicDir, story)) }];
  // One key, or several: the new tests a merge brought (T48).
  const test = body.test;
  const keys = Array.isArray(test) ? test : [test];
  if (keys.length === 0 || !keys.every((k) => typeof k === 'string' && TEST_KEY.test(k))) {
    return [400, { ok: false, error: 'test must be a test key, <file>:<line>, or a list of them' }];
  }
  return [200, { ok: true, ...(await playStory(setup, epicDir, story, Array.isArray(test) ? (keys as string[]) : (test as string))) }];
}

/** Discard the body of a refused request, so the connection can answer. */
function drain(req: IncomingMessage, error: PostError): PostError {
  req.resume();
  return error;
}

/** An Origin header, when present, must name the host the request came to (the Host header). */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === (req.headers.host ?? '').toLowerCase();
  } catch {
    return false;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  send(res, status, TYPES['.json']!, JSON.stringify(body));
}

function serveStatic(uiDir: string, path: string, res: ServerResponse): void {
  const index = join(uiDir, 'index.html');
  const file = normalize(join(uiDir, path));
  const inside = file === normalize(uiDir) || file.startsWith(normalize(uiDir) + sep);
  if (inside && path !== '/' && existsSync(file) && statSync(file).isFile()) {
    send(res, 200, TYPES[extname(file)] ?? 'application/octet-stream', readFileSync(file));
    return;
  }
  // A path with an extension is a missing asset; any other path is the app (one page).
  if (path !== '/' && extname(path) !== '') {
    send(res, 404, 'text/plain; charset=utf-8', 'not found\n');
    return;
  }
  send(res, 200, TYPES['.html']!, existsSync(index) ? readFileSync(index) : NOT_BUILT);
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}

/** Start the server on 127.0.0.1. There is no option for another host (R20). */
export function startServer(opts: ServeOptions): Promise<RunningServer> {
  const graph = opts.graph ?? graphServiceFor(opts.epicDir);
  const server = createServer(createHandler({ ...opts, graph }));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, LISTEN_HOST, () => {
      server.off('error', reject);
      const { port } = server.address() as AddressInfo;
      resolve({
        server,
        host: LISTEN_HOST,
        port,
        url: `http://${LISTEN_HOST}:${port}/`,
        close: () => new Promise((done) => server.close(() => void graph.close().then(done, done))),
      });
    });
  });
}
