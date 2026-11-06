// Box `run-query/context` (G6, G14, G19): the code an agent should read for a target, within a token
// budget. A token is estimated as 4 characters of code. The target comes first, then the other nodes by
// graph distance (edges followed both ways), then PageRank, then ID. Each one goes in when its code
// still fits; the bundle never goes over the budget (S4-A1). No LLM and no embeddings: the same graph
// and question give a byte-identical bundle (S4-A3).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContextBuilder, ContextBundle, ContextItem, GraphView } from '../extend.js';
import { findTarget, named, notFound, sortEdges } from '../query.js';
import type { Store } from '../store.js';
import type { AnswerNode, EdgeKind, GraphEdge, GraphNode, QueryAnswer } from '../types.js';
import { storeView } from '../update.js';

/** The budget of `context` without `--budget`, in tokens. */
export const DEFAULT_BUDGET = 2000;

/** The note of a bundle with Python code when the update found no Python environment (G19, S4-A2). */
export const NO_VENV = 'no venv found';

/** What a node is to the node it was reached from: [the other end of an out-edge, of an in-edge]. */
const ROLES: Record<EdgeKind, [string, string]> = {
  defines: ['member', 'container'],
  imports: ['import', 'importer'],
  calls: ['callee', 'caller'],
  references: ['referenced', 'reference'],
  extends: ['base', 'subclass'],
  implements: ['interface', 'implementation'],
  tests: ['tested', 'test'],
  builds: ['built', 'box'],
  changes: ['changed', 'commit'],
  'http-calls': ['route', 'client'],
};

export const tokensOf = (text: string): number => Math.ceil(text.length / 4);

/** The ContextBuilder of the `context` verb; it reads the code from the files below `root`. */
export function contextBuilder(root: string): ContextBuilder {
  return {
    async build(graph, target, budget, run) {
      const files = new Map<string, string[] | undefined>();
      const lines = (path: string) => {
        if (!files.has(path)) {
          try {
            files.set(path, readFileSync(join(root, path), 'utf8').split('\n'));
          } catch {
            files.set(path, undefined);
          }
        }
        return files.get(path);
      };
      const codeOf = (n: GraphNode): string | undefined => {
        const span = spanOf(n);
        const text = span && n.file !== undefined ? lines(n.file) : undefined;
        return text && span ? text.slice(span[0] - 1, span[1]).join('\n') : undefined;
      };

      const items: ContextItem[] = [];
      const notes: string[] = [];
      const targetCode = codeOf(target) ?? '';
      const cut = cutToFit(targetCode, budget);
      if (cut !== targetCode) notes.push(`the target is cut to fit the budget of ${budget} tokens`);
      items.push({ node: target, role: 'target', distance: 0, code: cut, tokens: tokensOf(cut) });
      let tokens = tokensOf(cut);
      const taken: Array<{ file: string; span: [number, number] }> = [];
      const targetSpan = spanOf(target);
      if (target.file !== undefined && targetSpan) taken.push({ file: target.file, span: targetSpan });

      for (const c of reach(graph, target, () => tokens >= budget)) {
        const file = c.node.file;
        const span = spanOf(c.node);
        if (c.node.targetOnly || file === undefined || !span) continue;
        // Each line but the last ends in a newline: a node of n lines has at least n - 1 characters.
        if (Math.ceil((span[1] - span[0]) / 4) > budget - tokens) continue;
        if (taken.some((t) => t.file === file && t.span[0] <= span[1] && span[0] <= t.span[1])) continue;
        const code = codeOf(c.node);
        if (code === undefined) continue;
        const t = tokensOf(code);
        if (tokens + t > budget) continue;
        items.push({ node: c.node, role: c.role, distance: c.distance, code, tokens: t });
        tokens += t;
        taken.push({ file, span });
      }

      if (run.venv === undefined && items.some((i) => i.node.language === 'python')) notes.push(NO_VENV);
      return { target, budget, tokens, items, notes };
    },
  };
}

interface Reached {
  node: GraphNode;
  role: string;
  distance: number;
}

/**
 * Every node linked to the target, in bundle order: graph distance, then PageRank (high first), then ID.
 * The target's members (a file's functions, a class's methods) are part of its code and count as the
 * target. `defines` edges are not followed from other nodes: the file of a callee is not near the target.
 * The edges are read once; the walk stops before the next distance once `full()` says the budget is used.
 */
function* reach(graph: GraphView, target: GraphNode, full: () => boolean): Generator<Reached> {
  const out = new Map<string, GraphEdge[]>();
  const into = new Map<string, GraphEdge[]>();
  const add = (m: Map<string, GraphEdge[]>, k: string, e: GraphEdge) => {
    const list = m.get(k);
    if (list) list.push(e);
    else m.set(k, [e]);
  };
  for (const e of graph.edges({})) (add(out, e.from, e), add(into, e.to, e));

  const seen = new Set<string>([target.id]);
  const members = [target.id];
  for (let i = 0; i < members.length; i++) {
    for (const e of out.get(members[i]!) ?? []) {
      if (e.kind === 'defines' && !seen.has(e.to)) (seen.add(e.to), members.push(e.to));
    }
  }
  let frontier = [...members].sort();
  for (let distance = 1; frontier.length > 0 && !full(); distance++) {
    const next: Reached[] = [];
    for (const id of frontier) {
      for (const e of [...(out.get(id) ?? []), ...(into.get(id) ?? [])]) {
        if (e.kind === 'defines') continue;
        const outward = e.from === id;
        const other = outward ? e.to : e.from;
        if (seen.has(other)) continue;
        seen.add(other);
        const node = graph.node(other);
        if (node) next.push({ node, role: ROLES[e.kind][outward ? 0 : 1], distance });
      }
    }
    next.sort((a, b) => b.node.rank - a.node.rank || (a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0));
    yield* next;
    // A target-only node (vitest.expect, a package outside the repo) is not walked through: every test
    // calls expect, and that does not make the tests near each other.
    frontier = next.filter((r) => !r.node.targetOnly).map((r) => r.node.id).sort();
  }
}

function spanOf(n: GraphNode): [number, number] | undefined {
  if (!n.range) return undefined;
  const [start, end] = n.range.split('-').map(Number) as [number, number];
  return [start, end];
}

/** The first whole lines of `code` that fit in `budget` tokens. */
function cutToFit(code: string, budget: number): string {
  if (tokensOf(code) <= budget) return code;
  const kept: string[] = [];
  let chars = 0;
  for (const line of code.split('\n')) {
    const add = (kept.length > 0 ? 1 : 0) + line.length;
    if (Math.ceil((chars + add) / 4) > budget) break;
    kept.push(line);
    chars += add;
  }
  return kept.join('\n');
}

/** `context <target> [--budget n]`: find the target, then build its bundle from the graph and the last run. */
export async function context(
  store: Store, root: string, target: string, budget = DEFAULT_BUDGET, builder: ContextBuilder = contextBuilder(root),
): Promise<QueryAnswer> {
  const t = findTarget(store, target);
  if (!t) return notFound('context');
  const run = store.lastRun();
  if (!run) throw new Error('context needs an index run: update the graph first');
  const bundle: ContextBundle = await builder.build(storeView(store), t.node, budget, run);
  const ids = new Set(bundle.items.map((i) => i.node.id));
  const nodes: AnswerNode[] = bundle.items.map((i) => ({ ...i.node, distance: i.distance }));
  const edges: GraphEdge[] = [];
  for (const id of ids) for (const e of store.edgesWhere('from_id = ?', id)) if (e.kind !== 'defines' && ids.has(e.to)) edges.push(e);
  return { verb: 'context', ok: true, exitCode: 0, nodes, edges: named(store, sortEdges(edges)), bundle, notes: [...t.notes, ...bundle.notes] };
}
