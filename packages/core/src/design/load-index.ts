// The design index from disk (T51, box `design-index`): every `design/**/*.figcraft` of the repo,
// read once per file and kept while its mtime and size stay the same; the PNGs are looked up on
// each read, so a refreshed picture shows at once. Symlinks are not followed. Also the facts of
// every EPIC under docs/epics/ that frame tags are resolved against, and the design state the
// Design tab, `rehearse design suggest` and `rehearse validate` share.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadEpic } from '../loader.js';
import { indexBoxes } from '../flow-index.js';
import type { EpicRecord, Finding } from '../types.js';
import { checkDesignLinks, DESIGN_DIR, isDesignPath, storyDesignLinks, type DesignLinks, type StoryDesignLinks } from './links.js';
import { fileExistsIn, readDesignLinks } from './load.js';
import { figcraftTooLarge, indexFigcraftFile, MAX_FIGCRAFT_BYTES, withPictures, type DesignFileIndex, type DesignIndex } from './figcraft-index.js';
import { effectiveDesignLinks, epicsLinkingFile, parseFrameTags, plainDesignLinks, resolveFrameTags, type EffectiveDesignLinks, type EpicFacts, type TagFinding, type TagLink } from './tags.js';
import { readZip } from './zip.js';

/** Deepest folder under design/ that is walked. */
const MAX_DEPTH = 8;

type Cached = { mtimeMs: number; size: number; result: { index: DesignFileIndex } | { finding: Finding } };
const cache = new Map<string, Cached>();

/** Every `.figcraft` file under `<top>/design/`, relative to the top, sorted. */
export function designFiles(top: string): string[] {
  const out: string[] = [];
  const walk = (rel: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(join(top, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const path = `${rel}${e.name}`;
      if (e.isDirectory() && depth < MAX_DEPTH) walk(`${path}/`, depth + 1);
      else if (e.isFile() && isDesignPath(path, '.figcraft')) out.push(path);
    }
  };
  walk(DESIGN_DIR, 0);
  return out.sort();
}

/** The design index of the repo at `top`. */
export function readDesignIndex(top: string): DesignIndex {
  const files: DesignFileIndex[] = [];
  const findings: Finding[] = [];
  const exists = fileExistsIn(top);
  for (const file of designFiles(top)) {
    const abs = join(top, file);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    let hit = cache.get(abs);
    if (!hit || hit.mtimeMs !== st.mtimeMs || hit.size !== st.size) {
      const result = st.size > MAX_FIGCRAFT_BYTES ? { finding: figcraftTooLarge(file) } : indexFigcraftFile(file, readFileSync(abs), () => false);
      hit = { mtimeMs: st.mtimeMs, size: st.size, result };
      cache.set(abs, hit);
    }
    if ('index' in hit.result) files.push(withPictures(hit.result.index, exists));
    else findings.push(hit.result.finding);
  }
  return { files, findings };
}

/** The `thumbnail.png` of an indexed design file, or undefined. */
export function readFigcraftThumbnail(top: string, file: string): Buffer | undefined {
  if (!readDesignIndex(top).files.some((f) => f.file === file && f.thumbnail)) return undefined;
  try {
    return readZip(readFileSync(join(top, file)), { only: (n) => n === 'thumbnail.png', maxBytes: MAX_FIGCRAFT_BYTES })[0]?.data;
  } catch {
    return undefined;
  }
}

/** What frame tags need of one EPIC. */
export function epicFacts(record: EpicRecord): EpicFacts {
  return { slug: record.slug, stories: new Set((record.prd?.stories ?? []).map((s) => s.id)), boxes: new Set(indexBoxes(record.flow).keys()) };
}

/** The slug, story ids and box paths of every EPIC under `<top>/docs/epics/`. */
export function epicFactsOf(top: string): EpicFacts[] {
  const root = join(top, 'docs', 'epics');
  let names: string[];
  try {
    names = readdirSync(root).sort();
  } catch {
    return [];
  }
  const out: EpicFacts[] = [];
  for (const name of names) {
    try {
      if (!statSync(join(root, name, 'prd.yaml')).isFile()) continue;
    } catch {
      continue;
    }
    const { record } = loadEpic(join(root, name));
    out.push(epicFacts(record));
  }
  return out;
}

/** links.yaml, the index and the frame tags of the repo: what every design view starts from. */
export interface DesignState {
  links: DesignLinks;
  /** The findings of parsing links.yaml. */
  linkFindings: Finding[];
  index: DesignIndex;
  tags: { links: TagLink[]; findings: TagFinding[] };
}

/** `record`: the EPIC being served or validated, counted even when it is not under docs/epics/. */
export function readDesignState(top: string, record?: EpicRecord): DesignState {
  const { links, findings } = readDesignLinks(top);
  const index = readDesignIndex(top);
  const tagged = index.files.some((f) => f.pages.some((p) => p.frames.some((fr) => parseFrameTags(fr.name).length > 0)));
  let tags: DesignState['tags'] = { links: [], findings: [] };
  if (tagged) {
    const epics = epicFactsOf(top);
    if (record && !epics.some((e) => e.slug === record.slug)) epics.push(epicFacts(record));
    tags = resolveFrameTags(index, epics, links);
  }
  return { links, linkFindings: findings, index, tags };
}

/**
 * Every finding of the repo's design that concerns this EPIC: links.yaml parse findings, bad links
 * of its stories, frame tags that name a story or box it does not have (or that cannot pick an
 * EPIC), and design files it links that cannot be read.
 */
export function designLinkFindings(record: EpicRecord, top: string, state: DesignState = readDesignState(top, record)): Finding[] {
  const slug = record.slug;
  const mine = state.linkFindings.filter((f) => f.path === '' || f.path.startsWith('line ') || f.path === `epics.${slug}` || f.path.startsWith(`epics.${slug}.`));
  const tags = state.tags.findings.filter((t) => t.epics.length === 0 || t.epics.includes(slug)).map((t) => t.finding);
  const unreadable = state.index.findings.filter((f) => epicsLinkingFile(state.links, f.path).includes(slug));
  return [...mine, ...checkDesignLinks(state.links, record, fileExistsIn(top)), ...tags, ...unreadable];
}

/** A story's links after precedence (links.yaml, then frame names), with where each comes from. */
export function storyEffectiveDesign(state: DesignState, slug: string, storyId: string): EffectiveDesignLinks {
  return effectiveDesignLinks(storyDesignLinks(state.links, slug, storyId), state.tags.links, slug, storyId);
}

/** A story's links as the build brief reads them: links.yaml, then frame names. */
export function storyBriefDesign(top: string, record: EpicRecord, storyId: string): StoryDesignLinks {
  return plainDesignLinks(storyEffectiveDesign(readDesignState(top, record), record.slug, storyId));
}
