// Design links (T50, box `design-links`): `design/links.yaml` at the repo top links a story, and
// optionally a box of it, to a page of a FigCraft file and its PNG. It is not part of the signed
// record: the owner edits it freely. Pure: parse and check take text and an `exists` function; a
// bad link is a finding, never a throw.
//
//   epics:
//     2026-11-05-rehearse:
//       S12: { file: design/rehearse-review.figcraft, page: 14, png: design/14-story-tests.png }
//       S11:
//         file: design/rehearse-review.figcraft
//         page: 13
//         boxes:
//           watch-build: { file: design/rehearse-review.figcraft, page: 15 }

import type { EpicRecord, Finding, Id } from '../types.js';
import { indexBoxes } from '../flow-index.js';
import { asArray, isObject } from '../util.js';
import { parseYaml } from '../yaml.js';

/** Where the links live, relative to the repo top. */
export const DESIGN_LINKS_FILE = 'design/links.yaml';
/** The folder a linked file must be in, relative to the repo top. */
export const DESIGN_DIR = 'design/';

/** One link: a page of a FigCraft file, and the PNG of that page. Paths are relative to the repo top. */
export interface DesignLink {
  file: string;
  /** The page's number (1 is the first) or its name. */
  page: number | string;
  /** A top-level frame of the page, by its name or id (T51). */
  frame?: string;
  png?: string;
}

/** A story's link, and the links of its boxes (box path → link). */
export interface StoryDesignLinks {
  story?: DesignLink;
  boxes: Record<string, DesignLink>;
}

/** epic slug → story id → its links. */
export type DesignLinks = Record<string, Record<Id, StoryDesignLinks>>;

const finding = (path: string, message: string, refs: string[] = []): Finding => ({ kind: 'reference', file: DESIGN_LINKS_FILE, path, message, refs });

/** A path under design/ with no `..`, `.` or empty part, no backslash and no leading slash. */
export function isDesignPath(p: string, ext: string): boolean {
  if (!p.startsWith(DESIGN_DIR) || !p.endsWith(ext) || p.includes('\\') || p.includes('\0')) return false;
  return p.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function readLink(v: unknown, where: string, refs: string[], findings: Finding[]): DesignLink | undefined {
  if (!isObject(v)) {
    findings.push(finding(where, 'a link must be { file, page, frame?, png? }', refs));
    return undefined;
  }
  const { file, page, png } = v;
  const frame = typeof v.frame === 'number' && Number.isInteger(v.frame) ? String(v.frame) : v.frame;
  let ok = true;
  if (typeof file !== 'string' || !isDesignPath(file, '.figcraft')) {
    findings.push(finding(`${where}.file`, `file must be a .figcraft file under design/, not ${JSON.stringify(file)}`, refs));
    ok = false;
  }
  const pageOk = (typeof page === 'number' && Number.isInteger(page) && page >= 1) || (typeof page === 'string' && page.trim() !== '');
  if (!pageOk) {
    findings.push(finding(`${where}.page`, `page must be a page number (1 is the first) or a page name, not ${JSON.stringify(page)}`, refs));
    ok = false;
  }
  if (png !== undefined && (typeof png !== 'string' || !isDesignPath(png, '.png'))) {
    findings.push(finding(`${where}.png`, `png must be a .png file under design/, not ${JSON.stringify(png)}`, refs));
    ok = false;
  }
  if (frame !== undefined && (typeof frame !== 'string' || frame.trim() === '')) {
    findings.push(finding(`${where}.frame`, `frame must be the name or id of a top-level frame of the page, not ${JSON.stringify(frame)}`, refs));
    ok = false;
  }
  for (const key of Object.keys(v)) if (!['file', 'page', 'frame', 'png', 'boxes'].includes(key)) findings.push(finding(`${where}.${key}`, `unknown key ${key}`, refs));
  if (!ok) return undefined;
  return { file: file as string, page: page as number | string, ...(typeof frame === 'string' ? { frame } : {}), ...(typeof png === 'string' ? { png } : {}) };
}

/** Parse links.yaml. Malformed entries are findings and are left out; the rest are kept. */
export function parseDesignLinks(text: string): { links: DesignLinks; findings: Finding[] } {
  const parsed = parseYaml(text, DESIGN_LINKS_FILE);
  if (parsed.finding) return { links: {}, findings: [parsed.finding] };
  const findings: Finding[] = [];
  const links: DesignLinks = {};
  const doc = parsed.value;
  if (doc === null || doc === undefined) return { links, findings };
  if (!isObject(doc) || !isObject(doc.epics)) return { links, findings: [finding('', 'links.yaml must hold `epics:`, a map of EPIC slug → story id → link')] };
  for (const [slug, stories] of Object.entries(doc.epics)) {
    if (!isObject(stories)) {
      findings.push(finding(`epics.${slug}`, 'must be a map of story id → link'));
      continue;
    }
    const out: Record<Id, StoryDesignLinks> = {};
    for (const [storyId, entry] of Object.entries(stories)) {
      const where = `epics.${slug}.${storyId}`;
      const one: StoryDesignLinks = { boxes: {} };
      if (isObject(entry) && (entry.file !== undefined || entry.page !== undefined || entry.png !== undefined || entry.frame !== undefined)) {
        const story = readLink(entry, where, [storyId], findings);
        if (story) one.story = story;
      } else if (!isObject(entry) || entry.boxes === undefined) {
        findings.push(finding(where, 'a story link must be { file, page, frame?, png?, boxes? }', [storyId]));
      }
      if (isObject(entry) && entry.boxes !== undefined) {
        if (!isObject(entry.boxes)) findings.push(finding(`${where}.boxes`, 'boxes must be a map of box path → link', [storyId]));
        else
          for (const [box, link] of Object.entries(entry.boxes)) {
            const read = readLink(link, `${where}.boxes.${box}`, [storyId], findings);
            if (read) one.boxes[box] = read;
          }
      }
      out[storyId] = one;
    }
    links[slug] = out;
  }
  return { links, findings };
}

/**
 * Check the links of one EPIC against its record and the files: the story and the box must
 * exist, the box must serve the story, and the linked file and PNG must be there.
 * `exists` takes a path relative to the repo top.
 */
export function checkDesignLinks(links: DesignLinks, record: EpicRecord, exists: (path: string) => boolean): Finding[] {
  const mine = links[record.slug];
  if (!mine) return [];
  const findings: Finding[] = [];
  const stories = new Set(asArray<{ id?: string }>(record.prd?.stories).filter(isObject).map((s) => s.id));
  const boxes = indexBoxes(record.flow);
  const checkFiles = (link: DesignLink, where: string, refs: string[]) => {
    if (!exists(link.file)) findings.push(finding(`${where}.file`, `${link.file} does not exist`, refs));
    if (link.png !== undefined && !exists(link.png)) findings.push(finding(`${where}.png`, `${link.png} does not exist`, refs));
  };
  for (const [storyId, one] of Object.entries(mine)) {
    const where = `epics.${record.slug}.${storyId}`;
    if (!stories.has(storyId)) {
      findings.push(finding(where, `no story ${storyId} in the EPIC ${record.slug}`, [storyId]));
      continue;
    }
    if (one.story) checkFiles(one.story, where, [storyId]);
    for (const [path, link] of Object.entries(one.boxes)) {
      const at = `${where}.boxes.${path}`;
      const entry = boxes.get(path);
      if (!entry) findings.push(finding(at, `no box ${path} in flow.yaml`, [storyId]));
      checkFiles(link, at, [storyId]);
    }
  }
  return findings;
}

/** The links of one story: its own and its boxes'. */
export function storyDesignLinks(links: DesignLinks, slug: string, storyId: Id): StoryDesignLinks {
  return links[slug]?.[storyId] ?? { boxes: {} };
}

/** "page 13", or "page Story code" for a page named in links.yaml. */
export function designPageText(page: number | string): string {
  return `page ${page}`;
}

/** The line to add under `epics: <slug>:` in links.yaml to link a story. */
export function designLinkLine(storyId: Id, file = 'design/<name>.figcraft'): string {
  return `${storyId}: { file: ${file}, page: <page number or name>, png: design/<page>.png }`;
}
