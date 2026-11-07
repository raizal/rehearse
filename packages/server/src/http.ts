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
// git history too, with the same check.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, relative, sep } from 'node:path';
import { approveScenarios, defaultVerifier, signOff, simulateRecord, type Finding, type Id, type Verifier } from '@rehearse/core';
import { MAP_LEVELS, type CoverageStats, type MapLevel } from '@rehearse/graph';
import { boxCode, codeIndex, epicBoxPaths, execGit, type GitRunner } from './box-code.js';
import { birdviewInfo, DEFAULT_BIRDVIEW_PORT, findTestProject, PLAYER_ACTIONS, type BirdviewSetup, type PlayerAction } from './birdview.js';
import { BirdviewError, playStory, useProject } from './birdview-play.js';
import { gatherBriefCode } from './brief-code.js';
import { graphServiceFor, repoRoot, type GraphService } from './graph-route.js';
import { createSession, sessionInfo, tokenMatches, type ServerSession } from './session.js';
import { MAX_PREVIEW_STORIES, signOffPreview } from './signoff-preview.js';
import { bbProjectFrom } from './bb-project.js';
import { createStoryThreads, processRunner, StoryThreadError, type Runner, type StoryThreadService } from './story-thread.js';
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

type HandlerOptions = Pick<ServeOptions, 'epicDir' | 'uiDir' | 'session' | 'verifier' | 'git' | 'run' | 'bbProject' | 'birdview' | 'graph' | 'threadModel' | 'threadReasoning'>;

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
  '/api/birdview': 'GET',
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
  const threads = createStoryThreads({
    epicDir: opts.epicDir,
    run: opts.run ?? processRunner(),
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
 * a body under MAX_BODY_BYTES (413) that is a JSON object (400).
 */
async function readJsonPost(req: IncomingMessage, session: ServerSession): Promise<{ json: Record<string, unknown> } | PostError> {
  const refused = checkRequest(req, session);
  if (refused) return drain(req, refused);
  const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'application/json') return drain(req, { status: 415, error: 'body must be application/json' });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return { status: 413, error: `body is larger than ${MAX_BODY_BYTES} bytes` };
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
 * does the same for one test of the story; `use-project {to: "this" | "default"}` only switches.
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
  const test = body.test;
  if (typeof test !== 'string' || !TEST_KEY.test(test)) return [400, { ok: false, error: 'test must be a test key, <file>:<line>' }];
  return [200, { ok: true, ...(await playStory(setup, epicDir, story, test)) }];
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
