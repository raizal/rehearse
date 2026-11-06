// Helpers the linkers share: the code node at a line, the better of two trust marks, and a set of
// edges that keeps one edge per (from, to, kind) with the best trust.

import { createHash } from 'node:crypto';
import type { GraphEdge, GraphNode, Trust } from '../types.js';

/** The smallest node of a file whose lines hold `line` (a function, method, test, route, class), else the file node. */
export function nodeAtLine(nodes: GraphNode[], line: number): GraphNode | undefined {
  let best: GraphNode | undefined;
  let bestSpan = Infinity;
  let file: GraphNode | undefined;
  for (const n of nodes) {
    if (n.kind === 'file') {
      file = n;
      continue;
    }
    if (!n.range) continue;
    const [start, end] = n.range.split('-').map(Number) as [number, number];
    if (line < start || line > end) continue;
    const span = end - start;
    if (span < bestSpan || (span === bestSpan && best !== undefined && n.id < best.id)) {
      best = n;
      bestSpan = span;
    }
  }
  return best ?? file;
}

const TRUST_ORDER: Record<Trust, number> = { exact: 0, 'name-match': 1, unresolved: 2 };

/** The weaker of two trust marks: a chain of edges is only as sure as its least sure edge. */
export function weaker(a: Trust, b: Trust): Trust {
  return TRUST_ORDER[a] >= TRUST_ORDER[b] ? a : b;
}

/** Edges by (from, to, kind); adding one that is there keeps the better trust. Sorted on output. */
export class EdgeSet {
  private readonly map = new Map<string, GraphEdge>();

  add(e: GraphEdge): void {
    const key = `${e.kind}\u0000${e.from}\u0000${e.to}`;
    const old = this.map.get(key);
    if (!old || TRUST_ORDER[e.trust] < TRUST_ORDER[old.trust]) this.map.set(key, e);
  }

  list(): GraphEdge[] {
    return [...this.map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, e]) => e);
  }
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
