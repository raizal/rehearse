// The design index (T51, box `design-index`), pure: what a `.figcraft` file holds — its pages (number
// and name) and their top-level frames (id and name) — and which picture shows each. A `.figcraft`
// file is a zip whose `document.json` has `pages` (node ids, numbers or strings) and `nodes` (by id,
// each with `name`, `type`, `children`). A page's picture is an existing `design/<n>-<slug>.png`
// (as design/figcraft/export.py names them), else the file's `thumbnail.png`, marked "file
// thumbnail". A frame's own picture is `design/frames/<frame-slug>.png` when it exists. A file that
// cannot be read is a finding, never a throw.

import type { Finding } from '../types.js';
import { isObject } from '../util.js';
import { DESIGN_DIR, DESIGN_LINKS_FILE } from './links.js';
import { readZip, ZipError } from './zip.js';

/** Largest `.figcraft` file read, and the most its document may unpack to. */
export const MAX_FIGCRAFT_BYTES = 64 * 1024 * 1024;
/** Where frame pictures go, relative to the repo top. */
export const DESIGN_FRAMES_DIR = 'design/frames/';

export interface DesignFrame {
  id: string;
  name: string;
  /** `design/frames/<slug>.png` when that file exists. */
  png?: string;
}

export interface DesignPage {
  /** 1 is the first page. */
  number: number;
  id: string;
  name: string;
  /** `design/<n>-<slug>.png` when that file exists. */
  png?: string;
  frames: DesignFrame[];
}

export interface DesignFileIndex {
  /** Relative to the repo top, under design/. */
  file: string;
  pages: DesignPage[];
  /** The zip has a `thumbnail.png`. */
  thumbnail: boolean;
}

/** Every readable `.figcraft` file under design/, and a finding for each that is not. */
export interface DesignIndex {
  files: DesignFileIndex[];
  findings: Finding[];
}

/** A picture to show: a PNG in design/, or the file's thumbnail. */
export type DesignPicture = { kind: 'page' | 'frame'; png: string } | { kind: 'file thumbnail'; file: string };

/** "Story · code" → "story-code"; "13 Story code" → "13-story-code". */
export function designSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `design/13-story-code.png` for page 13 "13 Story code" (or "Story code"). */
export function pagePngPath(number: number, name: string): string {
  const slug = designSlug(name);
  const named = slug === String(number) || slug.startsWith(`${number}-`) ? slug : slug === '' ? String(number) : `${number}-${slug}`;
  return `${DESIGN_DIR}${named}.png`;
}

/** `design/frames/story-code.png` for the frame "Story · code". */
export function framePngPath(name: string): string {
  return `${DESIGN_FRAMES_DIR}${designSlug(name) || 'frame'}.png`;
}

const FRAME_TYPES = new Set(['frame', 'section', 'component', 'component_set', 'componentset', 'instance', 'group']);

const idOf = (v: unknown): string | undefined => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && v !== '' ? v : undefined);

/** The pages and top-level frames of a parsed `document.json`; an error in words when its shape is wrong. */
export function readFigcraftDocument(doc: unknown): { pages: DesignPage[] } | { error: string } {
  if (!isObject(doc) || !Array.isArray(doc.pages) || !isObject(doc.nodes)) return { error: 'document.json has no `pages` list and `nodes` map' };
  const nodes = doc.nodes;
  const node = (id: string): Record<string, unknown> | undefined => {
    const n = nodes[id];
    return isObject(n) ? n : undefined;
  };
  const pages: DesignPage[] = [];
  doc.pages.forEach((raw, i) => {
    const id = idOf(raw);
    const page = id === undefined ? undefined : node(id);
    if (id === undefined || !page) return;
    const name = typeof page.name === 'string' && page.name.trim() !== '' ? page.name : `Page ${i + 1}`;
    const frames: DesignFrame[] = [];
    for (const c of Array.isArray(page.children) ? page.children : []) {
      const cid = idOf(c);
      const child = cid === undefined ? undefined : node(cid);
      if (cid === undefined || !child) continue;
      const type = typeof child.type === 'string' ? child.type.toLowerCase() : 'frame';
      if (!FRAME_TYPES.has(type)) continue;
      frames.push({ id: cid, name: typeof child.name === 'string' ? child.name : `Frame ${cid}` });
    }
    pages.push({ number: i + 1, id, name, frames });
  });
  return { pages };
}

const indexFinding = (file: string, message: string): Finding => ({ kind: 'reference', file: DESIGN_LINKS_FILE, path: file, message: `${file}: ${message}`, refs: [] });

/** The finding for a file over MAX_FIGCRAFT_BYTES: it is not read. */
export function figcraftTooLarge(file: string): Finding {
  return indexFinding(file, `the file is larger than ${MAX_FIGCRAFT_BYTES / 1024 / 1024} MB; not read`);
}

/**
 * Index one `.figcraft` file from its bytes. `pngExists` takes a path relative to the repo top.
 * Too large, not a zip, no or bad `document.json`: a finding.
 */
export function indexFigcraftFile(file: string, bytes: Buffer, pngExists: (path: string) => boolean): { index: DesignFileIndex } | { finding: Finding } {
  if (bytes.length > MAX_FIGCRAFT_BYTES) return { finding: figcraftTooLarge(file) };
  let entries;
  try {
    entries = readZip(bytes, { only: (n) => n === 'document.json' || n === 'thumbnail.png', maxBytes: MAX_FIGCRAFT_BYTES });
  } catch (e) {
    return { finding: indexFinding(file, e instanceof ZipError ? `cannot read it: ${e.message}` : String(e)) };
  }
  const docEntry = entries.find((e) => e.name === 'document.json');
  if (!docEntry) return { finding: indexFinding(file, 'it has no document.json; is it a FigCraft file?') };
  let parsed: unknown;
  try {
    parsed = JSON.parse(docEntry.data.toString('utf8'));
  } catch (e) {
    return { finding: indexFinding(file, `document.json is not JSON: ${e instanceof Error ? e.message : String(e)}`) };
  }
  const read = readFigcraftDocument(parsed);
  if ('error' in read) return { finding: indexFinding(file, read.error) };
  return { index: withPictures({ file, pages: read.pages, thumbnail: entries.some((e) => e.name === 'thumbnail.png') }, pngExists) };
}

/** The index with the PNGs that exist now: a page's `design/<n>-<slug>.png`, a frame's `design/frames/<slug>.png`. */
export function withPictures(index: DesignFileIndex, pngExists: (path: string) => boolean): DesignFileIndex {
  const pages = index.pages.map(({ png: _png, ...p }) => {
    const png = pagePngPath(p.number, p.name);
    const frames = p.frames.map(({ png: _fpng, ...f }) => {
      const fpng = framePngPath(f.name);
      return pngExists(fpng) ? { ...f, png: fpng } : f;
    });
    return { ...p, ...(pngExists(png) ? { png } : {}), frames };
  });
  return { ...index, pages };
}

/** A page of an indexed file by its number or name (as links.yaml says it). */
export function findPage(index: DesignFileIndex, page: number | string): DesignPage | undefined {
  if (typeof page === 'number') return index.pages.find((p) => p.number === page);
  return index.pages.find((p) => p.name === page) ?? index.pages.find((p) => designSlug(p.name) === designSlug(page));
}

/** A top-level frame of a page by its id or its name. */
export function findFrame(page: DesignPage, frame: string): DesignFrame | undefined {
  return page.frames.find((f) => f.id === frame) ?? page.frames.find((f) => f.name === frame);
}

/** The picture of a page or a frame of it: the frame's PNG, the page's PNG, else the file thumbnail. */
export function pictureOf(index: DesignFileIndex, page: DesignPage, frame?: DesignFrame): DesignPicture | undefined {
  if (frame?.png) return { kind: 'frame', png: frame.png };
  if (page.png) return { kind: 'page', png: page.png };
  return index.thumbnail ? { kind: 'file thumbnail', file: index.file } : undefined;
}
