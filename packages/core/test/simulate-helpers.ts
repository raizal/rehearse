// Fixture helpers for simulate: approve the shop scenarios with their real content hash.

import { scenarioHash, type Scenario } from '../src/index.js';
import { makeEpic, type Docs, type FixtureOptions } from './helpers.js';

/** Approve one scenario of the parsed docs. Call it after the content edits of the test. */
export function approve(s: any): void {
  s.status = 'approved';
  s.approval = { by: 'a@b.c', at: '2026-11-05T00:00:00Z', hash: scenarioHash(s as Scenario) };
}

/** Every scenario of the docs. */
export function allScenarios(docs: Docs): any[] {
  return Object.entries(docs)
    .filter(([f]) => f.startsWith('scenarios/'))
    .flatMap(([, d]) => d.scenarios);
}

/**
 * The shop fixture with each scenario approved. `edit` runs before the approvals;
 * `after` runs after them (to make an approved scenario stale, or to un-approve one).
 */
export function makeApprovedEpic(edit?: (docs: Docs) => void, after?: (docs: Docs) => void, opts: FixtureOptions = {}): string {
  return makeEpic({
    ...opts,
    edit: (docs) => {
      edit?.(docs);
      for (const s of allScenarios(docs)) approve(s);
      after?.(docs);
    },
  });
}
