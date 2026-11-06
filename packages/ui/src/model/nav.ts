// Where the reader is, as a URL hash (T23). Every navigation pushes the place on the browser
// history, so Back and Forward work (in the browser and with the in-app "← Back" button) and a
// reload opens the same place.
//
//   #/prd[/<focus>]                        #/techspec[/<focus>]
//   #/bigpicture[/<view>]                  #/usecases   #/signoff
//   #/stories                              the story list
//   #/stories/S6/how                       a story and its tab
//   #/stories/S6/board/S6-approve          the storyboard of a scenario
//   #/readiness[/<requirement>]            #/flow[/<diagram path>]

import type { Id } from '@rehearse/core';

export const TAB_IDS = ['prd', 'techspec', 'bigpicture', 'stories', 'usecases', 'readiness', 'signoff', 'flow'] as const;
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
  | { tab: 'flow'; diagram?: string }
  | { tab: 'stories'; list: true }
  | { tab: 'stories'; story: Id; storyTab: StoryTabId; card?: undefined }
  | { tab: 'stories'; story: Id; card: Id };

const enc = encodeURIComponent;

/** The hash of a place. */
export function toHash(loc: Loc): string {
  switch (loc.tab) {
    case 'prd':
    case 'techspec':
      return loc.focus ? `#/${loc.tab}/${enc(loc.focus)}` : `#/${loc.tab}`;
    case 'bigpicture':
      return loc.view && loc.view !== DEFAULT_BIG_VIEW ? `#/bigpicture/${enc(loc.view)}` : '#/bigpicture';
    case 'readiness':
      return loc.requirement ? `#/readiness/${enc(loc.requirement)}` : '#/readiness';
    case 'flow':
      return loc.diagram ? `#/flow/${loc.diagram.split('/').map(enc).join('/')}` : '#/flow';
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

/** The place a hash names; undefined for an empty or unknown hash. */
export function fromHash(hash: string): Loc | undefined {
  const parts = hash.replace(/^#\/?/, '').split('/').filter((p) => p !== '');
  const [tab, ...rest] = parts;
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
    case 'flow':
      return rest.length ? { tab: 'flow', diagram: rest.map(dec).join('/') } : { tab: 'flow' };
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

/** The history depth this app stored with a history entry (0 for the first place). */
export function depthOf(state: unknown): number {
  const i = (state as { rehearseDepth?: unknown } | null)?.rehearseDepth;
  return typeof i === 'number' && i >= 0 ? i : 0;
}

export const depthState = (depth: number) => ({ rehearseDepth: depth });
