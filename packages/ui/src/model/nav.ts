// Where the reader is, as a URL hash (T23). Every navigation pushes the place on the browser
// history, so Back and Forward work (in the browser and with the in-app "← Back" button) and a
// reload opens the same place.
//
//   #/prd[/<focus>]                        #/techspec[/<focus>]
//   #/bigpicture[/<view>]                  #/usecases   #/signoff
//   #/stories                              the story list
//   #/stories/S6/how                       a story and its tab
//   #/stories/S6/board/S6-approve          the storyboard of a scenario
//   #/readiness[/<requirement>]
//   #/code[/package/<package> | /file/<file>][/node/<node id>]   the code map (T40)
//
// An open box drawer (T38) adds `?box=<box path>` to the place it opened over, e.g.
// `#/stories/S4/how?box=review/panel`, so a box is a link and Back closes the drawer. The Flow tab
// is gone: an old `#/flow[/<diagram path>]` opens the big picture with that box in the drawer.

import type { Id } from '@rehearse/core';

export const TAB_IDS = ['prd', 'techspec', 'bigpicture', 'code', 'stories', 'usecases', 'readiness', 'signoff'] as const;
export type Tab = (typeof TAB_IDS)[number];

export const STORY_TAB_IDS = ['what', 'how', 'output', 'before-after', 'code', 'tests'] as const;
export type StoryTabId = (typeof STORY_TAB_IDS)[number];

export const DEFAULT_BIG_VIEW = 'features';

/** One place in the UI. */
export type Loc =
  | { tab: 'prd' | 'techspec'; focus?: string }
  | { tab: 'bigpicture'; view?: string }
  | { tab: 'usecases' | 'signoff' }
  | { tab: 'readiness'; requirement?: Id }
  | CodeLoc
  | { tab: 'stories'; list: true }
  | { tab: 'stories'; story: Id; storyTab: StoryTabId; card?: undefined }
  | { tab: 'stories'; story: Id; card: Id };

/** A place on the code map (T40): a level, and the node selected on it. */
export interface CodeLoc {
  tab: 'code';
  /** The package or file shown; the repo's packages when absent. */
  level?: { kind: 'package' | 'file'; target: string };
  node?: string;
}

const enc = encodeURIComponent;

const encPath = (path: string): string => path.split('/').map(enc).join('/');

/** The hash of a place, with the box open in the drawer over it. */
export function toHash(loc: Loc, box?: string): string {
  return box ? `${placeHash(loc)}?box=${encPath(box)}` : placeHash(loc);
}

function placeHash(loc: Loc): string {
  switch (loc.tab) {
    case 'prd':
    case 'techspec':
      return loc.focus ? `#/${loc.tab}/${enc(loc.focus)}` : `#/${loc.tab}`;
    case 'bigpicture':
      return loc.view && loc.view !== DEFAULT_BIG_VIEW ? `#/bigpicture/${enc(loc.view)}` : '#/bigpicture';
    case 'readiness':
      return loc.requirement ? `#/readiness/${enc(loc.requirement)}` : '#/readiness';
    case 'code':
      return `#/code${loc.level ? `/${loc.level.kind}/${enc(loc.level.target)}` : ''}${loc.node ? `/node/${enc(loc.node)}` : ''}`;
    case 'stories':
      if ('list' in loc) return '#/stories';
      if (loc.card !== undefined) return `#/stories/${enc(loc.story)}/board/${enc(loc.card)}`;
      return `#/stories/${enc(loc.story)}/${loc.storyTab}`;
    default:
      return `#/${loc.tab}`;
  }
}

const dec = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** The parts of a hash: the path segments, and the box of the drawer (`?box=`). */
function split(hash: string): { parts: string[]; box?: string } {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter((p) => p !== '');
  const box = new URLSearchParams(query).get('box') ?? undefined;
  return box ? { parts, box } : { parts };
}

/** The place a hash names; undefined for an empty or unknown hash. An old `#/flow…` is the big picture. */
export function fromHash(hash: string): Loc | undefined {
  const [tab, ...rest] = split(hash).parts;
  if (tab === 'flow') return { tab: 'bigpicture' };
  if (!tab || !(TAB_IDS as readonly string[]).includes(tab)) return undefined;
  const one = rest[0] !== undefined ? dec(rest[0]) : undefined;
  switch (tab as Tab) {
    case 'prd':
    case 'techspec':
      return { tab: tab as 'prd' | 'techspec', ...(one ? { focus: one } : {}) };
    case 'bigpicture':
      return { tab: 'bigpicture', ...(one ? { view: one } : {}) };
    case 'readiness':
      return { tab: 'readiness', ...(one ? { requirement: one } : {}) };
    case 'code':
      return codeLoc(rest);
    case 'stories': {
      if (one === undefined) return { tab: 'stories', list: true };
      if (rest[1] === 'board' && rest[2] !== undefined) return { tab: 'stories', story: one, card: dec(rest[2]) };
      const st = (STORY_TAB_IDS as readonly string[]).includes(rest[1] ?? '') ? (rest[1] as StoryTabId) : 'what';
      return { tab: 'stories', story: one, storyTab: st };
    }
    default:
      return { tab: tab as 'usecases' | 'signoff' };
  }
}

function codeLoc(rest: string[]): CodeLoc {
  const loc: CodeLoc = { tab: 'code' };
  let i = 0;
  if ((rest[0] === 'package' || rest[0] === 'file') && rest[1] !== undefined) {
    loc.level = { kind: rest[0], target: dec(rest[1]) };
    i = 2;
  }
  if (rest[i] === 'node' && rest[i + 1] !== undefined) loc.node = dec(rest[i + 1]!);
  return loc;
}

/** The box a hash opens in the drawer: `?box=`, or the diagram path of an old `#/flow/<path>`. */
export function boxOfHash(hash: string): string | undefined {
  const { parts, box } = split(hash);
  if (box) return box;
  return parts[0] === 'flow' && parts.length > 1 ? parts.slice(1).map(dec).join('/') : undefined;
}

/** The history depth this app stored with a history entry (0 for the first place). */
export function depthOf(state: unknown): number {
  const i = (state as { rehearseDepth?: unknown } | null)?.rehearseDepth;
  return typeof i === 'number' && i >= 0 ? i : 0;
}

export const depthState = (depth: number) => ({ rehearseDepth: depth });
