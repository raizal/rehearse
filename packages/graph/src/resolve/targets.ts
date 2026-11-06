// What the resolvers share (G10, G12): the repo node a confirmed declaration is in, the target-only
// node of a declaration outside the repo, and the reference sites an update must resolve again.
// A target-only node gets the same ID as the one name-match makes, so a resolver only raises the trust.

import { posix } from 'node:path';
import type { ResolveInput } from '../extend.js';
import type { Binding, RefSite } from '../readers/reader.js';
import type { StoredRef } from '../store.js';
import { externalMemberSymbol, externalModuleSymbol } from '../symbols.js';
import { splitWords } from '../terms.js';
import type { CodeLanguage, GraphNode } from '../types.js';

/** The repo node of a declaration: the smallest node named `name` in `file` whose range holds `line`. */
export function nodeAt(nodes: GraphNode[], name: string, line: number): GraphNode | undefined {
  let best: GraphNode | undefined;
  let size = Infinity;
  for (const n of nodes) {
    if (n.kind === 'file' || n.name !== name || !n.range) continue;
    const [a, b] = n.range.split('-').map(Number) as [number, number];
    if (line < a || line > b || b - a >= size) continue;
    best = n;
    size = b - a;
  }
  return best;
}

export function externalModule(language: CodeLanguage, pkg: string, modulePath: string): GraphNode {
  return {
    id: externalModuleSymbol(language, pkg, modulePath), kind: 'module', name: modulePath, terms: splitWords(modulePath),
    language, targetOnly: true, rank: 0,
  };
}

export function externalMember(language: CodeLanguage, pkg: string, modulePath: string, member: string): GraphNode {
  const name = `${modulePath}.${member}`;
  return {
    id: externalMemberSymbol(language, pkg, modulePath, member), kind: 'function', name, terms: splitWords(name),
    language, targetOnly: true, rank: 0,
  };
}

/** The package of a module specifier outside the repo, or undefined for a relative one. */
export function packageOf(language: CodeLanguage, spec: string): string | undefined {
  if (spec.startsWith('.')) return undefined;
  if (language === 'python') return spec.split('.')[0];
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * The target-only node of a reference through an import binding, as name-match names it:
 * `lodash.get()` with `import lodash from 'lodash'` → `lodash.get`; `requests.get()` → `requests.get`.
 * Undefined when the reference does not go through a binding of a package.
 */
export function boundTarget(language: CodeLanguage, ref: RefSite, bindings: Binding[]): GraphNode | undefined {
  if (ref.kind === 'imports') {
    const pkg = packageOf(language, ref.name);
    return pkg === undefined ? undefined : externalModule(language, pkg, ref.name);
  }
  const byLocal = new Map(bindings.map((b) => [b.local, b]));
  if (ref.receiver === undefined) {
    const b = byLocal.get(ref.name);
    const pkg = b && packageOf(language, b.module);
    if (!b || pkg === undefined) return undefined;
    return b.imported === '*' || b.imported === 'default'
      ? externalModule(language, pkg, b.module)
      : externalMember(language, pkg, b.module, b.imported);
  }
  const whole = byLocal.get(ref.receiver);
  if (whole) {
    const pkg = packageOf(language, whole.module);
    if (pkg === undefined) return undefined;
    const member = whole.imported === '*' || whole.imported === 'default' ? ref.name : `${whole.imported}.${ref.name}`;
    return externalMember(language, pkg, whole.module, member);
  }
  const [head, ...rest] = ref.receiver.split('.');
  const b = head === undefined ? undefined : byLocal.get(head);
  const pkg = b && packageOf(language, b.module);
  if (!b || pkg === undefined || b.imported !== '*' || rest.length === 0) return undefined;
  return externalMember(language, pkg, b.module, [...rest, ref.name].join('.'));
}

/** The last name of a repo path as a module: `src/orders.ts` → orders, `src/db/index.ts` → db, `api/__init__.py` → api. */
function fileStem(path: string): string {
  const base = posix.basename(path).replace(/\.[^.]+$/, '');
  return base === 'index' || base === '__init__' ? posix.basename(posix.dirname(path)) : base;
}

/** The last name of a module specifier: `./orders.js` → orders, `..db` → db, `api.orders` → orders. */
function specStem(spec: string): string {
  const last = spec.split(/[/.]+/).filter((p) => p !== '' && !/^(js|ts|mjs|cjs|jsx|tsx)$/.test(p)).pop() ?? spec;
  return last;
}

/**
 * The reference sites to resolve: all of them on a cold index. On an update, the sites in the changed
 * files and the sites elsewhere that may point into them (the same name as a node of a changed file,
 * or an import of a module with its name), not every site that no resolver could confirm before.
 */
export function refsToResolve(input: ResolveInput): StoredRef[] {
  if (input.mode === 'cold') return input.refs;
  const changed = new Set(input.changed);
  const names = new Set<string>();
  const stems = new Set<string>();
  for (const p of [...input.changed, ...input.removed]) stems.add(fileStem(p));
  for (const p of input.changed) for (const n of input.graph.nodesInFile(p)) if (n.kind !== 'file') names.add(n.name);
  return input.refs.filter((r) => changed.has(r.file) || (r.kind === 'imports' ? stems.has(specStem(r.name)) : names.has(r.name)));
}

/** Group by a key, keeping the order. */
export function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const t of items) {
    const k = key(t);
    const list = out.get(k);
    if (list) list.push(t);
    else out.set(k, [t]);
  }
  return out;
}
