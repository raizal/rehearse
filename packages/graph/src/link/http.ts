// The http-calls linker (G17, G23): a TypeScript client call → the FastAPI route it calls.
//
// Client calls (tree-sitter, in TypeScript files):
//   fetch(url [, { method }])          also ky(url, …), axios(url, …), ofetch / $fetch
//   axios({ url, method })             a config object as the only argument
//   <client>.get|post|put|patch|delete|head|options(url, …)   axios, ky, or an instance of them
// The URL is a string, a template string, a `+` of strings, or a top-level string const; each part
// that is not known is a parameter. `${base}/api/…` and `http://host/api/…` lose the base. A route
// is a route node of the Python reader (`GET /api/orders/{order_id}`).
//
// A call matches a route when the methods are the same and each path segment is the same, or the
// route has a parameter there. The edge is `name-match`, source tree-sitter (S7-A1). When the repo
// has an OpenAPI spec and the spec has an operation with the same method and path as the route and
// the call, the edge is `exact`, source openapi (S7-A2). A call of a function named like an
// operationId that only an outside package defines (a generated client) links to that operation's
// route as `exact` too. No spec is made (G23).
//
// Incremental: it keeps the client calls of each TypeScript file and the hash of each spec. An
// update parses again only the changed TypeScript files, then matches every call again (cheap).
// With no changed file and no changed spec it keeps its rows.

import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { Parser, type Node } from 'web-tree-sitter';
import { parse as parseYaml } from 'yaml';
import type { GraphView, Linker } from '../extend.js';
import { loadGrammars, stringValue } from '../readers/reader.js';
import type { GraphNode } from '../types.js';
import { EdgeSet, nodeAtLine, sha256 } from './nodes.js';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
const FETCHERS = new Set(['fetch', 'ky', 'axios', 'ofetch', '$fetch']);
/** Receivers that define server routes in TypeScript (Express, Fastify, Hono), not client calls. */
const SERVERS = new Set(['app', 'router', 'server', 'fastify', 'express', 'api_router']);
/** A file may have a client call: a cheap test before parsing. */
const MAYBE_CLIENT = /\b(fetch|ky|axios|ofetch|\$fetch)\s*\(|\.(get|post|put|patch|delete|head|options|request)\s*\(/;
/** Folders the spec search does not enter. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'venv', '__pycache__']);
const SPEC_FILE = /^(openapi|swagger)([.-][\w.-]*)?\.(json|ya?ml)$|\.openapi\.(json|ya?ml)$/i;
const SPEC_DEPTH = 3;
/** A path segment that is a parameter. */
const PARAM = '{}';

/** One client call in a TypeScript file. `method` `*` is a method the linker cannot read. */
export interface ClientCall {
  line: number;
  method: string;
  /** The path with each unknown part as `{}`, e.g. `/api/orders/{}`. */
  path: string;
}

interface HttpState {
  calls: Record<string, ClientCall[]>;
  specs: Record<string, string>;
}

interface Operation {
  method: string;
  path: string[];
  operationId?: string;
}

export function httpLinker(): Linker {
  return {
    name: 'http',
    source: 'tree-sitter',
    async stale({ root, state }) {
      const old = state.get<HttpState>();
      return old === undefined || JSON.stringify(old.specs) !== JSON.stringify(hashSpecs(root));
    },
    async link({ root, mode, changed, removed, graph, state }) {
      const specs = hashSpecs(root);
      const old = mode === 'cold' ? undefined : state.get<HttpState>();
      const specsSame = old !== undefined && JSON.stringify(old.specs) === JSON.stringify(specs);
      if (old !== undefined && specsSame && changed.length === 0 && removed.length === 0) return 'keep';

      const tsFiles = graph.nodesOfKind('file').filter((n) => n.language === 'typescript' && !n.targetOnly && n.file).map((n) => n.file!);
      const calls: Record<string, ClientCall[]> = {};
      const reread = old === undefined ? new Set(tsFiles) : new Set(changed);
      const parser = await tsParsers();
      for (const file of tsFiles) {
        const found = reread.has(file) ? clientCalls(parser, file, readText(root, file)) : (old?.calls[file] ?? []);
        if (found.length > 0) calls[file] = found;
      }
      state.set({ calls, specs } satisfies HttpState);
      const ops = Object.keys(specs).flatMap((p) => readSpec(root, p));
      return { nodes: [], edges: matchCalls(calls, ops, graph) };
    },
  };
}

function readText(root: string, file: string): string {
  try {
    return readFileSync(join(root, file), 'utf8');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- client calls

let parsers: Promise<{ ts: Parser; tsx: Parser }> | undefined;

function tsParsers(): Promise<{ ts: Parser; tsx: Parser }> {
  parsers ??= loadGrammars().then((g) => {
    const ts = new Parser();
    ts.setLanguage(g.typescript);
    const tsx = new Parser();
    tsx.setLanguage(g.tsx);
    return { ts, tsx };
  });
  return parsers;
}

/** The HTTP client calls of one TypeScript file. */
export function clientCalls(p: { ts: Parser; tsx: Parser }, file: string, text: string): ClientCall[] {
  if (!MAYBE_CLIENT.test(text)) return [];
  const tree = (file.endsWith('.tsx') ? p.tsx : p.ts).parse(text);
  if (!tree) return [];
  try {
    const consts = topLevelStrings(tree.rootNode);
    const out: ClientCall[] = [];
    const visit = (node: Node) => {
      if (node.type === 'call_expression') {
        const call = clientCall(node, consts);
        if (call) out.push(call);
      }
      for (const c of node.namedChildren) visit(c);
    };
    visit(tree.rootNode);
    return out;
  } finally {
    tree.delete();
  }
}

/** `const API = '/api'` at the top level (also exported): API → /api. */
function topLevelStrings(root: Node): Map<string, string> {
  const out = new Map<string, string>();
  for (let stmt of root.namedChildren) {
    if (stmt.type === 'export_statement') stmt = stmt.namedChildren.find((c) => c.type === 'lexical_declaration') ?? stmt;
    if (stmt.type !== 'lexical_declaration') continue;
    for (const d of stmt.namedChildren.filter((c) => c.type === 'variable_declarator')) {
      const name = d.childForFieldName('name');
      const value = stringValue(d.childForFieldName('value'));
      if (name?.type === 'identifier' && value !== undefined) out.set(name.text, value);
    }
  }
  return out;
}

function clientCall(node: Node, consts: Map<string, string>): ClientCall | undefined {
  const fn = node.childForFieldName('function');
  const args = node.childForFieldName('arguments')?.namedChildren ?? [];
  if (!fn || args.length === 0) return undefined;
  let method: string | undefined;
  let urlNode: Node | undefined;
  let options: Node | undefined;
  if (fn.type === 'identifier' && FETCHERS.has(fn.text)) {
    if (args[0]!.type === 'object') {
      urlNode = property(args[0]!, 'url');
      options = args[0];
    } else {
      urlNode = args[0];
      options = args[1];
    }
  } else if (fn.type === 'member_expression') {
    const name = fn.childForFieldName('property')?.text ?? '';
    const receiver = fn.childForFieldName('object')?.text ?? '';
    if (SERVERS.has(receiver)) return undefined;
    if (METHODS.includes(name)) {
      if (args.slice(1).some((a) => ['arrow_function', 'function_expression', 'function'].includes(a.type))) return undefined; // a route handler
      method = name.toUpperCase();
      urlNode = args[0];
    } else if (name === 'request' && args[0]!.type === 'object') {
      urlNode = property(args[0]!, 'url');
      options = args[0];
    } else {
      return undefined;
    }
  } else {
    return undefined;
  }
  if (!urlNode) return undefined;
  const raw = urlText(urlNode, consts);
  const path = raw === undefined ? undefined : clientPath(raw);
  if (path === undefined) return undefined;
  if (method === undefined) {
    const m = options?.type === 'object' ? property(options, 'method') : undefined;
    method = m === undefined ? 'GET' : (stringValue(m)?.toUpperCase() ?? '*');
  }
  return { line: node.startPosition.row + 1, method, path };
}

/** The value of `key: value` (or the shorthand `key`) in an object literal. */
function property(obj: Node, key: string): Node | undefined {
  for (const c of obj.namedChildren) {
    if (c.type === 'pair' && c.childForFieldName('key')?.text.replace(/^['"]|['"]$/g, '') === key) return c.childForFieldName('value') ?? undefined;
    if (c.type === 'shorthand_property_identifier' && c.text === key) return c;
  }
  return undefined;
}

/** The text of a URL expression; each part the linker cannot know is `{}`. */
function urlText(node: Node, consts: Map<string, string>): string | undefined {
  switch (node.type) {
    case 'string':
      return stringValue(node);
    case 'template_string': {
      let out = '';
      let at = node.startIndex + 1;
      for (const c of node.namedChildren) {
        if (c.type !== 'template_substitution') continue;
        out += node.text.slice(at - node.startIndex, c.startIndex - node.startIndex);
        const inner = c.namedChildren[0];
        out += (inner && urlText(inner, consts)) ?? PARAM;
        at = c.endIndex;
      }
      return out + node.text.slice(at - node.startIndex, -1);
    }
    case 'binary_expression': {
      if (node.childForFieldName('operator')?.text !== '+') return PARAM;
      const l = node.childForFieldName('left');
      const r = node.childForFieldName('right');
      return (l ? (urlText(l, consts) ?? PARAM) : PARAM) + (r ? (urlText(r, consts) ?? PARAM) : PARAM);
    }
    case 'parenthesized_expression':
      return node.namedChildren[0] ? urlText(node.namedChildren[0], consts) : undefined;
    case 'identifier':
      return consts.get(node.text) ?? PARAM;
    default:
      return PARAM;
  }
}

/** `/api/orders/{}` from a URL text, or undefined when it is not a path. */
export function clientPath(raw: string): string | undefined {
  let s = raw.trim().replace(/^https?:\/\/[^/]*/i, '').replace(/[?#].*$/, '');
  while (s.startsWith(`${PARAM}/`)) s = s.slice(PARAM.length); // a base URL in a variable
  if (!s.startsWith('/')) return undefined;
  const segs = s.split('/').filter((x) => x !== '').map((x) => (x.includes(PARAM) ? PARAM : x));
  if (segs.length === 0 || segs.every((x) => x === PARAM)) return undefined;
  return `/${segs.join('/')}`;
}

// ---------------------------------------------------------------- routes and the spec

/** `GET /api/orders/{order_id}` → { method GET, path [api, orders, {}] }. */
function routePath(route: string): { method: string; path: string[] } | undefined {
  const m = /^(\S+)\s+(\S+)$/.exec(route);
  if (!m) return undefined;
  return { method: m[1]!.toUpperCase(), path: segments(m[2]!) };
}

function segments(path: string): string[] {
  return path.split('/').filter((x) => x !== '').map((x) => (/^\{.*\}$/.test(x) ? PARAM : x));
}

/** How well a call path fits a route path: the number of equal segments, or -1. */
function fit(call: string[], route: string[]): number {
  if (call.length !== route.length) return -1;
  let score = 0;
  for (let i = 0; i < call.length; i++) {
    if (route[i] === PARAM) continue;
    if (call[i] !== route[i]) return -1;
    score++;
  }
  return score;
}

function methodFits(call: string, route: string): boolean {
  return call === '*' || route === 'ANY' || call === route;
}

function samePath(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/** The OpenAPI and Swagger files of the repo (not below node_modules or a hidden folder), with hashes. */
function hashSpecs(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = dir === '' ? e.name : posix.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < SPEC_DEPTH && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) walk(path, depth + 1);
      } else if (e.isFile() && SPEC_FILE.test(e.name)) {
        const text = readText(root, path);
        if (/["']?(openapi|swagger)["']?\s*:/.test(text)) out[path] = sha256(text);
      }
    }
  };
  walk('', 0);
  return out;
}

/** The operations of one spec, with the path prefix of its first server. */
function readSpec(root: string, path: string): Operation[] {
  let doc: unknown;
  try {
    doc = parseYaml(readText(root, path));
  } catch {
    return [];
  }
  if (typeof doc !== 'object' || doc === null) return [];
  const spec = doc as { paths?: Record<string, Record<string, { operationId?: unknown }>>; servers?: Array<{ url?: unknown }>; basePath?: unknown };
  const server = typeof spec.servers?.[0]?.url === 'string' ? spec.servers[0].url.replace(/^https?:\/\/[^/]*/i, '') : '';
  const base = segments(typeof spec.basePath === 'string' ? spec.basePath : server);
  const out: Operation[] = [];
  for (const [p, item] of Object.entries(spec.paths ?? {})) {
    if (typeof item !== 'object' || item === null) continue;
    for (const [method, op] of Object.entries(item)) {
      if (!METHODS.includes(method.toLowerCase()) || typeof op !== 'object' || op === null) continue;
      const operation: Operation = { method: method.toUpperCase(), path: [...base, ...segments(p)] };
      if (typeof op.operationId === 'string') operation.operationId = op.operationId;
      out.push(operation);
    }
  }
  return out;
}

// ---------------------------------------------------------------- matching

function matchCalls(calls: Record<string, ClientCall[]>, ops: Operation[], graph: GraphView) {
  const routes = graph
    .nodesOfKind('route')
    .filter((n) => n.route !== undefined && !n.targetOnly)
    .flatMap((n) => {
      const r = routePath(n.route!);
      return r ? [{ node: n, ...r }] : [];
    });
  const edges = new EdgeSet();
  for (const file of Object.keys(calls).sort()) {
    const inFile = graph.nodesInFile(file).filter((n) => !n.targetOnly);
    for (const call of calls[file]!) {
      const from = nodeAtLine(inFile, call.line);
      if (!from) continue;
      const path = segments(call.path);
      let best = -1;
      let hits: typeof routes = [];
      for (const r of routes) {
        if (!methodFits(call.method, r.method)) continue;
        const score = fit(path, r.path);
        if (score < 0 || score < best) continue;
        if (score > best) (best = score), (hits = []);
        hits.push(r);
      }
      for (const r of hits) {
        const confirmed = ops.some((op) => op.method === r.method && samePath(op.path, r.path) && methodFits(call.method, op.method) && fit(path, op.path) >= 0);
        edges.add({ from: from.id, to: r.node.id, kind: 'http-calls', trust: confirmed ? 'exact' : 'name-match', source: confirmed ? 'openapi' : 'tree-sitter' });
      }
    }
  }
  // A generated client: a call of a function named like an operationId that only an outside package has.
  // A target node is named after its package: `@shop/client.getOrder`.
  const outside = graph.nodesOfKind('function').filter((n) => n.targetOnly && n.language === 'typescript');
  for (const op of ops) {
    if (op.operationId === undefined) continue;
    const targets = routes.filter((r) => r.method === op.method && samePath(r.path, op.path)).map((r) => r.node);
    if (targets.length === 0) continue;
    const id = op.operationId;
    const callees = outside.filter((n: GraphNode) => n.name === id || n.name.endsWith(`.${id}`));
    for (const callee of callees) {
      for (const e of graph.edges({ to: callee.id, kind: 'calls' })) {
        for (const t of targets) edges.add({ from: e.from, to: t.id, kind: 'http-calls', trust: 'exact', source: 'openapi' });
      }
    }
  }
  return edges.list();
}
