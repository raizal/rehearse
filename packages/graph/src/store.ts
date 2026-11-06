// The store (G3): .rehearse/graph.db, node:sqlite with an FTS5 index over the node terms.
// It is a cache: a cold index drops every table but `runs` and makes them again.
//
// Each row says where it came from (`origin`), so an update replaces only what changed:
//   file:<path>  nodes and `defines` edges of one source file (reader output)
//   target       target-only nodes (node_modules, the venv, packages outside the repo)
//   ref          edges made from the reference sites; made again from `refs` on every update
//   link:<name>  nodes and edges of one Linker

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Binding, RefSite } from './readers/reader.js';
import type {
  CodeLanguage, EdgeKind, EdgeSource, FileHash, GraphEdge, GraphNode, IndexMode, IndexRun, IndexStatus, IndexTrigger, Language, NodeKind, Trust,
} from './types.js';

export const SCHEMA_VERSION = '2';

const TABLES = `
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY, hash TEXT NOT NULL, language TEXT NOT NULL, indexed_at TEXT NOT NULL, mtime REAL NOT NULL,
  size INTEGER NOT NULL, bindings TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes (
  rid INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, name TEXT NOT NULL, terms TEXT NOT NULL,
  language TEXT NOT NULL, file TEXT, start_line INTEGER, end_line INTEGER, target_only INTEGER NOT NULL,
  rank REAL NOT NULL DEFAULT 0, route TEXT, origin TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS nodes_name ON nodes (name);
CREATE INDEX IF NOT EXISTS nodes_origin ON nodes (origin);
CREATE INDEX IF NOT EXISTS nodes_file ON nodes (file);
CREATE INDEX IF NOT EXISTS nodes_kind ON nodes (kind);
CREATE TABLE IF NOT EXISTS edges (
  from_id TEXT NOT NULL, to_id TEXT NOT NULL, kind TEXT NOT NULL, trust TEXT NOT NULL, source TEXT NOT NULL,
  origin TEXT NOT NULL, PRIMARY KEY (from_id, to_id, kind)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS edges_to ON edges (to_id);
CREATE INDEX IF NOT EXISTS edges_origin ON edges (origin);
CREATE TABLE IF NOT EXISTS refs (
  file TEXT NOT NULL, from_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, receiver TEXT, owner TEXT,
  line INTEGER NOT NULL, resolved_by TEXT, resolved_to TEXT, resolved_trust TEXT
);
CREATE INDEX IF NOT EXISTS refs_file ON refs (file);
CREATE INDEX IF NOT EXISTS refs_from ON refs (from_id);
CREATE INDEX IF NOT EXISTS refs_name ON refs (name);
CREATE INDEX IF NOT EXISTS refs_resolved_to ON refs (resolved_to);
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5 (terms, content = 'nodes', content_rowid = 'rid');
CREATE TRIGGER IF NOT EXISTS nodes_fts_insert AFTER INSERT ON nodes WHEN new.target_only = 0 BEGIN
  INSERT INTO nodes_fts (rowid, terms) VALUES (new.rid, new.terms);
END;
CREATE TRIGGER IF NOT EXISTS nodes_fts_delete AFTER DELETE ON nodes WHEN old.target_only = 0 BEGIN
  INSERT INTO nodes_fts (nodes_fts, rowid, terms) VALUES ('delete', old.rid, old.terms);
END;
`;

const RUNS = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT NOT NULL, trigger TEXT NOT NULL, files INTEGER NOT NULL,
  changed_files INTEGER NOT NULL, resolvers TEXT NOT NULL, venv TEXT, started_at TEXT NOT NULL, ms REAL NOT NULL,
  status TEXT NOT NULL
);
`;

const DROP = `
DROP TRIGGER IF EXISTS nodes_fts_insert; DROP TRIGGER IF EXISTS nodes_fts_delete;
DROP TABLE IF EXISTS nodes_fts; DROP TABLE IF EXISTS nodes; DROP TABLE IF EXISTS edges;
DROP TABLE IF EXISTS refs; DROP TABLE IF EXISTS files;
`;

/** A reference site as stored: the file it is in, and the target a Resolver confirmed, if any. */
export interface StoredRef extends RefSite {
  file: string;
  resolvedBy?: EdgeSource;
  resolvedTo?: string;
  resolvedTrust?: Trust;
}

export interface StoredFile extends FileHash {
  bindings: Binding[];
}

type Row = Record<string, SQLInputValue>;

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000; PRAGMA synchronous = NORMAL;');
    this.db.exec(RUNS);
    const version = this.db.prepare(`SELECT value FROM meta WHERE key = 'schema'`).get() as { value: string } | undefined;
    if (version?.value !== SCHEMA_VERSION) this.reset();
    else this.db.exec(TABLES);
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  /** Drop every graph table and make them again, empty (a cold index; also an old schema). */
  reset(): void {
    this.db.exec(DROP);
    this.db.exec(TABLES);
    this.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)`).run(SCHEMA_VERSION);
    this.db.exec(`DELETE FROM meta WHERE key = 'indexed' OR key LIKE 'link:%' OR key LIKE 'graph:%'`);
  }

  /** The memo of one Linker (LinkState), or undefined. */
  linkState(name: string): unknown {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(`link:${name}`) as { value: string } | undefined;
    return r === undefined ? undefined : JSON.parse(r.value);
  }

  setLinkState(name: string, value: unknown): void {
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(`link:${name}`, JSON.stringify(value));
  }

  /** A memo of the update step itself (`graph:<key>`), cleared by a cold index. */
  memo(key: string): unknown {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(`graph:${key}`) as { value: string } | undefined;
    return r === undefined ? undefined : JSON.parse(r.value);
  }

  setMemo(key: string, value: unknown): void {
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(`graph:${key}`, JSON.stringify(value));
  }

  /** True once an index run has written the graph tables (and no reset since). */
  indexed(): boolean {
    return this.db.prepare(`SELECT 1 FROM meta WHERE key = 'indexed'`).get() !== undefined;
  }

  setIndexed(): void {
    this.db.exec(`INSERT OR REPLACE INTO meta (key, value) VALUES ('indexed', '1')`);
  }

  /** Run `fn` in one write transaction (BEGIN IMMEDIATE), and roll back if it throws. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = await fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // --- files ---

  files(): StoredFile[] {
    return (this.db.prepare('SELECT * FROM files ORDER BY path').all() as Row[]).map((r) => ({
      path: r.path as string,
      hash: r.hash as string,
      language: r.language as CodeLanguage,
      indexedAt: r.indexed_at as string,
      mtimeMs: r.mtime as number,
      size: r.size as number,
      bindings: JSON.parse(r.bindings as string) as Binding[],
    }));
  }

  /** The files without their bindings: what the freshness check compares. */
  fileHashes(): FileHash[] {
    return (this.db.prepare('SELECT path, hash, language, indexed_at, mtime, size FROM files').all() as Row[]).map((r) => ({
      path: r.path as string,
      hash: r.hash as string,
      language: r.language as CodeLanguage,
      indexedAt: r.indexed_at as string,
      mtimeMs: r.mtime as number,
      size: r.size as number,
    }));
  }

  /** A file read again with the same hash: record its new mtime and size, and when it was read. */
  touchFile(path: string, stat: { mtimeMs: number; size: number }, indexedAt: string): void {
    this.db.prepare('UPDATE files SET mtime = ?, size = ?, indexed_at = ? WHERE path = ?').run(stat.mtimeMs, stat.size, indexedAt, path);
  }

  /** Remove one file: its nodes, their `defines` edges, its refs and its hash. */
  deleteFile(path: string): void {
    const origin = `file:${path}`;
    this.db.prepare('DELETE FROM nodes WHERE origin = ?').run(origin);
    this.db.prepare('DELETE FROM edges WHERE origin = ?').run(origin);
    this.db.prepare('DELETE FROM refs WHERE file = ?').run(path);
    this.db.prepare('DELETE FROM files WHERE path = ?').run(path);
  }

  putFile(file: StoredFile, nodes: GraphNode[], edges: GraphEdge[], refs: RefSite[]): void {
    const origin = `file:${file.path}`;
    this.db
      .prepare('INSERT INTO files (path, hash, language, indexed_at, mtime, size, bindings) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(file.path, file.hash, file.language, file.indexedAt, file.mtimeMs, file.size, JSON.stringify(file.bindings));
    this.putNodes(nodes, origin);
    this.putEdges(edges, origin);
    const ref = this.db.prepare('INSERT INTO refs (file, from_id, kind, name, receiver, owner, line) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const r of refs) ref.run(file.path, r.from, r.kind, r.name, r.receiver ?? null, r.owner ?? null, r.line);
  }

  // --- nodes ---

  putNodes(nodes: GraphNode[], origin: string): void {
    const insert = this.db.prepare(
      `INSERT INTO nodes (id, kind, name, terms, language, file, start_line, end_line, target_only, rank, route, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
    );
    for (const n of nodes) {
      const [start, end] = n.range ? n.range.split('-').map(Number) : [null, null];
      insert.run(n.id, n.kind, n.name, n.terms, n.language, n.file ?? null, start ?? null, end ?? null, n.targetOnly ? 1 : 0, n.rank, n.route ?? null, origin);
    }
  }

  deleteNodes(origin: string): void {
    this.db.prepare('DELETE FROM nodes WHERE origin = ?').run(origin);
  }

  node(id: string): GraphNode | undefined {
    const r = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as Row | undefined;
    return r && toNode(r);
  }

  nodesWhere(sql: string, ...params: SQLInputValue[]): GraphNode[] {
    return (this.db.prepare(`SELECT * FROM nodes WHERE ${sql} ORDER BY id`).all(...params) as Row[]).map(toNode);
  }

  /** Every node, without terms, for the resolve step. */
  allNodes(): GraphNode[] {
    return this.nodesWhere('1');
  }

  /** Delete target-only nodes that no edge points to. */
  collectTargets(): void {
    this.db.exec(`DELETE FROM nodes WHERE origin = 'target' AND id NOT IN (SELECT to_id FROM edges)`);
  }

  /** Set the rank of every node (0 for one left out); only the rows whose rank moved are written. */
  setRanks(ranks: Map<string, number>): void {
    const update = this.db.prepare('UPDATE nodes SET rank = ? WHERE rid = ?');
    for (const r of this.db.prepare('SELECT rid, id, rank FROM nodes').all() as Row[]) {
      const rank = ranks.get(r.id as string) ?? 0;
      if (rank !== r.rank) update.run(rank, r.rid as number);
    }
  }

  // --- edges ---

  /** Insert edges; an edge that is already there keeps the better trust mark. */
  putEdges(edges: GraphEdge[], origin: string): void {
    const insert = this.db.prepare(
      `INSERT INTO edges (from_id, to_id, kind, trust, source, origin) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (from_id, to_id, kind) DO UPDATE SET trust = excluded.trust, source = excluded.source, origin = excluded.origin
       WHERE (CASE excluded.trust WHEN 'exact' THEN 0 WHEN 'name-match' THEN 1 ELSE 2 END)
           < (CASE edges.trust WHEN 'exact' THEN 0 WHEN 'name-match' THEN 1 ELSE 2 END)`,
    );
    for (const e of edges) insert.run(e.from, e.to, e.kind, e.trust, e.source, origin);
  }

  deleteEdges(origin: string): void {
    this.db.prepare('DELETE FROM edges WHERE origin = ?').run(origin);
  }

  /** Every edge, in no order: the ranker's input. */
  allEdges(): GraphEdge[] {
    return (this.db.prepare('SELECT * FROM edges').all() as Row[]).map(toEdge);
  }

  edgesWhere(sql: string, ...params: SQLInputValue[]): GraphEdge[] {
    return (this.db.prepare(`SELECT * FROM edges WHERE ${sql} ORDER BY kind, from_id, to_id`).all(...params) as Row[]).map(toEdge);
  }

  // --- refs ---

  refs(sql = '1', ...params: SQLInputValue[]): StoredRef[] {
    return (this.db.prepare(`SELECT * FROM refs WHERE ${sql} ORDER BY file, line, from_id, name`).all(...params) as Row[]).map((r) => {
      const ref: StoredRef = { file: r.file as string, from: r.from_id as string, kind: r.kind as RefSite['kind'], name: r.name as string, line: r.line as number };
      if (r.receiver !== null) ref.receiver = r.receiver as string;
      if (r.owner !== null) ref.owner = r.owner as string;
      if (r.resolved_by !== null) ref.resolvedBy = r.resolved_by as EdgeSource;
      if (r.resolved_to !== null) ref.resolvedTo = r.resolved_to as string;
      if (r.resolved_trust !== null) ref.resolvedTrust = r.resolved_trust as Trust;
      return ref;
    });
  }

  /** The nodes with a site whose `file` (or `name`) is one of `values`. */
  refSources(column: 'file' | 'name', values: string[]): string[] {
    if (values.length === 0) return [];
    return (this.db.prepare(`SELECT DISTINCT from_id FROM refs WHERE ${column} IN (SELECT value FROM json_each(?))`).all(JSON.stringify(values)) as Row[])
      .map((r) => r.from_id as string);
  }

  /** The sites of the nodes `from`. */
  refsFrom(from: string[]): StoredRef[] {
    return from.length === 0 ? [] : this.refs('from_id IN (SELECT value FROM json_each(?))', JSON.stringify(from));
  }

  /** Delete the ref edges that start at one of `from`. */
  deleteRefEdgesFrom(from: string[]): void {
    const del = this.db.prepare(`DELETE FROM edges WHERE from_id = ? AND origin = 'ref'`);
    for (const id of from) del.run(id);
  }

  /** Forget the resolver answers that point to one of `targets` (their nodes changed or are gone); returns the sources of those refs. */
  unresolveRefsTo(targets: string[]): string[] {
    const clear = this.db.prepare(
      'UPDATE refs SET resolved_by = NULL, resolved_to = NULL, resolved_trust = NULL WHERE resolved_to = ? RETURNING from_id',
    );
    return targets.flatMap((t) => (clear.all(t) as Row[]).map((r) => r.from_id as string));
  }

  markResolved(ref: StoredRef, by: EdgeSource, to: string, trust: Trust): void {
    this.db
      .prepare(
        `UPDATE refs SET resolved_by = ?, resolved_to = ?, resolved_trust = ?
         WHERE file = ? AND from_id = ? AND kind = ? AND name = ? AND line = ? AND receiver IS ?`,
      )
      .run(by, to, trust, ref.file, ref.from, ref.kind, ref.name, ref.line, ref.receiver ?? null);
  }

  // --- runs ---

  startRun(run: { mode: IndexMode; trigger: IndexTrigger; files: number; changedFiles: number; venv?: string; startedAt: string }): number {
    const r = this.db
      .prepare(
        `INSERT INTO runs (mode, trigger, files, changed_files, resolvers, venv, started_at, ms, status)
         VALUES (?, ?, ?, ?, '[]', ?, ?, 0, 'running')`,
      )
      .run(run.mode, run.trigger, run.files, run.changedFiles, run.venv ?? null, run.startedAt);
    return Number(r.lastInsertRowid);
  }

  finishRun(id: number, status: Exclude<IndexStatus, 'running'>, ms: number, resolvers: string[]): void {
    this.db.prepare('UPDATE runs SET status = ?, ms = ?, resolvers = ? WHERE id = ?').run(status, ms, JSON.stringify(resolvers), id);
  }

  runs(): IndexRun[] {
    return (this.db.prepare('SELECT * FROM runs ORDER BY id').all() as Row[]).map(toRun);
  }

  lastRun(): IndexRun | undefined {
    const r = this.db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').get() as Row | undefined;
    return r && toRun(r);
  }

  run(id: number): IndexRun | undefined {
    const r = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined;
    return r && toRun(r);
  }

  // --- search ---

  /** BM25 over the node terms (G2). `match` is an FTS5 query. Lower bm25 is better; ties by name, then ID. */
  search(match: string, limit: number): Array<{ node: GraphNode; bm25: number }> {
    const rows = this.db
      .prepare(
        `SELECT n.*, bm25(nodes_fts) AS bm25 FROM nodes_fts JOIN nodes n ON n.rid = nodes_fts.rowid
         WHERE nodes_fts MATCH ? ORDER BY round(bm25(nodes_fts), 6), n.name, n.id LIMIT ?`,
      )
      .all(match, limit) as Row[];
    return rows.map((r) => ({ node: toNode(r), bm25: r.bm25 as number }));
  }
}

function toRun(r: Row): IndexRun {
  const run: IndexRun = {
    id: r.id as number,
    mode: r.mode as IndexMode,
    trigger: r.trigger as IndexTrigger,
    files: r.files as number,
    changedFiles: r.changed_files as number,
    resolvers: JSON.parse(r.resolvers as string) as string[],
    startedAt: r.started_at as string,
    ms: r.ms as number,
    status: r.status as IndexStatus,
  };
  if (r.venv !== null) run.venv = r.venv as string;
  return run;
}

function toNode(r: Row): GraphNode {
  const node: GraphNode = {
    id: r.id as string,
    kind: r.kind as NodeKind,
    name: r.name as string,
    terms: r.terms as string,
    language: r.language as Language,
    targetOnly: r.target_only === 1,
    rank: r.rank as number,
  };
  if (r.file !== null) node.file = r.file as string;
  if (r.start_line !== null) node.range = `${r.start_line as number}-${r.end_line as number}`;
  if (r.route !== null) node.route = r.route as string;
  return node;
}

function toEdge(r: Row): GraphEdge {
  return { from: r.from_id as string, to: r.to_id as string, kind: r.kind as EdgeKind, trust: r.trust as Trust, source: r.source as EdgeSource };
}
