// The user flow of the EPIC (D42, design page 5): the path the human roles take through the
// root diagram. Boxes in human lanes are screens and actions, decisions are diamonds with their
// branch labels, starts and ends are dots. Boxes of other lanes that the path passes through are
// folded into one labelled step. Boxes that no human box connects to are listed apart.

import type { Box, BoxKind, Flow, Prd } from '@rehearse/core';
import { lanesFor, type LaneInfo } from './diagram.js';
import { flowOrder } from './features.js';
import { nodeSize, type DEdge, type DGraph, type DNode, type EdgeKind, type FoldRow, type Shape } from './graph.js';

export interface UserFlow extends DGraph {
  /** The human lanes the path belongs to. */
  humanLanes: LaneInfo[];
  /** Root boxes that no human box connects to, in flow order. */
  offPath: FoldRow[];
}

/** Box kinds that fold into one step when they are not in a human lane. */
const FOLDABLE: readonly BoxKind[] = ['process', 'input', 'output', 'external'];

function humanShape(kind: BoxKind): Shape {
  if (kind === 'start' || kind === 'end' || kind === 'decision') return kind;
  return kind === 'output' || kind === 'external' ? 'screen' : 'action';
}

/** Root boxes in flow order, and the edges between them. */
export function rootGraph(flow: Flow | undefined): { boxes: Box[]; edges: { from: string; to: string; label?: string; kind?: string }[] } {
  const all = (Array.isArray(flow?.root?.boxes) ? flow.root.boxes : []).filter((b) => b && typeof b.id === 'string');
  const byId = new Map(all.map((b) => [b.id, b]));
  const boxes = flowOrder(flow?.root).map((id) => byId.get(id)!);
  const edges = (Array.isArray(flow?.root?.edges) ? flow.root.edges : []).filter((e) => e && byId.has(e.from) && byId.has(e.to));
  return { boxes, edges };
}

/** Union-find over ids, joined along the given pairs. Each id maps to its set's root. */
function components(ids: string[], pairs: [string, string][]): Map<string, string> {
  const up = new Map(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    let at = id;
    while (up.get(at) !== at) at = up.get(at)!;
    return at;
  };
  for (const [a, b] of pairs) {
    if (!up.has(a) || !up.has(b)) continue;
    const ra = find(a);
    const rb = find(b);
    // The set keeps the id that comes first, so roots follow flow order.
    if (ra !== rb) ids.indexOf(ra) < ids.indexOf(rb) ? up.set(rb, ra) : up.set(ra, rb);
  }
  return new Map(ids.map((id) => [id, find(id)]));
}

/** Merge edges with the same ends: their labels join with ", ". */
export function mergeEdges(edges: Omit<DEdge, 'id'>[]): DEdge[] {
  const out: DEdge[] = [];
  const at = new Map<string, DEdge>();
  for (const e of edges) {
    const key = `${e.from}\n${e.to}`;
    const old = at.get(key);
    if (!old) {
      const edge = { id: `e${out.length}`, ...e };
      if (edge.label === undefined) delete edge.label;
      at.set(key, edge);
      out.push(edge);
    } else if (e.label && !(old.label ?? '').split(', ').includes(e.label)) {
      old.label = old.label ? `${old.label}, ${e.label}` : e.label;
      if (old.kind === 'normal') old.kind = e.kind;
    }
  }
  return out;
}

export function edgeKind(kind: string | undefined): EdgeKind {
  return kind === 'branch' || kind === 'error' ? kind : 'normal';
}

export function userFlow(flow: Flow | undefined, prd: Prd | undefined): UserFlow {
  const lanes = lanesFor(flow, prd, flow?.root, true);
  const laneOf = new Map(lanes.map((l) => [l.role, l]));
  const humanLanes = lanes.filter((l) => l.kind === 'human');
  const human = new Set(humanLanes.map((l) => l.role));
  const { boxes, edges } = rootGraph(flow);
  const ids = boxes.map((b) => b.id);

  // Boxes on the path: those in a part of the diagram that holds a human box.
  const part = components(ids, edges.map((e) => [e.from, e.to]));
  const humanParts = new Set(boxes.filter((b) => human.has(b.lane)).map((b) => part.get(b.id)));
  const onPath = (b: Box) => humanParts.has(part.get(b.id));

  const foldable = (b: Box) => onPath(b) && !human.has(b.lane) && FOLDABLE.includes(b.kind);
  const folded = boxes.filter(foldable).map((b) => b.id);
  const isFolded = new Set(folded);
  const fold = components(
    folded,
    edges.filter((e) => isFolded.has(e.from) && isFolded.has(e.to)).map((e) => [e.from, e.to]),
  );
  const nodeOf = (id: string) => (isFolded.has(id) ? `fold:${fold.get(id)}` : id);
  const laneLabel = (role: string) => laneOf.get(role)?.label ?? role;

  const nodes: DNode[] = [];
  const offPath: FoldRow[] = [];
  const folds = new Map<string, DNode>();
  for (const b of boxes) {
    const title = typeof b.title === 'string' ? b.title : b.id;
    if (!onPath(b)) {
      offPath.push({ path: b.id, title, lane: laneLabel(b.lane) });
      continue;
    }
    if (isFolded.has(b.id)) {
      const id = nodeOf(b.id);
      let node = folds.get(id);
      if (!node) {
        node = { id, shape: 'fold', title: '', rows: [], w: 0, h: 0 };
        folds.set(id, node);
        nodes.push(node);
      }
      node.rows!.push({ path: b.id, title, lane: laneLabel(b.lane) });
      continue;
    }
    const shape = human.has(b.lane) ? humanShape(b.kind) : b.kind === 'decision' ? 'decision' : b.kind === 'end' ? 'end' : 'start';
    nodes.push({ id: b.id, shape, title, path: b.id, ...(human.has(b.lane) ? {} : { tag: laneLabel(b.lane) }), ...nodeSize(shape, title) });
  }
  for (const node of folds.values()) {
    const lanesIn = [...new Set(node.rows!.map((r) => r.lane))];
    node.title = lanesIn.join(' · ');
    node.tag = `${node.rows!.length} step${node.rows!.length === 1 ? '' : 's'}`;
    Object.assign(node, nodeSize('fold', node.title, node.rows!.length));
  }

  const kept = edges
    .filter((e) => onPath(boxes.find((b) => b.id === e.from)!))
    .map((e) => ({ from: nodeOf(e.from), to: nodeOf(e.to), ...(typeof e.label === 'string' ? { label: e.label } : {}), kind: edgeKind(e.kind) }))
    .filter((e) => e.from !== e.to);
  return { nodes, edges: mergeEdges(kept), groups: [], humanLanes, offPath };
}
