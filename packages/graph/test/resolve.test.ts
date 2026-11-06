// S6-A2, S6-A3, S6-A4 and the venv part of S4-A2: the resolvers mark the edges they confirm `exact`
// (box `update-graph/bulk-index`, G10, G15, G16, G19). scip-python and basedpyright run from npm with
// PATH emptied, so these tests run on a host with no Python.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  lspStats, NO_VENV, openGraph, readScip, resolveFromScip, updateGraph, Store, GRAPH_DB,
  type Graph, type QueryAnswer, type Resolver,
} from '../src/index.js';
import { copyFixture, FIXTURES } from './helpers.js';

const open: Graph[] = [];
function graphOf(root: string): Graph {
  const g = openGraph(root);
  open.push(g);
  return g;
}

let path: string | undefined;
beforeEach(() => {
  // No Python on this host: an empty folder is the whole PATH.
  path = process.env.PATH;
  process.env.PATH = mkdtempSync(join(tmpdir(), 'rehearse-nopath-'));
});
afterEach(() => {
  for (const g of open.splice(0)) g.close();
  process.env.PATH = path;
});

function write(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

/** A .venv with the package requests 2.31.0 (pure Python: `requests.get` returns a Response). */
function fakeVenv(root: string): void {
  const site = '.venv/lib/python3.12/site-packages';
  write(root, '.venv/pyvenv.cfg', 'home = /nonexistent/bin\nversion = 3.12.0\n');
  write(root, `${site}/requests/__init__.py`, 'from .api import get\n');
  write(root, `${site}/requests/api.py`, [
    'class Response:', '    def json(self) -> dict:', '        return {}', '', '',
    'def get(url: str) -> Response:', '    return Response()', '',
  ].join('\n'));
  write(root, `${site}/requests-2.31.0.dist-info/METADATA`, 'Metadata-Version: 2.1\nName: requests\nVersion: 2.31.0\n');
  write(root, `${site}/requests-2.31.0.dist-info/RECORD`, 'requests/__init__.py,,\nrequests/api.py,,\n');
}

const edge = (a: QueryAnswer, from: string, to: string, kind = 'calls') =>
  a.edges.find((e) => e.fromName === from && e.toName === to && e.kind === kind);

describe('S6-A2 TypeScript: ts-morph', () => {
  it('S6-A2 a call ts-morph resolves is exact; a call through a computed property is name-match', async () => {
    const graph = graphOf(copyFixture('shop'));
    const caller = await graph.show('getOrderById');
    expect(edge(caller, 'getOrderById', 'loadRow')).toMatchObject({ trust: 'exact', source: 'ts-morph' });
    const computed = await graph.show('dispatch');
    expect(edge(computed, 'dispatch', 'handle')).toMatchObject({ trust: 'name-match', source: 'tree-sitter' });
  });

  it('S6-A2 a call into node_modules with a known type is exact, to a target-only node', async () => {
    const root = copyFixture('monorepo');
    write(root, 'node_modules/lodash/package.json', '{ "name": "lodash", "version": "4.17.21", "types": "index.d.ts" }');
    write(root, 'node_modules/lodash/index.d.ts', 'declare const lodash: { get(o: object, k: string): unknown };\nexport default lodash;\n');
    const graph = graphOf(root);
    await graph.update();
    const target = graph.store.nodesWhere('name = ?', 'lodash.get');
    expect(target).toMatchObject([{ targetOnly: true, id: 'scip-typescript npm lodash . lodash/get().' }]);
    expect(graph.store.edgesWhere('to_id = ?', target[0]!.id)).toMatchObject([{ kind: 'calls', trust: 'exact', source: 'ts-morph' }]);
  });

  it('S6-A2 an update resolves the changed file again and keeps the other edges exact', async () => {
    const root = copyFixture('shop');
    const graph = graphOf(root);
    await graph.update();
    const file = join(root, 'src/orders.ts');
    writeFileSync(file, readFileSync(file, 'utf8').replace('const row = loadRow(id);', 'const row = loadRow(id) ?? loadRow(id);'));
    const answer = await graph.show('getOrderById');
    expect(graph.lastRun()).toMatchObject({ mode: 'update', resolvers: ['tree-sitter', 'ts-morph'] });
    expect(edge(answer, 'getOrderById', 'loadRow')).toMatchObject({ trust: 'exact', source: 'ts-morph' });
    expect(edge(answer, 'loadOrder', 'getOrderById')).toMatchObject({ trust: 'exact', source: 'ts-morph' });
  });
});

describe('S6-A3 Python with a venv: scip-python and basedpyright from npm', () => {
  it('S6-A3 with .venv and no Python on the host, calls in the repo and into requests are exact', async () => {
    const root = copyFixture('shop');
    fakeVenv(root);
    const graph = graphOf(root);
    const cold = await graph.show('fetch_remote');
    expect(graph.lastRun()).toMatchObject({ mode: 'cold', venv: '.venv', resolvers: ['tree-sitter', 'ts-morph', 'scip-python'] });
    expect(edge(cold, 'fetch_remote', 'requests.get')).toMatchObject({ trust: 'exact', source: 'scip-python' });
    expect(graph.store.nodesWhere('name = ?', 'requests.get')).toMatchObject([{ targetOnly: true, id: 'scip-python python requests . requests/get().' }]);
    expect(edge(await graph.show('get_order_by_id'), 'get_order_by_id', 'load_row')).toMatchObject({ trust: 'exact', source: 'scip-python' });
    expect(cold.notes).not.toContain(NO_VENV);

    // An update asks the warm basedpyright server about the changed file.
    const file = join(root, 'api/orders.py');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n\ndef fetch_again(url: str) -> dict:\n    return requests.get(url).json()\n`);
    const updated = await graph.show('fetch_again');
    expect(graph.lastRun()).toMatchObject({ mode: 'update', resolvers: ['tree-sitter', 'basedpyright'] });
    expect(edge(updated, 'fetch_again', 'requests.get')).toMatchObject({ trust: 'exact', source: 'basedpyright' });
    expect(edge(await graph.show('get_order_by_id'), 'get_order_by_id', 'load_row')).toMatchObject({ trust: 'exact', source: 'basedpyright' });
  });

  it('S6-A3 the SCIP reader on a recorded scip-python index: load_row and requests.get are exact', async () => {
    const root = copyFixture('shop');
    const index = readScip(readFileSync(join(FIXTURES, 'scip/shop-api.scip')));
    expect(index.documents.map((d) => d.path)).toEqual(['api/orders.py', 'api/test_orders.py']);
    const recorded: Resolver = { name: 'scip-python', language: 'python', resolve: async (input) => resolveFromScip(index, input, true) };
    mkdirSync(join(root, '.rehearse'));
    const store = new Store(join(root, GRAPH_DB));
    try {
      await updateGraph(root, store, { resolvers: [recorded] });
      const edges = store.edgesWhere("kind = 'calls' AND source = 'scip-python'").map((e) => `${e.from.split(' ').pop()} -> ${e.to.split(' ').pop()}`);
      expect(edges.sort()).toEqual([
        'api/orders.py/fetch_remote(). -> requests/get().',
        'api/orders.py/get_order(). -> api/orders.py/get_order_by_id().',
        'api/orders.py/get_order_by_id(). -> api/orders.py/load_row().',
        'api/test_orders.py/test_get_order_by_id(). -> api/orders.py/get_order_by_id().',
      ]);
      // `import requests` from the venv, and `from orders import …` next to the file: exact imports too.
      expect(store.edgesWhere("kind = 'imports' AND source = 'scip-python'").map((e) => e.to).sort()).toEqual([
        'scip-python python . . api/orders.py/', 'scip-python python requests . requests/',
      ]);
    } finally {
      store.close();
    }
  });
});

describe('S4-A2 Python with no venv (G19)', () => {
  it('S4-A2 with no venv, edges in the repo are exact, edges into third-party packages are unresolved, and the answer says "no venv found"', async () => {
    const graph = graphOf(copyFixture('shop'));
    const answer = await graph.show('fetch_remote');
    expect(graph.lastRun()?.venv).toBeUndefined();
    expect(edge(answer, 'fetch_remote', 'requests.get')).toMatchObject({ trust: 'unresolved', source: 'tree-sitter' });
    expect(answer.notes).toContain(NO_VENV);
    const inRepo = await graph.show('get_order_by_id');
    expect(edge(inRepo, 'get_order_by_id', 'load_row')).toMatchObject({ trust: 'exact', source: 'scip-python' });
    expect(graph.store.nodesWhere('name = ?', 'fastapi.APIRouter')).toMatchObject([{ targetOnly: true }]);
    // An answer with no Python code in it has no such note.
    expect((await graph.show('getOrderById')).notes).not.toContain(NO_VENV);
  });
});

describe('S6-A4 bulk resolvers', () => {
  it('S6-A4 a cold index lists ts-morph and scip-python and sends no LSP request for any call site', async () => {
    const root = copyFixture('shop');
    fakeVenv(root);
    const before = lspStats.requests;
    const graph = graphOf(root);
    await graph.update();
    expect(graph.lastRun()).toMatchObject({ mode: 'cold', resolvers: ['tree-sitter', 'ts-morph', 'scip-python'] });
    expect(graph.store.refs().filter((r) => r.resolvedTrust === 'exact').length).toBeGreaterThan(5);
    expect(lspStats.requests - before).toBe(0);
  });
});
