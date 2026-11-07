// The fixture EPIC view for UI tests. test/global-setup.ts builds it in Node,
// because jsdom has no file URLs; tests get a fresh copy here.

import { inject } from 'vitest';
import type { ReviewEpicView } from '../src/contract.js';
import { markSeen, saveSeen, stepTotal, type SeenState } from '../src/model/seen.js';

declare module 'vitest' {
  export interface ProvidedContext {
    reviewEpic: ReviewEpicView;
    realEpic: ReviewEpicView;
    codeGraphEpic: ReviewEpicView;
    codeGraphNoPrd: ReviewEpicView;
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

/** T16: the code-graph fixture EPIC, which changes docs/system/ (design pages 11 and 12). */
export function codeGraphEpic(): ReviewEpicView {
  return structuredClone(inject('codeGraphEpic'));
}

/** The same EPIC before prd.yaml: only brainstorm.md decisions, no stories. */
export function codeGraphNoPrd(): ReviewEpicView {
  return structuredClone(inject('codeGraphNoPrd'));
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

/** The title of the small change C1 in `withChange`. */
export const CHANGE_TITLE = 'Pay again after a declined card';

/**
 * T62: the view with a small change C1 of story S1 merged in, as the loader merges
 * `changes/C1.yaml`: a criterion S1-A2, a draft scenario S1-retry and the root box `pay`, each
 * marked `change: 'C1'`.
 */
export function withChange(view: ReviewEpicView): ReviewEpicView {
  const story = view.prd!.stories.find((s) => s.id === 'S1')!;
  story.acceptance = [...(story.acceptance ?? []), { id: 'S1-A2', given: 'a declined card', when: 'the buyer pays again', then: 'the order is paid', change: 'C1' }];
  const buy = view.scenarios.find((sv) => sv.scenario.id === 'S1-buy')!;
  const retry = structuredClone(buy);
  retry.file = 'changes/C1.yaml';
  retry.status = 'draft';
  retry.scenario = { ...retry.scenario, id: 'S1-retry', title: 'Pay again', status: 'draft', change: 'C1', expect: { ...retry.scenario.expect!, criterion: 'S1-A2' } };
  delete retry.scenario.approval;
  view.scenarios.push(retry);
  view.flow!.root.boxes.find((b) => b.id === 'pay')!.change = 'C1';
  view.changes = [{ id: 'C1', story: 'S1', title: CHANGE_TITLE, why: 'Some cards fail the first time.', file: 'changes/C1.yaml' }];
  return view;
}
