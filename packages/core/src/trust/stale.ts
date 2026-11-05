// Box `content-changed`: detect changed signed content (R15, S6-A3, S9-A3).
// A story is stale when the hash of its latest sign-off differs from its current hash
// under the same rule. A scenario is stale when its approval hash differs from scenarioHash.

import { scenarioHash } from '../hash.js';
import type { EpicRecord, EpicStatus, Scenario, Story } from '../types.js';
import { asArray, isObject } from '../util.js';
import { storyHash } from './story-hash.js';
import { CURRENT_HASH_RULE, HASH_RULES, type HashRule, type ScenarioTrust, type SignOffWithRule, type StaleResult, type StoryTrust } from './types.js';

/** Every scenario of the record, in file order. */
export function allScenarios(record: EpicRecord): Scenario[] {
  return record.scenarioFiles.flatMap((f) => f.scenarios.filter(isObject));
}

/** The rule of a sign-off. A missing `hashRule` means rule 1. */
export function signOffRule(signOff: SignOffWithRule): number {
  return signOff.hashRule ?? 1;
}

/** Trust state of one scenario. Only `approved` counts as evidence (S6-A3). */
export function scenarioTrust(scenario: Scenario, file: string): ScenarioTrust {
  const base = { id: scenario.id, story: scenario.story, file };
  if (scenario.status === 'draft') return { ...base, status: 'draft' };
  if (scenario.status === 'stale') return { ...base, status: 'stale', reason: 'marked stale' };
  if (!isObject(scenario.approval) || typeof scenario.approval.hash !== 'string') {
    return { ...base, status: 'stale', reason: 'approved but has no approval hash' };
  }
  if (scenario.approval.hash !== scenarioHash(scenario)) {
    return { ...base, status: 'stale', reason: 'content changed since approval' };
  }
  return { ...base, status: 'approved' };
}

function storyTrust(record: EpicRecord, story: Story, scenarios: Scenario[]): StoryTrust {
  const signOffs = asArray<SignOffWithRule>(record.signoff?.signOffs).filter(isObject);
  const latest = [...signOffs].reverse().find((s) => isObject(s.storyHashes) && typeof s.storyHashes[story.id] === 'string');
  if (!latest) return { id: story.id, status: 'draft', trusted: false };
  const rule = signOffRule(latest);
  const signedHash = latest.storyHashes[story.id]!;
  if (!(HASH_RULES as readonly number[]).includes(rule)) {
    return { id: story.id, status: 'stale', hashRule: rule, signedHash, trusted: false };
  }
  const currentHash = storyHash(rule as HashRule, story, record.prd!, record.flow, scenarios);
  const status = currentHash === signedHash ? 'signed' : 'stale';
  return { id: story.id, status, hashRule: rule, signedHash, currentHash, trusted: status === 'signed' && rule === CURRENT_HASH_RULE };
}

/** Epic status: partly-stale when a story is stale, signed when every story is signed, else draft. */
export function epicStatus(stories: StoryTrust[]): EpicStatus {
  if (stories.some((s) => s.status === 'stale')) return 'partly-stale';
  if (stories.length > 0 && stories.every((s) => s.status === 'signed')) return 'signed';
  return 'draft';
}

/** Stale stories and scenarios of a loaded record, and the derived Epic status. */
export function detectStale(record: EpicRecord): StaleResult {
  const scenarios = allScenarios(record);
  const scenarioStates = record.scenarioFiles.flatMap((f) => f.scenarios.filter(isObject).map((s) => scenarioTrust(s, f.file)));
  const stories = asArray<Story>(record.prd?.stories)
    .filter((s) => isObject(s) && typeof s.id === 'string')
    .map((s) => storyTrust(record, s, scenarios));
  return {
    stories,
    scenarios: scenarioStates,
    staleStories: stories.filter((s) => s.status === 'stale').map((s) => s.id),
    staleScenarios: scenarioStates.filter((s) => s.status === 'stale').map((s) => s.id),
    epicStatus: epicStatus(stories),
  };
}
