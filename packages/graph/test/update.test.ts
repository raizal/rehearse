// S5: the graph stays fresh. Each query hashes the files and reads again only the changed ones;
// a missing store makes a cold index; --rebuild forces one (G4, G5, G13).

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GRAPH_DB, openGraph, type Graph } from '../src/index.js';
import { copyFixture } from './helpers.js';

const open: Graph[] = [];
function graphOf(root: string): Graph {
  const g = openGraph(root);
  open.push(g);
  return g;
}

afterEach(() => {
  for (const g of open.splice(0)) g.close();
});

const SOURCES = ['api/orders.py', 'api/test_orders.py', 'src/orders.test.ts', 'src/orders.ts', 'src/pay.ts'];

describe('S5 freshness', () => {
  it('S5-A1 after one file changes, the next query reads only that file and answers with the new code', async () => {
    const root = copyFixture('shop');
    const graph = graphOf(root);
    await graph.update();
    const file = join(root, 'src/orders.ts');
    writeFileSync(file, readFileSync(file, 'utf8').replace('const row = loadRow(id);', 'const row = loadRow(id.trim());'));
    const answer = await graph.show('getOrderById');
    expect(graph.lastRun()).toMatchObject({ mode: 'update', trigger: 'query', changedFiles: 1, files: SOURCES.length, status: 'written' });
    expect(answer.nodes[0]?.code).toContain('loadRow(id.trim())');
    expect(answer.edges.find((e) => e.toName === 'loadRow')).toBeDefined();
  });

  it('S5-A1 an update keeps the edges from unchanged files to the changed one, and drops a removed file', async () => {
    const root = copyFixture('shop');
    const graph = graphOf(root);
    await graph.update();
    const file = join(root, 'src/orders.ts');
    writeFileSync(file, `// one more line\n${readFileSync(file, 'utf8')}`);
    const near = await graph.near('getOrderById');
    expect(near.nodes[0]?.range).toBe('13-21');
    expect(near.edges.find((e) => e.fromName === 'orders > reads one order by its id' && e.toName === 'getOrderById')).toBeDefined();
    rmSync(join(root, 'src/pay.ts'));
    expect(await graph.show('charge')).toMatchObject({ exitCode: 1, notes: ['not found'] });
    expect(graph.lastRun()).toMatchObject({ mode: 'update', changedFiles: 0, files: SOURCES.length - 1, status: 'written' });
  });

  it('S5-A2 the first query with no graph.db makes a cold index and answers', async () => {
    const root = copyFixture('shop');
    expect(existsSync(join(root, GRAPH_DB))).toBe(false);
    const graph = graphOf(root);
    const answer = await graph.find('order by id');
    expect(existsSync(join(root, GRAPH_DB))).toBe(true);
    expect(graph.lastRun()).toMatchObject({ mode: 'cold', status: 'written', changedFiles: SOURCES.length, resolvers: ['tree-sitter', 'ts-morph', 'scip-python'] });
    expect(answer.nodes[0]?.name).toBe('getOrderById');
  });

  it('S5-A2 a store with the graph tables but no finished index is indexed cold again', async () => {
    const root = copyFixture('shop');
    graphOf(root).close();
    open.length = 0;
    const graph = graphOf(root);
    await graph.update();
    expect(graph.lastRun()?.mode).toBe('cold');
  });

  it('S5-A3 --rebuild makes a cold index of every file, even with no change', async () => {
    const root = copyFixture('shop');
    const graph = graphOf(root);
    await graph.update();
    await graph.update();
    expect(graph.lastRun()).toMatchObject({ mode: 'none', status: 'unchanged', changedFiles: 0 });
    const answer = await graph.find('order by id', { rebuild: true });
    expect(graph.lastRun()).toMatchObject({ mode: 'cold', status: 'written', changedFiles: SOURCES.length });
    expect(answer.nodes[0]?.name).toBe('getOrderById');
    expect(graph.store.files().map((f) => f.path)).toEqual(SOURCES);
    expect(graph.store.runs().map((r) => r.mode)).toEqual(['cold', 'none', 'cold']);
  });

  // An update confirms Python sites with basedpyright, a cold index with scip-python: the same edges and
  // trust, another source. So the edges are compared without their source.
  it('S5 an update gives the same graph as a cold index of the same files', async () => {
    const root = copyFixture('shop');
    const graph = graphOf(root);
    await graph.update();
    const file = join(root, 'api/orders.py');
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, text.replace('def load_row', 'def read_row').replace('load_row(order_id)', 'read_row(order_id)'));
    await graph.update();
    writeFileSync(file, text);
    await graph.update();
    const dump = () => JSON.stringify([graph.store.allNodes(), graph.store.edgesWhere('1').map(({ source: _, ...e }) => e)]);
    const updated = dump();
    await graph.update(true);
    expect(dump()).toBe(updated);
  });
});
