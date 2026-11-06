// Box `update-graph/link` (S7, S8, S2-A2, G13, G17, G18, G23, G25, G30): the http-calls, tests,
// builds, changes and record links. The shop fixture is copied with overlays (fixtures/links); git
// history is made in the copy (link-helpers.ts).

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clientPath, commitId, defaultLinkers, execGit, gitBoxId, gitLinker, openGraph, parseBlame, parseTrailerLog, recordId,
  recordLinker, TRUSTS, type Graph, type GitRunner, type GraphOptions, type QueryAnswer,
} from '../src/index.js';
import { commitAll, edit, initRepo, shopWith } from './link-helpers.js';

const open: Graph[] = [];
function graphOf(root: string, opts: GraphOptions = {}): Graph {
  const g = openGraph(root, opts);
  open.push(g);
  return g;
}

afterEach(() => {
  for (const g of open.splice(0)) g.close();
});

const edge = (a: QueryAnswer, kind: string, from: string, to: string) =>
  a.edges.find((e) => e.kind === kind && e.fromName === from && e.toName === to);
const edgesOf = (a: QueryAnswer, kind: string) =>
  a.edges.filter((e) => e.kind === kind).map((e) => `${e.fromName} -> ${e.toName} ${e.trust}`).sort();

/** A runner that records the git commands it ran (subcommand and last argument). */
function countingGit(): { run: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  return { calls, run: (args, cwd) => (calls.push(args.filter((a) => !a.startsWith('-') && a !== 'core.quotePath=false')), execGit(args, cwd)) };
}

describe('S7 http-calls', () => {
  it('S7-A1 a fetch of /api/orders/${id} in loadOrder links to the FastAPI route get_order as name-match', async () => {
    const graph = graphOf(shopWith());
    const answer = await graph.show('loadOrder');
    expect(edge(answer, 'http-calls', 'loadOrder', 'get_order')).toMatchObject({ trust: 'name-match', source: 'tree-sitter' });
    const route = await graph.show('GET /api/orders/{order_id}');
    expect(edgesOf(route, 'http-calls')).toEqual(['loadOrder -> get_order name-match']);
  });

  it('S7-A1 string concat, a const base, axios, ky and a full URL match; another method or path does not', async () => {
    const root = shopWith();
    writeFileSync(
      join(root, 'src/client.ts'),
      [
        "import axios from 'axios';",
        "import ky from 'ky';",
        "const API = '/api';",
        'export function viaAxios(id: string) { return axios.get(API + \'/orders/\' + id); }',
        'export function viaKy(base: string, id: string) { return ky(`${base}/api/orders/${id}`, { method: \'get\' }); }',
        'export function viaUrl(id: string) { return fetch(`https://shop.example/api/orders/${id}?full=1`); }',
        "export function viaConfig(id: string) { return axios({ url: '/api/orders/' + id, method: 'GET' }); }",
        "export function viaPost(id: string) { return fetch('/api/orders/' + id, { method: 'POST' }); }",
        "export function viaOther() { return fetch('/api/users/1'); }",
        "export function serve(app: any) { app.get('/api/orders/:id', (req: any, res: any) => res.send(req)); }",
        '',
      ].join('\n'),
    );
    const graph = graphOf(root);
    const route = await graph.show('get_order');
    expect(edgesOf(route, 'http-calls')).toEqual([
      'loadOrder -> get_order name-match',
      'viaAxios -> get_order name-match',
      'viaConfig -> get_order name-match',
      'viaKy -> get_order name-match',
      'viaUrl -> get_order name-match',
    ]);
  });

  it('S7-A1 a client URL becomes a path with {} for each part not known', () => {
    expect(clientPath('/api/orders/{}')).toBe('/api/orders/{}');
    expect(clientPath('http://localhost:8000/api/orders/{}?x={}#top')).toBe('/api/orders/{}');
    expect(clientPath('{}/api/orders/order-{}/')).toBe('/api/orders/{}');
    expect(clientPath('{}')).toBeUndefined();
    expect(clientPath('orders')).toBeUndefined();
  });

  it('S7-A2 with an OpenAPI spec that has the route, the loadOrder fetch → get_order edge is exact, source openapi', async () => {
    const graph = graphOf(shopWith('openapi'));
    const answer = await graph.show('loadOrder');
    expect(edge(answer, 'http-calls', 'loadOrder', 'get_order')).toMatchObject({ trust: 'exact', source: 'openapi' });
  });

  it('S7-A2 a route the spec does not have stays name-match; a generated client call by operationId is exact', async () => {
    const root = shopWith('openapi');
    writeFileSync(
      join(root, 'api/users.py'),
      'from fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.get("/api/users/{user_id}")\ndef get_user(user_id: str) -> dict:\n    return {"id": user_id}\n',
    );
    writeFileSync(
      join(root, 'src/users.ts'),
      "import { getOrder as fetchOrder } from '@shop/client';\nexport function loadUser(id: string) { return fetch(`/api/users/${id}`); }\nexport function viaSdk(id: string) { return fetchOrder({ orderId: id }); }\n",
    );
    const graph = graphOf(root);
    expect(edgesOf(await graph.show('get_user'), 'http-calls')).toEqual(['loadUser -> get_user name-match']);
    expect(edge(await graph.show('viaSdk'), 'http-calls', 'viaSdk', 'get_order')).toMatchObject({ trust: 'exact', source: 'openapi' });
  });

  it('S7-A2 a new spec makes the next query update, with no source file changed', async () => {
    const root = shopWith();
    const graph = graphOf(root);
    expect(edge(await graph.show('loadOrder'), 'http-calls', 'loadOrder', 'get_order')?.trust).toBe('name-match');
    writeFileSync(join(root, 'openapi.json'), JSON.stringify({ openapi: '3.1.0', paths: { '/api/orders/{id}': { get: { operationId: 'getOrder' } } } }));
    const answer = await graph.show('loadOrder');
    expect(graph.lastRun()).toMatchObject({ mode: 'update', changedFiles: 0 });
    expect(edge(answer, 'http-calls', 'loadOrder', 'get_order')?.trust).toBe('exact');
  });
});

describe('S8 builds and changes', () => {
  it('S8-A1 a commit with "Flow-Box: checkout/pay" that changed lines of charge links box and commit to charge, exact, source git', async () => {
    const root = shopWith();
    initRepo(root);
    edit(root, 'src/pay.ts', '// The card network says yes for every amount in the fixture.', '// The card network says yes to every amount.');
    const sha = commitAll(root, 'Pay: reword a comment\n\nFlow-Box: checkout/pay');
    const graph = graphOf(root);
    const answer = await graph.show('charge');
    expect(edge(answer, 'builds', 'checkout/pay', 'charge')).toMatchObject({ trust: 'exact', source: 'git', from: gitBoxId('checkout/pay') });
    expect(edge(answer, 'changes', sha.slice(0, 7), 'charge')).toMatchObject({ trust: 'exact', source: 'git', from: commitId(sha) });
    // Only the code the commit changed: no other function has a builds edge.
    const box = await graph.show(gitBoxId('checkout/pay'));
    expect(edgesOf(box, 'builds')).toEqual(['checkout/pay -> charge exact']);
    // The commit without a trailer makes no node.
    expect((await graph.find('initial')).nodes.filter((n) => n.kind === 'commit')).toEqual([]);
  });

  it('S8-A1 the box of the trailer is the record box node, also when the trailer names the EPIC folder', async () => {
    const root = shopWith('record');
    initRepo(root);
    edit(root, 'src/pay.ts', 'if (amount < 0) {', 'if (amount <= -1) {');
    commitAll(root, 'Pay: refuse a negative amount\n\nFlow-Box: 2026-01-01-shop/checkout/pay');
    const graph = graphOf(root);
    const answer = await graph.show('charge');
    expect(edge(answer, 'builds', 'checkout/pay', 'charge')).toMatchObject({ from: recordId('2026-01-01-shop', 'box', 'checkout/pay'), trust: 'exact' });
    expect(answer.edges.some((e) => e.from === gitBoxId('checkout/pay'))).toBe(false);
  });

  it('S8-A1 a new commit with no file change updates the graph and blames only the files it touched', async () => {
    const root = shopWith('record');
    initRepo(root);
    edit(root, 'src/pay.ts', 'if (amount < 0) {', 'if (amount <= -1) {');
    commitAll(root, 'Pay\n\nFlow-Box: checkout/pay');
    const git = countingGit();
    const graph = graphOf(root, { linkers: defaultLinkers({ git: git.run }) });
    await graph.update();
    edit(root, 'src/orders.ts', "if (id === '') {", 'if (id.length === 0) {');
    await graph.update();
    expect(graph.lastRun()).toMatchObject({ mode: 'update', changedFiles: 1 });
    git.calls.length = 0;
    commitAll(root, 'Orders: test the id length\n\nFlow-Box: orders/get');
    const answer = await graph.show('getOrderById');
    expect(graph.lastRun()).toMatchObject({ mode: 'update', changedFiles: 0, status: 'written' });
    expect(edge(answer, 'builds', 'orders/get', 'getOrderById')?.trust).toBe('exact');
    expect(git.calls.filter((c) => c[0] === 'blame')).toEqual([['blame', 'src/orders.ts']]);
    expect(git.calls.find((c) => c[0] === 'log')?.at(-1)).toMatch(/^[0-9a-f]{40}\.\.[0-9a-f]{40}$/);
    // Nothing moved: the next query writes nothing.
    await graph.show('getOrderById');
    expect(graph.lastRun()).toMatchObject({ mode: 'none', status: 'unchanged' });
  });

  it('S8-A1 outside a git repo, or when git fails, the git linker gives no rows and the query answers', async () => {
    const failing: GitRunner = async () => ({ ok: false, stdout: '', stderr: 'fatal: not a git repository' });
    const graph = graphOf(shopWith(), { linkers: [gitLinker({ run: failing })] });
    const answer = await graph.show('charge');
    expect(answer.ok).toBe(true);
    expect(answer.edges.filter((e) => e.source === 'git')).toEqual([]);
  });

  it('S8-A1 the trailer log and the porcelain blame parse from fake git output', () => {
    const a = 'a'.repeat(40);
    const b = 'b'.repeat(40);
    const log = `\x1e${a}\x1fPay\x1fcheckout/pay\x1d2026-01-01-shop/orders/get, review\n\nsrc/pay.ts\nsrc/orders.ts\n\x1e${b}\x1fNo trailer\x1f\n\nsrc/x.ts\n`;
    expect(parseTrailerLog(log)).toEqual([
      { sha: a, subject: 'Pay', boxes: ['checkout/pay', '2026-01-01-shop/orders/get', 'review'], files: ['src/pay.ts', 'src/orders.ts'] },
    ]);
    const blame = [`${a} 1 1 2`, 'author x', '\tline 1', `${a} 2 2`, '\tline 2', `${b} 3 3 1`, '\tline 3', `${a} 9 4 1`, '\tline 4'].join('\n');
    expect(parseBlame(blame, new Set([a]))).toEqual([[1, 2, a], [4, 4, a]]);
  });
});

describe('S8 tests edges', () => {
  it('S8-A2 a Vitest test and a pytest test link to the functions they call (tests edges)', async () => {
    const graph = graphOf(shopWith());
    const ts = await graph.show('getOrderById');
    expect(edge(ts, 'tests', 'orders > reads one order by its id', 'getOrderById')).toMatchObject({ trust: 'exact', source: 'ts-morph' });
    expect(ts.edges.find((e) => e.kind === 'tests')).toBeDefined();
    const py = await graph.show('get_order_by_id');
    expect(edge(py, 'tests', 'test_get_order_by_id', 'get_order_by_id')).toMatchObject({ trust: 'exact' });
    // The test files are orders.test.ts and test_orders.py.
    const files = [...ts.edges, ...py.edges].filter((e) => e.kind === 'tests').map((e) => graph.store.node(e.from)?.file);
    expect(files.sort()).toEqual(['api/test_orders.py', 'src/orders.test.ts']);
  });

  it('S8-A2 a test that calls a helper of its test file tests the code the helper calls, not expect or the helper', async () => {
    const root = shopWith();
    writeFileSync(
      join(root, 'src/pay.test.ts'),
      "import { expect, it } from 'vitest';\nimport { charge } from './pay';\n\nfunction chargeTwice(id: string) {\n  return [charge(id, 1), charge(id, 2)];\n}\n\nit('charges twice', () => {\n  expect(chargeTwice('1').length).toBe(2);\n});\n",
    );
    const graph = graphOf(root);
    const answer = await graph.show('charges twice');
    expect(edgesOf(answer, 'tests')).toEqual(['charges twice -> charge exact']);
  });

  it('S8-A2 an edit of a test file makes its tests edges again', async () => {
    const root = shopWith();
    const graph = graphOf(root);
    await graph.update();
    edit(root, 'src/orders.test.ts', "expect(getOrderById('1').id).toBe('1');", "expect(getOrderById('1').id).toBe(loadRow('1').id);");
    edit(root, 'src/orders.test.ts', "import { getOrderById } from './orders';", "import { getOrderById, loadRow } from './orders';");
    const answer = await graph.show('loadRow');
    expect(edge(answer, 'tests', 'orders > reads one order by its id', 'loadRow')).toBeDefined();
  });
});

describe('G30 record links', () => {
  const id = (kind: 'requirement' | 'story' | 'box' | 'scenario', name: string) => recordId('2026-01-01-shop', kind, name);

  it('G30 the record gives requirement, story, box and scenario nodes, linked by references edges', async () => {
    const graph = graphOf(shopWith('record'), { linkers: [recordLinker()] });
    await graph.update();
    const nodes = graph.store.nodesWhere("language = 'record'").map((n) => `${n.kind} ${n.name}`);
    expect(nodes.sort()).toEqual(['box checkout', 'box checkout/pay', 'box orders', 'box orders/get', 'requirement R1', 'scenario S1-get', 'story S1']);
    const edges = graph.store.edgesWhere("source = 'record'").map((e) => `${e.from} -> ${e.to} ${e.kind} ${e.trust}`);
    expect(edges.sort()).toEqual(
      [
        `${id('box', 'checkout/pay')} -> ${id('story', 'S1')} references exact`, // S9 is not in the record: no edge
        `${id('box', 'orders/get')} -> ${id('story', 'S1')} references exact`,
        `${id('scenario', 'S1-get')} -> ${id('box', 'orders/get')} references exact`, // no/such/box: no edge
        `${id('story', 'S1')} -> ${id('requirement', 'R1')} references exact`,
      ].sort(),
    );
    const box = await graph.show('orders/get');
    expect(box.nodes[0]).toMatchObject({ kind: 'box', file: 'docs/epics/2026-01-01-shop/flow.yaml', range: '10-13' });
    expect(box.nodes[0]!.code).toContain('title: Get one order');
  });

  it('G30 a record edit makes the next query update with no source file changed; no edit writes nothing', async () => {
    const root = shopWith('record');
    const graph = graphOf(root);
    await graph.update();
    await graph.update();
    expect(graph.lastRun()).toMatchObject({ mode: 'none' });
    edit(root, 'docs/epics/2026-01-01-shop/flow.yaml', 'title: Orders', 'title: Orders\n      stories: [S1]');
    const answer = await graph.near('S1');
    expect(graph.lastRun()).toMatchObject({ mode: 'update', changedFiles: 0 });
    expect(edge(answer, 'references', 'orders', 'S1')).toBeDefined();
  });
});

describe('S2 near with links', () => {
  it('S2-A2 near getOrderById lists the caller, the callee, the test and the box, each with kind and trust, and nothing two edges away', async () => {
    const root = shopWith('record');
    initRepo(root);
    edit(root, 'src/orders.ts', "if (id === '') {", 'if (id.length === 0) {');
    commitAll(root, 'Orders: test the id length\n\nFlow-Box: orders/get');
    const graph = graphOf(root);
    const answer = await graph.near('getOrderById');
    expect(edge(answer, 'calls', 'loadOrder', 'getOrderById')).toBeDefined();
    expect(edge(answer, 'calls', 'getOrderById', 'loadRow')).toBeDefined();
    expect(edge(answer, 'tests', 'orders > reads one order by its id', 'getOrderById')).toBeDefined();
    expect(edge(answer, 'builds', 'orders/get', 'getOrderById')).toMatchObject({ trust: 'exact', source: 'git', from: id('orders/get') });
    const linked = answer.nodes.filter((n) => n.distance === 1);
    expect(linked.map((n) => n.name)).toEqual(expect.arrayContaining(['loadOrder', 'loadRow', 'orders > reads one order by its id', 'orders/get']));
    expect(linked.find((n) => n.kind === 'test')?.file).toBe('src/orders.test.ts');
    expect(answer.nodes.map((n) => n.name)).not.toContain('getOrder');
    for (const e of answer.edges) {
      expect(e.kind).toBeDefined();
      expect(TRUSTS).toContain(e.trust);
    }
  });

  function id(box: string): string {
    return recordId('2026-01-01-shop', 'box', box);
  }
});

describe('linkers stay deterministic', () => {
  it('an update gives the same links as a cold index of the same files', async () => {
    const root = shopWith('record', 'openapi');
    initRepo(root);
    edit(root, 'src/pay.ts', 'if (amount < 0) {', 'if (amount <= -1) {');
    commitAll(root, 'Pay\n\nFlow-Box: checkout/pay');
    const graph = graphOf(root);
    await graph.update();
    edit(root, 'src/orders.ts', "if (id === '') {", 'if (id.length === 0) {');
    commitAll(root, 'Orders\n\nFlow-Box: orders/get');
    await graph.update();
    const dump = () => ({ nodes: graph.store.allNodes(), edges: graph.store.edgesWhere('1') });
    const updated = dump();
    await graph.update(true);
    expect(graph.lastRun()?.mode).toBe('cold');
    expect(dump()).toEqual(updated);
    expect(updated.edges.filter((e) => ['tests', 'builds', 'changes', 'http-calls', 'references'].includes(e.kind)).length).toBeGreaterThan(8);
  });
});
