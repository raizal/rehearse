// The TypeScript reader (G15, G16): files, classes, top-level functions (declared, or an arrow or
// function expression in a top-level const), methods, Vitest tests (`it` / `test`, named with their
// `describe` titles); calls, `new`, imports, re-exports, extends and implements.

import { Parser, type Node } from 'web-tree-sitter';
import type { SymbolPackage } from '../symbols.js';
import { FileGraph, lineRange, stringValue, type Grammars, type ReaderAdapter, type ReadResult } from './reader.js';

const FUNCTION_VALUES = new Set(['arrow_function', 'function_expression', 'function', 'generator_function']);
const TEST_CALLS = new Set(['it', 'test']);
const SUITE_CALLS = new Set(['describe', 'suite']);

interface Ctx {
  /** The node that a call here belongs to. */
  owner: string;
  /** The class around this place, for `this.x()`. */
  cls?: string;
  /** True at the top level of the file (outside any function, class or test). */
  top: boolean;
  /** The titles of the `describe` blocks around this place. */
  suites: string[];
}

export function typescriptReader(grammars: Grammars): ReaderAdapter {
  const ts = new Parser();
  ts.setLanguage(grammars.typescript);
  const tsx = new Parser();
  tsx.setLanguage(grammars.tsx);
  return {
    language: 'typescript',
    read(path: string, text: string, pkg: SymbolPackage): ReadResult {
      const tree = (path.endsWith('.tsx') ? tsx : ts).parse(text);
      const g = new FileGraph('typescript', pkg, path, text.split('\n').length);
      if (tree) {
        try {
          visit(tree.rootNode, { owner: g.fileId, top: true, suites: [] }, g);
        } finally {
          tree.delete();
        }
      }
      return g.result();
    },
  };
}

function visit(node: Node, ctx: Ctx, g: FileGraph): void {
  switch (node.type) {
    case 'import_statement': {
      const spec = stringValue(node.childForFieldName('source'));
      if (spec === undefined) return;
      g.refs.push({ from: g.fileId, kind: 'imports', name: spec, line: node.startPosition.row + 1 });
      for (const clause of node.namedChildren.filter((c) => c.type === 'import_clause')) importClause(clause, spec, g);
      return;
    }
    case 'export_statement': {
      const spec = stringValue(node.childForFieldName('source'));
      if (spec !== undefined) {
        g.refs.push({ from: g.fileId, kind: 'imports', name: spec, line: node.startPosition.row + 1 });
        return;
      }
      break;
    }
    case 'class_declaration':
    case 'abstract_class_declaration':
    case 'class': {
      const name = node.childForFieldName('name')?.text;
      if (name === undefined || !ctx.top) break;
      const range = lineRange(declarationNode(node));
      const id = g.add(g.fileId, 'class', name, range);
      for (const heritage of node.namedChildren.filter((c) => c.type === 'class_heritage')) classHeritage(heritage, id, g);
      const body = node.childForFieldName('body');
      if (body) for (const member of body.namedChildren) classMember(member, id, g, ctx);
      return;
    }
    case 'function_declaration':
    case 'generator_function_declaration': {
      const name = node.childForFieldName('name')?.text;
      if (name === undefined || !ctx.top) break;
      const id = g.add(g.fileId, 'function', name, lineRange(declarationNode(node)));
      visitChildren(node, { ...ctx, owner: id, top: false }, g);
      return;
    }
    case 'variable_declarator': {
      const value = node.childForFieldName('value');
      const name = node.childForFieldName('name');
      if (ctx.top && value && name?.type === 'identifier' && FUNCTION_VALUES.has(value.type)) {
        const id = g.add(g.fileId, 'function', name.text, lineRange(declarationNode(node)));
        visit(value, { ...ctx, owner: id, top: false }, g);
        return;
      }
      break;
    }
    case 'call_expression': {
      if (testOrSuite(node, ctx, g)) return;
      const fn = node.childForFieldName('function');
      if (fn) callRef(fn, ctx, g, node);
      break;
    }
    case 'new_expression': {
      const ctor = node.childForFieldName('constructor');
      if (ctor) callRef(ctor, ctx, g, node);
      break;
    }
  }
  visitChildren(node, ctx, g);
}

function visitChildren(node: Node, ctx: Ctx, g: FileGraph): void {
  for (const child of node.namedChildren) visit(child, ctx, g);
}

/** The statement that holds a declaration, so its range has `export` and `const` too. */
function declarationNode(node: Node): Node {
  let n = node;
  for (;;) {
    const p = n.parent;
    if (!p || !['export_statement', 'lexical_declaration', 'variable_declaration', 'variable_declarator'].includes(p.type)) return n;
    n = p;
  }
}

function importClause(clause: Node, spec: string, g: FileGraph): void {
  for (const c of clause.namedChildren) {
    if (c.type === 'identifier') {
      g.bindings.push({ local: c.text, module: spec, imported: 'default' });
    } else if (c.type === 'namespace_import') {
      const local = c.namedChildren.find((x) => x.type === 'identifier');
      if (local) g.bindings.push({ local: local.text, module: spec, imported: '*' });
    } else if (c.type === 'named_imports') {
      for (const s of c.namedChildren.filter((x) => x.type === 'import_specifier')) {
        const name = s.childForFieldName('name')?.text;
        const alias = s.childForFieldName('alias')?.text;
        if (name !== undefined) g.bindings.push({ local: alias ?? name, module: spec, imported: name });
      }
    }
  }
}

function classHeritage(heritage: Node, classId: string, g: FileGraph): void {
  for (const clause of heritage.namedChildren) {
    const kind = clause.type === 'extends_clause' ? 'extends' : clause.type === 'implements_clause' ? 'implements' : undefined;
    if (!kind) continue;
    for (const t of clause.namedChildren) {
      const target = t.type === 'generic_type' ? (t.childForFieldName('name') ?? t.namedChildren[0]) : t;
      if (!target) continue;
      const ref = splitTarget(target);
      if (ref) g.refs.push({ from: classId, kind, ...ref, line: t.startPosition.row + 1 });
    }
  }
}

function classMember(member: Node, classId: string, g: FileGraph, ctx: Ctx): void {
  const inClass: Ctx = { owner: classId, cls: classId, top: false, suites: ctx.suites };
  if (member.type === 'method_definition') {
    const name = member.childForFieldName('name')?.text;
    if (name === undefined) return;
    const id = g.add(classId, 'method', name, lineRange(member));
    visitChildren(member, { ...inClass, owner: id }, g);
    return;
  }
  if (member.type === 'public_field_definition') {
    const name = member.childForFieldName('name')?.text;
    const value = member.childForFieldName('value');
    if (name !== undefined && value && FUNCTION_VALUES.has(value.type)) {
      const id = g.add(classId, 'method', name, lineRange(member));
      visit(value, { ...inClass, owner: id }, g);
      return;
    }
  }
  visit(member, inClass, g);
}

/** `it('title', fn)` and `test(...)` make a test node; `describe('title', fn)` names the tests in it. */
function testOrSuite(call: Node, ctx: Ctx, g: FileGraph): boolean {
  const fn = call.childForFieldName('function');
  if (!fn) return false;
  const base = fn.type === 'identifier' ? fn.text : fn.type === 'member_expression' ? fn.childForFieldName('object')?.text : undefined;
  if (base === undefined || (!TEST_CALLS.has(base) && !SUITE_CALLS.has(base))) return false;
  const args = call.childForFieldName('arguments')?.namedChildren ?? [];
  const title = stringValue(args[0]);
  const body = args.find((a) => FUNCTION_VALUES.has(a.type));
  if (title === undefined || !body) return false;
  if (SUITE_CALLS.has(base)) {
    visit(body, { ...ctx, suites: [...ctx.suites, title] }, g);
  } else {
    const name = [...ctx.suites, title].join(' > ');
    const id = g.add(g.fileId, 'test', name, lineRange(call));
    visit(body, { ...ctx, owner: id, top: false }, g);
  }
  return true;
}

function callRef(fn: Node, ctx: Ctx, g: FileGraph, at: Node): void {
  const line = at.startPosition.row + 1;
  const owner = ctx.cls ? { owner: ctx.cls } : {};
  const ref = splitTarget(fn);
  if (ref) {
    g.refs.push({ from: ctx.owner, kind: 'calls', ...ref, ...owner, line });
    return;
  }
  // A computed call `handlers[name](id)` on a top-level object `{ handle }`: a call by name to each
  // function in it. No resolver can confirm it, so its edges stay name-match (S6-A2).
  for (const name of tableCallees(fn)) g.refs.push({ from: ctx.owner, kind: 'calls', name, ...owner, line });
}

const tables = new WeakMap<object, Map<string, string[]>>();

/** The names in a top-level object literal that `t[k]` or `t[k]!` calls. */
function tableCallees(fn: Node): string[] {
  const sub = fn.type === 'non_null_expression' ? fn.namedChildren[0] : fn;
  const obj = sub?.type === 'subscript_expression' ? sub.childForFieldName('object') : undefined;
  if (obj?.type !== 'identifier') return [];
  let byName = tables.get(fn.tree);
  if (!byName) tables.set(fn.tree, (byName = topLevelTables(fn.tree.rootNode)));
  return byName.get(obj.text) ?? [];
}

function topLevelTables(root: Node): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const stmt of root.namedChildren) {
    const decl = stmt.type === 'export_statement' ? stmt.namedChildren.find((c) => c.type === 'lexical_declaration') : stmt;
    if (decl?.type !== 'lexical_declaration') continue;
    for (const d of decl.namedChildren.filter((c) => c.type === 'variable_declarator')) {
      let value = d.childForFieldName('value');
      while (value && (value.type === 'as_expression' || value.type === 'satisfies_expression')) value = value.namedChildren[0] ?? null;
      const name = d.childForFieldName('name');
      if (value?.type !== 'object' || name?.type !== 'identifier') continue;
      const names = value.namedChildren.flatMap((p) => {
        if (p.type === 'shorthand_property_identifier') return [p.text];
        const v = p.type === 'pair' ? p.childForFieldName('value') : undefined;
        return v?.type === 'identifier' ? [v.text] : [];
      });
      if (names.length > 0) out.set(name.text, names);
    }
  }
  return out;
}

/** `b` → { name: b }; `a.b` → { receiver: a, name: b }; `a.b.c` → { receiver: a.b, name: c }; `this.b`. */
function splitTarget(node: Node): { name: string; receiver?: string } | undefined {
  if (node.type === 'identifier' || node.type === 'type_identifier') return { name: node.text };
  if (node.type === 'member_expression' || node.type === 'nested_type_identifier') {
    const prop = node.childForFieldName('property') ?? node.childForFieldName('name') ?? node.namedChildren.at(-1);
    const obj = node.childForFieldName('object') ?? node.childForFieldName('module') ?? node.namedChildren[0];
    if (!prop || !obj) return undefined;
    const receiver = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(obj.text) ? obj.text : '?';
    return { name: prop.text, receiver };
  }
  return undefined;
}
