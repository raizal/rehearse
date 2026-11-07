// The Design tab (T50, boxes `design-tab`, `figcraft-host`, `design-save`): the story's links from
// design/links.yaml, the linked PNGs and .figcraft files, the one design write (the owner's Save in
// the embedded FigCraft) and the FigCraft web build hosted at /figcraft/. Only files linked in
// links.yaml are read or written, and a write never leaves <top>/design/ (a symlink is followed and checked).

import { existsSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, extname, join, normalize, sep } from 'node:path';
import {
  DESIGN_LINKS_FILE,
  designLinkFindings,
  designLinkLine,
  isDesignPath,
  loadEpic,
  readDesignLinks,
  repoCommands,
  storyDesignLinks,
  type DesignLink,
  type DesignLinks,
  type Finding,
} from '@rehearse/core';
import { installedFigcraftWeb } from './figcraft-web.js';

/** The FigCraft web build's URL on this server. */
export const FIGCRAFT_PATH = '/figcraft/';
/** Largest body of `POST /api/design/save`: the base64 of a .figcraft file. */
export const MAX_DESIGN_BODY_BYTES = 64 * 1024 * 1024;

/** `GET /api/design?story=`: what the Design tab shows. */
export interface DesignView {
  ok: true;
  slug: string;
  story: DesignLink | null;
  boxes: Record<string, DesignLink>;
  /** The findings of links.yaml that name this story, and those of the whole file (a parse error). */
  findings: Finding[];
  linksFile: string;
  /** The line to add to links.yaml to link this story. */
  linkLine: string;
  figcraft: { fetched: boolean; version?: string; url: string; command: string };
  /** The name FigCraft shows as the author: the server's identity. */
  author: string;
}

/** The fetch command in the repo's form (`pnpm rehearse figcraft fetch` or `rehearse figcraft fetch`). */
export function figcraftFetchCommand(top: string): string {
  return `${repoCommands(top).cli} figcraft fetch`;
}

export function designView(epicDir: string, top: string, storyId: string, author: string): [number, unknown] {
  const { record } = loadEpic(epicDir);
  if (!record.prd?.stories.some((s) => s.id === storyId)) return [404, { ok: false, error: `no story ${storyId} in prd.yaml` }];
  const mine = storyDesignLinks(readDesignLinks(top).links, record.slug, storyId);
  const findings = designLinkFindings(record, top).filter((f) => f.refs.length === 0 || f.refs.includes(storyId));
  const installed = installedFigcraftWeb(top);
  const view: DesignView = {
    ok: true,
    slug: record.slug,
    story: mine.story ?? null,
    boxes: mine.boxes,
    findings,
    linksFile: DESIGN_LINKS_FILE,
    linkLine: designLinkLine(storyId),
    figcraft: { fetched: installed !== undefined, ...(installed ? { version: installed.version } : {}), url: FIGCRAFT_PATH, command: figcraftFetchCommand(top) },
    author,
  };
  return [200, view];
}

/** Every link of every EPIC and story, boxes too. */
function allLinks(links: DesignLinks): DesignLink[] {
  return Object.values(links).flatMap((stories) => Object.values(stories).flatMap((one) => [...(one.story ? [one.story] : []), ...Object.values(one.boxes)]));
}

/** A path is linked in links.yaml as a `file` (.figcraft) or a `png`. */
export function isLinked(top: string, path: string, as: 'file' | 'png'): boolean {
  return allLinks(readDesignLinks(top).links).some((l) => l[as] === path);
}

/** `<top>/design` when it is a real folder of the repo (not a symlink out of it), else undefined. */
function designRoot(top: string): string | undefined {
  try {
    const real = realpathSync(join(top, 'design'));
    return real === join(realpathSync(top), 'design') ? real : undefined;
  } catch {
    return undefined;
  }
}

const inside = (root: string, p: string) => p.startsWith(root + sep);

/** A linked design file's bytes, when the path is a design path, linked, and stays in design/; else undefined. */
export function readLinkedDesignFile(top: string, path: string, as: 'file' | 'png'): Buffer | undefined {
  if (!isDesignPath(path, as === 'png' ? '.png' : '.figcraft') || !isLinked(top, path, as)) return undefined;
  const root = designRoot(top);
  if (!root) return undefined;
  try {
    const real = realpathSync(join(top, path));
    if (!inside(root, real) || !statSync(real).isFile()) return undefined;
    return readFileSync(real);
  } catch {
    return undefined;
  }
}

/** The answer to `POST /api/design/save`. */
export type SaveResult = [200, { ok: true; file: string; size: number }] | [number, { ok: false; reason: string; error: string }];

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Save the bytes FigCraft sends for a linked .figcraft file: the path is checked (400 `bad path`),
 * it must be a `file` of links.yaml (403 `not linked`), and its folder, and the file when it exists,
 * must resolve inside <top>/design/ (403 `outside design`). Written to a temp file beside it, then renamed.
 */
export function saveDesign(top: string, body: Record<string, unknown>): SaveResult {
  const { file, bytes } = body;
  const refuse = (status: number, reason: string, error: string): SaveResult => [status, { ok: false, reason, error }];
  if (typeof file !== 'string' || typeof bytes !== 'string') return refuse(400, 'bad body', 'body must be { "file": "design/<name>.figcraft", "bytes": "<base64>" }');
  if (!isDesignPath(file, '.figcraft')) return refuse(400, 'bad path', `${JSON.stringify(file)} is not a .figcraft file under design/ (no "..", no absolute path)`);
  if (!isLinked(top, file, 'file')) return refuse(403, 'not linked', `${file} is not in ${DESIGN_LINKS_FILE}; only linked design files are saved`);
  if (bytes === '' || bytes.length % 4 !== 0 || !BASE64.test(bytes)) return refuse(400, 'bad body', '"bytes" must be the file in base64, not empty');
  const root = designRoot(top);
  const target = join(top, file);
  let folder: string;
  try {
    folder = realpathSync(dirname(target));
  } catch {
    return refuse(403, 'outside design', `the folder of ${file} does not exist; not saved`);
  }
  const leaves = () => refuse(403, 'outside design', `${file} leads outside design/ (a symlink); not saved`);
  if (!root || !(folder === root || inside(root, folder))) return leaves();
  const dest = join(folder, basename(target));
  if (existsSync(dest)) {
    const real = realpathSync(dest);
    if (!inside(root, real) || !statSync(real).isFile()) return leaves();
  }
  const data = Buffer.from(bytes, 'base64');
  const tmp = join(folder, `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, data, { flag: 'wx' });
    renameSync(tmp, dest);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return [200, { ok: true, file, size: data.length }];
}

const FIGCRAFT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/** FigCraft runs in an iframe of the rehearse page: same origin only. */
const FRAME_HEADERS = { 'content-security-policy': "frame-ancestors 'self'" };

export function notFetchedPage(top: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>FigCraft</title></head>
<body><p>The FigCraft web build is not fetched. Run <code>${figcraftFetchCommand(top)}</code> (or the button on the Design tab), then reload.</p></body></html>
`;
}

/**
 * `GET /figcraft/<file>`: a file of the newest fetched web build (`/figcraft/` is index.html),
 * as [status, content type, body, headers]. Not fetched: a 404 page that says how to fetch it.
 */
export function figcraftFile(top: string, path: string): [number, string, string | Buffer, Record<string, string>] {
  const installed = installedFigcraftWeb(top);
  if (!installed) return [404, FIGCRAFT_TYPES['.html']!, notFetchedPage(top), FRAME_HEADERS];
  const rel = path.slice(FIGCRAFT_PATH.length) || 'index.html';
  const root = normalize(installed.dir);
  const file = normalize(join(root, rel));
  if (!inside(root, file) || !existsSync(file) || !statSync(file).isFile()) return [404, 'text/plain; charset=utf-8', 'not found\n', FRAME_HEADERS];
  const cache = rel === 'index.html' ? 'no-cache' : 'max-age=86400';
  return [200, FIGCRAFT_TYPES[extname(file)] ?? 'application/octet-stream', readFileSync(file), { ...FRAME_HEADERS, 'cache-control': cache }];
}
