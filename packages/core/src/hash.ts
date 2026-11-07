// Content hashes for approvals and sign-offs (R13, R14, D23).
// The canonical form is the same as Python `json.dumps(v, sort_keys=True,
// separators=(',', ':'))` with its default ASCII escaping. The bootstrap
// approvals and sign-off of the first EPIC were made that way.

import { createHash } from 'node:crypto';
import type { Hash, Prd, Scenario, Story } from './types.js';
import { cmp, isObject } from './util.js';

/** JSON with sorted keys, no spaces, and every character above U+007E escaped as \uXXXX. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort(cmp);
    return `{${keys.map((k) => `${escapeAscii(JSON.stringify(k))}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return escapeAscii(JSON.stringify(value) ?? 'null');
}

function escapeAscii(json: string): string {
  return json.replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function sha256(value: unknown): Hash {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

/** The content of a scenario that an approval covers: everything except status, approval and the loader-added story and change. */
export function scenarioContent(scenario: Scenario): Record<string, unknown> {
  const { status: _status, approval: _approval, story: _story, change: _change, ...content } = scenario;
  return content;
}

/** Hash that Approval.hash must equal, else the scenario is stale (S6-A3). */
export function scenarioHash(scenario: Scenario): Hash {
  return sha256(scenarioContent(scenario));
}

/**
 * Story hash, rule 1 (bootstrap sign-off): the story, its requirements (in prd.yaml order)
 * and its scenarios (in file order, each as `scenarioContent`).
 * Correction C11 extends this rule to boxes and lane roles; thread T4 adds that as rule 2.
 */
export function storyHashV1(story: Story, prd: Prd, scenarios: Scenario[]): Hash {
  return sha256({
    story,
    requirements: prd.requirements.filter((r) => story.requirements.includes(r.id)),
    scenarios: scenarios.filter((s) => s.story === story.id).map(scenarioContent),
  });
}
