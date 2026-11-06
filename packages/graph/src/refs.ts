// Box `update-graph`, the ref edges (G10, G13): the `calls`, `imports`, `extends` and `implements` edges
// made from the reference sites, the resolver answers first, then name-match for the rest.
//
// A cold index makes every ref edge. An update makes again only the edges of the nodes whose sites
// may now point elsewhere (S10): the nodes of the changed files, the nodes with a site named like a
// node of a changed file (before or after), the nodes whose site goes through an import of such a
// name, and the nodes whose resolver answer changed. A changed file only changes names: the files in
// scope, and so where each import goes, are the same. When files come or go, or a workspace package
// changes, every ref edge is made again.

import { join, posix } from 'node:path';
import { nameMatch } from './resolve.js';
import { readJsonc, type Scope } from './scope.js';
import type { Store } from './store.js';
import type { GraphEdge } from './types.js';

/** What an update changed, for the ref edges. */
export interface RefChanges {
  /** Paths read again in this run. */
  changed: string[];
  /** True when the files in scope are not the same as before (one is new or gone). */
  filesMoved: boolean;
  /** The names of the nodes of the changed files, before and after. */
  names: Set<string>;
  /** The nodes the update deleted (the old nodes of the changed files). */
  gone: string[];
  /** The nodes with a site whose resolver answer was dropped or made in this run. */
  resolved: Set<string>;
}

/** Make the ref edges: all of them (cold, or `changes` undefined), or only those `changes` may touch. */
export function linkRefs(root: string, store: Store, scope: Scope, changes?: RefChanges): void {
  const ws = [...workspaces(root, scope)];
  const sameWorkspaces = JSON.stringify(store.memo('workspaces')) === JSON.stringify(ws);
  store.setMemo('workspaces', ws);
  const stored = store.files();
  let refs;
  if (changes === undefined || changes.filesMoved || !sameWorkspaces) {
    store.deleteEdges('ref');
    refs = store.refs();
  } else {
    const from = [...affectedSources(store, stored, changes)];
    store.deleteRefEdgesFrom(from);
    refs = store.refsFrom(from);
  }
  const edges: GraphEdge[] = [];
  for (const r of refs) {
    if (r.resolvedTo !== undefined && r.resolvedBy !== undefined && r.resolvedTrust !== undefined) {
      edges.push({ from: r.from, to: r.resolvedTo, kind: r.kind, trust: r.resolvedTrust, source: r.resolvedBy });
    }
  }
  const matched = nameMatch(refs, {
    files: new Map(stored.map((f) => [f.path, { language: f.language, bindings: f.bindings }])),
    nodes: store.nodesWhere('target_only = 0'),
    workspaces: new Map(ws),
  });
  store.putNodes(matched.targets, 'target');
  // Resolver edges first: an edge already there keeps the better trust.
  store.putEdges(edges, 'ref');
  store.putEdges(matched.edges, 'ref');
  store.collectTargets();
}

/** The nodes whose ref edges an update makes again (see the top of the file). */
function affectedSources(store: Store, files: ReturnType<Store['files']>, c: RefChanges): Set<string> {
  const out = new Set<string>([...c.gone, ...c.resolved]);
  for (const from of store.refSources('file', c.changed)) out.add(from);
  for (const from of store.refSources('name', [...c.names])) out.add(from);
  // `import { getX as load } from './x'`, then `load()` or `load.y()`: the site is named `load`.
  for (const f of files) {
    const locals = new Set(f.bindings.filter((b) => b.imported !== b.local && c.names.has(b.imported)).map((b) => b.local));
    if (locals.size === 0) continue;
    for (const r of store.refs('file = ?', f.path)) {
      if (locals.has(r.name) || (r.receiver !== undefined && locals.has(r.receiver.split('.')[0]!))) out.add(r.from);
    }
  }
  return out;
}

/** The TypeScript packages of the repo (package.json name) and their entry file, for `import '@scope/pkg'`. */
export function workspaces(root: string, scope: Scope): Map<string, string> {
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
