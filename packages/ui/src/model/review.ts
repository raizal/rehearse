// Pure review model: which scenarios need approval (S6-A1), the permission matrix
// axes (S7-A1), and which gate findings are about which stories (S8, S9-A1).
// The finding → story rule mirrors `findingStories` and `signOff` in @rehearse/core,
// which the browser bundle cannot import (it reads files).

import type { Finding, Flow, Id, PermissionMatrix, Prd, Story } from '@rehearse/core';
import type { ApprovalView, ReviewEpicView, SigStatus } from '../contract.js';
import type { ScenarioView } from '../api.js';
import { boxAt, parentPath } from './diagram.js';

const SIG_TEXT: Record<SigStatus, string> = {
  valid: 'signature valid',
  missing: 'not signed',
  invalid: 'bad signature',
  'unknown-signer': 'unknown signer',
};

/** Words for a signature status, so the UI does not rely on color (a11y). */
export function sigText(status: SigStatus | string): string {
  return SIG_TEXT[status as SigStatus] ?? `signature ${status}`;
}

/**
 * Why a scenario can be approved, or undefined when it is approved and well signed.
 * Draft and stale scenarios can be approved; so can an approved one whose signature
 * is missing, bad or from an unknown signer (D41: it is not evidence).
 */
export function approveReason(sv: ScenarioView, approvals: Record<Id, ApprovalView> | undefined): string | undefined {
  if (sv.status === 'draft') return 'draft';
  if (sv.status === 'stale') return 'stale';
  if (!approvals) return undefined;
  const a = approvals[sv.scenario.id];
  if (!a) return 'not signed';
  return a.sigStatus === 'valid' ? undefined : sigText(a.sigStatus);
}

/** Story ids in prd.yaml order. */
export function storiesOf(prd: Prd | undefined): Story[] {
  return Array.isArray(prd?.stories) ? prd.stories.filter((s) => s && typeof s.id === 'string') : [];
}

/** Stories a finding is about: from its refs, its scenario file, or its box path in flow.yaml. Empty means the whole EPIC. */
export function findingStories(view: ReviewEpicView, finding: Finding): Id[] {
  const out = new Set<Id>();
  const refs = Array.isArray(finding.refs) ? finding.refs : [];
  for (const story of storiesOf(view.prd)) {
    const reqs = Array.isArray(story.requirements) ? story.requirements : [];
    const criteria = Array.isArray(story.acceptance) ? story.acceptance.map((a) => a?.id) : [];
    if (refs.some((r) => r === story.id || reqs.includes(r) || criteria.includes(r))) out.add(story.id);
  }
  for (const sv of view.scenarios) if (sv.file === finding.file && sv.scenario.story) out.add(sv.scenario.story);
  if (finding.file === 'flow.yaml' && view.flow) {
    for (let path = finding.path; path !== ''; path = parentPath(path)) {
      const stories = boxAt(view.flow, path)?.stories;
      for (const s of Array.isArray(stories) ? stories : []) out.add(s);
    }
  }
  return [...out].sort();
}

/** A finding that a new sign-off of `story` clears: the story is stale or signed under an old hash rule. */
function resignStory(finding: Finding): Id | undefined {
  return finding.kind === 'gate' && finding.file === 'signoff.yaml' ? finding.path : undefined;
}

/**
 * Gate findings that block a sign-off of the selected stories (S9-A1): each finding about one
 * of them, and each finding about the whole EPIC. A finding that the sign-off itself clears does not block.
 */
export function blockingFindings(view: ReviewEpicView, findings: Finding[], selected: ReadonlySet<Id>): Finding[] {
  return findings.filter((f) => {
    const resign = resignStory(f);
    if (resign !== undefined && selected.has(resign)) return false;
    const stories = findingStories(view, f);
    return stories.length === 0 || stories.some((s) => selected.has(s));
  });
}

export interface FindingGroup {
  /** Story id, or undefined for findings about the whole EPIC. */
  story?: Id;
  findings: Finding[];
}

/** Gate findings grouped by story, in prd.yaml order; EPIC-wide findings first. A finding about two stories is in both groups. */
export function groupByStory(view: ReviewEpicView, findings: Finding[]): FindingGroup[] {
  const epic: Finding[] = [];
  const byStory = new Map<Id, Finding[]>();
  for (const f of findings) {
    const stories = findingStories(view, f);
    if (stories.length === 0) epic.push(f);
    for (const s of stories) byStory.set(s, [...(byStory.get(s) ?? []), f]);
  }
  const order = storiesOf(view.prd).map((s) => s.id);
  const ids = [...byStory.keys()].sort((a, b) => rank(order, a) - rank(order, b) || a.localeCompare(b));
  const groups: FindingGroup[] = ids.map((story) => ({ story, findings: byStory.get(story)! }));
  return epic.length > 0 ? [{ findings: epic }, ...groups] : groups;
}

function rank(order: string[], id: string): number {
  const i = order.indexOf(id);
  return i < 0 ? order.length : i;
}

/** Rows and columns of the permission matrix: roles in lane order, then the rest; entities in entities.yaml order, then the rest. */
export function matrixAxes(matrix: PermissionMatrix, flow: Flow | undefined, entityNames: string[]): { roles: Id[]; entities: Id[] } {
  const laneOrder = Array.isArray(flow?.lanes) ? [...flow.lanes].sort((a, b) => a.order - b.order).map((l) => l.role) : [];
  const roles = [...new Set([...laneOrder.filter((r) => r in matrix), ...Object.keys(matrix).sort()])];
  const used = new Set(Object.values(matrix).flatMap((byEntity) => Object.keys(byEntity)));
  const entities = [...new Set([...entityNames.filter((e) => used.has(e)), ...[...used].sort()])];
  return { roles, entities };
}

/** One line of a finding, the way the CLI prints it. */
export function findingText(f: Finding): string {
  return `${f.file}${f.path ? `: ${f.path}` : ''}: ${f.message}`;
}
