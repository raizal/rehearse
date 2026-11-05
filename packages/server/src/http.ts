// `rehearse serve`: the built UI plus a JSON API, on 127.0.0.1 only (R12, R20).
// Remote access goes through `bb connect expose <port>`, never through this server.
// The only record writes are approve and sign-off, from the UI (R13, R14, D41). The story thread
// panel (T12) writes local state only (.rehearse/story-threads.json) and runs `bb`. Each POST and
// each story-thread request needs the session token and a same-origin Origin (when sent); the
// identity and the signing key are the server process's, never the request's.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import { approveScenarios, defaultVerifier, signOff, simulateRecord, type Finding, type Id, type Verifier } from '@rehearse/core';
import { createSession, sessionInfo, tokenMatches, type ServerSession } from './session.js';
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
  /** Runs `git` and `bb` for the story thread panel. Default: the real programs. */
  run?: Runner;
  /** bb project for new story threads. Default: REHEARSE_BB_PROJECT, else BB_PROJECT_ID. */
  bbProject?: string;
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

type HandlerOptions = Pick<ServeOptions, 'epicDir' | 'uiDir' | 'session' | 'verifier' | 'run' | 'bbProject'>;

const ROUTES: Record<string, string> = {
  '/api/session': 'GET, HEAD',
  '/api/epic': 'GET, HEAD',
  '/api/approve': 'POST',
  '/api/sign-off': 'POST',
  '/api/story-thread': 'GET, HEAD',
  '/api/story-thread/link': 'POST',
  '/api/story-thread/start': 'POST',
  '/api/story-thread/send': 'POST',
  '/api/story-thread/open': 'POST',
};

/** The request handler, without listening. */
export function createHandler(opts: HandlerOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const session = opts.session ?? createSession(opts.epicDir);
  const verifier = opts.verifier ?? defaultVerifier(opts.epicDir);
  const bbProject = opts.bbProject ?? (process.env.REHEARSE_BB_PROJECT || process.env.BB_PROJECT_ID || undefined);
  const threads = createStoryThreads({ epicDir: opts.epicDir, run: opts.run ?? processRunner(), ...(bbProject ? { bbProject } : {}) });
  return (req, res) => {
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
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
    serveStatic(opts.uiDir, path, res);
  };
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
    if (e instanceof StoryThreadError) sendJson(res, e.status, { ok: false, error: e.message });
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
  const server = createServer(createHandler(opts));
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
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
