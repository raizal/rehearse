// S1, S2, S3: find, show, near and path on the shop fixture (scenarios/README.md).
// Wave 1 has no resolver: a call found by its name is `name-match`, where the examples say `exact`
// (ts-morph, scip-python come in wave 2). The tests check the trust mark is there and is wave 1's.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answerToJson, answerToText, openGraph, TRUSTS, type Graph, type QueryAnswer } from '../src/index.js';
import { copyFixture, snapshot } from './helpers.js';

let root: string;
let graph: Graph;

beforeEach(async () => {
  root = copyFixture('shop');
  graph = openGraph(root);
  await graph.update();
});

afterEach(() => graph.close());

const names = (a: QueryAnswer) => a.nodes.map((n) => n.name);
const edge = (a: QueryAnswer, from: string, to: string, kind = 'calls') =>
  a.edges.find((e) => e.fromName === from && e.toName === to && e.kind === kind);

describe('S1 find', () => {
  it('S1-A1 find "order by id" gives getOrderById first, with id, kind, file, range and score, on an unchanged index', async () => {
    const answer = await graph.find('order by id');
    expect(graph.lastRun()).toMatchObject({ mode: 'none', status: 'unchanged', changedFiles: 0 });
    expect(answer).toMatchObject({ verb: 'find', ok: true, exitCode: 0 });
    const first = answer.nodes[0]!;
    expect(first).toMatchObject({ name: 'getOrderById', kind: 'function', file: 'src/orders.ts', range: '12-20' });
    for (const field of ['id', 'kind', 'file', 'range', 'score'] as const) expect(first[field]).toBeDefined();
    expect(first.score).toBeGreaterThan(0);
  });

  it('S1-A2 find "order by id" gives the TypeScript and the Python function, split into the same words', async () => {
    const answer = await graph.find('order by id');
    expect(names(answer).slice(0, 2)).toEqual(['getOrderById', 'get_order_by_id']);
    expect(answer.nodes.slice(0, 2).map((n) => [n.language, n.terms])).toEqual([
      ['typescript', 'get order by id'],
      ['python', 'get order by id'],
    ]);
  });

  it('S1 find with no hit is not an error, and the same query gives a byte-identical answer', async () => {
    const none = await graph.find('zebra');
    expect(none).toMatchObject({ ok: true, exitCode: 0, nodes: [], notes: ['no hits'] });
    expect(answerToJson(await graph.find('getOrderById'))).toBe(answerToJson(await graph.find('getOrderById')));
  });

  it('S1 find matches camelCase and snake_case words of the query', async () => {
    expect(names(await graph.find('getOrderById'))[0]).toBe('getOrderById');
    expect(names(await graph.find('load_row')).slice(0, 2).sort()).toEqual(['loadRow', 'load_row']);
  });
});

describe('S2 show and near', () => {
  it('S2-A1 show getOrderById gives its code, file, SCIP ID and edges, each with kind and trust', async () => {
    const answer = await graph.show('getOrderById');
    expect(answer).toMatchObject({ verb: 'show', ok: true, exitCode: 0 });
    const node = answer.nodes[0]!;
    expect(node).toMatchObject({
      id: 'scip-typescript npm app 1.0 src/orders.ts/getOrderById().',
      file: 'src/orders.ts',
      range: '12-20',
    });
    expect(node.code).toContain('export function getOrderById(id: string): Order {');
    expect(node.code).toContain('const row = loadRow(id);');
    expect(edge(answer, 'getOrderById', 'loadRow')).toMatchObject({ trust: 'name-match', source: 'tree-sitter' });
    for (const e of answer.edges) {
      expect(e.kind).toBeDefined();
      expect(TRUSTS).toContain(e.trust);
    }
  });

  it('S2-A2 near getOrderById links its caller loadOrder, its callee loadRow and its test in orders.test.ts', async () => {
    const answer = await graph.near('getOrderById');
    expect(edge(answer, 'loadOrder', 'getOrderById')?.trust).toBe('name-match');
    expect(edge(answer, 'getOrderById', 'loadRow')?.trust).toBe('name-match');
    const test = answer.nodes.find((n) => n.kind === 'test');
    expect(test).toMatchObject({ name: 'orders > reads one order by its id', file: 'src/orders.test.ts', distance: 1 });
    expect(edge(answer, test!.name, 'getOrderById')).toBeDefined();
    for (const e of answer.edges) expect(TRUSTS).toContain(e.trust);
    // Depth 1: getOrder calls loadOrder, two edges away.
    expect(names(answer)).not.toContain('getOrder');
  });

  it('S2-A3 show noSuchThing exits 1 with "not found" and changes no file', async () => {
    const before = snapshot(root);
    const answer = await graph.show('noSuchThing');
    expect(answer).toEqual({ verb: 'show', ok: false, exitCode: 1, nodes: [], edges: [], notes: ['not found'] });
    expect(snapshot(root)).toEqual(before);
  });

  it('S2-A4 near getOrderById --depth 2 links loadOrder and getOrder', async () => {
    const answer = await graph.near('getOrderById', { depth: 2 });
    expect(edge(answer, 'loadOrder', 'getOrderById')?.trust).toBeDefined();
    expect(edge(answer, 'getOrder', 'loadOrder')?.trust).toBeDefined();
    expect(answer.nodes.find((n) => n.name === 'getOrder')?.distance).toBe(2);
  });
});

describe('S3 path', () => {
  it('S3-A1 path getOrder getOrderById gives getOrder -> loadOrder -> getOrderById, each edge with trust', async () => {
    const answer = await graph.path('getOrder', 'getOrderById');
    expect(answer).toMatchObject({ verb: 'path', ok: true, exitCode: 0 });
    expect(answer.edges.map((e) => `${e.fromName} -> ${e.toName}`)).toEqual(['getOrder -> loadOrder', 'loadOrder -> getOrderById']);
    for (const e of answer.edges) expect(e).toMatchObject({ kind: 'calls', trust: 'name-match' });
    expect(names(answer)).toEqual(['getOrder', 'loadOrder', 'getOrderById']);
  });

  it('S3-A2 path getOrderById charge exits 1 with "no path", no edges, and changes no file', async () => {
    const before = snapshot(root);
    const answer = await graph.path('getOrderById', 'charge');
    expect(answer).toEqual({ verb: 'path', ok: false, exitCode: 1, nodes: [], edges: [], notes: ['no path'] });
    expect(snapshot(root)).toEqual(before);
  });

  it('S3 path to a node that does not exist is "not found"', async () => {
    expect(await graph.path('getOrder', 'noSuchThing')).toMatchObject({ ok: false, exitCode: 1, notes: ['not found'] });
  });
});

describe('readers (G15, G16, G17)', () => {
  it('reads the FastAPI route with its router prefix, and Python calls by name', async () => {
    const answer = await graph.show('get_order');
    expect(answer.nodes[0]).toMatchObject({ kind: 'route', route: 'GET /api/orders/{order_id}', file: 'api/orders.py', range: '18-20' });
    expect(edge(answer, 'get_order', 'get_order_by_id')?.trust).toBe('name-match');
    expect((await graph.show('GET /api/orders/{order_id}')).nodes[0]?.name).toBe('get_order');
  });

  it('a call into a package outside the repo is a target-only node with trust unresolved', async () => {
    const answer = await graph.show('fetch_remote');
    expect(edge(answer, 'fetch_remote', 'requests.get')).toMatchObject({ trust: 'unresolved' });
    const target = graph.store.nodesWhere('name = ?', 'requests.get')[0];
    expect(target).toMatchObject({ targetOnly: true, kind: 'function' });
    expect(target?.file).toBeUndefined();
    expect((await graph.show('get_order')).edges.length).toBeGreaterThan(0);
    expect(graph.store.nodesWhere('name = ?', 'fastapi.APIRouter')[0]).toMatchObject({ targetOnly: true });
  });

  it('a pytest test calls the function it imports from a module below the repo root', async () => {
    const answer = await graph.near('get_order_by_id');
    expect(edge(answer, 'test_get_order_by_id', 'get_order_by_id')?.trust).toBe('name-match');
    expect(answer.nodes.find((n) => n.name === 'test_get_order_by_id')?.kind).toBe('test');
  });

  it('a computed call such as handlers[name](id) makes no edge in wave 1', async () => {
    const answer = await graph.show('dispatch');
    expect(answer.edges.filter((e) => e.kind === 'calls')).toEqual([]);
  });

  it('imports between repo files are edges between file nodes', async () => {
    const answer = await graph.show('src/orders.test.ts');
    expect(answer.nodes[0]?.kind).toBe('file');
    expect(edge(answer, 'orders.test.ts', 'orders.ts', 'imports')?.trust).toBe('name-match');
    expect(edge(answer, 'orders.test.ts', 'vitest', 'imports')?.trust).toBe('unresolved');
  });

  it('the text answer lists each edge with its trust mark', async () => {
    const text = answerToText(await graph.show('getOrderById'));
    expect(text).toContain('function getOrderById  src/orders.ts:12-20');
    expect(text).toContain('getOrderById -calls-> loadRow  (name-match, tree-sitter)');
  });
});
