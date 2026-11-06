// Box `update-graph` (G4, G5, G13): before each query, hash the files in scope and read again only the
// changed ones. A missing or empty store, a new schema, or `--rebuild` makes a cold index. The whole
// update is one write transaction, so a query never sees half a graph.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { GraphView, Linker, LinkState, Ranker, Resolver } from './extend.js';
import { loadGrammars, type ReaderAdapter } from './readers/reader.js';
import { pythonReader } from './readers/python.js';
import { typescriptReader } from './readers/typescript.js';
import { nameMatch } from './resolve.js';
import { findScope, packageFinder, readJsonc, type Scope } from './scope.js';
import type { Store } from './store.js';
import type { CodeLanguage, EdgeKind, GraphEdge, IndexMode, IndexRun, IndexTrigger } from './types.js';

export interface UpdateOptions {
  /** Force a cold index (`--rebuild`, G5). */
  rebuild?: boolean;
  trigger?: IndexTrigger;
  resolvers?: Resolver[];
  linkers?: Linker[];
  ranker?: Ranker;
}

/** Bring the store up to date with the files under `root`, and return the run it recorded. */
export async function updateGraph(root: string, store: Store, opts: UpdateOptions = {}): Promise<IndexRun> {
  const t0 = performance.now();
  const startedAt = new Date().toISOString();
  const scope = findScope(root);
  const texts = new Map<string, string>();
  const hashes = new Map<string, string>();
  for (const f of scope.files) {
    let text: string;
    try {
      text = readFileSync(join(root, f.path), 'utf8');
    } catch {
      continue; // gone between the walk and the read
    }
    texts.set(f.path, text);
    hashes.set(f.path, createHash('sha256').update(text).digest('hex'));
  }
  const files = scope.files.filter((f) => hashes.has(f.path));

  const id = await store.transaction(async () => {
    const stored = new Map(store.files().map((f) => [f.path, f.hash]));
    const cold = opts.rebuild === true || !store.indexed();
    const changed = cold ? files : files.filter((f) => stored.get(f.path) !== hashes.get(f.path));
    const removed = cold ? [] : [...stored.keys()].filter((p) => !hashes.has(p));
    let mode: IndexMode = cold ? 'cold' : changed.length + removed.length > 0 ? 'update' : 'none';
    // No source file changed, but a linker's input did (a new commit, a record file): update anyway.
    if (mode === 'none' && (await linkersStale(root, store, opts.linkers ?? []))) mode = 'update';
    const runId = store.startRun({
      mode, trigger: opts.trigger ?? 'query', files: files.length, changedFiles: changed.length, startedAt,
      ...(scope.venv !== undefined ? { venv: scope.venv } : {}),
    });
    if (mode === 'none') {
      store.finishRun(runId, 'unchanged', performance.now() - t0, []);
      return runId;
    }

    if (cold) {
      store.reset();
    } else {
      for (const path of [...changed.map((f) => f.path), ...removed]) {
        const old = store.nodesWhere('origin = ?', `file:${path}`).map((n) => n.id);
        store.deleteFile(path);
        store.unresolveRefsTo(old);
      }
    }

    const grammars = await loadGrammars();
    const readers: Record<CodeLanguage, ReaderAdapter> = { typescript: typescriptReader(grammars), python: pythonReader(grammars) };
    const pkgOf = packageFinder(root);
    const indexedAt = new Date().toISOString();
    for (const f of changed) {
      const read = readers[f.language].read(f.path, texts.get(f.path)!, pkgOf(f.path, f.language));
      store.putFile({ path: f.path, hash: hashes.get(f.path)!, language: f.language, indexedAt, bindings: read.bindings }, read.nodes, read.edges, read.refs);
    }

    const changedPaths = changed.map((f) => f.path);
    const view = storeView(store);
    const used = ['tree-sitter'];
    for (const resolver of opts.resolvers ?? []) {
      const langFiles = new Set(store.files().filter((f) => f.language === resolver.language).map((f) => f.path));
      const refs = store.refs('resolved_to IS NULL').filter((r) => langFiles.has(r.file));
      const answers = await resolver.resolve({ root, mode, scope, changed: changedPaths, removed, refs, graph: view });
      for (const a of answers) {
        if (a.target.targetOnly) store.putNodes([a.target], 'target');
        store.markResolved({ ...a.ref }, resolver.name, a.target.id, a.trust);
      }
      used.push(resolver.name);
    }

    linkRefs(root, store, scope);

    for (const linker of opts.linkers ?? []) {
      const out = await linker.link({ root, mode, changed: changedPaths, removed, graph: view, state: linkState(store, linker.name) });
      if (out === 'keep') continue;
      store.deleteEdges(`link:${linker.name}`);
      store.deleteNodes(`link:${linker.name}`);
      store.putNodes(out.nodes, `link:${linker.name}`);
      store.putEdges(out.edges, `link:${linker.name}`);
    }
    if (opts.ranker) {
      store.setRanks(opts.ranker.rank({ nodes: store.allNodes(), edges: store.edgesWhere('1') }));
    }
    store.setIndexed();
    store.finishRun(runId, 'written', performance.now() - t0, used);
    return runId;
  });
  return store.runs().find((r) => r.id === id)!;
}

async function linkersStale(root: string, store: Store, linkers: Linker[]): Promise<boolean> {
  for (const linker of linkers) {
    if (linker.stale && (await linker.stale({ root, state: linkState(store, linker.name) }))) return true;
  }
  return false;
}

function linkState(store: Store, name: string): LinkState {
  return { get: <T>() => store.linkState(name) as T | undefined, set: (value) => store.setLinkState(name, value) };
}

/** Make the edges of every reference site again: the resolver answers, then name-match for the rest. */
function linkRefs(root: string, store: Store, scope: Scope): void {
  store.deleteEdges('ref');
  const refs = store.refs();
  const edges: GraphEdge[] = [];
  for (const r of refs) {
    if (r.resolvedTo !== undefined && r.resolvedBy !== undefined && r.resolvedTrust !== undefined) {
      edges.push({ from: r.from, to: r.resolvedTo, kind: r.kind, trust: r.resolvedTrust, source: r.resolvedBy });
    }
  }
  const stored = store.files();
  const nodes = store.nodesWhere('target_only = 0');
  const matched = nameMatch(refs, {
    files: new Map(stored.map((f) => [f.path, { language: f.language, bindings: f.bindings }])),
    nodes,
    workspaces: workspaces(root, scope),
  });
  store.putNodes(matched.targets, 'target');
  // Resolver edges first: an edge already there keeps the better trust.
  store.putEdges(edges, 'ref');
  store.putEdges(matched.edges, 'ref');
  store.collectTargets();
}

/** The TypeScript packages of the repo (package.json name) and their entry file, for `import '@scope/pkg'`. */
function workspaces(root: string, scope: Scope): Map<string, string> {
  const tsFiles = new Set(scope.files.filter((f) => f.language === 'typescript').map((f) => f.path));
  const dirs = new Set<string>();
  for (const f of tsFiles) {
    for (let d = posix.dirname(f); ; d = posix.dirname(d)) {
      dirs.add(d);
      if (d === '.') break;
    }
  }
  const out = new Map<string, string>();
  for (const dir of [...dirs].sort()) {
    const json = readJsonc(join(root, dir, 'package.json'));
    if (typeof json !== 'object' || json === null || typeof (json as { name?: unknown }).name !== 'string') continue;
    const name = (json as { name: string }).name;
    const entry = ['src/index.ts', 'src/index.tsx', 'index.ts', 'index.tsx']
      .map((e) => posix.normalize(posix.join(dir, e)))
      .find((e) => tsFiles.has(e));
    if (entry && !out.has(name)) out.set(name, entry);
  }
  return out;
}

/** The graph as the store holds it now, for resolvers and linkers. */
export function storeView(store: Store): GraphView {
  return {
    node: (id) => store.node(id),
    nodesInFile: (path) => store.nodesWhere('file = ?', path),
    nodesNamed: (name) => store.nodesWhere('name = ?', name),
    nodesOfKind: (kind) => store.nodesWhere('kind = ?', kind),
    edges: (filter: { from?: string; to?: string; kind?: EdgeKind }) => {
      const where: string[] = [];
      const params: string[] = [];
      if (filter.from !== undefined) (where.push('from_id = ?'), params.push(filter.from));
      if (filter.to !== undefined) (where.push('to_id = ?'), params.push(filter.to));
      if (filter.kind !== undefined) (where.push('kind = ?'), params.push(filter.kind));
      return store.edgesWhere(where.length > 0 ? where.join(' AND ') : '1', ...params);
    },
  };
}

