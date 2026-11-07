// Design suggestions (T51, box `suggest-design`), pure. For a story (or a box) with no link, rank
// the pages and top-level frames of the design index by how well their names match the story's
// title, criteria and box titles: plain word overlap after a light stemming, stop words and page
// numbers left out, a word that few pages (and few stories) share counting more than one that many share. The top 3
// come with a plain reason ("matches: tests, birdview"). A suggestion is never linked by itself.

import type { EpicRecord, Id } from '../types.js';
import { indexBoxes } from '../flow-index.js';
import { asArray, isObject } from '../util.js';
import { pictureOf, type DesignIndex, type DesignPicture } from './figcraft-index.js';
import { frameRef } from './tags.js';

export const SUGGESTION_LIMIT = 3;

/** One suggested page or frame. */
export interface DesignSuggestion {
  file: string;
  page: number;
  pageName: string;
  /** The frame's links.yaml value (name, or id when names repeat) and name, for a frame. */
  frame?: { ref: string; name: string };
  /** The words of the page or frame name that match, as they are written there. */
  matches: string[];
  /** "matches: tests, birdview" */
  reason: string;
  picture?: DesignPicture;
}

const STOP = new Set(
  (
    'a an and are as at be been but by can cannot do does each for from has have he her his how i if in into is it its ' +
    'me more my no not of on one or our out so than that the their them then there these they this to too up us was we ' +
    'what when where which while who why will with without you your all any only own same just also new see shows show ' +
    'go goes get gets let lets say says its both other others s t x vs via per page may must should would could shall'
  ).split(' '),
);

/** A light stem: plural and verb endings off ("stories" → "story", "tests" → "test", "linked" → "link"). */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(sses|xes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  return w;
}

/** The words of a text: lower case, split on anything not a letter or digit, no stop words, no numbers or story ids. */
export function words(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !/^s\d+$/.test(w) && !STOP.has(w));
}

/** Stem → the first word written for it. */
function stems(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const w of words(text)) {
    const s = stem(w);
    if (!STOP.has(s) && !out.has(s)) out.set(s, w);
  }
  return out;
}

/** What a story says: its want and soThat, its criteria, and the titles of the boxes that serve it. */
export function storyTexts(record: EpicRecord, storyId: Id): string[] {
  const story = record.prd?.stories.find((s) => s.id === storyId);
  if (!story) return [];
  const texts = [story.want, story.soThat];
  for (const c of asArray<Record<string, unknown>>(story.acceptance).filter(isObject)) for (const k of ['given', 'when', 'then']) if (typeof c[k] === 'string') texts.push(c[k] as string);
  for (const { box } of indexBoxes(record.flow).values()) if (Array.isArray(box.stories) && box.stories.includes(storyId) && typeof box.title === 'string') texts.push(box.title);
  return texts;
}

/** What a box says: its title and the words of its id. */
export function boxTexts(record: EpicRecord, path: string): string[] {
  const entry = indexBoxes(record.flow).get(path);
  if (!entry) return [];
  return [typeof entry.box.title === 'string' ? entry.box.title : '', entry.box.id.replace(/-/g, ' ')];
}

export interface SuggestOptions {
  /** The texts of every story of the EPIC: a word most stories use (the role, "story") counts less. */
  others?: string[][];
  limit?: number;
}

/** The top pages and frames for these texts; none when nothing matches. */
export function suggestDesigns(index: DesignIndex, texts: string[], opts: SuggestOptions = {}): DesignSuggestion[] {
  const limit = opts.limit ?? SUGGESTION_LIMIT;
  const want = stems(texts.join('\n'));
  const others = (opts.others ?? []).map((t) => new Set(stems(t.join('\n')).keys()));
  const common = (k: string) => (others.length === 0 ? 1 : Math.log(1 + others.length / Math.max(1, others.filter((o) => o.has(k)).length)));
  type Candidate = { s: Omit<DesignSuggestion, 'matches' | 'reason'>; stems: Map<string, string>; order: number };
  const candidates: Candidate[] = [];
  for (const file of index.files) {
    for (const page of file.pages) {
      const pageStems = stems(page.name);
      const picture = pictureOf(file, page);
      candidates.push({ s: { file: file.file, page: page.number, pageName: page.name, ...(picture ? { picture } : {}) }, stems: pageStems, order: candidates.length });
      for (const frame of page.frames) {
        const frameStems = stems(frame.name);
        // A frame that says no more than its page is the page again.
        if ([...frameStems.keys()].every((k) => pageStems.has(k))) continue;
        const fpicture = pictureOf(file, page, frame);
        candidates.push({
          s: { file: file.file, page: page.number, pageName: page.name, frame: { ref: frameRef(page, frame), name: frame.name }, ...(fpicture ? { picture: fpicture } : {}) },
          stems: frameStems,
          order: candidates.length,
        });
      }
    }
  }
  const df = new Map<string, number>();
  for (const c of candidates) for (const k of c.stems.keys()) df.set(k, (df.get(k) ?? 0) + 1);
  const n = candidates.length;
  const scored = candidates
    .map((c) => {
      const shared = [...c.stems.keys()].filter((k) => want.has(k));
      const score = shared.reduce((sum, k) => sum + Math.log(1 + n / (df.get(k) ?? 1)) * common(k), 0);
      return { c, shared, score };
    })
    .filter((x) => x.shared.length > 0)
    .sort((a, b) => b.score - a.score || a.c.stems.size - b.c.stems.size || a.c.order - b.c.order);
  return scored.slice(0, limit).map(({ c, shared }) => {
    const matches = shared.map((k) => c.stems.get(k)!);
    return { ...c.s, matches, reason: `matches: ${matches.join(', ')}` };
  });
}
