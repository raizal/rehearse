// The fixture EPIC view for UI tests. test/global-setup.ts builds it in Node,
// because jsdom has no file URLs; tests get a fresh copy here.

import { inject } from 'vitest';
import type { ReviewEpicView } from '../src/contract.js';
import { markSeen, saveSeen, stepTotal, type SeenState } from '../src/model/seen.js';

declare module 'vitest' {
  export interface ProvidedContext {
    reviewEpic: ReviewEpicView;
    realEpic: ReviewEpicView;
  }
}

/** Signer key of the fixture builder (D41). */
export const FIXTURE_KEY = 'SHA256:fixtureKeyOfTheBuilder000000000000000000000';

export function reviewEpic(): ReviewEpicView {
  return structuredClone(inject('reviewEpic'));
}

/** The real EPIC (docs/epics/2026-11-05-rehearse) as the server sends it. */
export function realEpic(): ReviewEpicView {
  return structuredClone(inject('realEpic'));
}

/**
 * Mark every step of these scenarios (default: all) as seen in sessionStorage, as if the owner
 * had looked at each step panel. Approve is off until then (S6-A1).
 */
export function seeAll(view: ReviewEpicView, ids?: string[]): void {
  let state: SeenState = {};
  for (const sv of view.scenarios) {
    if (ids && !ids.includes(sv.scenario.id)) continue;
    for (let i = 0; i < stepTotal(sv); i++) state = markSeen(state, sv, i);
  }
  saveSeen(sessionStorage, view.slug, state);
}
