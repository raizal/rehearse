// Box `code-view` (S9, D19): what the drill-down below a leaf box shows, from graph answers. Which
// code a box builds comes from its `builds` edges (S8-A1); the route says the kind and place of each
// edge end, so tests and file nodes a Flow-Box commit touched are not taken for the box's code.
// Until a box has builds edges, the code is the functions defined in the files of its Flow-Box
// commits (the code index the Code tab uses), marked as found that way. No builds edge and no
// commit: the box has no code yet (S9-A2).

import type { AnswerEdge, AnswerNode, AstOutlineNode, NodeKind, Trust } from '@rehearse/server';
import type { PanelAnswer } from '../graph-api.js';

export const NO_CODE_YET = 'This box has no code yet.';

/** The kinds of node the drill-down shows the code of. Tests are in the call graph instead. */
export const CODE_KINDS: readonly NodeKind[] = ['function', 'method', 'class', 'route'];

/** The graph target of a box (S9 example drill-pay). */
export const boxTarget = (path: string): string => `box ${path}`;

export interface BuiltNode {
  id: string;
  name: string;
  kind: NodeKind;
  file?: string;
  range?: string;
  /** The builds edge's trust; missing when found by Flow-Box files. */
  trust?: Trust;
}

export type BoxCode =
  | { source: 'builds'; nodes: BuiltNode[] }
  | { source: 'flow-box'; nodes: BuiltNode[] }
  | { source: 'none' };

const byFileLine = (a: BuiltNode, b: BuiltNode) =>
  (a.file ?? '').localeCompare(b.file ?? '') || startLine(a.range) - startLine(b.range) || a.id.localeCompare(b.id);
const startLine = (range: string | undefined) => Number(range?.split('-')[0] ?? 0);
const TRUST_ORDER: readonly Trust[] = ['exact', 'name-match', 'unresolved'];

/** Test files are not the code a box builds; the fallback leaves them out. */
export const isTestFile = (path: string): boolean => /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.py$/.test(path);

/** The node at the other end of an edge, from the answer's `ends`; without them, the kind is read off the ID. */
function endNode(answer: PanelAnswer, id: string, name: string): BuiltNode {
  const end = answer.ends?.[id];
  return { id, name, kind: end?.kind ?? kindFromId(id), ...(end?.file !== undefined ? { file: end.file } : {}), ...(end?.range !== undefined ? { range: end.range } : {}) };
}

const isCode = (n: BuiltNode) => CODE_KINDS.includes(n.kind) && (n.file === undefined || !isTestFile(n.file));

/** The lower-case words of a box path or a code name: `checkout/sign-off` and `signOff` share sign, off. */
export const nameWords = (name: string): string[] =>
  name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== '');

/**
 * The code a box builds: the code nodes at the end of the builds edges out of the box node. Exact
 * ones first, then the ones whose name shares the most words with the box path and has the fewest
 * other words (a Flow-Box commit touches more code than the box's own function), then by file and line.
 */
export function builtNodes(answer: PanelAnswer | undefined): BuiltNode[] {
  const box = answer?.nodes[0];
  if (!answer || !box) return [];
  const words = new Set(nameWords(box.name));
  const score = (n: BuiltNode) => {
    const own = nameWords(n.name);
    return { shared: own.filter((w) => words.has(w)).length, extra: own.filter((w) => !words.has(w)).length };
  };
  return answer.edges
    .filter((e) => e.kind === 'builds' && e.from === box.id)
    .map((e) => ({ ...endNode(answer, e.to, e.toName), trust: e.trust }))
    .filter(isCode)
    .map((n) => ({ n, ...score(n) }))
    .sort((a, b) => TRUST_ORDER.indexOf(a.n.trust!) - TRUST_ORDER.indexOf(b.n.trust!) || b.shared - a.shared || a.extra - b.extra || byFileLine(a.n, b.n))
    .map(({ n }) => n);
}

/** The code nodes a file defines (the fallback): the ends of `defines` edges out of a file node that is not a test file. */
export function definedNodes(fileAnswers: (PanelAnswer | undefined)[]): BuiltNode[] {
  const out = new Map<string, BuiltNode>();
  for (const a of fileAnswers) {
    const file = a?.nodes[0];
    if (!a || !file || file.kind !== 'file' || (file.file !== undefined && isTestFile(file.file))) continue;
    for (const e of a.edges) {
      if (e.kind !== 'defines' || e.from !== file.id) continue;
      const n = endNode(a, e.to, e.toName);
      if (isCode(n)) out.set(e.to, { ...n, ...(n.file === undefined && file.file ? { file: file.file } : {}) });
    }
  }
  return [...out.values()].sort(byFileLine);
}

/** A SCIP-style ID ends in `name().` for a function or method, `Name#` for a class (G10). */
function kindFromId(id: string): NodeKind {
  if (id.endsWith('#')) return 'class';
  if (id.endsWith(').')) return 'function';
  return 'module';
}

export interface CallGraph {
  /** Nodes that call the shown node. */
  callers: CallLink[];
  /** Nodes the shown node calls. */
  callees: CallLink[];
  /** Tests of the shown node. */
  tests: CallLink[];
}

export interface CallLink {
  id: string;
  name: string;
  trust: Trust;
  kind: AnswerEdge['kind'];
}

const CALLING: readonly AnswerEdge['kind'][] = ['calls', 'http-calls'];

/** The call graph one edge around the shown node: callers, callees (calls and HTTP calls) and tests, by name. */
export function callGraph(answer: PanelAnswer): CallGraph {
  const me = (answer.nodes.find((n) => n.distance === 0) ?? answer.nodes[0])?.id;
  const sort = (l: CallLink[]) => [...new Map(l.map((c) => [c.id, c])).values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const link = (e: AnswerEdge, out: boolean): CallLink => ({ id: out ? e.to : e.from, name: out ? e.toName : e.fromName, trust: e.trust, kind: e.kind });
  return {
    callers: sort(answer.edges.filter((e) => CALLING.includes(e.kind) && e.to === me && e.from !== me).map((e) => link(e, false))),
    callees: sort(answer.edges.filter((e) => CALLING.includes(e.kind) && e.from === me && e.to !== me).map((e) => link(e, true))),
    tests: sort(answer.edges.filter((e) => e.kind === 'tests' && e.to === me).map((e) => link(e, false))),
  };
}

export interface OutlineRow {
  depth: number;
  type: string;
  name?: string;
  lines: string;
}

/** The AST outline as rows, depth first, for an indented read-only list. */
export function outlineRows(root: AstOutlineNode | undefined): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const walk = (n: AstOutlineNode, depth: number) => {
    rows.push({ depth, type: n.type, lines: n.lines, ...(n.name !== undefined ? { name: n.name } : {}) });
    for (const c of n.children) walk(c, depth + 1);
  };
  if (root) walk(root, 0);
  return rows;
}

export interface CodeLine {
  n: number;
  text: string;
}

/** The node's code with its file line numbers. */
export function codeLines(node: AnswerNode): CodeLine[] {
  if (node.code === undefined) return [];
  const first = startLine(node.range) || 1;
  return node.code.split('\n').map((text, i) => ({ n: first + i, text }));
}

/** `src/pay.ts:10-30` */
export const nodePlace = (n: { file?: string; range?: string }): string => (n.file ? `${n.file}${n.range ? `:${n.range}` : ''}` : 'outside the repo');
