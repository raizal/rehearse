// The view of one story (S4-A5, D42): WHAT (the role, want, so that, and the acceptance
// criteria as a checklist), HOW (a swimlane of only the boxes that serve the story, in flow
// order) and OUTPUT (each data change as before → after, side effects and what the user sees).

import type { AcceptanceCriterion, Box, EdgeKind, Flow, Id, Story } from '@rehearse/core';
import type { ScenarioView } from '../api.js';
import type { ReviewEpicView } from '../contract.js';
import { boxAt, diagramAt, lanesFor, parentPath, roleName, type LaneInfo } from './diagram.js';
import { flowPaths, servedStories } from './features.js';
import { storiesOf } from './review.js';
import { approvalState } from './storyboard.js';

// ---------------------------------------------------------------- writes

export interface WriteChange {
  /** `Entity.field` or `Entity.*`. */
  target: string;
  /** Set on a state change; `''` means the item is created. */
  from?: string;
  to?: string;
  /** `Entity.field: from → to`, or `Entity.field: written`. */
  text: string;
}

/** Same grammar as `parseAccess` in @rehearse/core, which the browser bundle does not import. */
const ACCESS = /^([A-Z][A-Za-z0-9]*\.(?:\*|[A-Za-z][A-Za-z0-9]*))(?::([a-z0-9-]*)->([a-z0-9-]+))?$/;

/** A `writes` item as a data change. A created item (`:->draft`) reads `new → draft`. */
export function writeChange(text: string): WriteChange {
  const m = ACCESS.exec(text);
  if (!m) return { target: text, text: `${text}: written` };
  const target = m[1]!;
  if (m[3] === undefined) return { target, text: `${target}: written` };
  const from = m[2] ?? '';
  return { target, from, to: m[3], text: `${target}: ${from || 'new'} → ${m[3]}` };
}

// ---------------------------------------------------------------- the story

export interface CriterionCheck {
  criterion: AcceptanceCriterion;
  /** A scenario approved with a valid signature names it as `expect.criterion`. */
  checked: boolean;
  /** Those scenarios. */
  scenarios: Id[];
}

export interface HowBox {
  path: string;
  box: Box;
  /** 0 for a root box. */
  depth: number;
  /** Path of the parent box, for a nested box. */
  parent?: string;
  /** Column: the place of the box in flow order. */
  column: number;
}

export interface HowEdge {
  from: string;
  to: string;
  /** Branch labels along the way. */
  label?: string;
  kind: EdgeKind;
  /** Titles of the boxes of other stories that the edge passes through. */
  via: string[];
}

export interface StoryHow {
  lanes: LaneInfo[];
  boxes: HowBox[];
  edges: HowEdge[];
}

export interface StoryOutput {
  changes: (WriteChange & { path: string; boxTitle: string })[];
  sideEffects: { path: string; boxTitle: string; text: string }[];
  /** Output boxes: what the user sees. */
  screens: { path: string; title: string }[];
  /** The end state each scenario expects (`expect.state`). */
  states: { scenarioId: Id; key: string; value: unknown }[];
}

export interface StoryDetail {
  storyId: Id;
  story?: Story;
  roleLabel: string;
  criteria: CriterionCheck[];
  how: StoryHow;
  output: StoryOutput;
  /** The story's scenarios, in file order. */
  scenarios: ScenarioView[];
}

const titleOf = (box: Box | undefined, path: string): string => (typeof box?.title === 'string' ? box.title : path);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function storyDetail(view: ReviewEpicView, storyId: Id): StoryDetail {
  const { flow, prd } = view;
  const story = storiesOf(prd).find((s) => s.id === storyId);
  const scenarios = view.scenarios.filter((sv) => sv.scenario.story === storyId);
  const signed = scenarios.filter((sv) => approvalState(sv, view.approvals).done);
  const criteria: CriterionCheck[] = (Array.isArray(story?.acceptance) ? story.acceptance : [])
    .filter((c) => c && typeof c.id === 'string')
    .map((criterion) => {
      const by = signed.filter((sv) => sv.scenario.expect?.criterion === criterion.id).map((sv) => sv.scenario.id);
      return { criterion, checked: by.length > 0, scenarios: by };
    });
  const how = storyHow(flow, view.prd, storyId);

  const output: StoryOutput = { changes: [], sideEffects: [], screens: [], states: [] };
  for (const { path, box } of how.boxes) {
    const boxTitle = titleOf(box, path);
    for (const w of list(box.writes)) output.changes.push({ path, boxTitle, ...writeChange(w) });
    for (const text of list(box.sideEffects)) output.sideEffects.push({ path, boxTitle, text });
    if (box.kind === 'output') output.screens.push({ path, title: boxTitle });
  }
  for (const sv of scenarios) {
    const state = sv.scenario.expect?.state;
    if (state && typeof state === 'object') for (const [key, value] of Object.entries(state)) output.states.push({ scenarioId: sv.scenario.id, key, value });
  }
  return { storyId, ...(story ? { story } : {}), roleLabel: roleName(prd, story?.role), criteria, how, output, scenarios };
}

/**
 * The boxes that serve the story (a parent serves what its children serve), in flow order.
 * Two of them are joined when an edge goes from one to the other in their diagram, directly or
 * through boxes that do not serve the story.
 */
function storyHow(flow: Flow | undefined, prd: ReviewEpicView['prd'], storyId: Id): StoryHow {
  const paths = flowPaths(flow).filter((p) => servedStories(boxAt(flow, p)).includes(storyId));
  const boxes: HowBox[] = paths.map((path, column) => {
    const parent = parentPath(path);
    return { path, box: boxAt(flow, path)!, depth: path.split('/').length - 1, ...(parent !== '' ? { parent } : {}), column };
  });
  const included = new Set(paths);
  const edges: HowEdge[] = [];
  for (const { path } of boxes) {
    const prefix = parentPath(path);
    const full = (id: string) => (prefix === '' ? id : `${prefix}/${id}`);
    const diagram = diagramAt(flow, prefix);
    const all = (Array.isArray(diagram?.edges) ? diagram.edges : []).filter((e) => e && typeof e.from === 'string' && typeof e.to === 'string');
    const found: HowEdge[] = [];
    const seen = new Set<string>([path]);
    let queue: { id: string; labels: string[]; kind: EdgeKind; via: string[] }[] = [{ id: path.slice(prefix === '' ? 0 : prefix.length + 1), labels: [], kind: 'normal', via: [] }];
    while (queue.length > 0) {
      const next: typeof queue = [];
      for (const at of queue) {
        for (const e of all.filter((x) => x.from === at.id)) {
          const to = full(e.to);
          if (seen.has(to)) continue;
          seen.add(to);
          const labels = e.label !== undefined ? [...at.labels, e.label] : at.labels;
          const kind = worse(at.kind, e.kind ?? 'normal');
          if (included.has(to)) found.push({ from: path, to, ...(labels.length ? { label: labels.join(', ') } : {}), kind, via: at.via });
          else next.push({ id: e.to, labels, kind, via: [...at.via, titleOf(boxAt(flow, to), to)] });
        }
      }
      queue = next;
    }
    const col = new Map(boxes.map((b) => [b.path, b.column]));
    edges.push(...found.sort((a, b) => col.get(a.to)! - col.get(b.to)!));
  }
  const lanes = lanesFor(flow, prd, { boxes: boxes.map((b) => b.box), edges: [] }, false);
  return { lanes, boxes, edges };
}

const KIND_RANK: Record<string, number> = { normal: 0, branch: 1, error: 2 };
function worse(a: EdgeKind, b: EdgeKind): EdgeKind {
  return (KIND_RANK[b] ?? 0) > (KIND_RANK[a] ?? 0) ? b : a;
}

// ---------------------------------------------------------------- HOW layout

/** Sizes of the HOW swimlane, in SVG units. */
export const HOW = { header: 120, pad: 12, colW: 180, boxW: 150, boxH: 56, rowPad: 16 } as const;

export interface HowLayout {
  width: number;
  height: number;
  rows: (LaneInfo & { y: number; height: number })[];
  boxes: { path: string; x: number; y: number; w: number; h: number }[];
  edges: (HowEdge & { x1: number; y1: number; x2: number; y2: number; back: boolean })[];
}

/** One row per lane the story uses, one column per box. A forward edge goes right; a back edge goes under the boxes. */
export function howLayout(how: StoryHow): HowLayout {
  const rowH = HOW.rowPad * 2 + HOW.boxH;
  const rows = how.lanes.map((l, i) => ({ ...l, y: i * rowH, height: rowH }));
  const rowOf = new Map(rows.map((r) => [r.role, r]));
  const boxes = how.boxes.flatMap((b) => {
    const row = rowOf.get(b.box.lane);
    return row ? [{ path: b.path, x: HOW.header + HOW.pad + b.column * HOW.colW, y: row.y + HOW.rowPad, w: HOW.boxW, h: HOW.boxH }] : [];
  });
  const at = new Map(boxes.map((b) => [b.path, b]));
  const edges = how.edges.flatMap((e): HowLayout['edges'] => {
    const a = at.get(e.from);
    const b = at.get(e.to);
    if (!a || !b) return [];
    const back = b.x <= a.x;
    return back
      ? [{ ...e, x1: a.x + a.w / 2, y1: a.y + a.h, x2: b.x + b.w / 2, y2: b.y + b.h, back }]
      : [{ ...e, x1: a.x + a.w, y1: a.y + a.h / 2, x2: b.x, y2: b.y + b.h / 2, back }];
  });
  const cols = Math.max(1, how.boxes.length);
  return { width: HOW.header + HOW.pad * 2 + (cols - 1) * HOW.colW + HOW.boxW, height: Math.max(rowH, rows.length * rowH), rows, boxes, edges };
}
