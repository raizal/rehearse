// The big picture of the EPIC (S4-A4, D42): every role as a row, the main processes of the
// root diagram as columns in flow order, and one coloured line per story (feature) through
// the processes that serve it. A process that two or more stories use is shared.

import type { BoxKind, Diagram, Flow, Id, Prd } from '@rehearse/core';
import { LANE_COLORS, lanesFor, type LaneInfo } from './diagram.js';
import type { ReviewEpicView } from '../contract.js';
import { storiesOf } from './review.js';

/** Box kinds that are main processes; start, end and decision boxes are left out. */
export const MAIN_KINDS: readonly BoxKind[] = ['process', 'input', 'output', 'external'];

/**
 * Story colours: the eight hues of a categorical palette checked for colour vision
 * deficiency, in fixed order. A ninth story keeps a hue and gets a dashed line instead
 * of a new hue; each line also carries its story id, so colour is never the only cue.
 */
export const STORY_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
/** Role kind as an icon; the kind is also given in words next to it. */
export const ROLE_ICON: Record<string, string> = { human: '👤', agent: '🤖', system: '⚙', external: '⇄' };

const DASHES = ['7 4', '2 4', '10 3 2 3'];

export interface StoryStyle {
  color: string;
  /** SVG stroke-dasharray, for stories after the eighth. */
  dash?: string;
}

/** The style of the story at `index` in prd.yaml order. */
export function storyStyle(index: number): StoryStyle {
  const color = STORY_COLORS[index % STORY_COLORS.length]!;
  const round = Math.floor(index / STORY_COLORS.length);
  return round === 0 ? { color } : { color, dash: DASHES[(round - 1) % DASHES.length]! };
}

type AnyBox = { id: string; stories?: Id[]; children?: Diagram };

function boxList<B extends AnyBox>(diagram: { boxes?: B[] } | undefined): B[] {
  return Array.isArray(diagram?.boxes) ? diagram.boxes.filter((b) => b && typeof b.id === 'string') : [];
}

/**
 * Box ids of a diagram in flow order: a topological order along its edges, ties broken by the
 * order in flow.yaml. An edge that closes a loop (a back edge of a depth-first walk that starts
 * at the boxes with no incoming edge, in flow.yaml order) is ignored.
 */
export function flowOrder(diagram: { boxes?: AnyBox[]; edges?: Diagram['edges'] } | undefined): string[] {
  const ids = [...new Set(boxList(diagram).map((b) => b.id))];
  const rank = new Map(ids.map((id, i) => [id, i]));
  const edges = (Array.isArray(diagram?.edges) ? diagram.edges : []).filter((e) => e && rank.has(e.from) && rank.has(e.to) && e.from !== e.to);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) out.get(e.from)!.push(e.to);
  const hasIn = new Set(edges.map((e) => e.to));

  const back = new Set<string>();
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string) => {
    state.set(id, 'open');
    for (const to of out.get(id)!) {
      const s = state.get(to);
      if (s === 'open') back.add(`${id}\n${to}`);
      else if (s === undefined) visit(to);
    }
    state.set(id, 'done');
  };
  for (const id of [...ids.filter((id) => !hasIn.has(id)), ...ids]) if (!state.has(id)) visit(id);

  const indegree = new Map(ids.map((id) => [id, 0]));
  const forward = edges.filter((e) => !back.has(`${e.from}\n${e.to}`));
  for (const e of forward) indegree.set(e.to, indegree.get(e.to)! + 1);
  const ready = ids.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => rank.get(a)! - rank.get(b)!);
    const id = ready.shift()!;
    order.push(id);
    for (const e of forward) {
      if (e.from !== id) continue;
      const n = indegree.get(e.to)! - 1;
      indegree.set(e.to, n);
      if (n === 0) ready.push(e.to);
    }
  }
  return order;
}

/** Every box path of the flow: each diagram in flow order, a parent right before its children. */
export function flowPaths(flow: Flow | undefined): string[] {
  const out: string[] = [];
  const walk = (diagram: Diagram | undefined, prefix: string) => {
    const byId = new Map(boxList(diagram).map((b) => [b.id, b]));
    for (const id of flowOrder(diagram)) {
      const path = prefix === '' ? id : `${prefix}/${id}`;
      out.push(path);
      walk(byId.get(id)?.children, path);
    }
  };
  walk(flow?.root, '');
  return out;
}

/** The stories a box serves: those that `stories` on the box or on any descendant lists. */
export function servedStories(box: AnyBox | undefined): Id[] {
  const out = new Set<Id>();
  const walk = (b: AnyBox | undefined) => {
    if (!b) return;
    for (const s of Array.isArray(b.stories) ? b.stories : []) if (typeof s === 'string') out.add(s);
    for (const c of boxList(b.children)) walk(c);
  };
  walk(box);
  return [...out];
}

/** Story ids in prd.yaml order, then ids that boxes name but prd.yaml does not have, sorted. */
export function storyOrder(prd: Prd | undefined, used: Iterable<Id>): Id[] {
  const known = storiesOf(prd).map((s) => s.id);
  const extra = [...new Set(used)].filter((id) => !known.includes(id)).sort();
  return [...known, ...extra];
}

export function byStoryOrder(order: Id[]): (a: Id, b: Id) => number {
  const at = (id: Id) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  return (a, b) => at(a) - at(b) || a.localeCompare(b);
}

export interface FeatureProcess {
  id: string;
  title: string;
  kind: BoxKind;
  lane: string;
  /** Column: the place of the process in flow order. */
  column: number;
  /** Stories it serves, in prd.yaml order. */
  stories: Id[];
  /** Two or more stories use it. */
  shared: boolean;
}

export interface FeatureStory {
  id: Id;
  want?: string;
  role?: Id;
  /** Its index in story order: its track in each row. */
  track: number;
  style: StoryStyle;
  /** Ids of the processes that serve it, in column order. */
  processes: string[];
}

/** An arrow between two main processes. */
export interface MainEdge {
  from: string;
  to: string;
  /** It closes a loop: drawn dashed, as "loop back". */
  back: boolean;
}

export interface BigPicture {
  lanes: LaneInfo[];
  processes: FeatureProcess[];
  stories: FeatureStory[];
  edges: MainEdge[];
}

/** The big picture of the EPIC from the root diagram (S4-A4). */
export function bigPicture(flow: Flow | undefined, prd: Prd | undefined): BigPicture {
  const lanes = lanesFor(flow, prd, flow?.root, true);
  const byId = new Map(boxList(flow?.root).map((b) => [b.id, b]));
  const main = flowOrder(flow?.root)
    .map((id) => byId.get(id)!)
    .filter((b) => MAIN_KINDS.includes(b.kind));
  const order = storyOrder(prd, main.flatMap((b) => servedStories(b)));
  const cmp = byStoryOrder(order);
  const processes: FeatureProcess[] = main.map((b, column) => {
    const stories = servedStories(b).sort(cmp);
    return { id: b.id, title: typeof b.title === 'string' ? b.title : b.id, kind: b.kind, lane: b.lane, column, stories, shared: stories.length >= 2 };
  });
  const known = new Map(storiesOf(prd).map((s) => [s.id, s]));
  const stories: FeatureStory[] = order.map((id, track) => {
    const s = known.get(id);
    return {
      id,
      ...(s?.want !== undefined ? { want: s.want } : {}),
      ...(s?.role !== undefined ? { role: s.role } : {}),
      track,
      style: storyStyle(track),
      processes: processes.filter((p) => p.stories.includes(id)).map((p) => p.id),
    };
  });
  return { lanes, processes, stories, edges: mainEdges(flow?.root, processes) };
}

/**
 * The arrows between main processes. An edge into a start, end or decision box goes on to the
 * main processes behind it, so `simulate → design-errors? → review` is one arrow simulate → review.
 * An arrow is a loop back when its target can reach its source and comes first in flow order.
 * Only a direct loop back is drawn; one that goes through a decision (a "no" branch) is left to
 * the box drawer, so the map stays readable.
 */
export function mainEdges(diagram: { boxes?: AnyBox[]; edges?: Diagram['edges'] } | undefined, processes: FeatureProcess[]): MainEdge[] {
  const main = new Map(processes.map((p) => [p.id, p]));
  const edges = (Array.isArray(diagram?.edges) ? diagram.edges : []).filter((e) => e && typeof e.from === 'string' && typeof e.to === 'string');
  const next = (id: string) => edges.filter((e) => e.from === id).map((e) => e.to);
  const reach = (from: string): { to: string; direct: boolean }[] => {
    const out: { to: string; direct: boolean }[] = [];
    const seen = new Set<string>([from]);
    const queue = next(from).map((id) => ({ id, direct: true }));
    while (queue.length > 0) {
      const { id, direct } = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (main.has(id)) out.push({ to: id, direct });
      else queue.push(...next(id).map((n) => ({ id: n, direct: false })));
    }
    return out;
  };
  const pairs = processes.flatMap((p) => reach(p.id).map((r) => ({ from: p.id, to: r.to, direct: r.direct })));
  const succ = new Map(processes.map((p) => [p.id, pairs.filter((e) => e.from === p.id).map((e) => e.to)]));
  const reaches = (a: string, b: string) => {
    const seen = new Set<string>();
    const stack = [a];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id === b) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...succ.get(id)!);
    }
    return false;
  };
  return pairs
    .map((e) => ({ from: e.from, to: e.to, direct: e.direct, back: main.get(e.to)!.column <= main.get(e.from)!.column && reaches(e.to, e.from) }))
    .filter((e) => !e.back || e.direct)
    .map(({ from, to, back }) => ({ from, to, back }));
}

/**
 * The column of each process on the feature map. A process sits one column after the latest of
 * the processes that lead to it; processes of different lanes may share a column, two of one lane
 * never do. A process that nothing leads to moves right, next to the first process it leads to.
 * Empty columns are dropped.
 */
export function featureColumns(bp: BigPicture): Map<string, number> {
  const fwd = bp.edges.filter((e) => !e.back);
  const lane = new Map(bp.processes.map((p) => [p.id, p.lane]));
  const preds = (id: string) => fwd.filter((e) => e.to === id).map((e) => e.from);
  const succs = (id: string) => fwd.filter((e) => e.from === id).map((e) => e.to);
  const col = new Map<string, number>();
  const taken = new Set<string>();
  const key = (id: string, c: number) => `${lane.get(id)}\n${c}`;

  // Kahn order over the forward arrows, ties in flow order.
  const indegree = new Map(bp.processes.map((p) => [p.id, preds(p.id).length]));
  const ready = bp.processes.filter((p) => indegree.get(p.id) === 0).map((p) => p.id);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => bp.processes.findIndex((p) => p.id === a) - bp.processes.findIndex((p) => p.id === b));
    const id = ready.shift()!;
    order.push(id);
    for (const to of succs(id)) {
      indegree.set(to, indegree.get(to)! - 1);
      if (indegree.get(to) === 0) ready.push(to);
    }
  }
  for (const p of bp.processes) if (!order.includes(p.id)) order.push(p.id);

  for (const id of order) {
    let c = Math.max(0, ...preds(id).map((p) => (col.get(p) ?? 0) + 1));
    while (taken.has(key(id, c))) c++;
    col.set(id, c);
    taken.add(key(id, c));
  }
  for (const id of order) {
    if (preds(id).length > 0 || succs(id).length === 0) continue;
    const limit = Math.min(...succs(id).map((s) => col.get(s)!)) - 1;
    taken.delete(key(id, col.get(id)!));
    for (let c = limit; c > col.get(id)!; c--) {
      if (!taken.has(key(id, c))) {
        col.set(id, c);
        break;
      }
    }
    taken.add(key(id, col.get(id)!));
  }
  const used = [...new Set(col.values())].sort((a, b) => a - b);
  return new Map([...col].map(([id, c]) => [id, used.indexOf(c)]));
}

/**
 * The title of a process box in up to `max` lines of about `width` characters. A word longer than
 * a line breaks after a hyphen ("(caught-in-" / "simulation)"); cut text ends in ….
 */
export function boxTitleLines(title: string, width = 14, max = 3): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of title.split(/\s+/).filter(Boolean)) {
    const parts = word.length > width ? word.split(/(?<=-)/) : [word];
    parts.forEach((part, i) => {
      const sep = line && i === 0 ? ' ' : '';
      if (line && (line + sep + part).length > width) {
        out.push(line);
        line = part;
      } else line = line + sep + part;
    });
  }
  if (line) out.push(line);
  if (out.length <= max) return out;
  const last = out[max - 1]!;
  return [...out.slice(0, max - 1), last.length < width ? `${last}…` : `${last.slice(0, width - 1)}…`];
}

/** What a process box says under its title, by box kind. */
export const KIND_LINE: Record<string, string> = { input: 'person acts', process: 'process', output: 'shows', external: 'external run' };

/** Tints of the lane colours, in the same order as LANE_COLORS. */
export const LANE_TINTS = ['#EFF6FF', '#F5F3FF', '#ECFDF5', '#FFFBEB', '#FDF2F8', '#ECFEFF', '#FEF3C7', '#F1F5F9'];

export function laneTint(color: string): string {
  const i = LANE_COLORS.indexOf(color);
  return i < 0 ? '#F1F5F9' : LANE_TINTS[i]!;
}

/** The counts above the feature map. */
export interface BigPictureStats {
  roles: number;
  stories: number;
  processes: number;
  scenarios: number;
  signed: number;
}

export function bigPictureStats(bp: BigPicture, view: Pick<ReviewEpicView, 'prd' | 'scenarios' | 'readiness'>): BigPictureStats {
  const stories = storiesOf(view.prd);
  const signed = new Set(stories.filter((s) => s.status === 'signed').map((s) => s.id));
  for (const r of Array.isArray(view.readiness?.requirements) ? view.readiness.requirements : [])
    for (const s of Array.isArray(r.stories) ? r.stories : []) if (s.status === 'signed') signed.add(s.id);
  return {
    roles: bp.lanes.length,
    stories: stories.length,
    processes: bp.processes.length,
    scenarios: Array.isArray(view.scenarios) ? view.scenarios.length : 0,
    signed: stories.filter((s) => signed.has(s.id)).length,
  };
}

/** Scenarios of each story, by story id. */
export function scenarioCounts(scenarios: { scenario: { story?: Id } }[] | undefined): Map<Id, number> {
  const out = new Map<Id, number>();
  for (const sv of Array.isArray(scenarios) ? scenarios : []) {
    const id = sv.scenario.story;
    if (typeof id === 'string') out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}


// ---------------------------------------------------------------- layout

/** Sizes of the feature map, in SVG units (design page 1). */
export const FM = {
  /** Room for the role name on the left of each lane. */
  left: 116,
  colW: 146,
  boxW: 128,
  boxH: 84,
  /** From the top of a lane to the top of its boxes. */
  boxTop: 30,
  chipH: 20,
  /** Gap between chips, and between the box and the first chip row. */
  chipGap: 4,
  chipTop: 8,
  laneMin: 188,
  laneGap: 12,
  /** From the last chip row to the bottom of a lane: room for loop-back arrows. */
  laneFoot: 40,
  right: 24,
  /** The map is at least as wide as the feature map card of the design, so the lanes fill it. */
  minWidth: 1408,
} as const;

export interface Point {
  x: number;
  y: number;
}

export interface FmRow extends LaneInfo {
  y: number;
  height: number;
  tint: string;
}

export interface FmBox {
  id: string;
  column: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A story chip under a process box. */
export interface FmChip {
  storyId: Id;
  process: string;
  x: number;
  y: number;
  w: number;
}

export interface FmEdge extends MainEdge {
  points: Point[];
}

export interface FeatureMapLayout {
  width: number;
  height: number;
  rows: FmRow[];
  boxes: FmBox[];
  chips: FmChip[];
  edges: FmEdge[];
}

/** Width of a story chip: 11px bold text, about 7 units a character, and its padding. */
export function chipWidth(id: string): number {
  return 14 + 7 * id.length;
}

/** Chips in rows under a box: left to right, a new row when the box width is full. */
function chipRows(ids: Id[]): { id: Id; dx: number; row: number; w: number }[] {
  const out: { id: Id; dx: number; row: number; w: number }[] = [];
  let dx = 0;
  let row = 0;
  for (const id of ids) {
    const w = chipWidth(id);
    if (dx > 0 && dx + w > FM.boxW) {
      dx = 0;
      row++;
    }
    out.push({ id, dx, row, w });
    dx += w + FM.chipGap;
  }
  return out;
}

/**
 * Lanes in rows, processes in compact columns (featureColumns), the story chips under each box,
 * and orthogonal arrows. A forward arrow turns in the gap after its source; a loop back runs
 * dashed along the bottom of the target lane and enters the target from the right.
 */
export function featureMapLayout(bp: BigPicture): FeatureMapLayout {
  const cols = featureColumns(bp);
  const ncols = Math.max(1, ...[...cols.values()].map((c) => c + 1));
  const gap = FM.colW - FM.boxW;
  const width = Math.max(FM.minWidth, FM.left + ncols * FM.colW + FM.right);
  const chipsOf = new Map(bp.processes.map((p) => [p.id, chipRows(p.stories)]));

  const rows: FmRow[] = [];
  let y = 0;
  for (const l of bp.lanes) {
    const inLane = bp.processes.filter((p) => p.lane === l.role);
    const chipLines = Math.max(1, ...inLane.map((p) => (chipsOf.get(p.id)!.at(-1)?.row ?? 0) + 1));
    const height = Math.max(FM.laneMin, FM.boxTop + FM.boxH + FM.chipTop + chipLines * (FM.chipH + FM.chipGap) + FM.laneFoot);
    rows.push({ ...l, y, height, tint: laneTint(l.color) });
    y += height + FM.laneGap;
  }
  const height = Math.max(FM.laneMin, y - FM.laneGap);
  const rowOf = new Map(rows.map((r) => [r.role, r]));

  const boxes: FmBox[] = [];
  const chips: FmChip[] = [];
  for (const p of bp.processes) {
    const row = rowOf.get(p.lane);
    if (!row) continue;
    const column = cols.get(p.id)!;
    const box = { id: p.id, column, x: FM.left + column * FM.colW, y: row.y + FM.boxTop, w: FM.boxW, h: FM.boxH };
    boxes.push(box);
    for (const c of chipsOf.get(p.id)!) chips.push({ storyId: c.id, process: p.id, x: box.x + c.dx, y: box.y + box.h + FM.chipTop + c.row * (FM.chipH + FM.chipGap), w: c.w });
  }
  const at = new Map(boxes.map((b) => [b.id, b]));
  const laneOf = new Map(bp.processes.map((p) => [p.id, p.lane]));
  /** Some box of `lane` sits strictly between columns a and b. */
  const blocked = (lane: string | undefined, a: number, b: number) => boxes.some((x) => laneOf.get(x.id) === lane && x.column > Math.min(a, b) && x.column < Math.max(a, b));
  const foot = (lane: string | undefined) => {
    const r = rowOf.get(lane ?? '')!;
    return r.y + r.height - FM.laneFoot / 2;
  };

  const edges: FmEdge[] = [];
  for (const e of bp.edges) {
    const a = at.get(e.from);
    const b = at.get(e.to);
    if (!a || !b) continue;
    const la = laneOf.get(e.from);
    const lb = laneOf.get(e.to);
    const am = a.y + a.h / 2;
    const bm = b.y + b.h / 2;
    let points: Point[];
    if (b.column > a.column) {
      const afterA = a.x + a.w + gap / 2;
      const beforeB = b.x - gap / 2;
      if (la === lb && !blocked(la, a.column, b.column)) points = [{ x: a.x + a.w, y: am }, { x: b.x, y: bm }];
      else if (!blocked(lb, a.column, b.column)) points = [{ x: a.x + a.w, y: am }, { x: afterA, y: am }, { x: afterA, y: bm }, { x: b.x, y: bm }];
      else if (!blocked(la, a.column, b.column)) points = [{ x: a.x + a.w, y: am }, { x: beforeB, y: am }, { x: beforeB, y: bm }, { x: b.x, y: bm }];
      else {
        const t = foot(la);
        points = [{ x: a.x + a.w, y: am }, { x: afterA, y: am }, { x: afterA, y: t }, { x: beforeB, y: t }, { x: beforeB, y: bm }, { x: b.x, y: bm }];
      }
    } else if (b.column === a.column) {
      // Same column, other lane: straight down or up, past the chips of the upper box.
      const cx = Math.min(a.x, b.x) + FM.boxW / 2 + 24;
      const down = a.y < b.y;
      points = down ? [{ x: cx, y: a.y + a.h }, { x: cx, y: b.y }] : [{ x: cx, y: a.y }, { x: cx, y: b.y + b.h }];
    } else if (la === lb && !blocked(la, a.column, b.column)) {
      points = [{ x: a.x, y: am }, { x: b.x + b.w, y: bm }];
    } else {
      const beforeA = a.x - gap / 2;
      const afterB = b.x + b.w + gap / 2;
      const t = foot(lb);
      points = [{ x: a.x, y: am }, { x: beforeA, y: am }, { x: beforeA, y: t }, { x: afterB, y: t }, { x: afterB, y: bm }, { x: b.x + b.w, y: bm }];
    }
    edges.push({ ...e, points: points.filter((p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y) });
  }
  return { width, height, rows, boxes, chips, edges };
}
