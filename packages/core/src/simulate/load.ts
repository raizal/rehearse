// Box `simulate/load`: approved scenarios whose approval hash still matches are evidence.
// Drafts are skipped. Approved scenarios with a changed hash, and `stale` ones, are listed
// as stale information (S6-A3): they are not evidence and they are not findings.

import { scenarioHash } from '../hash.js';
import type { EpicRecord } from '../types.js';
import { cmp, isObject } from '../util.js';
import type { LoadedScenario, StaleScenario } from './types.js';

export interface LoadedScenarios {
  /** In file order, then scenario order. */
  approved: LoadedScenario[];
  stale: StaleScenario[];
}

export function loadScenarios(record: EpicRecord): LoadedScenarios {
  const approved: LoadedScenario[] = [];
  const stale: StaleScenario[] = [];
  for (const sf of record.scenarioFiles) {
    for (const scenario of sf.scenarios) {
      if (!isObject(scenario)) continue;
      const base = { file: sf.file, scenario: scenario.id, story: scenario.story };
      if (scenario.status === 'stale') {
        stale.push({ ...base, reason: 'status is stale' });
      } else if (scenario.status === 'approved') {
        const hash = scenarioHash(scenario);
        if (isObject(scenario.approval) && scenario.approval.hash === hash) approved.push({ file: sf.file, scenario });
        else {
          const had = isObject(scenario.approval) ? String(scenario.approval.hash) : 'no approval';
          stale.push({ ...base, reason: `content changed after approval (approval ${had}, content ${hash})` });
        }
      }
    }
  }
  stale.sort((a, b) => cmp(a.file, b.file) || cmp(a.scenario, b.scenario));
  return { approved, stale };
}
