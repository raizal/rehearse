// The storyboard of one scenario (S6-A1): its story and criterion, its approval state in words,
// the review queue grouped by story, and the path map (the diagrams the path goes through,
// with the path boxes and the edges taken).

import type { AcceptanceCriterion, Box, Diagram, EdgeKind, Flow, Id, Prd, Scenario, Story } from '@rehearse/core';
import type { ScenarioView } from '../api.js';
import type { ApprovalView, ReviewEpicView } from '../contract.js';
import { boxAt, diagramAt } from './diagram.js';
import { storiesOf } from './review.js';

export type ApprovalKind = 'signed' | 'missing' | 'invalid' | 'unknown-signer' | 'unchecked' | 'stale' | 'draft';

export interface ApprovalState {
  kind: ApprovalKind;
  /** The state in words, e.g. `approved, signature valid`. */
  text: string;
  /** Approved, not stale, with a valid signature: the only approval that is evidence (D41). */
  done: boolean;
}

/** Approval state of a scenario in words. `approvals` undefined means the server sent no signature checks. */
export function approvalState(sv: ScenarioView, approvals: Record<Id, ApprovalView> | undefined): ApprovalState {
  if (sv.status === 'draft') return { kind: 'draft', text: 'draft, not approved', done: false };
  if (sv.status === 'stale') return { kind: 'stale', text: 'stale, changed since it was approved', done: false };
  if (!approvals) return { kind: 'unchecked', text: 'approved, signature not checked', done: false };
  const sig = approvals[sv.scenario.id]?.sigStatus ?? 'missing';
  if (sig === 'valid') return { kind: 'signed', text: 'approved, signature valid', done: true };
  if (sig === 'unknown-signer') return { kind: 'unknown-signer', text: 'approved, unknown signer', done: false };
  if (sig === 'invalid') return { kind: 'invalid', text: 'approved, signature invalid', done: false };
  return { kind: 'missing', text: 'approved, signature missing', done: false };
}

export interface QueueGroup {
  storyId: Id;
  story?: Story;
  scenarios: ScenarioView[];
}

/** Scenarios grouped by story: stories in prd.yaml order, then stories prd.yaml does not have. */
export function reviewQueue(prd: Prd | undefined, scenarios: ScenarioView[]): QueueGroup[] {
  const stories = storiesOf(prd);
  const groups: QueueGroup[] = stories.map((story) => ({ storyId: story.id, story, scenarios: [] }));
  const byId = new Map(groups.map((g) => [g.storyId, g]));
  for (const sv of scenarios) {
    const id = sv.scenario.story ?? '?';
    let group = byId.get(id);
    if (!group) {
      group = { storyId: id, scenarios: [] };
      byId.set(id, group);
      groups.push(group);
    }
    group.scenarios.push(sv);
  }
  return groups.filter((g) => g.scenarios.length > 0);
}

/** How many scenarios have a valid signed approval. */
export function progress(scenarios: ScenarioView[], approvals: Record<Id, ApprovalView> | undefined): { done: number; total: number } {
  return { done: scenarios.filter((sv) => approvalState(sv, approvals).done).length, total: scenarios.length };
}

/** The next scenario after `current` in queue order that has no valid signed approval, wrapping round. */
export function nextToApprove(order: ScenarioView[], current: Id | undefined, approvals: Record<Id, ApprovalView> | undefined): Id | undefined {
  const start = order.findIndex((sv) => sv.scenario.id === current);
  for (let k = 1; k <= order.length; k++) {
    const sv = order[(start + k + order.length) % order.length]!;
    if (sv.scenario.id !== current && !approvalState(sv, approvals).done) return sv.scenario.id;
  }
  return undefined;
}

// ---------------------------------------------------------------- next scenario, next story (S21)

export interface NextScenario {
  id: Id;
  title: string;
  storyId: Id;
  /** 1-based place of the scenario among its story's scenarios, in queue order. */
  index: number;
  /** How many scenarios the story has. */
  total: number;
}

/**
 * The next scenario of the same story as `current`, in queue order, with no valid signed
 * approval: the first after `current`, else the first before it (wrapping). Undefined when no
 * other scenario of the story is left to approve.
 */
export function nextInStory(order: ScenarioView[], current: Id, approvals: Record<Id, ApprovalView> | undefined): NextScenario | undefined {
  const storyId = order.find((sv) => sv.scenario.id === current)?.scenario.story;
  if (storyId === undefined) return undefined;
  const own = order.filter((sv) => sv.scenario.story === storyId);
  const id = nextToApprove(own, current, approvals);
  const at = own.findIndex((sv) => sv.scenario.id === id);
  if (id === undefined || at < 0) return undefined;
  return { id, title: own[at]!.scenario.title, storyId, index: at + 1, total: own.length };
}

export interface NextStory {
  storyId: Id;
  story?: Story;
  /** Its first scenario in queue order with no valid signed approval. */
  scenarioId: Id;
  /** How many of its scenarios are left to approve. */
  left: number;
}

/**
 * The next story after `storyId` in queue order that still has scenarios to approve, wrapping
 * round to the stories before it. Never `storyId` itself. Undefined when no other story has
 * anything left to approve.
 */
export function nextStoryToApprove(groups: QueueGroup[], storyId: Id | undefined, approvals: Record<Id, ApprovalView> | undefined): NextStory | undefined {
  const start = groups.findIndex((g) => g.storyId === storyId);
  for (let k = 1; k <= groups.length; k++) {
    const g = groups[(start + k + groups.length) % groups.length]!;
    if (g.storyId === storyId) continue;
    const left = g.scenarios.filter((sv) => !approvalState(sv, approvals).done);
    if (left.length > 0) return { storyId: g.storyId, ...(g.story ? { story: g.story } : {}), scenarioId: left[0]!.scenario.id, left: left.length };
  }
  return undefined;
}

/** What the owner can do when every scenario of a story is approved with a valid signature. */
export interface StoryFinish {
  storyId: Id;
  /** How many scenarios the story has, all approved. */
  total: number;
  /** The story still needs a sign-off: never signed, or signed but stale. Undefined when the sign-off is current. */
  signOff?: 'unsigned' | 'stale';
  /** The next story with scenarios to approve; undefined when every scenario of the EPIC is approved. */
  next?: NextStory;
}

/**
 * The finish of a story: undefined while the story has no scenarios or any of them is left to
 * approve; else its sign-off need and the next story. The sign-off state is the readiness's
 * (signed, stale, draft); a server without readiness counts as not signed.
 */
export function storyFinish(view: Pick<ReviewEpicView, 'prd' | 'scenarios' | 'approvals' | 'readiness'>, storyId: Id): StoryFinish | undefined {
  const groups = reviewQueue(view.prd, view.scenarios);
  const own = groups.find((g) => g.storyId === storyId)?.scenarios ?? [];
  if (own.length === 0 || own.some((sv) => !approvalState(sv, view.approvals).done)) return undefined;
  const status = view.readiness?.requirements.flatMap((r) => r.stories).find((s) => s.id === storyId)?.status;
  const next = nextStoryToApprove(groups, storyId, view.approvals);
  return {
    storyId,
    total: own.length,
    ...(status === 'signed' ? {} : { signOff: status === 'stale' ? ('stale' as const) : ('unsigned' as const) }),
    ...(next ? { next } : {}),
  };
}

/** The story of a scenario and the acceptance criterion its `expect.criterion` names. */
export function criterionFor(prd: Prd | undefined, scenario: Scenario): { story?: Story; criterion?: AcceptanceCriterion } {
  const story = storiesOf(prd).find((s) => s.id === scenario.story);
  const id = scenario.expect?.criterion;
  const criterion = id && Array.isArray(story?.acceptance) ? story.acceptance.find((a) => a?.id === id) : undefined;
  return { ...(story ? { story } : {}), ...(criterion ? { criterion } : {}) };
}

// ---------------------------------------------------------------- path map

export interface MapBox {
  id: string;
  path: string;
  box: Box;
  /** 1-based numbers of the steps on this box or inside it. */
  steps: number[];
  onPath: boolean;
}

export interface MapEdge {
  from: string;
  to: string;
  label?: string;
  kind: EdgeKind;
  /** The path goes along this edge. */
  taken: boolean;
}

export interface MapDiagram {
  /** '' for the root. */
  path: string;
  /** Title of the box that holds the diagram, or the EPIC for the root. */
  title: string;
  diagram: Diagram;
  boxes: MapBox[];
  edges: MapEdge[];
}

const join = (diagramPath: string, id: string): string => (diagramPath === '' ? id : `${diagramPath}/${id}`);

/**
 * The diagrams a scenario's path goes through, root first: the diagram of each step and of each
 * box above it. Each lists all its boxes (the path boxes with their step numbers) and its edges,
 * with the edges the path takes marked. A step goes from one box to the next along the edge
 * between the two boxes that hold them in their nearest common diagram.
 */
export function pathMap(flow: Flow | undefined, scenario: Scenario): MapDiagram[] {
  const steps = (Array.isArray(scenario.steps) ? scenario.steps : []).filter((s) => s && typeof s.name === 'string');
  const order: string[] = [];
  for (const step of steps) {
    const ids = step.name.split('/');
    for (let k = 0; k < ids.length; k++) {
      const d = ids.slice(0, k).join('/');
      if (!order.includes(d) && diagramAt(flow, d)) order.push(d);
    }
  }

  const taken = new Map<string, Set<string>>(); // diagram path → `from\nto\nlabel` keys
  const take = (diagram: string, from: string, to: string | undefined, branch: string | undefined) => {
    const edges = diagramAt(flow, diagram)?.edges;
    const list = (Array.isArray(edges) ? edges : []).filter((e) => e && e.from === from && (to === undefined || e.to === to));
    const edge = list.find((e) => branch !== undefined && e.label === branch) ?? (to === undefined ? undefined : list[0]);
    if (!edge) return;
    const set = taken.get(diagram) ?? new Set<string>();
    set.add(edgeKey(edge.from, edge.to, edge.label));
    taken.set(diagram, set);
  };
  steps.forEach((step, i) => {
    const a = step.name.split('/');
    const next = steps[i + 1];
    if (!next) {
      // A last step that takes a branch or an error exit: mark the edge with that label.
      if (step.branch !== undefined) take(a.slice(0, -1).join('/'), a[a.length - 1]!, undefined, step.branch);
      return;
    }
    const b = next.name.split('/');
    let k = 0;
    while (k < a.length && k < b.length && a[k] === b[k]) k++;
    if (k >= a.length || k >= b.length) return;
    take(a.slice(0, k).join('/'), a[k]!, b[k]!, step.branch);
  });

  return order.map((path) => {
    const diagram = diagramAt(flow, path)!;
    const boxes: MapBox[] = (Array.isArray(diagram.boxes) ? diagram.boxes : [])
      .filter((b) => b && typeof b.id === 'string')
      .map((box) => {
        const p = join(path, box.id);
        const on: number[] = [];
        steps.forEach((s, i) => {
          if (s.name === p || s.name.startsWith(`${p}/`)) on.push(i + 1);
        });
        return { id: box.id, path: p, box, steps: on, onPath: on.length > 0 };
      });
    const ids = new Set(boxes.map((b) => b.id));
    const keys = taken.get(path) ?? new Set<string>();
    const edges: MapEdge[] = (Array.isArray(diagram.edges) ? diagram.edges : [])
      .filter((e) => e && ids.has(e.from) && ids.has(e.to))
      .map((e) => ({
        from: e.from,
        to: e.to,
        ...(e.label !== undefined ? { label: e.label } : {}),
        kind: e.kind ?? 'normal',
        taken: keys.has(edgeKey(e.from, e.to, e.label)),
      }));
    const title = path === '' ? (flow?.epic ?? 'root') : (boxAt(flow, path)?.title ?? path);
    return { path, title, diagram, boxes, edges };
  });
}

function edgeKey(from: string, to: string, label: string | undefined): string {
  return `${from}\n${to}\n${label ?? ''}`;
}
