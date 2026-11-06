// The extension points that wave 2 fills in. Wave 1 only defines them: the update step calls every
// Resolver, Linker and the Ranker it is given. openGraph gives PageRank (src/rank/) by default, and the
// `context` verb (G6, S4) is a ContextBuilder (src/context/).
//
//   Resolver       ts-morph (TypeScript) and scip-python / basedpyright (Python) confirm a reference
//                  site: the edge gets trust `exact` and the resolver's source (G10, G11, G19).
//   Linker         adds nodes and edges from outside the code: tests/builds edges from the record and
//                  git (S2-A2, S10), http-calls edges from an OpenAPI file or fetch URLs (S7).
//   Ranker         PageRank over the graph (G14); its numbers go in GraphNode.rank.
//   ContextBuilder the `context` verb: the code to read for a target within a token budget (G6, S4).

import type { RefSite } from './readers/reader.js';
import type { Scope } from './scope.js';
import type { StoredRef } from './store.js';
import type { EdgeKind, EdgeSource, GraphEdge, GraphNode, IndexMode, IndexRun, Trust } from './types.js';

/** A read-only view of the graph as it stands during an update (after the readers ran). */
export interface GraphView {
  node(id: string): GraphNode | undefined;
  nodesInFile(path: string): GraphNode[];
  nodesNamed(name: string): GraphNode[];
  edges(filter: { from?: string; to?: string; kind?: EdgeKind }): GraphEdge[];
}

export interface ResolveInput {
  /** Absolute repo root. */
  root: string;
  mode: Exclude<IndexMode, 'none'>;
  scope: Scope;
  /** Repo paths read again in this run (every file on a cold index). */
  changed: string[];
  /** Repo paths that are gone since the last run. */
  removed: string[];
  /** The reference sites of the resolver's language that have no resolver answer yet. */
  refs: StoredRef[];
  graph: GraphView;
}

/** A resolver's answer for one reference site. A target outside the repo is a target-only node. */
export interface Resolution {
  ref: RefSite & { file: string };
  target: GraphNode;
  trust: Exclude<Trust, 'name-match'>;
}

export interface Resolver {
  /** The edge source of its answers, and the name in IndexRun.resolvers. */
  name: EdgeSource;
  language: 'typescript' | 'python';
  resolve(input: ResolveInput): Promise<Resolution[]>;
  close?(): Promise<void>;
}

export interface LinkInput {
  root: string;
  mode: Exclude<IndexMode, 'none'>;
  changed: string[];
  removed: string[];
  graph: GraphView;
}

/** Nodes and edges of one linker; they replace the linker's output of the last run. */
export interface LinkOutput {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Linker {
  /** Unique; the store keeps its rows under origin `link:<name>`. */
  name: string;
  source: EdgeSource;
  /** `keep`: nothing the linker reads changed, keep its rows from the last run. */
  link(input: LinkInput): Promise<LinkOutput | 'keep'>;
}

export interface Ranker {
  name: string;
  /** A number per node ID; nodes left out get 0. */
  rank(graph: { nodes: GraphNode[]; edges: GraphEdge[] }): Map<string, number>;
}

/** One piece of code in a context bundle. */
export interface ContextItem {
  node: GraphNode;
  /** Why it is in the bundle: the target, a caller, a callee, a test, a type. */
  role: string;
  /** Edges from the target, both ways; 0 for the target. */
  distance: number;
  code: string;
  tokens: number;
}

export interface ContextBundle {
  target: GraphNode;
  budget: number;
  tokens: number;
  items: ContextItem[];
  notes: string[];
}

export interface ContextBuilder {
  build(graph: GraphView, target: GraphNode, budget: number, run: IndexRun): Promise<ContextBundle>;
}
