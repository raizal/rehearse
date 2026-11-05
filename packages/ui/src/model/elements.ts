// React Flow nodes and edges for one diagram: lane group nodes, and box nodes
// whose parent is the lane of their role (S4-A1).

import type { Edge as FlowEdge, Node } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import type { Box, Diagram, EdgeKind } from '@rehearse/core';
import { hasChildren, type LaneInfo } from './diagram.js';
import { BOX_H, BOX_W, type SwimlaneLayout } from './layout.js';

export interface LaneData extends Record<string, unknown> {
  lane: LaneInfo;
  width: number;
  height: number;
}

export interface BoxData extends Record<string, unknown> {
  box: Box;
  /** Box path. */
  path: string;
  lane: string;
  hasChildren: boolean;
  childCount: number;
  /** The current playback step is this box. */
  current: boolean;
  /** The current playback step is inside this box. */
  containsCurrent: boolean;
  selected: boolean;
}

export type LaneNode = Node<LaneData, 'lane'>;
export type BoxNode = Node<BoxData, 'box'>;

export const laneNodeId = (role: string): string => `lane:${role}`;
export const boxNodeId = (path: string): string => `box:${path}`;

export interface ElementOptions {
  /** Path of the diagram: '' for the root. */
  diagramPath: string;
  /** Leaf path of the current playback step. */
  current?: string;
  selected?: string;
}

export function toFlowElements(diagram: Diagram | undefined, layout: SwimlaneLayout, opts: ElementOptions): { nodes: (LaneNode | BoxNode)[]; edges: FlowEdge[] } {
  const prefix = opts.diagramPath === '' ? '' : `${opts.diagramPath}/`;
  const byId = new Map((Array.isArray(diagram?.boxes) ? diagram.boxes : []).filter((b) => b && typeof b === 'object').map((b) => [b.id, b]));
  const nodes: (LaneNode | BoxNode)[] = layout.lanes.map((lane) => ({
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
  for (const laid of layout.boxes) {
    const box = byId.get(laid.id);
    if (!box) continue;
    const path = prefix + box.id;
    const children = hasChildren(box) ? box.children!.boxes.length : 0;
    nodes.push({
      id: boxNodeId(path),
      type: 'box',
      parentId: laneNodeId(laid.lane),
      extent: 'parent',
      position: { x: laid.x, y: laid.y },
      width: BOX_W,
      height: BOX_H,
      draggable: false,
      zIndex: 1,
      data: {
        box,
        path,
        lane: laid.lane,
        hasChildren: children > 0,
        childCount: children,
        current: opts.current === path,
        containsCurrent: opts.current !== undefined && opts.current.startsWith(`${path}/`),
        selected: opts.selected === path,
      },
    });
  }
  const edges: FlowEdge[] = [];
  (Array.isArray(diagram?.edges) ? diagram.edges : []).forEach((e, i) => {
    if (!e || !byId.has(e.from) || !byId.has(e.to)) return;
    const kind: EdgeKind = e.kind ?? 'normal';
    edges.push({
      id: `edge:${i}:${e.from}->${e.to}`,
      source: boxNodeId(prefix + e.from),
      target: boxNodeId(prefix + e.to),
      type: 'smoothstep',
      className: `edge-${kind}`,
      zIndex: 2,
      data: { kind },
      markerEnd: { type: MarkerType.ArrowClosed },
      ...(e.label !== undefined ? { label: kind === 'error' ? `⚠ ${e.label}` : e.label } : {}),
    });
  });
  return { nodes, edges };
}
