// The reader adapter of one language (G15, G16). A reader turns one file into nodes, `defines` edges
// and the reference sites (calls, imports, extends, implements) that the resolve step turns into edges.
// Python and TypeScript readers give the same features: file, class, function, method, test and
// route nodes; calls, imports, extends and defines.

import { createRequire } from 'node:module';
import { Language, Parser, type Node } from 'web-tree-sitter';
import { splitWords } from '../terms.js';
import { fileSymbol, memberSymbol, type SymbolPackage } from '../symbols.js';
import type { CodeLanguage, GraphEdge, GraphNode, NodeKind } from '../types.js';

/** One syntactic reference in a file. The resolve step finds its target (name-match or unresolved). */
export interface RefSite {
  /** Symbol ID of the node the reference is in: a function, method, test, route, class or the file. */
  from: string;
  kind: 'calls' | 'imports' | 'extends' | 'implements';
  /** The called or extended name, or the module specifier of an import (`./orders`, `..db`, `lodash`). */
  name: string;
  /** `a` of `a.b()`, `a.b` of `a.b.c()`, `this` or `self`. Missing on a plain call `b()`. */
  receiver?: string;
  /** Symbol ID of the class around the reference, for `this.x()` and `self.x()`. */
  owner?: string;
  line: number;
}

/** A name that an import statement binds in a file. */
export interface Binding {
  local: string;
  /** The module specifier as written. */
  module: string;
  /** `*` for a namespace or a whole module, `default`, or the imported name. */
  imported: string;
}

export interface ReadResult {
  nodes: GraphNode[];
  /** The `defines` edges: file → class, function, test, route; class → method. */
  edges: GraphEdge[];
  refs: RefSite[];
  bindings: Binding[];
}

export interface ReaderAdapter {
  language: CodeLanguage;
  read(path: string, text: string, pkg: SymbolPackage): ReadResult;
}

export interface Grammars {
  typescript: Language;
  tsx: Language;
  python: Language;
}

let grammars: Promise<Grammars> | undefined;

/** Load web-tree-sitter and the WASM grammars once per process. */
export function loadGrammars(): Promise<Grammars> {
  grammars ??= (async () => {
    const require = createRequire(import.meta.url);
    await Parser.init();
    const [typescript, tsx, python] = await Promise.all([
      Language.load(require.resolve('tree-sitter-typescript/tree-sitter-typescript.wasm')),
      Language.load(require.resolve('tree-sitter-typescript/tree-sitter-tsx.wasm')),
      Language.load(require.resolve('tree-sitter-python/tree-sitter-python.wasm')),
    ]);
    return { typescript, tsx, python };
  })();
  return grammars;
}

export function lineRange(node: Node): string {
  return `${node.startPosition.row + 1}-${node.endPosition.row + 1}`;
}

/** Builds the nodes, `defines` edges and refs of one file, with unique symbol IDs. */
export class FileGraph {
  readonly nodes: GraphNode[] = [];
  readonly edges: GraphEdge[] = [];
  readonly refs: RefSite[] = [];
  readonly bindings: Binding[] = [];
  readonly fileId: string;
  private readonly ids = new Set<string>();

  constructor(
    readonly language: CodeLanguage,
    pkg: SymbolPackage,
    readonly path: string,
    lines: number,
  ) {
    this.fileId = fileSymbol(language, pkg, path);
    const name = path.split('/').pop() ?? path;
    this.nodes.push({
      id: this.fileId, kind: 'file', name, terms: splitWords(path), language, file: path,
      range: `1-${Math.max(lines, 1)}`, targetOnly: false, rank: 0,
    });
    this.ids.add(this.fileId);
  }

  /** Add a node below `parent` with a `defines` edge, and return its ID. */
  add(parent: string, kind: NodeKind, name: string, range: string, extra: { route?: string; terms?: string } = {}): string {
    const base = memberSymbol(parent, name, kind === 'class' ? 'type' : 'term');
    let id = base;
    for (let n = 1; this.ids.has(id); n++) id = base.endsWith('().') ? `${base.slice(0, -3)}(+${n}).` : `${base}+${n}`;
    this.ids.add(id);
    const node: GraphNode = {
      id, kind, name, terms: extra.terms ?? splitWords(name), language: this.language, file: this.path, range,
      targetOnly: false, rank: 0,
    };
    if (extra.route !== undefined) node.route = extra.route;
    this.nodes.push(node);
    this.edges.push({ from: parent, to: id, kind: 'defines', trust: 'exact', source: 'tree-sitter' });
    return id;
  }

  result(): ReadResult {
    return { nodes: this.nodes, edges: this.edges, refs: this.refs, bindings: this.bindings };
  }
}

/** The text of a string literal with no interpolation, or undefined. */
export function stringValue(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === 'string') {
    const parts = node.namedChildren.filter((c) => c !== null);
    if (parts.some((c) => c.type === 'interpolation' || c.type === 'escape_sequence')) return undefined;
    return parts.filter((c) => c.type === 'string_fragment' || c.type === 'string_content').map((c) => c.text).join('');
  }
  if (node.type === 'template_string') {
    if (node.namedChildren.some((c) => c?.type === 'template_substitution')) return undefined;
    return node.text.slice(1, -1);
  }
  return undefined;
}
