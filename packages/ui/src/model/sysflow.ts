// The system flowchart of the EPIC (D42, design page 7): one column per system lane (kind system
// or external), its root boxes and their nested children as program steps, decisions as checks
// (diamonds), output boxes as documents, starts and ends as terminals. A box with children is a
// frame around its steps: an edge into it goes to its first steps, an edge out of it leaves from
// its last steps. A box of another lane that a system box links to stands once in a last column,
// "Other lanes", so every branch of a check shows where it goes.

import type { Box, Diagram, Flow, Prd } from '@rehearse/core';
import { lanesFor, type LaneInfo } from './diagram.js';
import { flowOrder } from './features.js';
import { nodeSize, type DEdge, type DGraph, type DGroup, type DNode, type Shape } from './graph.js';
import { edgeKind, mergeEdges } from './userflow.js';

/** Lane kinds that get a column. */
export const SYSTEM_KINDS = ['system', 'external'] as const;
export const OUTSIDE = 'col:outside';

export interface SystemFlowchart extends DGraph {
  /** Column group ids in order; the last one is OUTSIDE when a box of another lane is linked. */
  columns: string[];
  systemLanes: LaneInfo[];
}

function stepShape(kind: Box['kind']): Shape {
  if (kind === 'decision') return 'decision';
  if (kind === 'output') return 'document';
  if (kind === 'start' || kind === 'end') return 'terminal';
  return 'step';
}

function boxesOf(diagram: Diagram | undefined): Box[] {
  const all = (Array.isArray(diagram?.boxes) ? diagram.boxes : []).filter((b) => b && typeof b.id === 'string');
  const byId = new Map(all.map((b) => [b.id, b]));
  return flowOrder(diagram).map((id) => byId.get(id)!);
}

function edgesOf(diagram: Diagram | undefined, ids: Set<string>) {
  return (Array.isArray(diagram?.edges) ? diagram.edges : []).filter((e) => e && ids.has(e.from) && ids.has(e.to));
}

const hasKids = (b: Box) => boxesOf(b.children).length > 0;

/** The steps an edge into (`in`) or out of (`out`) the box at `path` really reaches. */
function ends(box: Box, path: string, side: 'in' | 'out'): string[] {
  if (!hasKids(box)) return [path];
  const kids = boxesOf(box.children);
  const ids = new Set(kids.map((k) => k.id));
  const inner = edgesOf(box.children, ids);
  const linked = new Set(inner.map((e) => (side === 'in' ? e.to : e.from)));
  let picked = kids.filter((k) => !linked.has(k.id));
  if (picked.length === 0) picked = [side === 'in' ? kids[0]! : kids[kids.length - 1]!];
  return picked.flatMap((k) => ends(k, `${path}/${k.id}`, side));
}

export function systemFlowchart(flow: Flow | undefined, prd: Prd | undefined): SystemFlowchart {
  const lanes = lanesFor(flow, prd, flow?.root, true);
  const systemLanes = lanes.filter((l) => (SYSTEM_KINDS as readonly string[]).includes(l.kind ?? ''));
  const system = new Set(systemLanes.map((l) => l.role));
  const laneLabel = new Map(lanes.map((l) => [l.role, l.label]));
  const nodes: DNode[] = [];
  const groups: DGroup[] = systemLanes.map((l) => ({ id: `col:${l.role}`, title: l.label, kind: 'column' }));
  const raw: Omit<DEdge, 'id'>[] = [];

  const root = boxesOf(flow?.root);
  const rootById = new Map(root.map((b) => [b.id, b]));
  const connectors = new Map<string, DNode>();
  const connector = (b: Box): string => {
    const id = `o:${b.id}`;
    if (!connectors.has(id)) {
      const title = typeof b.title === 'string' ? b.title : b.id;
      connectors.set(id, { id, shape: 'connector', title, tag: laneLabel.get(b.lane) ?? b.lane, path: b.id, group: OUTSIDE, ...nodeSize('connector', title) });
    }
    return id;
  };

  // A diagram's boxes inside `group`; its edges by the steps they really reach.
  const place = (diagram: Diagram | undefined, prefix: string, group: string) => {
    const list = boxesOf(diagram);
    for (const b of list) {
      const path = prefix ? `${prefix}/${b.id}` : b.id;
      const title = typeof b.title === 'string' ? b.title : b.id;
      if (hasKids(b)) {
        const id = `c:${path}`;
        groups.push({ id, title, kind: 'cluster', parent: group, path });
        place(b.children, path, id);
      } else {
        const shape = stepShape(b.kind);
        nodes.push({ id: path, shape, title, path, group, ...(b.kind === 'start' || b.kind === 'end' ? { tag: b.kind } : {}), ...nodeSize(shape, title) });
      }
    }
    const byId = new Map(list.map((b) => [b.id, b]));
    for (const e of edgesOf(diagram, new Set(byId.keys()))) {
      const p = (id: string) => (prefix ? `${prefix}/${id}` : id);
      for (const from of ends(byId.get(e.from)!, p(e.from), 'out'))
        for (const to of ends(byId.get(e.to)!, p(e.to), 'in')) raw.push({ from, to, ...(typeof e.label === 'string' ? { label: e.label } : {}), kind: edgeKind(e.kind) });
    }
  };
  for (const b of root) {
    if (!system.has(b.lane)) continue;
    place({ boxes: [b], edges: [] }, '', `col:${b.lane}`);
  }

  // Root edges: between system boxes, or to and from a box of another lane.
  const rootIds = new Set(root.map((b) => b.id));
  for (const e of edgesOf(flow?.root, rootIds)) {
    const a = rootById.get(e.from)!;
    const z = rootById.get(e.to)!;
    if (!system.has(a.lane) && !system.has(z.lane)) continue;
    const froms = system.has(a.lane) ? ends(a, a.id, 'out') : [connector(a)];
    const tos = system.has(z.lane) ? ends(z, z.id, 'in') : [connector(z)];
    for (const from of froms) for (const to of tos) raw.push({ from, to, ...(typeof e.label === 'string' ? { label: e.label } : {}), kind: edgeKind(e.kind) });
  }

  const columns = groups.filter((g) => g.kind === 'column').map((g) => g.id);
  if (connectors.size > 0) {
    groups.push({ id: OUTSIDE, title: 'Other lanes', kind: 'column' });
    columns.push(OUTSIDE);
    const order = new Map(root.map((b, i) => [`o:${b.id}`, i]));
    nodes.push(...[...connectors.values()].sort((p, q) => order.get(p.id)! - order.get(q.id)!));
  }
  return { nodes, edges: mergeEdges(raw), groups, columns, systemLanes };
}
