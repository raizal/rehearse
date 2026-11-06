// The Python reader (G15, G16): files, classes, top-level functions, methods, pytest tests
// (`test_*` functions, and `test_*` methods of `Test*` classes), FastAPI routes (a function with a
// `@<router>.get("/path")` decorator, with the `prefix=` of its `APIRouter(...)` in the same file, G17);
// calls, imports, and base classes as extends.

import { Parser, type Node } from 'web-tree-sitter';
import { splitWords } from '../terms.js';
import type { SymbolPackage } from '../symbols.js';
import { FileGraph, lineRange, stringValue, type Grammars, type ReaderAdapter, type ReadResult } from './reader.js';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace', 'api_route', 'websocket']);
const ROUTERS = new Set(['APIRouter', 'FastAPI']);

interface Ctx {
  owner: string;
  cls?: string;
  /** The name of the class around this place, for pytest `Test*` classes. */
  clsName?: string;
  top: boolean;
}

export function pythonReader(grammars: Grammars): ReaderAdapter {
  const parser = new Parser();
  parser.setLanguage(grammars.python);
  return {
    language: 'python',
    read(path: string, text: string, pkg: SymbolPackage): ReadResult {
      const tree = parser.parse(text);
      const g = new FileGraph('python', pkg, path, text.split('\n').length);
      if (tree) {
        try {
          const prefixes = routerPrefixes(tree.rootNode);
          visit(tree.rootNode, { owner: g.fileId, top: true }, g, prefixes);
        } finally {
          tree.delete();
        }
      }
      return g.result();
    },
  };
}

function visit(node: Node, ctx: Ctx, g: FileGraph, prefixes: Map<string, string>): void {
  switch (node.type) {
    case 'import_statement': {
      for (const c of node.namedChildren) {
        const dotted = c.type === 'aliased_import' ? c.childForFieldName('name') : c;
        if (!dotted || dotted.type !== 'dotted_name') continue;
        const alias = c.type === 'aliased_import' ? c.childForFieldName('alias')?.text : undefined;
        g.refs.push({ from: g.fileId, kind: 'imports', name: dotted.text, line: node.startPosition.row + 1 });
        g.bindings.push({ local: alias ?? dotted.text, module: dotted.text, imported: '*' });
      }
      return;
    }
    case 'import_from_statement': {
      const mod = node.childForFieldName('module_name');
      if (!mod) return;
      const spec = mod.text.replace(/\s+/g, '');
      g.refs.push({ from: g.fileId, kind: 'imports', name: spec, line: node.startPosition.row + 1 });
      for (const c of node.childrenForFieldName('name')) {
        const name = c.type === 'aliased_import' ? c.childForFieldName('name')?.text : c.text;
        const alias = c.type === 'aliased_import' ? c.childForFieldName('alias')?.text : undefined;
        if (name !== undefined) g.bindings.push({ local: alias ?? name, module: spec, imported: name });
      }
      return;
    }
    case 'decorated_definition': {
      const def = node.childForFieldName('definition');
      if (def) definition(def, node, ctx, g, prefixes);
      return;
    }
    case 'class_definition':
    case 'function_definition':
      definition(node, node, ctx, g, prefixes);
      return;
    case 'call': {
      const fn = node.childForFieldName('function');
      const ref = fn && splitTarget(fn);
      if (ref) {
        g.refs.push({ from: ctx.owner, kind: 'calls', ...ref, ...(ctx.cls ? { owner: ctx.cls } : {}), line: node.startPosition.row + 1 });
      }
      break;
    }
  }
  for (const child of node.namedChildren) visit(child, ctx, g, prefixes);
}

/** A class or function; `outer` is the decorated_definition around it, if any (its range has the decorators). */
function definition(def: Node, outer: Node, ctx: Ctx, g: FileGraph, prefixes: Map<string, string>): void {
  const name = def.childForFieldName('name')?.text;
  const decorators = outer === def ? [] : outer.namedChildren.filter((c) => c.type === 'decorator');
  // Decorator calls are calls of the place around the definition.
  for (const d of decorators) visit(d, ctx, g, prefixes);
  if (name === undefined) return;
  const range = lineRange(outer);
  if (def.type === 'class_definition') {
    if (!ctx.top) {
      visitBody(def, ctx, g, prefixes); // a class in a function belongs to the function
      return;
    }
    const id = g.add(g.fileId, 'class', name, range);
    const bases = def.childForFieldName('superclasses');
    for (const b of bases?.namedChildren ?? []) {
      const ref = splitTarget(b);
      if (ref) g.refs.push({ from: id, kind: 'extends', ...ref, line: b.startPosition.row + 1 });
    }
    visitBody(def, { owner: id, cls: id, clsName: name, top: false }, g, prefixes);
    return;
  }
  // function_definition
  if (ctx.top) {
    const route = routeOf(decorators, prefixes);
    const kind = route ? 'route' : name.startsWith('test') ? 'test' : 'function';
    const id = route
      ? g.add(g.fileId, 'route', name, range, { route, terms: `${splitWords(name)} ${splitWords(route)}` })
      : g.add(g.fileId, kind, name, range);
    visitBody(def, { owner: id, top: false }, g, prefixes);
  } else if (ctx.cls && ctx.owner === ctx.cls) {
    const isTest = name.startsWith('test') && (ctx.clsName ?? '').startsWith('Test');
    const id = g.add(ctx.cls, isTest ? 'test' : 'method', name, range);
    visitBody(def, { ...ctx, owner: id }, g, prefixes);
  } else {
    visitBody(def, ctx, g, prefixes); // a nested function belongs to the function around it
  }
}

function visitBody(def: Node, ctx: Ctx, g: FileGraph, prefixes: Map<string, string>): void {
  for (const field of ['parameters', 'body']) {
    const part = def.childForFieldName(field);
    if (part) visit(part, ctx, g, prefixes);
  }
}

/** `router = APIRouter(prefix="/api/orders")` at the top level: router → /api/orders. */
function routerPrefixes(root: Node): Map<string, string> {
  const out = new Map<string, string>();
  for (const stmt of root.namedChildren) {
    const assign = stmt.type === 'expression_statement' ? stmt.namedChildren[0] : undefined;
    if (assign?.type !== 'assignment') continue;
    const left = assign.childForFieldName('left');
    const right = assign.childForFieldName('right');
    if (left?.type !== 'identifier' || right?.type !== 'call') continue;
    const callee = right.childForFieldName('function');
    const calleeName = callee?.type === 'attribute' ? callee.childForFieldName('attribute')?.text : callee?.text;
    if (!calleeName || !ROUTERS.has(calleeName)) continue;
    out.set(left.text, keywordString(right, 'prefix') ?? '');
  }
  return out;
}

/** `GET /api/orders/{order_id}` from `@router.get("/{order_id}")`, or undefined. */
function routeOf(decorators: Node[], prefixes: Map<string, string>): string | undefined {
  for (const d of decorators) {
    const call = d.namedChildren[0];
    if (call?.type !== 'call') continue;
    const fn = call.childForFieldName('function');
    if (fn?.type !== 'attribute') continue;
    const method = fn.childForFieldName('attribute')?.text ?? '';
    const router = fn.childForFieldName('object')?.text ?? '';
    if (!HTTP_METHODS.has(method)) continue;
    const args = call.childForFieldName('arguments')?.namedChildren ?? [];
    const path = stringValue(args[0]) ?? keywordString(call, 'path');
    if (path === undefined) continue;
    let verb = method.toUpperCase();
    if (method === 'api_route') {
      const methods = args.find((a) => a.type === 'keyword_argument' && a.childForFieldName('name')?.text === 'methods');
      const first = methods?.childForFieldName('value')?.namedChildren[0];
      verb = (stringValue(first) ?? 'ANY').toUpperCase();
    }
    if (method === 'websocket') verb = 'WS';
    return `${verb} ${prefixes.get(router) ?? ''}${path}`;
  }
  return undefined;
}

function keywordString(call: Node, key: string): string | undefined {
  for (const a of call.childForFieldName('arguments')?.namedChildren ?? []) {
    if (a.type === 'keyword_argument' && a.childForFieldName('name')?.text === key) return stringValue(a.childForFieldName('value'));
  }
  return undefined;
}

/** `f` → { name: f }; `a.f` → { receiver: a, name: f }; `self.f`; `a.b.f` → { receiver: a.b, name: f }. */
function splitTarget(node: Node): { name: string; receiver?: string } | undefined {
  if (node.type === 'identifier') return { name: node.text };
  if (node.type === 'attribute') {
    const attr = node.childForFieldName('attribute');
    const obj = node.childForFieldName('object');
    if (!attr || !obj) return undefined;
    const receiver = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(obj.text) ? obj.text : '?';
    return { name: attr.text, receiver };
  }
  return undefined;
}
