// The name-match step of wave 1 (G10, G15): turn the reference sites that no Resolver confirmed into
// edges. A target found in the repo by its name only gets trust `name-match`. A target in a package
// outside the repo (node_modules, the venv, a third-party module) becomes a target-only node, and
// the edge gets trust `unresolved` (G12, G19). A call to a name that is nowhere (a builtin) makes no edge.

import { posix } from 'node:path';
import type { Binding } from './readers/reader.js';
import type { StoredRef } from './store.js';
import { externalMemberSymbol, externalModuleSymbol } from './symbols.js';
import { splitWords } from './terms.js';
import type { CodeLanguage, GraphEdge, GraphNode, NodeKind } from './types.js';

export interface ResolveContext {
  /** Every indexed file with its language and import bindings. */
  files: Map<string, { language: CodeLanguage; bindings: Binding[] }>;
  /** Every repo node (not target-only). */
  nodes: GraphNode[];
  /** Workspace package name → its entry file (`src/index.ts`), for imports of a package in the repo. */
  workspaces: Map<string, string>;
}

export type ModuleTarget = { file: string } | { pkg: string; modulePath: string } | undefined;

const CALLABLE: ReadonlySet<NodeKind> = new Set(['function', 'class', 'route']);
const CLASSES: ReadonlySet<NodeKind> = new Set(['class']);
const METHODS: ReadonlySet<NodeKind> = new Set(['method']);

/** Name-match edges and the target-only nodes they point to, for refs that no Resolver confirmed. */
export function nameMatch(refs: StoredRef[], ctx: ResolveContext): { edges: GraphEdge[]; targets: GraphNode[] } {
  const r = new NameIndex(ctx);
  const edges = new Map<string, GraphEdge>();
  const targets = new Map<string, GraphNode>();
  const add = (e: GraphEdge) => {
    const key = `${e.from}\u0000${e.to}\u0000${e.kind}`;
    if (!edges.has(key)) edges.set(key, e);
  };
  for (const ref of refs) {
    if (ref.resolvedTo !== undefined) continue;
    const file = ctx.files.get(ref.file);
    if (!file) continue;
    for (const t of r.lookup(ref, file.language)) {
      if ('node' in t) {
        add({ from: ref.from, to: t.node.id, kind: ref.kind, trust: 'name-match', source: 'tree-sitter' });
      } else {
        targets.set(t.target.id, t.target);
        add({ from: ref.from, to: t.target.id, kind: ref.kind, trust: 'unresolved', source: 'tree-sitter' });
      }
    }
  }
  return { edges: [...edges.values()], targets: [...targets.values()] };
}

type Hit = { node: GraphNode } | { target: GraphNode };

class NameIndex {
  private readonly byFile = new Map<string, Map<string, GraphNode[]>>();
  private readonly byName = new Map<string, GraphNode[]>();
  private readonly fileNode = new Map<string, GraphNode>();
  private readonly bindings = new Map<string, Map<string, Binding>>();
  private readonly moduleCache = new Map<string, ModuleTarget>();
  private readonly pyFiles: string[];
  private readonly tsFiles: Set<string>;

  constructor(private readonly ctx: ResolveContext) {
    for (const n of ctx.nodes) {
      if (n.targetOnly || !n.file) continue;
      if (n.kind === 'file') {
        this.fileNode.set(n.file, n);
        continue;
      }
      push(this.byName, `${n.language}:${n.name}`, n);
      let names = this.byFile.get(n.file);
      if (!names) this.byFile.set(n.file, (names = new Map()));
      push(names, n.name, n);
    }
    for (const [path, f] of ctx.files) this.bindings.set(path, new Map(f.bindings.map((b) => [b.local, b])));
    this.pyFiles = [...ctx.files].filter(([, f]) => f.language === 'python').map(([p]) => p).sort();
    this.tsFiles = new Set([...ctx.files].filter(([, f]) => f.language === 'typescript').map(([p]) => p));
  }

  lookup(ref: StoredRef, language: CodeLanguage): Hit[] {
    if (ref.kind === 'imports') {
      const m = this.module(ref.file, ref.name, language);
      if (!m) return [];
      if ('file' in m) {
        const node = this.fileNode.get(m.file);
        return node ? [{ node }] : [];
      }
      return [{ target: this.externalModule(language, m.pkg, m.modulePath) }];
    }
    const kinds = ref.kind === 'calls' ? CALLABLE : CLASSES;
    const bindings = this.bindings.get(ref.file) ?? new Map<string, Binding>();
    if (ref.receiver === undefined) {
      const b = bindings.get(ref.name);
      if (b) return this.fromBinding(ref.file, language, b, undefined, kinds);
      const local = this.inFile(ref.file, ref.name, kinds);
      if (local.length > 0) return local;
      return this.global(language, ref.name, kinds);
    }
    if (ref.receiver === 'this' || ref.receiver === 'self') {
      const own = ref.owner ? this.inFile(ref.file, ref.name, METHODS).filter((h) => h.node.id.startsWith(ref.owner!)) : [];
      return own.length > 0 ? own : this.global(language, ref.name, METHODS);
    }
    const whole = bindings.get(ref.receiver);
    if (whole) return this.fromBinding(ref.file, language, whole, ref.name, kinds);
    // `os.path.join()` with `import os`: a member path below a module binding.
    const [head, ...rest] = ref.receiver.split('.');
    const b = head === undefined ? undefined : bindings.get(head);
    if (b && b.imported === '*' && rest.length > 0) {
      const m = this.module(ref.file, b.module, language);
      if (m && !('file' in m)) return [{ target: this.externalMember(language, m.pkg, m.modulePath, [...rest, ref.name].join('.')) }];
    }
    return ref.kind === 'calls' ? this.global(language, ref.name, METHODS) : [];
  }

  /** The target of a call through an imported name: `b()` (member undefined) or `b.member()`. */
  private fromBinding(file: string, language: CodeLanguage, b: Binding, member: string | undefined, kinds: ReadonlySet<NodeKind>): Hit[] {
    let m = this.module(file, b.module, language);
    let imported = b.imported;
    // Python `from pkg import orders`: `orders` may be a module of the repo.
    if (language === 'python' && imported !== '*') {
      const sub = this.module(file, b.module.endsWith('.') ? `${b.module}${imported}` : `${b.module}.${imported}`, language);
      if (sub && 'file' in sub) {
        m = sub;
        imported = '*';
      }
    }
    if (!m) return [];
    if ('file' in m) {
      if (imported === '*') return member === undefined ? [] : this.or(this.inFile(m.file, member, kinds), () => this.global(language, member, kinds));
      const name = imported === 'default' ? (member === undefined ? b.local : member) : imported;
      if (member !== undefined && imported !== 'default') {
        // `Imported.member()`: a static method of an imported class.
        const cls = this.inFile(m.file, name, CLASSES)[0];
        const methods = cls ? this.inFile(m.file, member, METHODS).filter((h) => h.node.id.startsWith(cls.node.id)) : [];
        return this.or(methods, () => this.global(language, member, METHODS));
      }
      return this.or(this.inFile(m.file, name, kinds), () => this.global(language, name, kinds));
    }
    if (imported === '*') {
      return [{ target: member === undefined ? this.externalModule(language, m.pkg, m.modulePath) : this.externalMember(language, m.pkg, m.modulePath, member) }];
    }
    if (imported === 'default') {
      return [{ target: member === undefined ? this.externalModule(language, m.pkg, m.modulePath) : this.externalMember(language, m.pkg, m.modulePath, member) }];
    }
    return [{ target: this.externalMember(language, m.pkg, m.modulePath, member === undefined ? imported : `${imported}.${member}`) }];
  }

  private or(first: Hit[], second: () => Hit[]): Hit[] {
    return first.length > 0 ? first : second();
  }

  private inFile(file: string, name: string, kinds: ReadonlySet<NodeKind>): Array<{ node: GraphNode }> {
    return (this.byFile.get(file)?.get(name) ?? []).filter((n) => kinds.has(n.kind)).map((node) => ({ node }));
  }

  private global(language: CodeLanguage, name: string, kinds: ReadonlySet<NodeKind>): Array<{ node: GraphNode }> {
    return (this.byName.get(`${language}:${name}`) ?? []).filter((n) => kinds.has(n.kind)).map((node) => ({ node }));
  }

  private externalModule(language: CodeLanguage, pkg: string, modulePath: string): GraphNode {
    return {
      id: externalModuleSymbol(language, pkg, modulePath), kind: 'module', name: modulePath, terms: splitWords(modulePath),
      language, targetOnly: true, rank: 0,
    };
  }

  private externalMember(language: CodeLanguage, pkg: string, modulePath: string, member: string): GraphNode {
    const name = `${modulePath}.${member}`;
    return {
      id: externalMemberSymbol(language, pkg, modulePath, member), kind: 'function', name, terms: splitWords(name),
      language, targetOnly: true, rank: 0,
    };
  }

  /** The repo file of a module specifier, or the package outside the repo, or undefined (not found). */
  module(from: string, spec: string, language: CodeLanguage): ModuleTarget {
    const key = `${language}:${posix.dirname(from)}:${spec}`;
    if (this.moduleCache.has(key)) return this.moduleCache.get(key);
    const m = language === 'typescript' ? this.tsModule(from, spec) : this.pyModule(from, spec);
    this.moduleCache.set(key, m);
    return m;
  }

  private tsModule(from: string, spec: string): ModuleTarget {
    if (spec.startsWith('.')) {
      const base = posix.normalize(posix.join(posix.dirname(from), spec));
      const candidates = [
        base, base.replace(/\.js$/, '.ts'), base.replace(/\.jsx$/, '.tsx'), base.replace(/\.js$/, '.tsx'),
        base.replace(/\.mjs$/, '.mts'), base.replace(/\.cjs$/, '.cts'),
        `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`,
      ];
      const file = candidates.find((c) => this.tsFiles.has(c));
      return file ? { file } : undefined;
    }
    for (const [name, entry] of this.ctx.workspaces) {
      if (spec === name && this.tsFiles.has(entry)) return { file: entry };
    }
    const parts = spec.split('/');
    const pkg = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
    return { pkg, modulePath: spec };
  }

  private pyModule(from: string, spec: string): ModuleTarget {
    const dots = /^\.*/.exec(spec)![0].length;
    const parts = spec.slice(dots).split('.').filter((p) => p !== '');
    const files = new Set(this.pyFiles);
    const at = (base: string) => {
      const p = posix.join(base, ...parts);
      return [`${p}.py`, `${p}/__init__.py`].map((c) => posix.normalize(c)).find((c) => files.has(c));
    };
    if (dots > 0) {
      let base = posix.dirname(from);
      for (let i = 1; i < dots; i++) base = posix.dirname(base);
      const file = parts.length === 0 ? [posix.join(base, '__init__.py')].find((c) => files.has(c)) : at(base);
      return file ? { file } : undefined;
    }
    const direct = at('.');
    if (direct) return { file: direct };
    // A source root below the repo root (for example `api/` on sys.path): the shortest path that ends with the module.
    const tail = parts.join('/');
    const below = this.pyFiles
      .filter((f) => f.endsWith(`/${tail}.py`) || f.endsWith(`/${tail}/__init__.py`))
      .sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0];
    if (below) return { file: below };
    return { pkg: parts[0]!, modulePath: parts.join('.') };
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
