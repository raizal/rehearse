// Swimlane layout (R9, S4-A1). ELK (layered, left to right) gives each box a
// column; the box's lane gives its row band. Boxes of one lane that would
// overlap go to a new row inside that lane.

import ELK from 'elkjs/lib/elk.bundled.js';
import type { Box, Diagram } from '@rehearse/core';
import type { LaneInfo } from './diagram.js';

export const BOX_W = 210;
export const BOX_H = 78;
/** Width of the lane label column on the left of each lane. */
export const LANE_HEADER = 132;
export const LANE_PAD = 22;
const ROW_GAP = 22;
const COL_GAP = 28;

export interface LaidLane extends LaneInfo {
  /** Top of the lane band. Lanes start at x 0. */
  y: number;
  width: number;
  height: number;
}

export interface LaidBox {
  id: string;
  /** Lane role. */
  lane: string;
  /** Position inside its lane. */
  x: number;
  y: number;
}

export interface SwimlaneLayout {
  lanes: LaidLane[];
  boxes: LaidBox[];
}

function boxList(diagram: Diagram | undefined): Box[] {
  return Array.isArray(diagram?.boxes) ? diagram.boxes.filter((b) => b && typeof b === 'object') : [];
}

/**
 * Place boxes in lane bands. `columns` maps box id → x from ELK (or any x).
 * Every box is in the lane of its role, and lanes keep the given order.
 */
export function swimlaneLayout(diagram: Diagram | undefined, lanes: LaneInfo[], columns: Map<string, number>): SwimlaneLayout {
  const all = boxList(diagram);
  const minX = Math.min(0, ...all.map((b) => columns.get(b.id) ?? 0));
  const out: SwimlaneLayout = { lanes: [], boxes: [] };
  let y = 0;
  let maxRight = 0;
  for (const lane of lanes) {
    const inLane = all
      .filter((b) => b.lane === lane.role)
      .map((b) => ({ id: b.id, x: (columns.get(b.id) ?? 0) - minX }))
      .sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : 1));
    const rowRight: number[] = [];
    for (const b of inLane) {
      let row = rowRight.findIndex((right) => right + COL_GAP <= b.x);
      if (row < 0) row = rowRight.push(0) - 1;
      rowRight[row] = b.x + BOX_W;
      const x = LANE_HEADER + LANE_PAD + b.x;
      out.boxes.push({ id: b.id, lane: lane.role, x, y: LANE_PAD + row * (BOX_H + ROW_GAP) });
      maxRight = Math.max(maxRight, x + BOX_W);
    }
    const rows = Math.max(1, rowRight.length);
    const height = LANE_PAD * 2 + rows * BOX_H + (rows - 1) * ROW_GAP;
    out.lanes.push({ ...lane, y, width: 0, height });
    y += height;
  }
  const width = Math.max(maxRight + LANE_PAD, LANE_HEADER + LANE_PAD * 2 + BOX_W);
  for (const lane of out.lanes) lane.width = width;
  return out;
}

const elk = new ELK();

/** Column x of each box from ELK's layered layout, left to right along the edges. */
export async function elkColumns(diagram: Diagram | undefined): Promise<Map<string, number>> {
  const all = boxList(diagram);
  const ids = new Set(all.map((b) => b.id));
  const edges = (Array.isArray(diagram?.edges) ? diagram.edges : []).filter((e) => e && ids.has(e.from) && ids.has(e.to));
  const graph = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '30',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(COL_GAP * 2),
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: [...ids].map((id) => ({ id, width: BOX_W, height: BOX_H })),
    edges: edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  });
  return new Map((graph.children ?? []).map((n) => [n.id, n.x ?? 0]));
}

export async function layoutDiagram(diagram: Diagram | undefined, lanes: LaneInfo[]): Promise<SwimlaneLayout> {
  return swimlaneLayout(diagram, lanes, await elkColumns(diagram));
}
