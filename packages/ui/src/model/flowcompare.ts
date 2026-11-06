// Before / after → Flow as a flow chart (T42). The root diagram of the as-is flow and of the
// EPIC's flow, drawn as the swimlanes of the box drawer: one lane per role, each box in its lane,
// the edges with their branch and exit names. The chart holds the union of both sides, so one
// layout places a box in the same spot on every side; a side only leaves boxes and edges out.
// A box with children stays one box with its step count: the steps are in the box drawer.

import type { Edge as FlowEdge, Node } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import type { Box, Diagram, DiffStatus, EdgeKind, Flow, Prd, SystemCompare } from '@rehearse/core';
import { linkWord, statusLook, type DiffSide } from './architecture.js';
import { lanesFor, type LaneInfo } from './diagram.js';
import { boxNodeId, laneNodeId, type LaneNode } from './elements.js';
import { BOX_H, BOX_W, type SwimlaneLayout } from './layout.js';

/** The lane of a removed step that no flow has (work done outside the tool): it has no role. */
export const OUTSIDE_LANE = 'outside-record';

export interface CompareBox {
  path: string;
  box: Box;
  status: DiffStatus;
  /** Steps inside the box, on the side that has the most. */
  steps: number;
  /** The EPIC's flow has the box, so the box drawer can open it. */
  opens: boolean;
  what?: string;
  onBefore: boolean;
  onAfter: boolean;
}

export interface CompareEdge {
  key: string;
  from: string;
  to: string;
  label?: string;
  kind: EdgeKind;
  status: DiffStatus;
  what?: string;
  onBefore: boolean;
  onAfter: boolean;
}

export interface FlowCompareChart {
  /** Every root box and edge of both sides: what the layout places. */
  diagram: Diagram;
  lanes: LaneInfo[];
  boxes: CompareBox[];
  edges: CompareEdge[];
}

const stepsOf = (b: Box | undefined) => (Array.isArray(b?.children?.boxes) ? b.children.boxes.length : 0);

/** The root of both flows with the status of each box and edge. `asIs` and `epic` give the lanes. */
export function flowCompareChart(c: SystemCompare, asIs: Flow | undefined, epic: Flow | undefined, prd: Prd | undefined): FlowCompareChart {
  const epicRoot = new Set((Array.isArray(epic?.root?.boxes) ? epic.root.boxes : []).map((b) => b?.id));
  const boxes: CompareBox[] = c.boxes
    .filter((d) => !d.path.includes('/'))
    .map((d) => {
      const box: Box = d.after ?? d.before ?? { id: d.path, path: d.path, title: d.title, kind: 'process', lane: OUTSIDE_LANE };
      const out: CompareBox = {
        path: d.path,
        box,
        status: d.status,
        steps: Math.max(stepsOf(d.before), stepsOf(d.after)),
        opens: epicRoot.has(d.path),
        onBefore: d.before !== undefined,
        onAfter: d.after !== undefined,
      };
      if (d.what) out.what = d.what;
      return out;
    });
  const edges: CompareEdge[] = c.flowEdges
    .filter((e) => e.diagram === '')
    .map((e, i) => {
      const edge = (e.after ?? e.before)!;
      const out: CompareEdge = { key: `${i}:${e.from}->${e.to}`, from: e.from, to: e.to, kind: edge.kind ?? 'normal', status: e.status, onBefore: e.before !== undefined, onAfter: e.after !== undefined };
      if (edge.label !== undefined) out.label = edge.label;
      if (e.what) out.what = e.what;
      return out;
    });
  const diagram: Diagram = {
    boxes: boxes.map((b) => ({ ...b.box, id: b.path })),
    edges: edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind, ...(e.label !== undefined ? { label: e.label } : {}) })),
  };
  // Lanes in the EPIC's order, then the lanes only the as-is flow has.
  const declared = [...(Array.isArray(epic?.lanes) ? epic.lanes : [])];
  for (const l of Array.isArray(asIs?.lanes) ? asIs.lanes : []) if (!declared.some((d) => d.role === l.role)) declared.push({ ...l, order: Number.MAX_SAFE_INTEGER });
  const lanes = lanesFor({ ...(epic ?? asIs ?? { version: 1, epic: '', root: diagram }), lanes: declared } as Flow, prd, diagram, true).map((l) =>
    l.role === OUTSIDE_LANE ? { role: l.role, label: 'Outside the record', color: l.color } : l,
  );
  return { diagram, lanes, boxes, edges };
}

/** The boxes and edges a side draws, and the status each one shows there (none before). */
export function chartSide(chart: FlowCompareChart, side: DiffSide): { boxes: (CompareBox & { shown?: DiffStatus })[]; edges: (CompareEdge & { shown?: DiffStatus })[] } {
  const keep = (x: { onBefore: boolean; onAfter: boolean }) => (side === 'before' ? x.onBefore : side === 'after' ? x.onAfter : true);
  const shown = (s: DiffStatus) => (side === 'before' ? undefined : s);
  return {
    boxes: chart.boxes.filter(keep).map((b) => ({ ...b, shown: shown(b.status) })),
    edges: chart.edges.filter(keep).map((e) => ({ ...e, shown: shown(e.status) })),
  };
}

// ---------------------------------------------------------------- React Flow elements

export interface CompareBoxData extends Record<string, unknown> {
  item: CompareBox;
  status?: DiffStatus;
  lit: boolean;
}

export type CompareBoxNode = Node<CompareBoxData, 'cbox'>;

/** The smallest zoom: box titles still read. A chart wider than that pans. */
export const MIN_ZOOM = 0.55;

/**
 * The zoom of a chart `contentW` wide in a card with `room` to draw: the whole width, at most 1:1,
 * down to MIN_ZOOM. `more` when the chart is still wider: the card shows its start and says so.
 */
export function chartZoom(room: number, contentW: number): { zoom: number; more: boolean } {
  const zoom = Math.min(1, Math.max(MIN_ZOOM, room / Math.max(1, contentW)));
  return { zoom, more: contentW * zoom > room + 1 };
}

/** How far an edge leaves its box before it turns, and the radius of its corners. */
const OUT = 14;
const R = 6;

/** An orthogonal path through `pts`, its corners rounded. */
function rounded(pts: [number, number][]): string {
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]!;
    const [x, y] = pts[i]!;
    const [nx, ny] = pts[i + 1]!;
    const r = Math.min(R, Math.abs(x - px) / 2 + Math.abs(y - py) / 2, Math.abs(nx - x) / 2 + Math.abs(ny - y) / 2);
    const ix = x - Math.sign(x - px) * r;
    const iy = y - Math.sign(y - py) * r;
    const ox = x + Math.sign(nx - x) * r;
    const oy = y + Math.sign(ny - y) * r;
    d += ` L ${ix} ${iy} Q ${x} ${y} ${ox} ${oy}`;
  }
  const [lx, ly] = pts[pts.length - 1]!;
  return `${d} L ${lx} ${ly}`;
}

/**
 * The path of an edge a smooth step would draw through boxes: one that goes back (right to left) or
 * skips a column. It runs in the gap under the lower of its two rows instead. Undefined for an edge
 * to the next column, which the smooth step draws well. Points are in flow units (source right handle,
 * target left handle).
 */
export function detourPath(sx: number, sy: number, tx: number, ty: number): { path: string; labelX: number; labelY: number } | undefined {
  // Next column: the smooth step turns in the gap between the two columns.
  if (tx >= sx + OUT && tx - sx <= BOX_W / 2) return undefined;
  // Under the lower box of the two, in the gap between rows (or the lane's bottom pad).
  const under = Math.max(sy, ty) + BOX_H / 2 + 11;
  const pts: [number, number][] = [[sx, sy], [sx + OUT, sy], [sx + OUT, under], [tx - OUT, under], [tx - OUT, ty], [tx, ty]];
  return { path: rounded(pts), labelX: (sx + tx) / 2, labelY: under };
}

/** The text an edge carries: its branch or exit name. Its status is its colour, and its accessible name. */
export function edgeText(e: { label?: string; kind: EdgeKind }): string | undefined {
  return e.label === undefined ? undefined : e.kind === 'error' ? `⚠ ${e.label}` : e.label;
}

/**
 * Lane and box nodes and edges of one side, placed by the layout of the whole chart. With a box
 * hovered (`hover`), its own edges are lit and the others faint.
 */
export function compareElements(chart: FlowCompareChart, layout: SwimlaneLayout, side: DiffSide, hover?: string): { nodes: (LaneNode | CompareBoxNode)[]; edges: FlowEdge[] } {
  const s = chartSide(chart, side);
  const byPath = new Map(s.boxes.map((b) => [b.path, b]));
  const nodes: (LaneNode | CompareBoxNode)[] = layout.lanes.map((lane) => ({
    id: laneNodeId(lane.role),
    type: 'lane',
    position: { x: 0, y: lane.y },
    data: { lane, width: lane.width, height: lane.height },
    width: lane.width,
    height: lane.height,
    draggable: false,
    selectable: false,
    focusable: false,
    zIndex: 0,
  }));
  const near = new Set(hover ? s.edges.filter((e) => e.from === hover || e.to === hover).flatMap((e) => [e.from, e.to]) : []);
  for (const laid of layout.boxes) {
    const item = byPath.get(laid.id);
    if (!item) continue;
    nodes.push({
      id: boxNodeId(item.path),
      type: 'cbox',
      parentId: laneNodeId(laid.lane),
      extent: 'parent',
      position: { x: laid.x, y: laid.y },
      width: BOX_W,
      height: BOX_H,
      draggable: false,
      zIndex: 1,
      data: { item, lit: near.has(item.path), ...(item.shown ? { status: item.shown } : {}) },
    });
  }
  const edges: FlowEdge[] = s.edges.map((e) => {
    const look = statusLook(e.shown);
    const lit = hover !== undefined && (e.from === hover || e.to === hover);
    const text = edgeText(e);
    const cls = ['ba-edge', `edge-${e.kind}`, look?.className, hover === undefined ? '' : lit ? 'is-lit' : 'is-faint'].filter(Boolean).join(' ');
    return {
      id: `edge:${e.key}`,
      source: boxNodeId(e.from),
      target: boxNodeId(e.to),
      type: 'ba',
      className: cls,
      zIndex: lit ? 3 : 2,
      data: { kind: e.kind, status: e.shown },
      markerEnd: { type: MarkerType.ArrowClosed },
      ariaLabel: `${e.from} → ${e.to}${e.label ? `: ${e.label}` : ''}${e.shown ? ` (${linkWord(e.shown)})` : ''}`,
      ...(text ? { label: text, labelBgPadding: [4, 2] as [number, number], labelBgBorderRadius: 3 } : {}),
    };
  });
  return { nodes, edges };
}
