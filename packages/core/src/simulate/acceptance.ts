// Box `simulate/acceptance` (R7, S3-A4).
// For each approved scenario: its `expect.state` and its end state (from the lifecycle walk)
// must agree with the `expectedState` of the criterion it names, and `expect.state` must agree
// with the end state for each `Entity.field` the walk knows. Each criterion that no approved
// scenario names is reported too.

import { canonicalJson } from '../hash.js';
import { RECORD_FILES, type AcceptanceCriterion, type Finding, type Prd, type Story } from '../types.js';
import { asArray, isObject } from '../util.js';
import type { EndStates } from './lifecycles.js';
import type { LoadedScenario } from './types.js';

export function checkAcceptance(prd: Prd | undefined, scenarios: LoadedScenario[], endStates: EndStates): Finding[] {
  const out: Finding[] = [];
  const stories = asArray<Story>(prd?.stories).filter(isObject) as Story[];
  const criteria = new Map<string, { story: string; criterion: AcceptanceCriterion }>();
  for (const s of stories) {
    for (const c of asArray<AcceptanceCriterion>(s.acceptance)) if (isObject(c)) criteria.set(c.id, { story: s.id, criterion: c });
  }
  const checked = new Set<string>();
  const show = (v: unknown): string => (v === undefined ? 'not set' : JSON.stringify(v));

  for (const { file, scenario } of scenarios) {
    const expect = isObject(scenario.expect) ? scenario.expect : undefined;
    if (!expect) continue;
    const state = isObject(expect.state) ? expect.state : {};
    const end = endStates.get(scenario.id) ?? {};
    const critId = typeof expect.criterion === 'string' ? expect.criterion : undefined;
    const refs = critId ? [critId, scenario.story] : [scenario.story];
    const push = (message: string): void => {
      out.push({ kind: 'acceptance', file, path: scenario.id, message, refs: [...new Set(refs)] });
    };

    for (const [key, value] of Object.entries(state)) {
      if (Object.hasOwn(end, key) && canonicalJson(end[key]) !== canonicalJson(value)) {
        push(`end state ${key} is ${show(end[key])}, but the scenario expects ${show(value)}`);
      }
    }
    if (!critId) continue;
    checked.add(critId);
    const c = criteria.get(critId)?.criterion;
    if (!c || !isObject(c.expectedState)) continue;
    for (const [key, want] of Object.entries(c.expectedState)) {
      if (Object.hasOwn(end, key) && canonicalJson(end[key]) !== canonicalJson(want)) {
        push(`criterion ${critId} expects ${key} ${show(want)}, but the end state is ${show(end[key])}`);
      } else if (Object.hasOwn(state, key) && canonicalJson(state[key]) !== canonicalJson(want)) {
        push(`criterion ${critId} expects ${key} ${show(want)}, but the scenario expects ${show(state[key])}`);
      } else if (!Object.hasOwn(end, key) && !Object.hasOwn(state, key)) {
        push(`criterion ${critId} expects ${key} ${show(want)}, but the scenario does not check ${key}`);
      }
    }
  }

  for (const [id, { story }] of criteria) {
    if (!checked.has(id)) {
      out.push({
        kind: 'acceptance',
        file: RECORD_FILES.prd,
        path: story,
        message: `criterion ${id}: no approved scenario checks it (expect.criterion)`,
        refs: [id, story],
      });
    }
  }
  return out;
}
