// T40: the code map, one level at a time (packages, package, file), from a small made-up graph and
// from the shop and monorepo fixtures.

import { afterEach, describe, expect, it } from 'vitest';
import { MapIndex, openGraph, packageOf, type GraphEdge, type GraphNode, type Graph, type NodeKind } from '../src/index.js';
import { copyFixture } from './helpers.js';

const ts = (pkg: string, path: string, name?: string, kind: NodeKind = name ? 'function' : 'file', rank = 0.01): GraphNode => ({
  id: `scip-typescript npm ${pkg} 1.0 ${path}/${name ? `${name}().` : ''}`,
  kind, name: name ?? path.split('/').pop()!, terms: '', language: 'typescript', file: path, range: name ? '1-5' : '1-40', targetOnly: false, rank,
});
const outside = (pkg: string, name: string): GraphNode => ({
  id: `scip-typescript npm ${pkg} . ${pkg}/${name}().`, kind: 'function', name, terms: '', language: 'typescript', targetOnly: true, rank: 0.001,
});
const box = (epic: string, path: string): GraphNode => ({
  id: `rehearse record ${epic} . box:${path}`, kind: 'box', name: path, terms: '', language: 'record', file: `docs/epics/${epic}/flow.yaml`, targetOnly: false, rank: 0,
});
const edge = (from: GraphNode, to: GraphNode, kind: GraphEdge['kind'] = 'calls', trust: GraphEdge['trust'] = 'exact'): GraphEdge => ({ from: from.id, to: to.id, kind, trust, source: 'ts-morph' });

// Two packages, a: index.ts (run, helper) and its test; b: index.ts (pay). A fixture package inside a.
const aFile = ts('@m/a', 'packages/a/src/index.ts');
const run = ts('@m/a', 'packages/a/src/index.ts', 'run', 'function', 0.2);
const helper = ts('@m/a', 'packages/a/src/index.ts', 'helper', 'function', 0.05);
const aTestFile = ts('@m/a', 'packages/a/test/index.test.ts');
const aTest = ts('@m/a', 'packages/a/test/index.test.ts', 'runs', 'test');
const bFile = ts('@m/b', 'packages/b/src/index.ts');
const pay = ts('@m/b', 'packages/b/src/index.ts', 'pay', 'function', 0.4);
const fixture = ts('fixture-app', 'packages/a/test/fixtures/app/main.ts', 'main');
const loose = { ...ts('.', 'scripts/tool.ts', 'tool'), id: 'scip-typescript npm . . scripts/tool.ts/tool().' };
const lodash = outside('lodash', 'get');
const payBox = box('2026-01-01-shop', 'checkout/pay');
const runBox = box('2026-02-02-ops', 'ops/run');

const NODES = [aFile, run, helper, aTestFile, aTest, bFile, pay, fixture, loose, lodash, payBox, runBox];
const EDGES: GraphEdge[] = [
  edge(aFile, bFile, 'imports'),
  edge(run, pay),
  edge(run, helper),
  edge(helper, pay, 'calls', 'name-match'),
  edge(run, lodash),
  edge(aTest, run),
  edge(aFile, run, 'defines'),
  { ...edge(payBox, pay, 'builds'), source: 'git' },
  { ...edge(runBox, run, 'builds'), source: 'git' },
  edge(fixture, run),
];

const index = () => new MapIndex(NODES, EDGES);

describe('T40 code map: packages', () => {
  it('one node per package, sized by summed PageRank; a package in a package folds into it; a file of no package goes to its top folder', () => {
    const m = index().level({ level: 'packages' });
    expect(m).toMatchObject({ ok: true, level: 'packages', name: 'the repo' });
    const byId = Object.fromEntries(m.nodes.map((n) => [n.id, n]));
    expect(Object.keys(byId).sort()).toEqual(['@m/a', '@m/b', 'dir:scripts', 'outside:lodash']);
    // The fixture's main is below a test folder: test code, not a function of the package.
    expect(byId['@m/a']).toMatchObject({ kind: 'package', files: 2, functions: 2, tests: 1, outside: false });
    expect(byId['@m/a']!.rank).toBeCloseTo(0.01 + 0.2 + 0.05 + 0.01 + 0.01 + 0.01, 6);
    expect(byId['dir:scripts']).toMatchObject({ name: 'scripts/', functions: 1 });
    expect(byId['outside:lodash']).toMatchObject({ kind: 'outside', outside: true });
    expect(m.totals).toEqual({ packages: 3, files: 3, functions: 4, tests: 1 });
  });

  it('edges between packages are counted, with the best trust; defines and builds edges do not count', () => {
    const m = index().level({ level: 'packages' });
    expect(m.edges).toEqual([
      { from: '@m/a', to: '@m/b', count: 3, exact: 2, trust: 'exact', kinds: ['calls', 'imports'] },
      { from: '@m/a', to: 'outside:lodash', count: 1, exact: 1, trust: 'exact', kinds: ['calls'] },
    ]);
  });

  it('each node says which plan boxes it serves, and the EPICs of those boxes are listed', () => {
    const ix = index();
    const m = ix.level({ level: 'packages' });
    expect(m.epics).toEqual(['2026-01-01-shop', '2026-02-02-ops']);
    expect(m.nodes.find((n) => n.id === '@m/b')!.boxes).toEqual([{ id: payBox.id, path: 'checkout/pay', epic: '2026-01-01-shop' }]);
    expect(ix.level({ level: 'packages', epic: '2026-01-01-shop' }).nodes.map((n) => n.id)).toEqual(['@m/b']);
  });

  it('hide tests and hide outside leave those nodes and their edges out', () => {
    const m = index().level({ level: 'packages', hideTests: true, hideOutside: true });
    expect(m.nodes.map((n) => n.id).sort()).toEqual(['@m/a', '@m/b', 'dir:scripts']);
    expect(m.nodes.find((n) => n.id === '@m/a')).toMatchObject({ files: 1, tests: 0, functions: 2 });
  });

  it('never more than the limit: the rest fold into "+N more"', () => {
    const many = Array.from({ length: 30 }, (_, i) => ts(`p${String(i).padStart(2, '0')}`, `p${i}/x.ts`, 'f', 'function', i / 100));
    const m = new MapIndex(many, []).level({ level: 'packages', limit: 10 });
    expect(m.nodes).toHaveLength(10);
    expect(m.nodes.at(-1)).toMatchObject({ id: 'more:packages', kind: 'more', more: 21 });
    expect(m.nodes[0]!.id).toBe('p29');
  });
});

describe('T40 code map: package and file', () => {
  it('a package: its files with the edges among them, and stubs to the packages they use', () => {
    const m = index().level({ level: 'package', target: '@m/a' });
    expect(m).toMatchObject({ ok: true, name: '@m/a', unit: { key: '@m/a', name: '@m/a' } });
    const ids = m.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['packages/a/src/index.ts', 'packages/a/test/fixtures/app/main.ts', 'packages/a/test/index.test.ts', 'unit:@m/b', 'unit:outside:lodash']);
    expect(m.nodes.find((n) => n.id === 'packages/a/src/index.ts')).toMatchObject({ kind: 'file', name: 'src/index.ts', test: false, boxes: [{ path: 'ops/run' }] });
    expect(m.nodes.find((n) => n.id === 'packages/a/test/index.test.ts')).toMatchObject({ test: true });
    expect(m.nodes.find((n) => n.id === 'unit:@m/b')).toMatchObject({ kind: 'stub', outside: true, unit: '@m/b' });
    expect(m.edges.find((e) => e.to === 'unit:@m/b')).toMatchObject({ from: 'packages/a/src/index.ts', count: 3 });
    expect(m.edges.find((e) => e.from === 'packages/a/test/index.test.ts')).toMatchObject({ to: 'packages/a/src/index.ts', count: 1 });
  });

  it('a file: its functions and their calls; the code elsewhere is one node per other file or outside package, its calls counted', () => {
    const m = index().level({ level: 'file', target: 'packages/a/src/index.ts' });
    expect(m).toMatchObject({ ok: true, unit: { key: '@m/a' }, hiddenTests: 0 });
    const own = m.nodes.filter((n) => !n.outside).map((n) => n.name).sort();
    expect(own).toEqual(['helper', 'run']);
    const out = Object.fromEntries(m.nodes.filter((n) => n.outside).map((n) => [n.id, n]));
    expect(Object.keys(out).sort()).toEqual(['group:outside:lodash', 'group:packages/a/test/fixtures/app/main.ts', 'group:packages/a/test/index.test.ts', 'group:packages/b/src/index.ts']);
    // pay is called twice (by run and helper): one node for its file, the calls counted, the members listed.
    expect(out['group:packages/b/src/index.ts']).toMatchObject({ kind: 'file', name: 'index.ts', file: 'packages/b/src/index.ts', unit: '@m/b', calls: 2, members: [{ id: pay.id, name: 'pay', kind: 'function', to: 2, from: 0 }] });
    expect(out['group:outside:lodash']).toMatchObject({ kind: 'outside', name: 'lodash', calls: 1, members: [{ name: 'get', to: 1, from: 0 }] });
    expect(out['group:packages/a/test/index.test.ts']).toMatchObject({ test: true, members: [{ name: 'runs', to: 0, from: 1 }] });
    expect(m.edges).toContainEqual({ from: helper.id, to: 'group:packages/b/src/index.ts', count: 1, exact: 0, trust: 'name-match', kinds: ['calls'] });
    expect(m.edges).toContainEqual({ from: run.id, to: 'group:packages/b/src/index.ts', count: 1, exact: 1, trust: 'exact', kinds: ['calls'] });
    expect(m.nodes.find((n) => n.name === 'run')!.boxes.map((b) => b.path)).toEqual(['ops/run']);
    const noTests = index().level({ level: 'file', target: 'packages/a/src/index.ts', hideTests: true, hideOutside: true });
    expect(noTests.nodes.map((n) => n.name).sort()).toEqual(['helper', 'index.ts', 'run']);
  });

  it('many callers in one other file are one node; the edges to it add up', () => {
    const callers = Array.from({ length: 9 }, (_, i) => ts('@m/b', 'packages/b/src/index.ts', `c${i}`));
    const m = new MapIndex([aFile, run, bFile, ...callers], callers.map((c) => edge(c, run))).level({ level: 'file', target: 'packages/a/src/index.ts' });
    expect(m.nodes.filter((n) => n.outside)).toHaveLength(1);
    expect(m.nodes.find((n) => n.outside)).toMatchObject({ name: 'index.ts', calls: 9 });
    expect(m.nodes.find((n) => n.outside)!.members).toHaveLength(9);
    expect(m.edges).toEqual([{ from: 'group:packages/b/src/index.ts', to: run.id, count: 9, exact: 9, trust: 'exact', kinds: ['calls'] }]);
  });

  it('tests hidden say how many; auto hides them unless the level is all tests', () => {
    const ix = index();
    expect(ix.level({ level: 'package', target: '@m/a' }).hiddenTests).toBe(0);
    const auto = ix.level({ level: 'package', target: '@m/a', hideTests: 'auto' });
    // The test file and the fixture below test/ are left out.
    expect(auto.hiddenTests).toBe(2);
    expect(auto.nodes.filter((n) => !n.outside).map((n) => n.id)).toEqual(['packages/a/src/index.ts']);
    expect(ix.level({ level: 'packages', hideTests: true }).hiddenTests).toBe(2);
    expect(ix.level({ level: 'file', target: 'packages/a/src/index.ts', hideTests: true }).hiddenTests).toBe(0);
    // A test file holds only tests: auto shows them.
    const testFile = ix.level({ level: 'file', target: 'packages/a/test/index.test.ts', hideTests: 'auto' });
    expect(testFile).toMatchObject({ hiddenTests: 0 });
    expect(testFile.nodes.filter((n) => !n.outside).map((n) => n.name)).toEqual(['runs']);
  });

  it('an unknown package or file, or an outside package, is not found', () => {
    for (const q of [{ level: 'package' as const, target: 'nope' }, { level: 'package' as const, target: 'outside:lodash' }, { level: 'file' as const, target: 'nope.ts' }]) {
      expect(index().level(q)).toMatchObject({ ok: false, nodes: [], edges: [], notes: ['not found'] });
    }
  });

  it('the place of a code node: its package and file; none for outside or record nodes', () => {
    const ix = index();
    expect(ix.place(pay.id)).toEqual({ unit: '@m/b', file: 'packages/b/src/index.ts' });
    expect(ix.place(fixture.id)).toEqual({ unit: '@m/a', file: 'packages/a/test/fixtures/app/main.ts' });
    expect(ix.place(lodash.id)).toBeUndefined();
    expect(ix.place(payBox.id)).toBeUndefined();
    expect(packageOf(pay.id)).toBe('@m/b');
  });
});

describe('T40 code map on the fixtures', () => {
  let graph: Graph | undefined;
  afterEach(() => graph?.close());

  it('the monorepo: two packages, @mono/b uses @mono/a', async () => {
    graph = openGraph(copyFixture('monorepo'), { linkers: [] });
    await graph.update();
    const m = MapIndex.fromStore(graph.store).level({ level: 'packages', hideOutside: true });
    expect(m.nodes.map((n) => n.id).sort()).toEqual(['@mono/a', '@mono/b']);
    expect(m.edges.map((e) => `${e.from}->${e.to}`)).toContain('@mono/b->@mono/a');
  });

  it('the shop: a file of no package goes to its top folder; a file level lists its functions', async () => {
    graph = openGraph(copyFixture('shop'), { linkers: [] });
    await graph.update();
    const ix = MapIndex.fromStore(graph.store);
    const m = ix.level({ level: 'file', target: 'src/pay.ts' });
    expect(m.ok).toBe(true);
    expect(m.nodes.filter((n) => !n.outside).map((n) => n.name)).toContain('charge');
    expect(ix.level({ level: 'packages' }).totals.files).toBeGreaterThan(3);
  });
});
