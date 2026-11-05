// The big picture of the EPIC (S4-A4, D42): every role as a row, the main processes of the
// root diagram as columns in flow order, and one coloured line per story (feature) through
// the processes that serve it. A process that two or more stories use is shared.

import type { BoxKind, Diagram, Flow, Id, Prd } from '@rehearse/core';
import { lanesFor, type LaneInfo } from './diagram.js';
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

export interface BigPicture {
  lanes: LaneInfo[];
  processes: FeatureProcess[];
  stories: FeatureStory[];
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
  return { lanes, processes, stories };
}

// ---------------------------------------------------------------- layout

/** Sizes of the big picture, in SVG units. */
export const BIG = {
  /** Width of the role column on the left. */
  header: 140,
  colW: 150,
  boxW: 124,
  /** Room for the process title (two lines) and the shared line at the top of each box. */
  titleH: 52,
  /** Height of one story track. */
  track: 10,
  pad: 12,
} as const;

export interface BigRow extends LaneInfo {
  y: number;
  height: number;
}

export interface BigBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface BigLine {
  storyId: Id;
  style: StoryStyle;
  /** One point per process, in column order. One point: a dot. */
  points: Point[];
}

export interface BigPictureLayout {
  width: number;
  height: number;
  rows: BigRow[];
  boxes: BigBox[];
  lines: BigLine[];
}

/**
 * Rows of equal height, one per role; one column per process; one horizontal track per story
 * inside every row, so a story's line runs at the same height in each lane, like a metro map.
 */
export function bigPictureLayout(bp: BigPicture): BigPictureLayout {
  const tracks = Math.max(1, bp.stories.length);
  const height = BIG.pad * 2 + BIG.titleH + tracks * BIG.track;
  const rows: BigRow[] = bp.lanes.map((l, i) => ({ ...l, y: i * height, height }));
  const rowOf = new Map(rows.map((r) => [r.role, r]));
  const boxes: BigBox[] = [];
  const at = new Map<string, BigBox>();
  for (const p of bp.processes) {
    const row = rowOf.get(p.lane);
    if (!row) continue;
    const box = { id: p.id, x: BIG.header + p.column * BIG.colW + (BIG.colW - BIG.boxW) / 2, y: row.y + BIG.pad, w: BIG.boxW, h: height - BIG.pad * 2 };
    boxes.push(box);
    at.set(p.id, box);
  }
  const lines: BigLine[] = bp.stories
    .map((s) => ({
      storyId: s.id,
      style: s.style,
      points: s.processes.flatMap((id) => {
        const b = at.get(id);
        return b ? [{ x: b.x + b.w / 2, y: b.y + BIG.titleH + BIG.track * (s.track + 0.5) }] : [];
      }),
    }))
    .filter((l) => l.points.length > 0);
  return { width: BIG.header + Math.max(1, bp.processes.length) * BIG.colW, height: Math.max(height, rows.length * height), rows, boxes, lines };
}
