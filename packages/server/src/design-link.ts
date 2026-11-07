// Linking a design without editing YAML (T51, boxes `link-design` and `refresh-design-pictures`).
//
// `POST /api/design/link {epic, story, box?, file, page, frame?}` (or `{…, unlink: true}`) is the
// owner's click in the picker or on a suggestion: it rewrites design/links.yaml with the yaml
// document API (comments and order kept) and only points at a .figcraft file under design/ that the
// design index has, at a page and frame that file has. `POST /api/design/refresh {story}` asks a
// running FigCraft for pictures of the story's linked frames, only when the linked file is FigCraft's
// active tab, and writes them to design/<n>-<slug>.png (design/frames/<frame-slug>.png for a frame
// link). Both are owner actions behind the token and Origin check; agents never call them.

import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join, sep } from 'node:path';
import {
  DESIGN_LINKS_FILE,
  findFrame,
  findPage,
  framePngPath,
  frameRef,
  indexBoxes,
  isDesignPath,
  loadEpic,
  pagePngPath,
  readDesignState,
  setDesignLink,
  storyEffectiveDesign,
  type DesignLink,
} from '@rehearse/core';
import { FigcraftNotRunning, listFigcraftDocs, renderFigcraftPng, type FigcraftControlAddress } from './figcraft-control.js';

/** What the owner is told when FigCraft does not answer. */
export const FIGCRAFT_NOT_RUNNING = 'Open the file in FigCraft (port 4800) to refresh pictures';

export type LinkResult = [200, { ok: true; link: DesignLink | null; linksFile: string }] | [number, { ok: false; reason: string; error: string }];

const STORY_ID = /^S[0-9]+$/;
const refuse = (status: number, reason: string, error: string, items?: RefreshItem[]): [number, { ok: false; reason: string; error: string; items?: RefreshItem[] }] => [
  status,
  { ok: false, reason, error, ...(items ? { items } : {}) },
];

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

/**
 * Write a file under <top>/design/ through a temp file and a rename. The folder (made when missing)
 * and the file when it exists must resolve inside design/; else nothing is written and false is returned.
 */
function writeInDesign(top: string, rel: string, data: string | Buffer): boolean {
  const root = designRoot(top);
  if (!root || !rel.startsWith('design/')) return false;
  const target = join(top, rel);
  const folderRel = dirname(rel);
  if (folderRel !== 'design' && !existsSync(join(top, folderRel))) mkdirSync(join(top, folderRel), { recursive: true });
  let folder: string;
  try {
    folder = realpathSync(dirname(target));
  } catch {
    return false;
  }
  if (!(folder === root || inside(root, folder))) return false;
  const dest = join(folder, basename(target));
  if (existsSync(dest)) {
    const real = realpathSync(dest);
    if (!inside(root, real) || !statSync(real).isFile()) return false;
  }
  const tmp = join(folder, `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, data, { flag: 'wx' });
    renameSync(tmp, dest);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return true;
}

/** Link (or unlink) a story or a box of it, from the body of `POST /api/design/link`. */
export function linkDesign(epicDir: string, top: string, body: Record<string, unknown>): LinkResult {
  const { epic, story, box, file, page, frame, unlink } = body;
  const { record } = loadEpic(epicDir);
  if (typeof epic !== 'string' || typeof story !== 'string' || !STORY_ID.test(story)) return refuse(400, 'bad body', 'body must be { "epic", "story", "box"?, "file", "page", "frame"? } or { "epic", "story", "box"?, "unlink": true }');
  if (epic !== record.slug) return refuse(400, 'other epic', `this server serves the EPIC ${record.slug}, not ${epic}`);
  if (!record.prd?.stories.some((s) => s.id === story)) return refuse(404, 'unknown story', `no story ${story} in prd.yaml`);
  if (box !== undefined && (typeof box !== 'string' || !indexBoxes(record.flow).has(box))) return refuse(404, 'unknown box', `no box ${JSON.stringify(box)} in flow.yaml`);
  const boxPath = box as string | undefined;

  let link: DesignLink | null = null;
  if (unlink !== true) {
    if (unlink !== undefined) return refuse(400, 'bad body', '"unlink" must be true when it is sent');
    if (typeof file !== 'string' || !isDesignPath(file, '.figcraft')) return refuse(400, 'file not in design/', `${JSON.stringify(file)} is not a .figcraft file under design/`);
    const index = readDesignState(top, record).index.files.find((f) => f.file === file);
    if (!index) return refuse(404, 'file not in design/', `${file} is not a FigCraft file the design index has under design/`);
    if (!((typeof page === 'number' && Number.isInteger(page)) || typeof page === 'string')) return refuse(400, 'bad body', '"page" must be a page number or a page name');
    const p = findPage(index, page);
    if (!p) return refuse(404, 'unknown page', `${file} has no page ${JSON.stringify(page)}`);
    let png = p.png;
    let ref: string | undefined;
    if (frame !== undefined) {
      if (typeof frame !== 'string' || frame === '') return refuse(400, 'bad body', '"frame" must be the id or name of a top-level frame');
      const f = findFrame(p, frame);
      if (!f) return refuse(404, 'unknown frame', `page ${p.number} "${p.name}" of ${file} has no top-level frame ${JSON.stringify(frame)}`);
      ref = frameRef(p, f);
      png = f.png ?? p.png;
    }
    link = { file, page: p.number, ...(ref !== undefined ? { frame: ref } : {}), ...(png ? { png } : {}) };
  }

  const linksPath = join(top, DESIGN_LINKS_FILE);
  const root = designRoot(top);
  if (!root) return refuse(403, 'outside design', 'design/ is missing or leads outside the repo; links.yaml is not written');
  let text: string | undefined;
  if (existsSync(linksPath)) {
    const real = realpathSync(linksPath);
    if (!inside(root, real)) return refuse(403, 'outside design', `${DESIGN_LINKS_FILE} leads outside design/ (a symlink); not written`);
    text = readFileSync(real, 'utf8');
  }
  let next: string;
  try {
    next = setDesignLink(text, record.slug, story, boxPath, link);
  } catch (e) {
    return refuse(409, 'links.yaml invalid', `${e instanceof Error ? e.message : String(e)}; fix it first (rehearse validate says what is wrong)`);
  }
  if (next !== (text ?? '') && !writeInDesign(top, DESIGN_LINKS_FILE, next)) return refuse(403, 'outside design', `${DESIGN_LINKS_FILE} leads outside design/; not written`);
  return [200, { ok: true, link, linksFile: DESIGN_LINKS_FILE }];
}

/** One picture `POST /api/design/refresh` wrote, or did not. */
export interface RefreshItem {
  /** "the story" or "box <path>" */
  what: string;
  file: string;
  png?: string;
  skipped?: string;
}

export type RefreshResult =
  | [200, { ok: true; wrote: string[]; items: RefreshItem[]; message: string }]
  | [number, { ok: false; reason: string; error: string; items?: RefreshItem[] }];

/** The real path of a file, or the path itself. */
function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Refresh the pictures of a story's linked pages and frames from the running FigCraft. Asks
 * `doc.list` which tab is active; a link to another file is skipped ("file not the active tab").
 * A page link renders the page's first top-level frame. Writes only under design/.
 */
export async function refreshDesignPictures(epicDir: string, top: string, body: Record<string, unknown>, control: FigcraftControlAddress): Promise<RefreshResult> {
  const { story } = body;
  if (typeof story !== 'string' || !STORY_ID.test(story)) return refuse(400, 'bad body', 'body must be { "story": "<story id>" }');
  const { record } = loadEpic(epicDir);
  if (!record.prd?.stories.some((s) => s.id === story)) return refuse(404, 'unknown story', `no story ${story} in prd.yaml`);
  const state = readDesignState(top, record);
  const eff = storyEffectiveDesign(state, record.slug, story);
  const links: { what: string; link: DesignLink }[] = [
    ...(eff.story ? [{ what: 'the story', link: eff.story.link }] : []),
    ...Object.entries(eff.boxes).map(([b, s]) => ({ what: `box ${b}`, link: s.link })),
  ];
  if (links.length === 0) return refuse(400, 'nothing linked', `${story} has no design linked; link one first`);

  let docs;
  try {
    docs = await listFigcraftDocs(control);
  } catch (e) {
    if (e instanceof FigcraftNotRunning) return refuse(503, 'FigCraft not running', FIGCRAFT_NOT_RUNNING);
    return refuse(502, 'FigCraft error', e instanceof Error ? e.message : String(e));
  }
  const active = docs.find((d) => d.active);
  const activePath = active && typeof active.path === 'string' && active.path !== '' ? real(active.path) : undefined;

  const items: RefreshItem[] = [];
  const wrote: string[] = [];
  for (const { what, link } of links) {
    const item: RefreshItem = { what, file: link.file };
    items.push(item);
    if (activePath === undefined || activePath !== real(join(top, link.file))) {
      item.skipped = 'file not the active tab';
      continue;
    }
    const index = state.index.files.find((f) => f.file === link.file);
    const page = index && findPage(index, link.page);
    if (!page) {
      item.skipped = `the file has no page ${link.page}`;
      continue;
    }
    const frame = link.frame !== undefined ? findFrame(page, link.frame) : page.frames[0];
    if (!frame) {
      item.skipped = link.frame !== undefined ? `page ${page.number} has no frame ${link.frame}` : `page ${page.number} has no top-level frame`;
      continue;
    }
    const png = link.frame !== undefined ? framePngPath(frame.name) : pagePngPath(page.number, page.name);
    if (wrote.includes(png)) {
      item.png = png;
      continue;
    }
    let data: Buffer;
    try {
      data = await renderFigcraftPng(control, frame.id);
    } catch (e) {
      item.skipped = e instanceof Error ? e.message : String(e);
      continue;
    }
    if (!writeInDesign(top, png, data)) {
      item.skipped = `${png} leads outside design/; not written`;
      continue;
    }
    item.png = png;
    wrote.push(png);
  }
  if (wrote.length === 0) {
    const notActive = items.every((i) => i.skipped === 'file not the active tab');
    const files = [...new Set(items.map((i) => i.file))].join(', ');
    return notActive
      ? refuse(409, 'file not the active tab', `${files} is not the active tab in FigCraft${active ? ` (the active tab is ${active.name})` : ''}; open it there, then refresh pictures`, items)
      : refuse(502, 'nothing rendered', items.map((i) => `${i.what}: ${i.skipped}`).join('; '), items);
  }
  const skipped = items.filter((i) => i.skipped);
  const message = `Wrote ${wrote.join(', ')}.${skipped.length ? ` Skipped ${skipped.map((i) => `${i.what} (${i.skipped})`).join(', ')}.` : ''}`;
  return [200, { ok: true, wrote, items, message }];
}
