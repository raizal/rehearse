// Box `update-graph/rank` (G14): PageRank over every edge of the graph, followed in its direction, so
// a function that many callers, tests and files point to ranks high. The numbers are rounded to six
// significant digits: the same graph gives the same ranks, whatever order the rows come in (S4-A3).

import type { Ranker } from '../extend.js';

export interface PageRankOptions {
  /** The chance of following an edge rather than jumping to any node. */
  damping?: number;
  maxIterations?: number;
  /** Stop when the ranks move less than this in total (L1). */
  tolerance?: number;
}

export function pageRank(opts: PageRankOptions = {}): Ranker {
  const damping = opts.damping ?? 0.85;
  const maxIterations = opts.maxIterations ?? 100;
  const tolerance = opts.tolerance ?? 1e-10;
  return {
    name: 'pagerank',
    rank({ nodes, edges }) {
      const ids = [...new Set(nodes.map((n) => n.id))].sort();
      const n = ids.length;
      const out = new Map<string, number>();
      if (n === 0) return out;
      const index = new Map(ids.map((id, i) => [id, i]));
      // One link per (from, to) pair, whatever the edge kinds; self-links and unknown ends count for nothing.
      const targets: Set<number>[] = ids.map(() => new Set<number>());
      for (const e of edges) {
        const from = index.get(e.from);
        const to = index.get(e.to);
        if (from !== undefined && to !== undefined && from !== to) targets[from]!.add(to);
      }
      const links = targets.map((s) => [...s].sort((a, b) => a - b));

      let rank = new Float64Array(n).fill(1 / n);
      for (let iter = 0; iter < maxIterations; iter++) {
        let dangling = 0;
        for (let i = 0; i < n; i++) if (links[i]!.length === 0) dangling += rank[i]!;
        const next = new Float64Array(n).fill((1 - damping) / n + (damping * dangling) / n);
        for (let i = 0; i < n; i++) {
          const to = links[i]!;
          if (to.length === 0) continue;
          const share = (damping * rank[i]!) / to.length;
          for (const j of to) next[j]! += share;
        }
        let moved = 0;
        for (let i = 0; i < n; i++) moved += Math.abs(next[i]! - rank[i]!);
        rank = next;
        if (moved < tolerance) break;
      }
      for (let i = 0; i < n; i++) out.set(ids[i]!, Number(rank[i]!.toPrecision(6)));
      return out;
    },
  };
}
