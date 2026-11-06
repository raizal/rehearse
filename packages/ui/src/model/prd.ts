// The PRD as a document (T15 feature 3): requirements with their proof (N/M scenarios approved,
// and whether the approvals are signed), stories with the scenario that proves each acceptance
// criterion, the trace tree of an id (requirement → story → boxes → scenarios), the places in
// rehearse that show an id, and the gate note of a requirement that is not proved yet.

import type { AcceptanceCriterion, Id, Requirement, RequirementKind, ResolvedQuestion, Role, Story } from '@rehearse/core';
import type { ScenarioView } from '../api.js';
import type { ReviewEpicView } from '../contract.js';
import { boxAt, roleName } from './diagram.js';
import { flowPaths, MAIN_KINDS, servedStories } from './features.js';
import { chipWidth, citedDecisions, knownIds, type KnownIds, type LinkRef, type Place } from './links.js';
import { storiesOf } from './review.js';
import { approvalState, type ApprovalState } from './storyboard.js';

// ---------------------------------------------------------------- proof

export type ProofGap = 'no-story' | 'no-scenario' | 'none-approved' | 'not-signed';

export interface ProofCount {
  /** Scenarios that count. */
  total: number;
  /** Approved and not stale. */
  approved: number;
  /** Approved with a valid signature: the only proof (D41, C28). */
  signed: number;
  /** e.g. `3/5 scenarios approved`. */
  text: string;
  /** e.g. `approvals not signed yet`, `all approvals signed`, `1 of 3 approvals signed`. */
  signText: string;
  /** At least one scenario is approved with a valid signature. */
  proved: boolean;
  /** Why it is not proved. */
  gap?: ProofGap;
}

/** The proof the scenarios give. `noStory` marks a requirement that no story names. */
export function proofOf(view: ReviewEpicView, scenarios: ScenarioView[], noStory = false): ProofCount {
  const states = scenarios.map((sv) => approvalState(sv, view.approvals));
  const approved = scenarios.filter((sv) => sv.status === 'approved').length;
  const signed = states.filter((s) => s.done).length;
  const total = scenarios.length;
  const text = total === 0 ? 'no scenarios' : `${approved}/${total} scenario${total === 1 ? '' : 's'} approved`;
  let signText = '';
  if (approved > 0) signText = signed === 0 ? 'approvals not signed yet' : signed === approved ? 'all approvals signed' : `${signed} of ${approved} approvals signed`;
  const proved = signed > 0;
  const gap: ProofGap | undefined = proved ? undefined : noStory ? 'no-story' : total === 0 ? 'no-scenario' : approved === 0 ? 'none-approved' : 'not-signed';
  return { total, approved, signed, text, signText, proved, ...(gap ? { gap } : {}) };
}

/** Stories that name the requirement, in prd.yaml order. */
export function storiesOfRequirement(view: ReviewEpicView, reqId: Id): Story[] {
  return storiesOf(view.prd).filter((s) => Array.isArray(s.requirements) && s.requirements.includes(reqId));
}

/** Scenarios of the stories that name the requirement. */
export function requirementScenarios(view: ReviewEpicView, reqId: Id): ScenarioView[] {
  const ids = new Set(storiesOfRequirement(view, reqId).map((s) => s.id));
  return view.scenarios.filter((sv) => ids.has(sv.scenario.story));
}

export function requirementProof(view: ReviewEpicView, reqId: Id): ProofCount {
  return proofOf(view, requirementScenarios(view, reqId), storiesOfRequirement(view, reqId).length === 0);
}

/** Scenarios whose path goes through the box (a step names it or a box inside it). */
export function boxScenarios(view: ReviewEpicView, path: string): ScenarioView[] {
  return view.scenarios.filter((sv) => (Array.isArray(sv.scenario.steps) ? sv.scenario.steps : []).some((st) => st?.name === path || st?.name?.startsWith(`${path}/`)));
}

/** Boxes whose own `stories` list names the story, in flow order. */
export function storyBoxes(view: ReviewEpicView, storyId: Id): string[] {
  return flowPaths(view.flow).filter((p) => {
    const stories = boxAt(view.flow, p)?.stories;
    return Array.isArray(stories) && stories.includes(storyId);
  });
}

/** The gate note of a requirement that is not proved yet, in words. */
export function gateNote(id: Id, proof: ProofCount): string | undefined {
  if (proof.proved) return undefined;
  switch (proof.gap) {
    case 'no-story':
      return `No story names ${id}, so no scenario can prove it. Add a story for it.`;
    case 'no-scenario':
      return `The stories of ${id} have no scenarios yet. Add a scenario that ends in its acceptance criteria.`;
    case 'none-approved':
      return proof.total === 1
        ? `The scenario of ${id} is not approved yet. Review it in the Storyboard and approve it.`
        : `None of the ${proof.total} scenarios of ${id} is approved yet. Review each one in the Storyboard and approve it.`;
    default:
      return `The ${proof.approved === 1 ? 'scenario is' : `${proof.approved} scenarios are`} approved, but the approvals have no valid SSH signature. Approve them again in the UI, then they count as evidence.`;
  }
}

// ---------------------------------------------------------------- trace tree

export interface TraceScenario {
  id: Id;
  state: ApprovalState;
}

export interface TraceStory {
  id: Id;
  boxes: string[];
  scenarios: TraceScenario[];
}

export interface TraceRequirement {
  id: Id;
  stories: TraceStory[];
}

/**
 * The trace of an id: requirement → stories → boxes → scenarios with status. A story traces from
 * each requirement it names, a box from the stories it serves, a scenario from its story (and
 * only that scenario shows). Other kinds have no trace.
 */
export function traceOf(view: ReviewEpicView, ref: LinkRef): TraceRequirement[] {
  const stories = storiesOf(view.prd);
  const story = (s: Story, only?: Id): TraceStory => ({
    id: s.id,
    boxes: storyBoxes(view, s.id),
    scenarios: view.scenarios
      .filter((sv) => sv.scenario.story === s.id && (only === undefined || sv.scenario.id === only))
      .map((sv) => ({ id: sv.scenario.id, state: approvalState(sv, view.approvals) })),
  });
  const fromStories = (picked: Story[], only?: Id): TraceRequirement[] => {
    const reqs: Id[] = [];
    for (const s of picked) for (const r of Array.isArray(s.requirements) ? s.requirements : []) if (!reqs.includes(r)) reqs.push(r);
    return reqs.map((id) => ({ id, stories: picked.filter((s) => s.requirements.includes(id)).map((s) => story(s, only)) }));
  };
  switch (ref.kind) {
    case 'requirement':
      return [{ id: ref.id, stories: storiesOfRequirement(view, ref.id).map((s) => story(s)) }];
    case 'story': {
      const s = stories.find((x) => x.id === ref.id.replace(/-A\d+$/, ''));
      return s ? fromStories([s]) : [];
    }
    case 'box': {
      const served = servedStories(boxAt(view.flow, ref.id));
      return fromStories(stories.filter((s) => served.includes(s.id)));
    }
    case 'scenario': {
      const sv = view.scenarios.find((x) => x.scenario.id === ref.id);
      const s = sv && stories.find((x) => x.id === sv.scenario.story);
      return s ? fromStories([s], ref.id) : [];
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------- open in rehearse

export interface OpenPlace {
  /** The view, e.g. `Story view`. */
  label: string;
  /** What the view shows of the id, e.g. `S6 · WHAT · HOW · OUTPUT`. */
  detail: string;
  place: Place;
}

/** Every view that shows the id, with a short note of what it shows there. */
export function openPlaces(view: ReviewEpicView, ref: LinkRef): OpenPlace[] {
  const out: OpenPlace[] = [];
  const firstScenario = (storyId: Id) => view.scenarios.find((sv) => sv.scenario.story === storyId)?.scenario.id;
  const storyPlaces = (s: Story) => {
    out.push({ label: 'Story view', detail: `${s.id} · WHAT · HOW · OUTPUT`, place: { view: 'story', story: s.id } });
    const sc = firstScenario(s.id);
    if (sc) out.push({ label: 'Storyboard', detail: `${sc} · one card per step`, place: { view: 'storyboard', scenario: sc } });
  };
  const boxPlace = (path: string) => {
    const box = boxAt(view.flow, path);
    out.push({ label: 'Box', detail: `box ${path} in the ${roleName(view.prd, box?.lane)} lane`, place: { view: 'box', box: path } });
  };
  switch (ref.kind) {
    case 'requirement': {
      for (const s of storiesOfRequirement(view, ref.id)) storyPlaces(s);
      for (const s of storiesOfRequirement(view, ref.id).slice(0, 1)) for (const b of storyBoxes(view, s.id).slice(0, 1)) boxPlace(b);
      out.push({ label: 'Readiness', detail: `row ${ref.id}: requirement → story → box → scenario`, place: { view: 'readiness', requirement: ref.id } });
      break;
    }
    case 'story': {
      const s = storiesOf(view.prd).find((x) => x.id === ref.id.replace(/-A\d+$/, ''));
      if (s) {
        storyPlaces(s);
        out.push({ label: 'Big picture', detail: `story line ${s.id}`, place: { view: 'bigpicture' } });
        for (const r of s.requirements ?? []) out.push({ label: 'Readiness', detail: `row ${r}`, place: { view: 'readiness', requirement: r } });
      }
      break;
    }
    case 'box': {
      const box = boxAt(view.flow, ref.id);
      if (box && !ref.id.includes('/') && MAIN_KINDS.includes(box.kind)) out.push({ label: 'Big picture', detail: `column ${ref.id}`, place: { view: 'bigpicture' } });
      for (const id of servedStories(box)) out.push({ label: 'Story view', detail: `${id} · HOW lane`, place: { view: 'story', story: id } });
      const sc = boxScenarios(view, ref.id)[0];
      if (sc) out.push({ label: 'Storyboard', detail: `${sc.scenario.id}`, place: { view: 'storyboard', scenario: sc.scenario.id } });
      if (box && (Array.isArray(box.writes) || Array.isArray(box.reads))) out.push({ label: 'Use cases', detail: `${roleName(view.prd, box.lane)} → ${box.title ?? ref.id}`, place: { view: 'usecases' } });
      boxPlace(ref.id);
      out.push({ label: 'Tech spec', detail: `contract of ${ref.id}`, place: { view: 'techspec', focus: `box:${ref.id}` } });
      break;
    }
    case 'scenario': {
      const sv = view.scenarios.find((x) => x.scenario.id === ref.id);
      out.push({ label: 'Storyboard', detail: `${ref.id} · one card per step`, place: { view: 'storyboard', scenario: ref.id } });
      if (sv) out.push({ label: 'Story view', detail: `${sv.scenario.story} · its scenarios`, place: { view: 'story', story: sv.scenario.story } });
      break;
    }
    case 'entity':
      out.push({ label: 'Tech spec', detail: `entity ${ref.id}`, place: { view: 'techspec', focus: `entity:${ref.id}` } });
      out.push({ label: 'Use cases', detail: `the data each action changes`, place: { view: 'usecases' } });
      break;
    case 'decision':
      out.push({ label: 'Tech spec', detail: `decision log ${ref.id}`, place: { view: 'techspec', focus: `decision:${ref.id}` } });
      break;
  }
  return out;
}

// ---------------------------------------------------------------- the document

export interface RequirementRow {
  requirement: Requirement;
  stories: Id[];
  proof: ProofCount;
  /** Decisions and corrections the text cites. */
  cites: Id[];
}

export interface CriterionRow {
  criterion: AcceptanceCriterion;
  /** Scenarios that name the criterion as `expect.criterion`, with their state. */
  provedBy: TraceScenario[];
}

export interface StoryCard {
  story: Story;
  roleLabel: string;
  criteria: CriterionRow[];
  /** Boxes whose `stories` name the story, in flow order. */
  boxes: string[];
  proof: ProofCount;
}

export interface Contents {
  id: string;
  label: string;
  count?: number;
}

export interface PrdDoc {
  title: string;
  goal: string;
  successMeasure?: string;
  successCites: Id[];
  roles: Role[];
  requirements: RequirementRow[];
  /** Each requirement kind with its count, in first-use order. */
  kinds: { kind: RequirementKind; count: number }[];
  stories: StoryCard[];
  outOfScope: string[];
  resolved: ResolvedQuestion[];
  contents: Contents[];
}

export function prdDoc(view: ReviewEpicView, known: KnownIds = knownIds(view)): PrdDoc {
  const prd = view.prd;
  const requirements: RequirementRow[] = (Array.isArray(prd?.requirements) ? prd.requirements : [])
    .filter((r) => r && typeof r.id === 'string')
    .map((requirement) => ({
      requirement,
      stories: storiesOfRequirement(view, requirement.id).map((s) => s.id),
      proof: requirementProof(view, requirement.id),
      cites: citedDecisions(requirement.text, known),
    }));
  const kinds: PrdDoc['kinds'] = [];
  for (const r of requirements) {
    const k = kinds.find((x) => x.kind === r.requirement.kind);
    if (k) k.count += 1;
    else kinds.push({ kind: r.requirement.kind, count: 1 });
  }
  const stories: StoryCard[] = storiesOf(prd).map((story) => {
    const own = view.scenarios.filter((sv) => sv.scenario.story === story.id);
    return {
      story,
      roleLabel: roleName(prd, story.role),
      criteria: (Array.isArray(story.acceptance) ? story.acceptance : []).map((criterion) => ({
        criterion,
        provedBy: own.filter((sv) => sv.scenario.expect?.criterion === criterion.id).map((sv) => ({ id: sv.scenario.id, state: approvalState(sv, view.approvals) })),
      })),
      boxes: storyBoxes(view, story.id),
      proof: proofOf(view, own),
    };
  });
  const roles = Array.isArray(prd?.roles) ? prd.roles : [];
  const outOfScope = Array.isArray(prd?.epic?.outOfScope) ? prd.epic.outOfScope : [];
  const resolved = Array.isArray(prd?.resolvedQuestions) ? prd.resolvedQuestions : [];
  return {
    title: prd?.epic?.title ?? view.slug,
    goal: prd?.epic?.goal ?? '',
    ...(prd?.epic?.successMeasure ? { successMeasure: prd.epic.successMeasure } : {}),
    successCites: citedDecisions(prd?.epic?.successMeasure, known),
    roles,
    requirements,
    kinds,
    stories,
    outOfScope,
    resolved,
    contents: [
      { id: 'goal', label: 'Goal' },
      { id: 'roles', label: 'Roles', count: roles.length },
      { id: 'requirements', label: 'Requirements', count: requirements.length },
      { id: 'stories', label: 'Stories', count: stories.length },
      { id: 'out-of-scope', label: 'Out of scope', count: outOfScope.length },
      { id: 'resolved', label: 'Resolved questions', count: resolved.length },
    ],
  };
}

// ---------------------------------------------------------------- trace diagram (T18, design page 9)

/** Sizes of the trace diagram in px: chip height, row height of a box and of a scenario (chip and status line). */
export const TRACE = { chipH: 20, boxRow: 40, scenarioRow: 46, minRow: 32, gap: 28, trunkGap: 48, statusW: 150 } as const;

export interface TraceNode {
  kind: 'requirement' | 'story' | 'box' | 'scenario';
  id: string;
  /** Top left of the chip. */
  x: number;
  y: number;
  /** A scenario's state, drawn under its chip. */
  state?: ApprovalState;
}

export interface TraceNote {
  x: number;
  y: number;
  text: string;
}

export interface TraceLayout {
  width: number;
  height: number;
  nodes: TraceNode[];
  /** `no story`, `no box`, `no scenario`. */
  notes: TraceNote[];
  /** Elbow connectors, SVG paths. */
  lines: string[];
}

const elbow = (x1: number, y1: number, x2: number, y2: number) => {
  const mx = Math.round((x1 + x2) / 2);
  return y1 === y2 ? `M ${x1} ${y1} H ${x2}` : `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`;
};

/**
 * The trace as a small tree, left to right: requirement → story → boxes, and a trunk from the
 * boxes to the scenarios with their status. Each story gets a band as tall as its boxes or its
 * scenarios; a requirement sits in the middle of its stories. Columns are as wide as their
 * widest chip, so long box paths push the next column right instead of overlapping it.
 */
export function traceLayout(trace: TraceRequirement[], width: (id: string) => number = chipWidth): TraceLayout {
  const maxW = (ids: string[], min = 0) => Math.max(min, ...ids.map(width));
  const stories = trace.flatMap((r) => r.stories);
  const reqW = maxW(trace.map((r) => r.id));
  const storyW = maxW(stories.map((s) => s.id), 40);
  const boxW = maxW(stories.flatMap((s) => s.boxes), 50);
  const col = [0, reqW + TRACE.gap, 0, 0];
  col[2] = col[1]! + storyW + TRACE.gap;
  col[3] = col[2]! + boxW + TRACE.trunkGap;
  const scnW = maxW(stories.flatMap((s) => s.scenarios.map((x) => x.id)), TRACE.statusW);
  const nodes: TraceNode[] = [];
  const notes: TraceNote[] = [];
  const lines: string[] = [];
  const half = TRACE.chipH / 2;
  let y = 0;
  for (const r of trace) {
    const centers: number[] = [];
    const storyLines: string[] = [];
    if (r.stories.length === 0) {
      centers.push(y + TRACE.minRow / 2);
      notes.push({ x: col[1]!, y: y + TRACE.minRow / 2 - 7, text: 'no story' });
      y += TRACE.minRow;
    }
    for (const s of r.stories) {
      const h = Math.max(TRACE.minRow, s.boxes.length * TRACE.boxRow, s.scenarios.length * TRACE.scenarioRow);
      const cy = y + h / 2;
      centers.push(cy);
      nodes.push({ kind: 'story', id: s.id, x: col[1]!, y: cy - half });
      const boxTop = y + (h - s.boxes.length * TRACE.boxRow) / 2;
      const boxYs = s.boxes.map((_, i) => boxTop + i * TRACE.boxRow + TRACE.boxRow / 2);
      s.boxes.forEach((b, i) => {
        nodes.push({ kind: 'box', id: b, x: col[2]!, y: boxYs[i]! - half });
        storyLines.push(elbow(col[1]! + width(s.id), cy, col[2]!, boxYs[i]!));
      });
      if (s.boxes.length === 0) notes.push({ x: col[2]!, y: cy - 7, text: 'no box' });
      // The trunk leaves the box column at the first box (or the story, with no box).
      const trunkX = s.boxes.length > 0 ? col[2]! + width(s.boxes[0]!) : col[1]! + width(s.id);
      const trunkY = boxYs[0] ?? cy;
      const scnTop = y + (h - s.scenarios.length * TRACE.scenarioRow) / 2;
      s.scenarios.forEach((sc, i) => {
        const top = scnTop + i * TRACE.scenarioRow + 4;
        nodes.push({ kind: 'scenario', id: sc.id, x: col[3]!, y: top, state: sc.state });
        storyLines.push(elbow(trunkX, trunkY, col[3]!, top + half));
      });
      if (s.scenarios.length === 0) notes.push({ x: col[3]!, y: cy - 7, text: 'no scenario' });
      y += h;
    }
    // The requirement sits in the middle of its stories, with a connector to each.
    const ry = (centers[0]! + centers[centers.length - 1]!) / 2;
    nodes.push({ kind: 'requirement', id: r.id, x: col[0]!, y: ry - half });
    if (r.stories.length > 0) for (const cy of centers) lines.push(elbow(col[0]! + width(r.id), ry, col[1]!, cy));
    lines.push(...storyLines);
    y += 8;
  }
  return { width: col[3]! + scnW, height: Math.max(0, y - 8), nodes, notes, lines };
}

// ---------------------------------------------------------------- page header and contents rail (T18)

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The line under the PRD title: `prd.yaml · 21 requirements · 10 stories · 4 roles. …` */
export function prdSummary(doc: PrdDoc): string {
  return `prd.yaml · ${count(doc.requirements.length, 'requirement')} · ${count(doc.stories.length, 'story').replace('storys', 'stories')} · ${count(doc.roles.length, 'role')}. Every ID opens the place in rehearse where it lives.`;
}

/**
 * The contents row to mark as active: the last section whose top is at or above the reading line
 * (a little below the top of the scrolled document), else the first.
 */
export function activeSection(tops: { id: string; top: number }[], scrollTop: number, line = 24): string | undefined {
  let at = tops[0]?.id;
  for (const t of tops) if (t.top <= scrollTop + line) at = t.id;
  return at;
}
