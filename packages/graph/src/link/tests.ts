// The test adapters (G18, G25): static `tests` edges, a test → the code it calls. No test runs.
// Vitest and pytest only. The readers already make the test nodes (`it`/`test` in TypeScript,
// `test_*` functions and `Test*` methods in Python) and their `calls` edges; an adapter says which
// files are test files, so that a call into a helper of a test file is followed to the code the
// helper calls, and the calls at the top level of a test file (hooks, fixtures) count too.
//
// A `tests` edge has the trust and source of the `calls` edge it comes from (the weakest one when it
// goes through a helper): a test of a name-match call is a name-match test.
//
// Incremental: the `calls` edges are made again on every update, so this linker runs again on every
// update that read a file; it reads only the graph, never a file.

import type { GraphView, Linker } from '../extend.js';
import type { EdgeSource, GraphNode, Trust } from '../types.js';
import { EdgeSet, weaker } from './nodes.js';

export interface TestAdapter {
  name: string;
  language: 'typescript' | 'python';
  /** A test file of this framework, by its repo path. */
  file: RegExp;
}

export const VITEST: TestAdapter = { name: 'vitest', language: 'typescript', file: /(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$/ };
export const PYTEST: TestAdapter = { name: 'pytest', language: 'python', file: /(^|\/)(test_[^/]*|[^/]*_test|conftest)\.py$/ };

/** Helpers in test files that a test goes through before it reaches the code. */
const MAX_HELPER_DEPTH = 3;

export function testsLinker(adapters: TestAdapter[] = [VITEST, PYTEST]): Linker {
  const isTestFile = (n: GraphNode) => n.file !== undefined && adapters.some((a) => a.language === n.language && a.file.test(n.file!));
  return {
    name: 'tests',
    source: 'tree-sitter',
    async link({ mode, changed, removed, graph }) {
      if (mode !== 'cold' && changed.length === 0 && removed.length === 0) return 'keep';
      const edges = new EdgeSet();
      const sources = [
        ...graph.nodesOfKind('test').filter((n) => !n.targetOnly && adapters.some((a) => a.language === n.language)),
        ...graph.nodesOfKind('file').filter((n) => !n.targetOnly && isTestFile(n)),
      ];
      for (const test of sources) {
        for (const hit of tested(graph, test.id, isTestFile)) {
          edges.add({ from: test.id, to: hit.to, kind: 'tests', trust: hit.trust, source: hit.source });
        }
      }
      return { nodes: [], edges: edges.list() };
    },
  };
}

/** The code a test calls: its callees, through the helpers of test files and other tests. */
function tested(graph: GraphView, from: string, isTestFile: (n: GraphNode) => boolean): Array<{ to: string; trust: Trust; source: EdgeSource }> {
  const out: Array<{ to: string; trust: Trust; source: EdgeSource }> = [];
  const seen = new Set<string>([from]);
  const walk = (id: string, trust: Trust, depth: number) => {
    for (const e of graph.edges({ from: id, kind: 'calls' })) {
      const callee = graph.node(e.to);
      if (!callee || callee.targetOnly) continue; // a framework call (expect, assert) or an outside package
      const t = weaker(trust, e.trust);
      if (callee.kind === 'test' || isTestFile(callee)) {
        if (depth < MAX_HELPER_DEPTH && !seen.has(callee.id)) {
          seen.add(callee.id);
          walk(callee.id, t, depth + 1);
        }
        continue;
      }
      out.push({ to: callee.id, trust: t, source: e.source });
    }
  };
  walk(from, 'exact', 0);
  return out;
}
