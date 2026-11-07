// Box `content-changed`: detect changed signed content (R15, S6-A3, S9-A3).
// A story is stale when the hash of its latest sign-off differs from its current hash
// under the same rule. A scenario is stale when its approval hash differs from scenarioHash.

import { scenarioHash } from '../hash.js';
import type { EpicRecord, EpicStatus, Scenario, Story } from '../types.js';
import { asArray, isObject } from '../util.js';
import { storyChanges } from '../change/load.js';
import type { ChangeDoc } from '../change/types.js';
import { storyHash, storyHashV2, storyHashV3, withoutChanges } from './story-hash.js';
import { storyHashV1 } from '../hash.js';
import { HASH_RULES, isTrustedRule, type HashRule, type ScenarioTrust, type SignOffWithRule, type StaleResult, type StoryTrust } from './types.js';

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

/**
 * The changes that a sign-off does not cover, when it covers all the rest (T62): the story
 * without its changes (any rule), or under rule 3 the story with its first k changes. Undefined
 * when the signed hash matches none of these: then more than the changes is new.
 */
function newChangesSince(rule: HashRule, signedHash: string, record: EpicRecord, story: Story, scenarios: Scenario[], changes: ChangeDoc[]): string[] | undefined {
  if (changes.length === 0) return undefined;
  const prd = record.prd!;
  const base = withoutChanges(story, record.flow, scenarios);
  for (let k = rule === 3 ? changes.length - 1 : 0; k >= 0; k--) {
    let hash: string;
    if (k > 0) hash = storyHashV3(story, prd, record.flow, scenarios, changes.slice(0, k));
    else if (rule === 1) hash = storyHashV1(base.story, prd, base.scenarios);
    else hash = storyHashV2(base.story, prd, base.flow, base.scenarios);
    if (hash === signedHash) return changes.slice(k).map((c) => c.id);
  }
  return undefined;
}

function storyTrust(record: EpicRecord, story: Story, scenarios: Scenario[]): StoryTrust {
  const changes = storyChanges(record, story.id).map((c) => c.doc);
  const ids = changes.length > 0 ? { changes: changes.map((c) => c.id) } : {};
  const signOffs = asArray<SignOffWithRule>(record.signoff?.signOffs).filter(isObject);
  const latest = [...signOffs].reverse().find((s) => isObject(s.storyHashes) && typeof s.storyHashes[story.id] === 'string');
  if (!latest) return { id: story.id, status: 'draft', trusted: false, ...ids };
  const rule = signOffRule(latest);
  const signedHash = latest.storyHashes[story.id]!;
  if (!(HASH_RULES as readonly number[]).includes(rule)) {
    return { id: story.id, status: 'stale', hashRule: rule, signedHash, trusted: false, ...ids };
  }
  const currentHash = storyHash(rule as HashRule, story, record.prd!, record.flow, scenarios, changes);
  // Rules 1 and 2 do not cover the change files: a story with changes needs a rule-3 sign-off.
  const status = currentHash === signedHash && (changes.length === 0 || rule === 3) ? 'signed' : 'stale';
  const out: StoryTrust = { id: story.id, status, hashRule: rule, signedHash, currentHash, trusted: status === 'signed' && isTrustedRule(rule), ...ids };
  if (status === 'stale') {
    const fresh = newChangesSince(rule as HashRule, signedHash, record, story, scenarios, changes);
    if (fresh) out.newChanges = fresh;
  }
  return out;
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
