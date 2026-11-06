// The graph entities of the code-graph EPIC (entities.yaml): GraphNode, GraphEdge, FileHash,
// IndexRun, GraphQuery, QueryAnswer. The store keeps them in .rehearse/graph.db (G3).

import type { ContextBundle } from './extend.js';

export const NODE_KINDS = [
  'file', 'module', 'class', 'function', 'method', 'route', 'test',
  'requirement', 'story', 'box', 'scenario', 'commit',
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const EDGE_KINDS = [
  'defines', 'imports', 'calls', 'references', 'extends', 'implements', 'tests', 'builds', 'changes', 'http-calls',
] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

/** exact: a resolver confirmed it. name-match: the same name only. unresolved: the target is not known (G10). */
export const TRUSTS = ['exact', 'name-match', 'unresolved'] as const;
export type Trust = (typeof TRUSTS)[number];

export type EdgeSource = 'tree-sitter' | 'ts-morph' | 'scip-python' | 'basedpyright' | 'openapi' | 'git' | 'record';
export type Language = 'typescript' | 'python' | 'record' | 'git';
/** The languages that have a reader (G16). */
export type CodeLanguage = 'typescript' | 'python';

export interface GraphNode {
  /** SCIP-style symbol ID (G10), e.g. `scip-typescript npm app 1.0 src/orders.ts/getOrderById().` */
  id: string;
  kind: NodeKind;
  name: string;
  /** The name split into words for FTS5: getOrderById → get order by id (G2). */
  terms: string;
  language: Language;
  /** Repo path, `/`-separated. Missing on a target-only node. */
  file?: string;
  /** First and last line, 1-based, as `12-20`. */
  range?: string;
  /** A symbol in node_modules or a package outside the repo: an edge target only (G12). */
  targetOnly: boolean;
  /** PageRank (G14). 0 until a Ranker runs. */
  rank: number;
  /** A route node only: method and full path, e.g. `GET /api/orders/{order_id}` (G17). */
  route?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  trust: Trust;
  source: EdgeSource;
}

export interface FileHash {
  path: string;
  hash: string;
  language: CodeLanguage;
  indexedAt: string;
}

export type IndexMode = 'cold' | 'update' | 'none';
export type IndexTrigger = 'query' | 'watch' | 'bench';
export type IndexStatus = 'running' | 'written' | 'unchanged';

export interface IndexRun {
  id: number;
  mode: IndexMode;
  trigger: IndexTrigger;
  /** Files in scope. */
  files: number;
  /** Files read again: every file on a cold index, the changed ones on an update. */
  changedFiles: number;
  /** The readers and resolvers that ran, e.g. [tree-sitter]. */
  resolvers: string[];
  /** The Python environment found, or missing (G19). */
  venv?: string;
  startedAt: string;
  ms: number;
  status: IndexStatus;
}

export type Verb = 'find' | 'show' | 'near' | 'path' | 'context';

/** One question to the graph (G1, G8). */
export interface GraphQuery {
  verb: Verb;
  /** Words for find; a node ID, name or file path for the others. */
  target: string;
  /** The second node, for path. */
  to?: string;
  /** Tokens, for context (G6). */
  budget?: number;
  /** Edges to follow from the target, for near; default 1 (G26). */
  depth?: number;
  /** Make a cold index before the answer (G29). */
  rebuild?: boolean;
  json: boolean;
  from: 'cli' | 'panel';
}

/** A node in an answer. `code` on the shown node, `score` on a find hit, `distance` on a near node. */
export interface AnswerNode extends GraphNode {
  code?: string;
  score?: number;
  distance?: number;
}

/** An edge in an answer, with the names of its two ends for reading. */
export interface AnswerEdge extends GraphEdge {
  fromName: string;
  toName: string;
}

export interface QueryAnswer {
  verb: Verb;
  ok: boolean;
  /** 0, or 1 for "not found" and "no path" (G27, G28). */
  exitCode: number;
  nodes: AnswerNode[];
  edges: AnswerEdge[];
  /** The `context` verb only (G6). */
  bundle?: ContextBundle;
  notes: string[];
}
