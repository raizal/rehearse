// The Tech spec as a document (T15 feature 4, D20): box contracts (D10), the entity model with
// links between entities, lifecycles as state diagrams with the box that makes each transition
// (D21), non-functional requirements with how they are proved (D22), the decision log and the
// corrections. Layout numbers for the state diagram are here, so the component only draws.

import type { Box, EntityDef, Flow, Id, Requirement } from '@rehearse/core';
import type { ReviewEpicView } from '../contract.js';
import { boxAt, roleName } from './diagram.js';
import { flowPaths, MAIN_KINDS, servedStories } from './features.js';
import { citedDecisions, knownIds, type KnownIds, type LinkRef } from './links.js';
import { boxScenarios, proofOf, storiesOfRequirement, storyBoxes, type Contents, type ProofCount } from './prd.js';
import { storiesOf } from './review.js';
import { writeChange, type WriteChange } from './storyview.js';

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const fields = (v: unknown): string[] => (v && typeof v === 'object' ? Object.keys(v) : []);

// ---------------------------------------------------------------- box contracts

export interface ContractRow {
  path: string;
  box: Box;
  /** 0 for a root box. */
  depth: number;
  laneLabel: string;
  /** Input and output field names. */
  ins: string[];
  outs: string[];
  writes: WriteChange[];
  reads: string[];
  /** Stories the box serves (with its children). */
  stories: Id[];
  /** Scenarios whose path goes through the box. */
  proof: ProofCount;
  /** A job (process, input, output, external); start, end and decision boxes are not. */
  main: boolean;
}

/** Every box of the flow, each diagram in flow order, a parent right before its children. */
export function boxContracts(view: ReviewEpicView): ContractRow[] {
  return flowPaths(view.flow).flatMap((path) => {
    const box = boxAt(view.flow, path);
    if (!box) return [];
    return [
      {
        path,
        box,
        depth: path.split('/').length - 1,
        laneLabel: roleName(view.prd, box.lane),
        ins: fields(box.inputs),
        outs: fields(box.outputs),
        writes: list(box.writes).map(writeChange),
        reads: list(box.reads),
        stories: servedStories(box),
        proof: proofOf(view, boxScenarios(view, path)),
        main: MAIN_KINDS.includes(box.kind),
      },
    ];
  });
}

/** Requirements a box traces to: those of the stories it serves, in prd.yaml order. */
export function boxRequirements(view: ReviewEpicView, path: string): Id[] {
  const served = servedStories(boxAt(view.flow, path));
  const out: Id[] = [];
  for (const s of storiesOf(view.prd)) if (served.includes(s.id)) for (const r of s.requirements ?? []) if (!out.includes(r)) out.push(r);
  const order = (view.prd?.requirements ?? []).map((r) => r.id);
  return out.sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** Decisions a box traces to (cited by its requirements), and corrections about the box. */
export function boxDecisions(view: ReviewEpicView, path: string, known: KnownIds = knownIds(view)): Id[] {
  const out: Id[] = [];
  for (const r of boxRequirements(view, path)) {
    const text = view.prd?.requirements.find((x) => x.id === r)?.text;
    for (const d of citedDecisions(text, known)) if (!out.includes(d)) out.push(d);
  }
  const id = path.split('/').pop()!;
  for (const c of view.corrections ?? []) {
    const named = [...c.about.matchAll(/`([^`]+)`/g)].some((m) => m[1] === path || m[1] === id || expand(m[1]!).includes(path));
    if (named && !out.includes(c.id)) out.push(c.id);
  }
  return out;
}

/** `simulate/{a,b}` → `simulate/a`, `simulate/b`. */
function expand(pattern: string): string[] {
  const m = /^(.*)\{([^}]*)\}(.*)$/.exec(pattern);
  return m ? m[2]!.split(',').map((x) => `${m[1]}${x.trim()}${m[3]}`) : [pattern];
}

// ---------------------------------------------------------------- entities

export interface EntityField {
  name: string;
  type: string;
  /** Entities the type names, e.g. `list ref Story` → Story. */
  refs: Id[];
  /** The type without the entities it names, e.g. `list ref Story` → `list`; drawn before the entity links. */
  plain: string;
}

export interface EntityCard {
  entity: EntityDef;
  fields: EntityField[];
  /** Boxes that write the entity, in flow order. */
  writtenBy: string[];
}

export function entityCards(view: ReviewEpicView): EntityCard[] {
  const entities = (Array.isArray(view.entities?.entities) ? view.entities.entities : []).filter((e) => e && typeof e.id === 'string');
  const ids = new Set(entities.map((e) => e.id));
  const paths = flowPaths(view.flow);
  return entities.map((entity) => ({
    entity,
    fields: Object.entries(entity.fields ?? {}).map(([name, type]) => {
      const refs = [...String(type).matchAll(/\b([A-Z][A-Za-z0-9]*)\b/g)].map((m) => m[1]!).filter((r, i, a) => ids.has(r) && a.indexOf(r) === i);
      return { name, type: String(type), refs, plain: typePlain(String(type), refs) };
    }),
    writtenBy: paths.filter((p) => list(boxAt(view.flow, p)?.writes).some((w) => w.startsWith(`${entity.id}.`))),
  }));
}

/** A field type without the entities it names: `list ref Story` → `list`, `ref Approval?` → `optional`. */
export function typePlain(type: string, refs: Id[]): string {
  let out = type;
  let optional = false;
  for (const r of refs)
    out = out.replace(new RegExp(`\\b(ref\\s+)?${r}\\b(\\?)?`, 'g'), (_m, _ref, q) => {
      if (q) optional = true;
      return '';
    });
  out = out.replace(/\s+/g, ' ').trim();
  return optional ? (out ? `${out}, optional` : 'optional') : out;
}

// ---------------------------------------------------------------- lifecycles

export interface LifecycleEdge {
  from: string;
  to: string;
  /** The role that may make the transition. */
  by: string;
  when?: string;
  /** Boxes that write `Entity.field:from->to`. */
  boxes: string[];
}

export interface LifecycleGraph {
  entity: Id;
  field: string;
  initial: string;
  /** The states: the enum of the field in order, then states only the transitions name. */
  states: string[];
  transitions: LifecycleEdge[];
  /** Boxes that create the item in its initial state (`Entity.field:->initial`). */
  createdBy: string[];
}

export function lifecycleGraph(entity: EntityDef, flow: Flow | undefined): LifecycleGraph | undefined {
  const lc = entity.lifecycle;
  if (!lc || typeof lc.field !== 'string') return undefined;
  const target = `${entity.id}.${lc.field}`;
  const enumText = /^enum\[(.*)\]\??$/.exec(String(entity.fields?.[lc.field] ?? '').trim());
  const states: string[] = enumText ? enumText[1]!.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const add = (s: string) => {
    if (s && !states.includes(s)) states.push(s);
  };
  add(lc.initial);
  const transitions = Array.isArray(lc.transitions) ? lc.transitions : [];
  for (const t of transitions) {
    add(t.from);
    add(t.to);
  }
  const changes = flowPaths(flow).flatMap((path) => list(boxAt(flow, path)?.writes).map((w) => ({ path, change: writeChange(w) })));
  const by = (from: string, to: string) => changes.filter((c) => c.change.target === target && c.change.from === from && c.change.to === to).map((c) => c.path);
  return {
    entity: entity.id,
    field: lc.field,
    initial: lc.initial,
    states,
    transitions: transitions.map((t) => ({ from: t.from, to: t.to, by: t.by, ...(t.when ? { when: t.when } : {}), boxes: by(t.from, t.to) })),
    createdBy: by('', lc.initial),
  };
}

export function lifecycleGraphs(view: ReviewEpicView): LifecycleGraph[] {
  return (view.entities?.entities ?? []).flatMap((e) => {
    const g = e && lifecycleGraph(e, view.flow);
    return g ? [g] : [];
  });
}

/** Sizes of the state diagram, in SVG units. */
export const LC = { stateW: 120, stateH: 40, gap: 130, padX: 40, padY: 70, arc: 34, offset: 8 } as const;

export interface StateBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  initial: boolean;
}

export interface LifecycleArrow {
  from: string;
  to: string;
  /** SVG path. */
  d: string;
  /** Where the label (the boxes, else the role) goes. */
  labelX: number;
  labelY: number;
  /** Forward arrows go above the states, back arrows below. */
  forward: boolean;
}

export interface LifecycleLayout {
  width: number;
  height: number;
  states: StateBox[];
  /** The start dot and its arrow into the initial state. */
  start: { x: number; y: number; d: string };
  arrows: LifecycleArrow[];
}

/**
 * States in one row in enum order. A transition to the next state is a straight arrow a little
 * above the middle; a back transition to the state before is a straight arrow a little below.
 * A transition that skips states arcs above (forward) or below (back) the row.
 */
export function lifecycleLayout(g: LifecycleGraph): LifecycleLayout {
  const index = new Map(g.states.map((id, i) => [id, i]));
  const spans = g.transitions.map((t) => Math.abs((index.get(t.to) ?? 0) - (index.get(t.from) ?? 0)));
  const maxSpan = Math.max(1, ...spans);
  // Room above and below the row: a skipping arc rises LC.arc per state it spans.
  const reach = maxSpan > 1 ? LC.arc * maxSpan : 30;
  const top = Math.max(LC.padY, reach + 20);
  const cy = top + LC.stateH / 2;
  const states: StateBox[] = g.states.map((id, i) => ({ id, x: LC.padX + i * (LC.stateW + LC.gap), y: top, w: LC.stateW, h: LC.stateH, initial: id === g.initial }));
  const arrows: LifecycleArrow[] = [];
  for (const t of g.transitions) {
    const a = states[index.get(t.from) ?? -1];
    const b = states[index.get(t.to) ?? -1];
    if (!a || !b || a === b) continue;
    const forward = b.x > a.x;
    const span = Math.abs(index.get(t.to)! - index.get(t.from)!);
    if (span === 1) {
      const y = forward ? cy - LC.offset : cy + LC.offset;
      const x1 = forward ? a.x + a.w : a.x;
      const x2 = forward ? b.x : b.x + b.w;
      arrows.push({ from: t.from, to: t.to, d: `M ${x1} ${y} L ${x2} ${y}`, labelX: (x1 + x2) / 2, labelY: forward ? y - 8 : y + 18, forward });
    } else {
      const x1 = a.x + a.w / 2;
      const x2 = b.x + b.w / 2;
      const y = forward ? top : top + LC.stateH;
      const control = forward ? y - LC.arc * span : y + LC.arc * span;
      // The middle of a quadratic curve is (start + 2 × control + end) / 4.
      const midY = (2 * y + 2 * control) / 4;
      arrows.push({ from: t.from, to: t.to, d: `M ${x1} ${y} Q ${(x1 + x2) / 2} ${control} ${x2} ${y}`, labelX: (x1 + x2) / 2, labelY: forward ? midY - 6 : midY + 14, forward });
    }
  }
  const first = states[index.get(g.initial) ?? 0];
  const fx = first?.x ?? LC.padX;
  const sx = fx - 26;
  return {
    width: LC.padX * 2 + Math.max(1, states.length) * LC.stateW + Math.max(0, states.length - 1) * LC.gap,
    height: top + LC.stateH + reach + 20,
    states,
    start: { x: sx, y: cy, d: `M ${sx + 5} ${cy} L ${fx} ${cy}` },
    arrows,
  };
}

// ---------------------------------------------------------------- non-functional

export interface NonFunctionalRow {
  requirement: Requirement;
  /** `provenBy` of the requirement: how it is proved (D22). Missing is a gap. */
  provenBy?: string;
  stories: Id[];
}

export function nonFunctional(view: ReviewEpicView): NonFunctionalRow[] {
  return (view.prd?.requirements ?? [])
    .filter((r) => r && r.kind !== 'functional')
    .map((requirement) => ({
      requirement,
      ...(requirement.provenBy ? { provenBy: requirement.provenBy } : {}),
      stories: storiesOfRequirement(view, requirement.id).map((s) => s.id),
    }));
}

// ---------------------------------------------------------------- contents

export function techContents(view: ReviewEpicView): Contents[] {
  return [
    { id: 'contracts', label: 'Box contracts', count: flowPaths(view.flow).length },
    { id: 'entities', label: 'Entity model', count: view.entities?.entities?.length ?? 0 },
    { id: 'lifecycles', label: 'Lifecycles', count: lifecycleGraphs(view).length },
    { id: 'non-functional', label: 'Non-functional', count: nonFunctional(view).length },
    { id: 'decisions', label: 'Decisions', count: (view.decisions ?? []).flatMap((d) => d.ids).length },
    { id: 'corrections', label: 'Corrections', count: (view.corrections ?? []).length },
  ];
}

/** The change rule of a box in words (D7, D23). */
export function changeRule(stories: Id[]): string {
  if (stories.length === 0) return 'A change to this contract goes in corrections.md with a reason (D7). No story uses the box yet.';
  return `A change to this contract goes in corrections.md with a reason, and makes ${stories.join(', ')} and ${stories.length === 1 ? 'its' : 'their'} scenarios stale (D7, D23).`;
}

// ---------------------------------------------------------------- the page (T18, design page 10)

/** Entities a box writes, once each, in its order: `Scenario.status:draft->approved` → Scenario. */
export function writtenEntities(row: ContractRow): Id[] {
  const out: Id[] = [];
  for (const w of row.writes) {
    const e = w.target.split('.')[0]!;
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

/** The first rows of the contracts table: the jobs at the root; the rest is behind "show more". */
export function isFirstRow(row: ContractRow): boolean {
  return row.main && row.depth === 0;
}

/** What the Tech spec says about an id from the PRD: the boxes of its stories, the entities they write, the decisions they trace to. */
export interface SpecLinks {
  entities: Id[];
  boxes: string[];
  decisions: Id[];
}

export function specLinks(view: ReviewEpicView, ref: LinkRef, known: KnownIds = knownIds(view)): SpecLinks {
  const stories = ref.kind === 'requirement' ? storiesOfRequirement(view, ref.id).map((s) => s.id) : ref.kind === 'story' ? [ref.id.replace(/-A\d+$/, '')] : [];
  const paths = new Set(stories.flatMap((s) => storyBoxes(view, s)));
  const rows = boxContracts(view).filter((r) => paths.has(r.path));
  const entities: Id[] = [];
  for (const r of rows) for (const e of writtenEntities(r)) if (known.entities.has(e) && !entities.includes(e)) entities.push(e);
  const decisions: Id[] = [];
  const add = (d: Id) => {
    if (!decisions.includes(d)) decisions.push(d);
  };
  for (const r of rows) for (const d of boxDecisions(view, r.path, known)) add(d);
  if (ref.kind === 'requirement') for (const d of citedDecisions(view.prd?.requirements.find((x) => x.id === ref.id)?.text, known)) add(d);
  return { entities: entities.sort(), boxes: rows.map((r) => r.path), decisions: decisions.sort((a, b) => a[0]!.localeCompare(b[0]!) || Number(a.slice(1)) - Number(b.slice(1))) };
}

/** The line under the Tech spec title. */
export const TECH_SUMMARY = 'flow.yaml + entities.yaml + non-functional requirements. Not prose (D20). Every name opens the place in rehearse where it lives.';
