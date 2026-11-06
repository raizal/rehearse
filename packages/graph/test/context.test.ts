// S4: `context <target> --budget <tokens>` (G6, G14, G19). The `context` fixture is a TypeScript shop
// where getOrderById and the code linked to it have about 9,000 characters (scenario S4-context-budget).
// Wave 1 has no `tests` edge: the test reaches getOrderById by its call, so its role is `caller`.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  answerToJson, answerToText, contextBuilder, DEFAULT_BUDGET, NO_VENV, openGraph, storeView,
  type ContextBundle, type Graph, type GraphEdge, type GraphNode, type GraphView, type IndexRun, type Resolver,
} from '../src/index.js';
import { copyFixture, snapshot } from './helpers.js';

let graph: Graph | undefined;
afterEach(() => graph?.close());

async function open(fixture: string, opts: Parameters<typeof openGraph>[1] = {}): Promise<{ root: string; graph: Graph }> {
  const root = copyFixture(fixture);
  graph = openGraph(root, opts);
  await graph.update();
  return { root, graph };
}

const TEST_NAME = 'orders > reads one order by its id, with the total of its lines in cents';
const names = (b: ContextBundle) => b.items.map((i) => i.node.name);

describe('S4-A1 the bundle fills the budget: target first, then graph distance, then PageRank', () => {
  it('S4-A1 context getOrderById --budget 2000: at most 2,000 tokens of 9,000 characters, in order', async () => {
    const { graph } = await open('context');
    const all = (await graph.context('getOrderById', { budget: 100_000 })).bundle!;
    const linkedChars = all.items.reduce((s, i) => s + i.code.length, 0);
    expect(linkedChars).toBeGreaterThan(9000);
    expect(linkedChars).toBeLessThan(9500);

    const answer = await graph.context('getOrderById', { budget: 2000 });
    expect(answer).toMatchObject({ verb: 'context', ok: true, exitCode: 0 });
    const bundle = answer.bundle!;
    expect(bundle).toMatchObject({ budget: 2000, target: { name: 'getOrderById' } });
    expect(bundle.tokens).toBeLessThanOrEqual(2000);
    expect(bundle.tokens).toBe(1988);
    expect(names(bundle)).toEqual(['getOrderById', 'loadRow', 'loadOrder', TEST_NAME]);
    expect(bundle.items.map((i) => [i.role, i.distance])).toEqual([['target', 0], ['callee', 1], ['caller', 1], ['caller', 1]]);
    expect(bundle.items[3]!.node.file).toBe('src/orders.test.ts');
    // getOrder (distance 2, it calls loadOrder) does not fit any more.
    expect(names(all)).toContain('getOrder');
    expect(names(bundle)).not.toContain('getOrder');
  });

  it('S4-A1 the items are in order of distance, then PageRank (high first), and each token count is its characters ÷ 4', async () => {
    const { graph } = await open('context');
    const bundle = (await graph.context('getOrderById', { budget: 100_000 })).bundle!;
    for (let i = 2; i < bundle.items.length; i++) {
      const [a, b] = [bundle.items[i - 1]!, bundle.items[i]!];
      expect(a.distance <= b.distance).toBe(true);
      if (a.distance === b.distance) expect(a.node.rank).toBeGreaterThanOrEqual(b.node.rank);
    }
    for (const item of bundle.items) expect(item.tokens).toBe(Math.ceil(item.code.length / 4));
    expect(bundle.tokens).toBe(bundle.items.reduce((s, i) => s + i.tokens, 0));
  });

  it('S4-A1 no budget goes over, and a target bigger than the budget is cut at a line with a note', async () => {
    const { graph } = await open('context');
    for (const budget of [1, 50, 400, 1000, 1500, 2300, 3000]) {
      const answer = await graph.context('getOrderById', { budget });
      expect(answer.bundle!.tokens).toBeLessThanOrEqual(budget);
      expect(answer.bundle!.items[0]!.node.name).toBe('getOrderById');
    }
    const small = (await graph.context('getOrderById', { budget: 50 })).bundle!;
    expect(small.items).toHaveLength(1);
    expect(small.notes).toEqual(['the target is cut to fit the budget of 50 tokens']);
    expect(small.items[0]!.code.startsWith('export function getOrderById(id: string): Order {\n')).toBe(true);
    // A smaller item still goes in after a bigger one that does not fit.
    // 357 + 594 tokens, then loadOrder (655) does not fit in 1,350 and the test (382) does.
    const mid = (await graph.context('getOrderById', { budget: 1350 })).bundle!;
    expect(names(mid)).toEqual(['getOrderById', 'loadRow', TEST_NAME]);
  });

  it('S4-A1 the code of an item is its lines in the file, the same as show', async () => {
    const { graph } = await open('context');
    const bundle = (await graph.context('getOrderById')).bundle!;
    expect(bundle.budget).toBe(DEFAULT_BUDGET);
    expect(bundle.items[0]!.code).toBe((await graph.show('getOrderById')).nodes[0]!.code);
  });

  it('S4-A1 a file target holds its functions: they are not items again, and their neighbours are at distance 1', async () => {
    const { graph } = await open('context');
    const bundle = (await graph.context('src/db.ts', { budget: 100_000 })).bundle!;
    expect(bundle.items[0]!.node).toMatchObject({ kind: 'file', file: 'src/db.ts' });
    expect(names(bundle)).not.toContain('loadRow');
    expect(bundle.items.find((i) => i.node.name === 'getOrderById')).toMatchObject({ distance: 1, role: 'caller' });
    // No item overlaps another one of the same file.
    for (const a of bundle.items) {
      for (const b of bundle.items) {
        if (a === b || a.node.file !== b.node.file) continue;
        const [as, ae] = a.node.range!.split('-').map(Number) as [number, number];
        const [bs, be] = b.node.range!.split('-').map(Number) as [number, number];
        expect(as > be || bs > ae).toBe(true);
      }
    }
  });

  it('S4-A1 the answer lists the item nodes with their distance and the edges between them', async () => {
    const { graph } = await open('context');
    const answer = await graph.context('getOrderById', { budget: 2000 });
    expect(answer.nodes.map((n) => [n.name, n.distance])).toEqual([['getOrderById', 0], ['loadRow', 1], ['loadOrder', 1], [TEST_NAME, 1]]);
    expect(answer.edges.map((e) => `${e.fromName} ${e.kind} ${e.toName}`).sort()).toEqual([
      'getOrderById calls loadRow', 'loadOrder calls getOrderById', `${TEST_NAME} calls getOrderById`,
    ]);
    const text = answerToText(answer);
    expect(text.split('\n')[0]).toBe('context getOrderById: 1988 of 2000 tokens, 4 items');
    expect(text).toContain('== 1 callee: function loadRow  src/db.ts:14-71\nexport function loadRow(id: string): Row {');
  });

  it('S4-A1 a target-only node is in reach but not walked through: two tests that both call expect are not near', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rehearse-context-'));
    writeFileSync(join(root, 'a.test.ts'), 'one\ntwo\n');
    const fn = (id: string, range: string): GraphNode => ({ id, kind: 'test', name: id, terms: id, language: 'typescript', file: 'a.test.ts', range, targetOnly: false, rank: 0 });
    const nodes = new Map<string, GraphNode>([
      ['t1', fn('t1', '1-1')], ['t2', fn('t2', '2-2')],
      ['expect', { id: 'expect', kind: 'function', name: 'expect', terms: 'expect', language: 'typescript', targetOnly: true, rank: 1 }],
    ]);
    const edges: GraphEdge[] = ['t1', 't2'].map((from) => ({ from, to: 'expect', kind: 'calls', trust: 'unresolved', source: 'tree-sitter' }));
    const view: GraphView = {
      node: (id) => nodes.get(id),
      nodesInFile: () => [],
      nodesNamed: () => [],
      edges: (f) => edges.filter((e) => (f.from === undefined || e.from === f.from) && (f.to === undefined || e.to === f.to) && (f.kind === undefined || e.kind === f.kind)),
    };
    const run: IndexRun = { id: 1, mode: 'cold', trigger: 'query', files: 1, changedFiles: 1, resolvers: [], startedAt: '', ms: 0, status: 'written' };
    const bundle = await contextBuilder(root).build(view, nodes.get('t1')!, 100, run);
    expect(names(bundle)).toEqual(['t1']);
  });

  it('S2-A3 / G27 an unknown target exits 1 with "not found" and changes no file', async () => {
    const { root, graph } = await open('context');
    const before = snapshot(root);
    expect(await graph.context('noSuchThing')).toMatchObject({ verb: 'context', ok: false, exitCode: 1, notes: ['not found'] });
    expect(snapshot(root)).toEqual(before);
  });
});

/** A stand-in for T29's Python resolver: a call to a function of the repo is `exact`. */
const fakePythonResolver: Resolver = {
  name: 'scip-python',
  language: 'python',
  async resolve({ refs, graph }) {
    return refs.flatMap((ref) => {
      const target = graph.nodesNamed(ref.name).find((n) => !n.targetOnly && n.language === 'python');
      return target ? [{ ref, target, trust: 'exact' as const }] : [];
    });
  },
};

describe('S4-A2 a Python repo with no virtual environment', () => {
  it('S4-A2 context get_order_by_id exits 0 and says "no venv found"; repo edges exact, third-party edges unresolved', async () => {
    const { graph } = await open('shop', { resolvers: [fakePythonResolver] });
    expect(graph.lastRun()!.venv).toBeUndefined();
    const answer = await graph.context('get_order_by_id', { budget: 2000 });
    expect(answer).toMatchObject({ ok: true, exitCode: 0 });
    expect(answer.bundle!.notes).toEqual([NO_VENV]);
    expect(answer.notes).toEqual([NO_VENV]);
    expect(answerToText(answer)).toContain(`note: ${NO_VENV}`);
    expect(answer.edges.length).toBeGreaterThan(0);
    for (const e of answer.edges) expect(e.trust).toBe('exact');
    const fetchRemote = (await graph.show('fetch_remote')).edges.filter((e) => e.kind === 'calls');
    expect(fetchRemote.map((e) => [e.toName, e.trust])).toEqual([['requests.get', 'unresolved']]);
  });

  it('S4-A2 with a .venv the note is gone', async () => {
    const root = copyFixture('shop');
    mkdirSync(join(root, '.venv'));
    writeFileSync(join(root, '.venv/pyvenv.cfg'), 'home = /usr/bin\n');
    graph = openGraph(root);
    const answer = await graph.context('get_order_by_id');
    expect(graph.lastRun()!.venv).toBe('.venv');
    expect(answer.notes).toEqual([]);
  });

  it('S4-A2 the note comes from the run: a run with no venv notes a Python bundle, never a TypeScript one', async () => {
    const { root, graph } = await open('shop');
    const view = storeView(graph.store);
    const node = (name: string) => graph.store.nodesWhere('name = ? AND target_only = 0', name)[0]!;
    const run = (venv?: string): IndexRun => ({
      id: 1, mode: 'cold', trigger: 'query', files: 5, changedFiles: 5, resolvers: ['tree-sitter'], startedAt: '', ms: 0, status: 'written',
      ...(venv !== undefined ? { venv } : {}),
    });
    const builder = contextBuilder(root);
    expect((await builder.build(view, node('get_order_by_id'), 2000, run())).notes).toEqual([NO_VENV]);
    expect((await builder.build(view, node('get_order_by_id'), 2000, run('.venv'))).notes).toEqual([]);
    expect((await builder.build(view, node('getOrderById'), 2000, run())).notes).toEqual([]);
  });
});

describe('S4-A3 the same question gives the same bytes', () => {
  it('S4-A3 context getOrderById --budget 2000 two times, and after a rebuild, gives byte-identical answers', async () => {
    const { graph } = await open('context');
    const one = await graph.context('getOrderById', { budget: 2000 });
    const two = await graph.context('getOrderById', { budget: 2000 });
    expect(answerToJson(two)).toBe(answerToJson(one));
    expect(answerToText(two)).toBe(answerToText(one));
    const three = await graph.context('getOrderById', { budget: 2000, rebuild: true });
    expect(graph.lastRun()!.mode).toBe('cold');
    expect(answerToJson(three)).toBe(answerToJson(one));
  });

  it('S4-A3 no LLM and no embeddings: the context and rank code imports only node built-ins and the package', () => {
    const src = new URL('../src/', import.meta.url).pathname;
    for (const dir of ['context', 'rank']) {
      for (const file of readdirSync(join(src, dir))) {
        const imports = [...readFileSync(join(src, dir, file), 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
        for (const i of imports) expect(i.startsWith('node:') || i.startsWith('.'), `${dir}/${file} imports ${i}`).toBe(true);
      }
    }
  });
});
