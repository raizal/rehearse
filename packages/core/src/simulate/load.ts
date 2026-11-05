// Box `simulate/load`: approved scenarios whose approval hash still matches are evidence.
// Drafts are skipped. Approved scenarios with a changed hash, and `stale` ones, are listed
// as stale information (S6-A3): they are not evidence and they are not findings.
// Drafts mode (T22) counts drafts and stale scenarios too, each marked with its real status.

import { scenarioHash } from '../hash.js';
import type { EpicRecord } from '../types.js';
import { cmp, isObject } from '../util.js';
import type { LoadedScenario, SimulateOptions, StaleScenario } from './types.js';

export interface LoadedScenarios {
  /** In file order, then scenario order. In drafts mode: every scenario, with its status. */
  approved: LoadedScenario[];
  stale: StaleScenario[];
}

export function loadScenarios(record: EpicRecord, opts: SimulateOptions = {}): LoadedScenarios {
  const approved: LoadedScenario[] = [];
  const stale: StaleScenario[] = [];
  for (const sf of record.scenarioFiles) {
    for (const scenario of sf.scenarios) {
      if (!isObject(scenario)) continue;
      const base = { file: sf.file, scenario: scenario.id, story: scenario.story };
      if (scenario.status === 'stale') {
        stale.push({ ...base, reason: 'status is stale' });
        if (opts.drafts) approved.push({ file: sf.file, scenario, status: 'stale' });
      } else if (scenario.status === 'approved') {
        const hash = scenarioHash(scenario);
        if (isObject(scenario.approval) && scenario.approval.hash === hash) {
          approved.push(opts.drafts ? { file: sf.file, scenario, status: 'approved' } : { file: sf.file, scenario });
        } else {
          const had = isObject(scenario.approval) ? String(scenario.approval.hash) : 'no approval';
          stale.push({ ...base, reason: `content changed after approval (approval ${had}, content ${hash})` });
          if (opts.drafts) approved.push({ file: sf.file, scenario, status: 'stale' });
        }
      } else if (opts.drafts) {
        approved.push({ file: sf.file, scenario, status: 'draft' });
      }
    }
  }
  stale.sort((a, b) => cmp(a.file, b.file) || cmp(a.scenario, b.scenario));
  return { approved, stale };
}

/** `S1-buy`, or in drafts mode `S1-buy (draft)`. */
export function named(s: LoadedScenario): string {
  return s.status ? `${s.scenario.id} (${s.status})` : s.scenario.id;
}

/** `''`, or in drafts mode ` (scenario S1-buy, draft)`: appended to a finding on a scenario. */
export function fromNote(s: LoadedScenario): string {
  return s.status ? ` (scenario ${s.scenario.id}, ${s.status})` : '';
}

/** `covered only by drafts (S1-buy: draft, S1-empty: stale)` when no taker is approved, else undefined. */
export function draftOnlyNote(takers: LoadedScenario[]): string | undefined {
  if (takers.length === 0 || takers.some((s) => s.status === undefined || s.status === 'approved')) return undefined;
  const names = [...new Map(takers.map((s) => [s.scenario.id, `${s.scenario.id}: ${s.status}`])).entries()]
    .sort((a, b) => cmp(a[0], b[0]))
    .map(([, n]) => n);
  return `covered only by drafts (${names.join(', ')})`;
}
