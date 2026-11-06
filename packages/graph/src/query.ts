// Box `run-query`: find the target, then answer one verb (G1, G2, G26, G27, G28). The answers hold
// no run times and no dates: the same graph and the same query give a byte-identical answer.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Store } from './store.js';
import { splitWords } from './terms.js';
import type { AnswerEdge, AnswerNode, GraphEdge, GraphNode, NodeKind, QueryAnswer, Verb } from './types.js';

/** Which node a bare name means when several have it. */
const KIND_ORDER: NodeKind[] = ['function', 'method', 'class', 'route', 'test', 'file', 'module'];

export interface Target {
  node: GraphNode;
  notes: string[];
}

/** A node by its ID, its name, its route (`GET /api/orders/{order_id}`) or its file path. */
export function findTarget(store: Store, target: string): Target | undefined {
  const byId = store.node(target);
  if (byId) return { node: byId, notes: [] };
  const named = store.nodesWhere('name = ? OR route = ? OR (kind = ? AND file = ?)', target, target, 'file', target);
  if (named.length === 0) return undefined;
  const sorted = [...named].sort(
    (a, b) => Number(a.targetOnly) - Number(b.targetOnly) || kindIndex(a.kind) - kindIndex(b.kind) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const node = sorted[0]!;
  const notes = sorted.length > 1 ? [`${sorted.length} nodes match ${target}; this is ${node.id}; give the ID to pick another`] : [];
  return { node, notes };
}

function kindIndex(kind: NodeKind): number {
  const i = KIND_ORDER.indexOf(kind);
  return i === -1 ? KIND_ORDER.length : i;
}

/** `find <words>`: BM25 over the node terms, camelCase and snake_case split (G2). */
export function find(store: Store, words: string, limit = 20): QueryAnswer {
  const terms = splitWords(words).split(' ').filter((t) => t !== '');
  if (terms.length === 0) return answer('find', [], [], ['no words']);
  const match = [...new Set(terms)].map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
  const nodes: AnswerNode[] = store.search(match, limit).map(({ node, bm25 }) => ({ ...node, score: round(-bm25) }));
  return answer('find', nodes, [], nodes.length === 0 ? ['no hits'] : []);
}

/** `show <target>`: the node, its code and every edge in and out of it. */
export function show(store: Store, root: string, target: string): QueryAnswer {
  const t = findTarget(store, target);
  if (!t) return notFound('show');
  const node: AnswerNode = { ...t.node };
  const code = codeOf(root, t.node);
  if (code !== undefined) node.code = code;
  const edges = [...store.edgesWhere('from_id = ?', t.node.id), ...store.edgesWhere('to_id = ? AND from_id != ?', t.node.id, t.node.id)];
  return answer('show', [node], named(store, sortEdges(edges)), t.notes);
}

/**
 * `near <target> [--depth n]`: the nodes up to n edges away, both ways (G26). A `defines` edge counts
 * only at the target (its file, or its methods): the other things in the same file are not near.
 */
export function near(store: Store, target: string, depth = 1): QueryAnswer {
  const t = findTarget(store, target);
  if (!t) return notFound('near');
  const distance = new Map<string, number>([[t.node.id, 0]]);
  const edges = new Map<string, GraphEdge>();
  let frontier = [t.node.id];
  for (let d = 1; d <= depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of [...store.edgesWhere('from_id = ?', id), ...store.edgesWhere('to_id = ?', id)]) {
        if (e.kind === 'defines' && id !== t.node.id) continue;
        edges.set(edgeKey(e), e);
        const other = e.from === id ? e.to : e.from;
        if (distance.has(other)) continue;
        distance.set(other, d);
        if (e.kind !== 'defines') next.push(other);
      }
    }
    frontier = next.sort();
  }
  const nodes: AnswerNode[] = [];
  for (const [id, d] of distance) {
    const n = store.node(id);
    if (n) nodes.push({ ...n, distance: d });
  }
  nodes.sort((a, b) => a.distance! - b.distance! || (a.id < b.id ? -1 : 1));
  return answer('near', nodes, named(store, sortEdges([...edges.values()])), t.notes);
}

/** `path <from> <to>`: the shortest chain of edges, followed in their direction (G28). */
export function path(store: Store, from: string, to: string): QueryAnswer {
  const a = findTarget(store, from);
  const b = findTarget(store, to);
  if (!a || !b) return notFound('path');
  const notes = [...a.notes, ...b.notes];
  const via = new Map<string, GraphEdge | undefined>([[a.node.id, undefined]]);
  let frontier = [a.node.id];
  while (frontier.length > 0 && !via.has(b.node.id)) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of store.edgesWhere('from_id = ?', id)) {
        if (via.has(e.to)) continue;
        via.set(e.to, e);
        next.push(e.to);
      }
    }
    frontier = next;
  }
  if (!via.has(b.node.id)) return { ...answer('path', [], [], [...notes, 'no path']), ok: false, exitCode: 1 };
  const chain: GraphEdge[] = [];
  for (let e = via.get(b.node.id); e; e = via.get(e.from)) chain.unshift(e);
  const nodes = [a.node, ...chain.map((e) => store.node(e.to)!)];
  return answer('path', nodes, named(store, chain), notes);
}

function codeOf(root: string, node: GraphNode): string | undefined {
  if (!node.file || !node.range) return undefined;
  try {
    const [start, end] = node.range.split('-').map(Number) as [number, number];
    return readFileSync(join(root, node.file), 'utf8').split('\n').slice(start - 1, end).join('\n');
  } catch {
    return undefined;
  }
}

export function named(store: Store, edges: GraphEdge[]): AnswerEdge[] {
  const names = new Map<string, string>();
  const nameOf = (id: string) => {
    let n = names.get(id);
    if (n === undefined) names.set(id, (n = store.node(id)?.name ?? id));
    return n;
  };
  return edges.map((e) => ({ ...e, fromName: nameOf(e.from), toName: nameOf(e.to) }));
}

export function sortEdges(edges: GraphEdge[]): GraphEdge[] {
  return [...edges].sort((a, b) => (edgeKey(a) < edgeKey(b) ? -1 : edgeKey(a) > edgeKey(b) ? 1 : 0));
}

function edgeKey(e: GraphEdge): string {
  return `${e.kind}\u0000${e.from}\u0000${e.to}`;
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000 + 0;
}

function answer(verb: Verb, nodes: AnswerNode[], edges: AnswerEdge[], notes: string[]): QueryAnswer {
  return { verb, ok: true, exitCode: 0, nodes, edges, notes };
}

export function notFound(verb: Verb): QueryAnswer {
  return { verb, ok: false, exitCode: 1, nodes: [], edges: [], notes: ['not found'] };
}
