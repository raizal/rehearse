// A small diagram graph and its layout, shared by the big picture diagrams that are generated
// from the record: user flow, data flow and system flowchart (D42). The models build a DGraph;
// ELK (layered) places it. Every position is absolute, so the components only draw.

import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api.js';
import { wrapLines } from './text.js';

export type Shape =
  /** User flow: a start or end dot. */
  | 'start'
  | 'end'
  /** User flow: a screen the person sees (output box). */
  | 'screen'
  /** User flow: an action the person takes (input or process box). */
  | 'action'
  | 'decision'
  /** User flow: boxes of other lanes the flow passes through, folded into one step. */
  | 'fold'
  /** Data flow: a role outside the system. */
  | 'entity'
  /** Data flow: a numbered process. */
  | 'process'
  /** Data flow: a numbered data store. */
  | 'store'
  /** System flowchart: a program step, a start or end, an output document, a box of another lane. */
  | 'step'
  | 'terminal'
  | 'document'
  | 'connector';

/** One box inside a folded step. */
export interface FoldRow {
  path: string;
  title: string;
  lane: string;
}

export interface DNode {
  id: string;
  shape: Shape;
  title: string;
  /** Small text over the title: a number, a lane, a kind. */
  tag?: string;
  /** The box path this node opens in the flow view. */
  path?: string;
  /** Folded steps: one row per box, each one opens its box. */
  rows?: FoldRow[];
  /** The group (column or parent box) the node sits in. */
  group?: string;
  w: number;
  h: number;
}

export type EdgeKind = 'normal' | 'branch' | 'error' | 'read' | 'write' | 'data';

export interface DEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  kind: EdgeKind;
}

export interface DGroup {
  id: string;
  title: string;
  kind: 'column' | 'cluster';
  parent?: string;
  /** The box path a cluster (a box with children) opens. */
  path?: string;
}

export interface DGraph {
  nodes: DNode[];
  edges: DEdge[];
  groups: DGroup[];
}

// ---------------------------------------------------------------- sizes

export const SIZE = {
  boxW: 168,
  lineH: 14,
  dot: 28,
  diamondW: 150,
  diamondH: 84,
  rowH: 18,
  /** Room for a group title. */
  groupTop: 30,
  groupPad: 14,
  colGap: 70,
  labelH: 14,
  /** Width of one character of a small label. */
  charW: 6,
} as const;

/** Title lines of a node, the same in the model and the drawing. */
export function titleLines(node: Pick<DNode, 'shape' | 'title'>): string[] {
  if (node.shape === 'start' || node.shape === 'end') return wrapLines(node.title, 18, 3);
  if (node.shape === 'decision') return wrapLines(node.title, 18, 2);
  return wrapLines(node.title, 24, 3);
}

/** Width and height of a node of this shape and title. */
export function nodeSize(shape: Shape, title: string, rows = 0): { w: number; h: number } {
  const lines = titleLines({ shape, title }).length;
  switch (shape) {
    case 'start':
    case 'end':
      return { w: SIZE.dot, h: SIZE.dot };
    case 'decision':
      return { w: SIZE.diamondW, h: SIZE.diamondH };
    case 'fold':
      return { w: 210, h: 26 + rows * SIZE.rowH + 6 };
    case 'store':
      return { w: 190, h: 36 };
    case 'entity':
      return { w: 130, h: 50 };
    case 'process':
      return { w: 150, h: 34 + lines * SIZE.lineH + 8 };
    default:
      return { w: SIZE.boxW, h: 22 + lines * SIZE.lineH + (shape === 'document' ? 14 : 6) };
  }
}

/** The text under a start or end dot (its tag and title lines), or undefined for other shapes. */
export function dotLabel(node: Pick<DNode, 'shape' | 'title' | 'tag'>): { w: number; h: number } | undefined {
  if (node.shape !== 'start' && node.shape !== 'end') return undefined;
  return { w: 120, h: 8 + (titleLines(node).length + (node.tag ? 1 : 0)) * SIZE.lineH };
}

export function labelSize(text: string): { w: number; h: number } {
  return { w: Math.min(40, text.length) * SIZE.charW + 8, h: SIZE.labelH };
}

// ---------------------------------------------------------------- layout

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LaidEdge {
  id: string;
  points: Point[];
  /** Where the label goes (its top left corner and size). */
  label?: Rect;
}

export interface GraphLayout {
  width: number;
  height: number;
  nodes: Record<string, Rect>;
  groups: Record<string, Rect>;
  edges: LaidEdge[];
}

const elk = new ELK();

/** A label short enough for one line on an edge. */
export function edgeLabelText(label: string): string {
  return label.length > 40 ? `${label.slice(0, 39)}…` : label;
}

/**
 * Lay out the graph with ELK (layered). Groups become compound nodes with room for their
 * title; an edge may cross groups. Positions are absolute and start at 0, 0.
 */
export async function layoutGraph(graph: DGraph, direction: 'RIGHT' | 'DOWN'): Promise<GraphLayout> {
  const groups = new Map(graph.groups.map((g) => [g.id, { g, elk: { id: g.id, children: [] as ElkNode[], layoutOptions: { 'elk.padding': `[top=${SIZE.groupTop},left=${SIZE.groupPad},bottom=${SIZE.groupPad},right=${SIZE.groupPad}]` } } as ElkNode }]));
  const root: ElkNode = {
    id: '__root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.json.edgeCoords': 'ROOT',
      'elk.json.shapeCoords': 'ROOT',
      'elk.edgeLabels.placement': 'CENTER',
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '60',
      'elk.spacing.edgeLabel': '4',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.padding': '[top=20,left=20,bottom=40,right=20]',
    },
    children: [],
    edges: [],
  };
  const parentOf = (group: string | undefined): ElkNode => (group !== undefined && groups.has(group) ? groups.get(group)!.elk : root);
  for (const { g, elk: node } of groups.values()) parentOf(g.parent).children!.push(node);
  const ids = new Set<string>();
  for (const n of graph.nodes) {
    ids.add(n.id);
    const below = dotLabel(n);
    parentOf(n.group).children!.push({
      id: n.id,
      width: n.w,
      height: n.h,
      // ELK keeps room for the title under a start or end dot.
      ...(below ? { labels: [{ text: n.title, width: below.w, height: below.h }], layoutOptions: { 'elk.nodeLabels.placement': 'OUTSIDE V_BOTTOM H_CENTER' } } : {}),
    });
  }
  for (const e of graph.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    const text = e.label ? edgeLabelText(e.label) : undefined;
    root.edges!.push({
      id: e.id,
      sources: [e.from],
      targets: [e.to],
      ...(text ? { labels: [{ text, width: labelSize(text).w, height: labelSize(text).h }] } : {}),
    });
  }
  const out = await elk.layout(root);
  const nodes: Record<string, Rect> = {};
  const laidGroups: Record<string, Rect> = {};
  const walk = (n: ElkNode) => {
    for (const c of n.children ?? []) {
      const rect = { x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? 0, h: c.height ?? 0 };
      if (groups.has(c.id)) laidGroups[c.id] = rect;
      else nodes[c.id] = rect;
      walk(c);
    }
  };
  walk(out);
  const edges: LaidEdge[] = (out.edges ?? []).map((e) => {
    const s = e.sections?.[0];
    const points = s ? [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: p.x, y: p.y })) : [];
    const l = e.labels?.[0];
    return { id: e.id, points, ...(l ? { label: { x: l.x ?? 0, y: l.y ?? 0, w: l.width ?? 0, h: l.height ?? 0 } } : {}) };
  });
  return { width: out.width ?? 0, height: out.height ?? 0, nodes, groups: laidGroups, edges };
}

/** The column a node or group sits in: its top group. */
function topGroup(graph: DGraph, group: string | undefined): string | undefined {
  const byId = new Map(graph.groups.map((g) => [g.id, g]));
  let at = group;
  while (at !== undefined && byId.get(at)?.parent !== undefined) at = byId.get(at)!.parent;
  return at;
}

/**
 * One column per top group, side by side in the given order, each one laid out top to bottom.
 * An edge inside a column is routed by ELK; an edge between columns runs out of the side of its
 * box, down or up the gap next to the target column, and into the target box. A column in
 * `stack` has no edges inside: its nodes stand at the height of the boxes they link to.
 */
export async function layoutColumns(graph: DGraph, order: string[], stack: ReadonlySet<string> = new Set()): Promise<GraphLayout> {
  const columnOf = new Map(graph.nodes.map((n) => [n.id, topGroup(graph, n.group)]));
  const nodes: Record<string, Rect> = {};
  const groups: Record<string, Rect> = {};
  const edges: LaidEdge[] = [];
  let x = 20;
  let height = 0;
  const top = 20;
  const pending: string[] = [];
  for (const col of order) {
    if (stack.has(col)) {
      pending.push(col);
      groups[col] = { x, y: top, w: 0, h: 0 };
      x += 210 + SIZE.groupPad * 2 + SIZE.colGap;
      continue;
    }
    const sub: DGraph = {
      nodes: graph.nodes.filter((n) => columnOf.get(n.id) === col).map((n) => ({ ...n, ...(n.group === col ? { group: undefined } : {}) })),
      groups: graph.groups.filter((g) => g.id !== col && topGroup(graph, g.id) === col).map((g) => ({ ...g, ...(g.parent === col ? { parent: undefined } : {}) })),
      edges: graph.edges.filter((e) => columnOf.get(e.from) === col && columnOf.get(e.to) === col),
    };
    const lay = await layoutGraph(sub, 'DOWN');
    const dx = x + SIZE.groupPad - 20;
    const dy = top + SIZE.groupTop - 20;
    const move = (r: Rect): Rect => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h });
    for (const [id, r] of Object.entries(lay.nodes)) nodes[id] = move(r);
    for (const [id, r] of Object.entries(lay.groups)) groups[id] = move(r);
    for (const e of lay.edges) edges.push({ id: e.id, points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })), ...(e.label ? { label: move(e.label) } : {}) });
    const w = lay.width - 40 + SIZE.groupPad * 2;
    const h = lay.height - 60 + SIZE.groupTop + SIZE.groupPad;
    groups[col] = { x, y: top, w, h };
    height = Math.max(height, top + h);
    x += w + SIZE.colGap;
  }

  // Stacked columns: each node at the mean height of the boxes it links to, pushed down so none overlap.
  for (const col of pending) {
    const g = groups[col]!;
    const mine = graph.nodes.filter((n) => columnOf.get(n.id) === col);
    const want = mine.map((n) => {
      const ys = graph.edges.flatMap((e) => {
        const other = e.from === n.id ? e.to : e.to === n.id ? e.from : undefined;
        const r = other !== undefined ? nodes[other] : undefined;
        return r ? [r.y + r.h / 2] : [];
      });
      return { n, y: ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length - n.h / 2 : 0 };
    });
    want.sort((a, b) => a.y - b.y || a.n.id.localeCompare(b.n.id));
    let next = top + SIZE.groupTop;
    for (const { n, y } of want) {
      const at = Math.max(next, y);
      nodes[n.id] = { x: g.x + SIZE.groupPad, y: at, w: n.w, h: n.h };
      next = at + n.h + 16;
    }
    g.w = 210 + SIZE.groupPad * 2;
    g.h = next - top + SIZE.groupPad;
    height = Math.max(height, top + g.h);
  }
  for (const col of order) if (groups[col]) groups[col]!.h = Math.max(groups[col]!.h, height - top);

  // Edges between columns.
  const gaps: Record<string, number> = {};
  for (const e of graph.edges) {
    const a = columnOf.get(e.from);
    const b = columnOf.get(e.to);
    const s = nodes[e.from];
    const t = nodes[e.to];
    if (a === b || !s || !t || a === undefined || b === undefined) continue;
    const tc = groups[b]!;
    const right = t.x > s.x;
    const key = `${b}:${right ? 'l' : 'r'}`;
    const lane = (gaps[key] = (gaps[key] ?? 0) + 1);
    const offset = 8 + ((lane * 9) % (SIZE.colGap - 16));
    const midX = right ? tc.x - offset : tc.x + tc.w + offset;
    const sy = s.y + s.h / 2;
    const ty = t.y + t.h / 2;
    const start = { x: right ? s.x + s.w : s.x, y: sy };
    const end = { x: right ? t.x : t.x + t.w, y: ty };
    const points = [start, { x: midX, y: sy }, { x: midX, y: ty }, end];
    const text = e.label ? edgeLabelText(e.label) : undefined;
    const size = text ? labelSize(text) : undefined;
    edges.push({ id: e.id, points, ...(size ? { label: { x: midX - size.w / 2, y: (sy + ty) / 2 - size.h / 2, w: size.w, h: size.h } } : {}) });
  }
  edges.sort((p, q) => graph.edges.findIndex((e) => e.id === p.id) - graph.edges.findIndex((e) => e.id === q.id));
  return { width: x - SIZE.colGap + 20, height: height + 20, nodes, groups, edges };
}
