// The call graph of the code drill-down as a node graph (S9, box drill-code, T36): from a `near`
// answer around the shown code node, its callers on the left, its callees on the right and its
// tests as their own kind, laid out by ELK (layered, left to right) with the big picture helper.
// Edges keep the graph's trust (G10): exact, name-match or unresolved. A node outside the repo
// (a target-only node, or an unresolved end the graph has no node for) is a small "outside" node.
// More than FOLD_AT neighbours on one side fold into one "+N more" node until it is opened.

import type { AnswerEdge, AnswerNode, NodeKind, Trust } from '@rehearse/server';
import type { PanelAnswer } from '../graph-api.js';
import { layoutGraph, type DGraph, type GraphLayout } from './graph.js';

type EdgeKind = AnswerEdge['kind'];

/** Neighbours on one side shown before they fold. */
export const FOLD_AT = 12;

/** The edges the call graph draws. */
export const CALL_KINDS: readonly EdgeKind[] = ['calls', 'tests', 'http-calls'];

export type Side = 'callers' | 'tests' | 'callees';

const TRUST_ORDER: readonly Trust[] = ['exact', 'name-match', 'unresolved'];

export interface CgNode {
  id: string;
  type: 'code' | 'more' | 'empty';
  name: string;
  kind?: NodeKind;
  file?: string;
  range?: string;
  /** The center, or a node 1 or 2 edges away. */
  ring: number;
  side?: Side;
  /** Outside the repo: a target-only node, or an end the graph has no node for. */
  outside: boolean;
  /** The graph has a node for it, so it can become the center. */
  known: boolean;
  /** The edge that brought it in: its kind and trust, for the tooltip. */
  via?: { kind: EdgeKind; trust: Trust };
  /** A "+N more" node: the group it opens and how many it holds. */
  more?: { group: string; count: number };
}

export interface CgEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  trust: Trust;
  /** An edge to a "+N more" or an empty-side node: drawn faint, no trust. */
  ghost?: boolean;
}

export interface CallGraphModel {
  center: string;
  nodes: CgNode[];
  edges: CgEdge[];
}

const SIDES: readonly Side[] = ['callers', 'tests', 'callees'];

/** A SCIP-style ID ends in `name().` for a function or method, `Name#` for a class (G10). */
function kindFromId(id: string): NodeKind {
  if (id.endsWith('#')) return 'class';
  if (id.endsWith(').')) return 'function';
  return 'module';
}

const sideOf = (e: AnswerEdge, at: string): Side => (e.kind === 'tests' ? 'tests' : e.to === at ? 'callers' : 'callees');
const better = (a: Trust, b: Trust): boolean => TRUST_ORDER.indexOf(a) < TRUST_ORDER.indexOf(b);
const byTrustName = (a: CgNode, b: CgNode) =>
  TRUST_ORDER.indexOf(a.via!.trust) - TRUST_ORDER.indexOf(b.via!.trust) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/**
 * The graph to draw from a `near` answer: the center (the node at distance 0), the nodes one edge
 * away and, at depth 2, the nodes one edge past a shown neighbour. Only call, test and HTTP-call
 * edges count. `open` holds the groups ("1:callers", "2:callees", …) whose "+N more" was opened.
 */
export function callGraphModel(answer: PanelAnswer, depth: number, open: ReadonlySet<string> = new Set()): CallGraphModel {
  const me = answer.nodes.find((n) => n.distance === 0) ?? answer.nodes[0];
  if (!me) return { center: '', nodes: [], edges: [] };
  const known = new Map<string, AnswerNode>(answer.nodes.map((n) => [n.id, n]));
  const edges = answer.edges.filter((e) => CALL_KINDS.includes(e.kind) && e.from !== e.to);
  const make = (id: string, name: string, ring: number, side: Side | undefined, via: CgNode['via']): CgNode => {
    const n = known.get(id);
    return {
      id,
      type: 'code',
      name: n?.name ?? name,
      kind: n?.kind ?? kindFromId(id),
      ...(n?.file !== undefined ? { file: n.file } : {}),
      ...(n?.range !== undefined ? { range: n.range } : {}),
      ring,
      ...(side ? { side } : {}),
      outside: !n || n.targetOnly || n.file === undefined,
      known: n !== undefined,
      ...(via ? { via } : {}),
    };
  };

  const placed = new Map<string, CgNode>([[me.id, make(me.id, me.name, 0, undefined, undefined)]]);
  const shown: CgNode[] = [placed.get(me.id)!];
  const extra: CgEdge[] = [];
  /** Put the nodes of one ring in groups, fold the big groups, and return the ones shown. */
  const ring = (n: number, found: Map<string, { node: CgNode; anchor: string }>): CgNode[] => {
    const out: CgNode[] = [];
    for (const side of SIDES) {
      const group = `${n}:${side}`;
      const all = [...found.values()].filter((f) => f.node.side === side).sort((a, b) => byTrustName(a.node, b.node));
      const fold = all.length > FOLD_AT && !open.has(group);
      const visible = fold ? all.slice(0, FOLD_AT - 1) : all;
      out.push(...visible.map((f) => f.node));
      if (!fold) continue;
      const hidden = all.length - visible.length;
      const id = `more:${group}`;
      const anchor = all[visible.length]!.anchor;
      placed.set(id, { id, type: 'more', name: `+${hidden} more`, ring: n, side, outside: false, known: false, more: { group, count: hidden } });
      out.push(placed.get(id)!);
      extra.push({ id: `ghost:${id}`, ...(side === 'callees' ? { from: anchor, to: id } : { from: id, to: anchor }), kind: 'calls', trust: 'exact', ghost: true });
    }
    for (const node of out) placed.set(node.id, node);
    return out;
  };

  const first = new Map<string, { node: CgNode; anchor: string }>();
  for (const e of edges) {
    if (e.from !== me.id && e.to !== me.id) continue;
    const other = e.from === me.id ? e.to : e.from;
    const had = first.get(other);
    if (had && !better(e.trust, had.node.via!.trust)) continue;
    const side = had?.node.side ?? sideOf(e, me.id);
    first.set(other, { node: make(other, e.from === me.id ? e.toName : e.fromName, 1, side, { kind: e.kind, trust: e.trust }), anchor: me.id });
  }
  const ring1 = ring(1, first);
  shown.push(...ring1);

  if (depth >= 2) {
    const second = new Map<string, { node: CgNode; anchor: string }>();
    for (const v of ring1) {
      if (v.type !== 'code') continue;
      for (const e of edges) {
        if (e.from !== v.id && e.to !== v.id) continue;
        const other = e.from === v.id ? e.to : e.from;
        if (other === me.id || first.has(other) || second.has(other)) continue;
        second.set(other, { node: make(other, e.from === v.id ? e.toName : e.fromName, 2, v.side, { kind: e.kind, trust: e.trust }), anchor: v.id });
      }
    }
    shown.push(...ring(2, second));
  }

  const drawn = new Map<string, CgEdge>();
  for (const e of edges) {
    if (!placed.has(e.from) || !placed.has(e.to)) continue;
    const id = `${e.kind}:${e.from}->${e.to}`;
    if (!drawn.has(id)) drawn.set(id, { id, from: e.from, to: e.to, kind: e.kind, trust: e.trust });
  }
  // An empty side says so, in the graph and not only in the list.
  const has = (side: Side) => ring1.some((n) => n.side === side);
  if (!has('callers') && !has('tests')) {
    shown.push({ id: 'empty:callers', type: 'empty', name: 'no callers', ring: 1, side: 'callers', outside: false, known: false });
    extra.push({ id: 'ghost:empty:callers', from: 'empty:callers', to: me.id, kind: 'calls', trust: 'exact', ghost: true });
  }
  if (!has('callees')) {
    shown.push({ id: 'empty:callees', type: 'empty', name: 'no callees', ring: 1, side: 'callees', outside: false, known: false });
    extra.push({ id: 'ghost:empty:callees', from: me.id, to: 'empty:callees', kind: 'calls', trust: 'exact', ghost: true });
  }
  return { center: me.id, nodes: shown, edges: [...drawn.values(), ...extra] };
}

/** Width and height of a node: the center is the biggest, outside and fold nodes are small. */
export function cgNodeSize(n: CgNode, center: string): { w: number; h: number } {
  if (n.id === center) return { w: 230, h: 56 };
  if (n.type === 'more') return { w: 120, h: 30 };
  if (n.type === 'empty') return { w: 120, h: 30 };
  if (n.outside) return { w: 180, h: 32 };
  return { w: 220, h: 42 };
}

/** Node positions from ELK (layered, left to right): callers left of the center, callees right. Neighbours stack close. */
export async function layoutCallGraph(model: CallGraphModel): Promise<GraphLayout> {
  const graph: DGraph = {
    nodes: model.nodes.map((n) => ({ id: n.id, shape: 'step', title: n.name, ...cgNodeSize(n, model.center) })),
    edges: model.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, kind: 'normal' })),
    groups: [],
  };
  return layoutGraph(graph, 'RIGHT', { 'elk.spacing.nodeNode': '10', 'elk.layered.spacing.nodeNodeBetweenLayers': '110', 'elk.edgeRouting': 'SPLINES' });
}

/** The tooltip of a node: kind, place and the trust of the edge that brought it in. */
export function cgNodeTitle(n: CgNode): string {
  if (n.type === 'more') return `${n.more!.count} more, click to show them`;
  if (n.type === 'empty') return n.name;
  const place = n.file ? `${n.file}${n.range ? `:${n.range}` : ''}` : 'outside the repo';
  const via = n.via ? `, ${n.via.kind} edge, ${n.via.trust}` : '';
  return `${n.kind ?? 'node'} ${n.name}, ${place}${via}`;
}
