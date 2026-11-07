// T43 (S12): unit test coverage on the code graph. lcov parsing, paths, roll-ups per function,
// file, package and box, staleness, no data, and the coverage of one target.

import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  boxCode, boxCoverage, coverageHint, coverageOf, CoverageIndex, findLcovFiles, lineRanges, loadCoverage, MapIndex, mergeCoverage, parseLcov,
  sourcePath, Store, sumStats, withCoverage, type CoverageData, type GraphEdge, type GraphNode, type NodeKind,
} from '../src/index.js';

const LCOV = `TN:
SF:src/pay.ts
FN:1,pay
FN:10,refund
FNDA:3,pay
FNDA:0,refund
FNF:2
FNH:1
DA:2,3
DA:3,3
DA:4,0
DA:5,3
DA:11,0
DA:12,0
BRDA:3,0,0,3
BRDA:3,0,1,0
BRDA:5,1,0,2
BRDA:5,1,1,1
BRDA:11,2,0,-
BRDA:11,2,1,-
LF:6
LH:4
end_of_record
SF:/repo/packages/shop/src/cart.ts
DA:1,1
DA:2,1
end_of_record
`;

describe('T43 lcov: parse', () => {
  it('reads files, line hits, branches per line and functions; "-" is a branch not taken', () => {
    const [pay, cart] = parseLcov(LCOV);
    expect(pay!.file).toBe('src/pay.ts');
    expect([...pay!.lines]).toEqual([[2, 3], [3, 3], [4, 0], [5, 3], [11, 0], [12, 0]]);
    expect(pay!.branches.get(3)).toEqual({ found: 2, hit: 1 });
    expect(pay!.branches.get(5)).toEqual({ found: 2, hit: 2 });
    expect(pay!.branches.get(11)).toEqual({ found: 2, hit: 0 });
    expect(pay!.functions).toEqual([{ name: 'pay', line: 1, hits: 3 }, { name: 'refund', line: 10, hits: 0 }]);
    expect(cart!.file).toBe('/repo/packages/shop/src/cart.ts');
  });

  it('skips junk lines and reads lcov 2 FN lines (line, end, name)', () => {
    const [r] = parseLcov('garbage\nSF:a.ts\nFN:3,9,go\nFNDA:2,go\nDA:x,1\nDA:4,2\r\nend_of_record\nDA:9,9\n');
    expect(r!.functions).toEqual([{ name: 'go', line: 3, hits: 2 }]);
    expect([...r!.lines]).toEqual([[4, 2]]);
  });
});

describe('T43 lcov: paths', () => {
  const exists = (have: string[]) => (abs: string) => have.includes(abs);
  it('a relative SF is tried at the package root (above coverage/), the lcov folder, then the repo root', () => {
    expect(sourcePath('src/pay.ts', 'packages/shop/coverage/lcov.info', '/repo', exists(['/repo/packages/shop/src/pay.ts']))).toBe('packages/shop/src/pay.ts');
    expect(sourcePath('src/pay.ts', 'packages/shop/coverage/lcov.info', '/repo', exists(['/repo/src/pay.ts']))).toBe('src/pay.ts');
    // Nothing exists: the package root guess.
    expect(sourcePath('src/x.ts', 'packages/shop/coverage/lcov.info', '/repo', exists([]))).toBe('packages/shop/src/x.ts');
  });
  it('an absolute SF is made relative to the repo; one outside the repo is dropped', () => {
    expect(sourcePath('/repo/packages/shop/src/cart.ts', 'coverage/lcov.info', '/repo')).toBe('packages/shop/src/cart.ts');
    expect(sourcePath('/elsewhere/x.ts', 'coverage/lcov.info', '/repo')).toBeUndefined();
  });
  it('several lcov files merge: hits add up, branches keep the most taken, the newest report time wins', () => {
    const a = parseLcov('SF:/repo/x.ts\nDA:1,0\nDA:2,1\nBRDA:2,0,0,1\nBRDA:2,0,1,0\nend_of_record\n');
    const b = parseLcov('SF:/repo/x.ts\nDA:1,2\nBRDA:2,0,0,0\nBRDA:2,0,1,4\nend_of_record\n');
    const d = mergeCoverage([{ report: { path: 'a/coverage/lcov.info', mtimeMs: 10, files: 1 }, records: a }, { report: { path: 'b/coverage/lcov.info', mtimeMs: 20, files: 1 }, records: b }], '/repo');
    const x = d.files.get('x.ts')!;
    expect([...x.lines]).toEqual([[1, 2], [2, 1]]);
    expect(x.branches.get(2)).toEqual({ found: 2, hit: 1 });
    expect(x.reportMs).toBe(20);
    expect(d.reports.map((r) => r.path)).toEqual(['a/coverage/lcov.info', 'b/coverage/lcov.info']);
  });
});

// A small graph: pay.ts with pay (1-6) and refund (10-13), cart.ts; a test that calls pay, one that goes through a helper.
const node = (id: string, kind: NodeKind, file: string | undefined, range?: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id: `scip-typescript npm @m/shop 1.0 ${id}`, kind, name: id.replace(/[().#]+$/, '').split('/').pop()!, terms: '', language: 'typescript',
  ...(file !== undefined ? { file } : {}), ...(range !== undefined ? { range } : {}), targetOnly: false, rank: 0.1, ...extra,
});
const payFile = node('packages/shop/src/pay.ts/', 'file', 'packages/shop/src/pay.ts', '1-20');
const pay = node('packages/shop/src/pay.ts/pay().', 'function', 'packages/shop/src/pay.ts', '1-6');
const refund = node('packages/shop/src/pay.ts/refund().', 'function', 'packages/shop/src/pay.ts', '10-13');
const cartFile = node('packages/shop/src/cart.ts/', 'file', 'packages/shop/src/cart.ts', '1-3');
const cart = node('packages/shop/src/cart.ts/cart().', 'function', 'packages/shop/src/cart.ts', '1-3');
const testFile = node('packages/shop/test/pay.test.ts/', 'file', 'packages/shop/test/pay.test.ts', '1-30');
const t1 = node('packages/shop/test/pay.test.ts/pays().', 'test', 'packages/shop/test/pay.test.ts', '5-8');
const t2 = node('packages/shop/test/pay.test.ts/pays twice().', 'test', 'packages/shop/test/pay.test.ts', '10-14');
const helperFn = node('packages/shop/test/pay.test.ts/payTwice().', 'function', 'packages/shop/test/pay.test.ts', '1-3');
const box = (epic: string, path: string): GraphNode => ({
  id: `rehearse record ${epic} . box:${path}`, kind: 'box', name: path, terms: '', language: 'record', file: `docs/epics/${epic}/flow.yaml`, targetOnly: false, rank: 0,
});
const EPIC = '2026-01-01-shop';
const checkout = box(EPIC, 'checkout');
const payBox = box(EPIC, 'checkout/pay');
const refundBox = box(EPIC, 'checkout/refund');
const cartBox = box(EPIC, 'checkout/cart');
const e = (from: GraphNode, to: GraphNode, kind: GraphEdge['kind'], trust: GraphEdge['trust'] = 'exact'): GraphEdge => ({ from: from.id, to: to.id, kind, trust, source: 'ts-morph' });
const NODES = [payFile, pay, refund, cartFile, cart, testFile, t1, t2, helperFn, checkout, payBox, refundBox, cartBox];
const EDGES = [
  e(t1, pay, 'calls'), e(t1, pay, 'tests'),
  e(t2, helperFn, 'calls'), e(helperFn, pay, 'calls'), e(t2, pay, 'tests', 'name-match'),
  e(payBox, pay, 'builds'), e(refundBox, refund, 'builds'),
  e(payFile, pay, 'defines'), e(payFile, refund, 'defines'), e(cartFile, cart, 'defines'),
];

const data = (reportMs = 1000): CoverageData =>
  mergeCoverage([{ report: { path: 'packages/shop/coverage/lcov.info', mtimeMs: reportMs, files: 2 }, records: parseLcov(LCOV) }], '/repo', () => true);

describe('T43 coverage: roll-ups', () => {
  const index = (mtimes: Record<string, number> = {}) => new CoverageIndex(data(), NODES, EDGES, (f) => mtimes[f] ?? 500);

  it('a function: the lines in its range, its branches, the tests that call it', () => {
    expect(index().node(pay.id)).toEqual({ lines: 4, covered: 3, branches: 4, branchesCovered: 3, percent: 75, tests: 2, stale: false });
    expect(index().node(refund.id)).toEqual({ lines: 2, covered: 0, branches: 2, branchesCovered: 0, percent: 0, tests: 0, stale: false });
  });

  it('a file and several files: all their lines; a file with no lcov record has no data', () => {
    expect(index().file('packages/shop/src/pay.ts')).toMatchObject({ lines: 6, covered: 3, percent: 50, tests: 2 });
    expect(index().files(['packages/shop/src/pay.ts', 'packages/shop/src/cart.ts'])).toMatchObject({ lines: 8, covered: 5, percent: 62 });
    expect(index().file('packages/shop/src/other.ts')).toMatchObject({ percent: null, lines: 0 });
  });

  it('a mark per line: run, not run, not code; branches all, partly or not taken; the lines not run as ranges', () => {
    const nc = index().nodeCoverage(pay.id)!;
    expect(nc.lines.map((l) => [l.n, l.state, l.branch ?? '-'])).toEqual([
      [1, 'none', '-'], [2, 'run', '-'], [3, 'run', 'partial'], [4, 'missed', '-'], [5, 'run', 'all'], [6, 'none', '-'],
    ]);
    expect(nc.uncovered).toEqual(['4']);
    expect(index().nodeCoverage(refund.id)!.uncovered).toEqual(['11-12']);
    expect(lineRanges([7, 1, 2, 3, 9, 10])).toEqual(['1-3', '7', '9-10']);
  });

  it('tested by: direct callers first, then the tests that reach it through a helper', () => {
    expect(index().testedBy(pay.id).map((t) => [t.name, t.direct, t.trust])).toEqual([['pays', true, 'exact'], ['pays twice', false, 'name-match']]);
    expect(index().testedBy(refund.id)).toEqual([]);
  });

  it('stale: the source changed after the lcov file was written, on the file and its functions', () => {
    const i = index({ 'packages/shop/src/pay.ts': 2000 });
    expect(i.file('packages/shop/src/pay.ts').stale).toBe(true);
    expect(i.node(pay.id).stale).toBe(true);
    expect(i.file('packages/shop/src/cart.ts').stale).toBe(false);
  });

  it('a package on the map adds up its files; the test files are left out', () => {
    const map = new MapIndex(NODES, EDGES);
    expect(map.unitFiles('@m/shop')).toEqual(['packages/shop/src/cart.ts', 'packages/shop/src/pay.ts']);
    const level = withCoverage(map.level({ level: 'packages' }), map, index(), '/nowhere');
    expect(level.coverage).toMatchObject({ found: true });
    expect(level.nodes.find((n) => n.id === '@m/shop')!.coverage).toMatchObject({ lines: 8, covered: 5, percent: 62, tests: 2 });
    const file = withCoverage(map.level({ level: 'file', target: 'packages/shop/src/pay.ts' }), map, index(), '/nowhere');
    expect(file.nodes.find((n) => n.id === pay.id)!.coverage).toMatchObject({ percent: 75 });
    const pkg = withCoverage(map.level({ level: 'package', target: '@m/shop', hideTests: false }), map, index(), '/nowhere');
    expect(pkg.nodes.find((n) => n.id === 'packages/shop/src/pay.ts')!.coverage).toMatchObject({ percent: 50 });
    expect(pkg.nodes.find((n) => n.id === 'packages/shop/test/pay.test.ts')!.coverage).toBeUndefined();
  });

  it('folders add up apart-counted stats; no data stays no data', () => {
    const s = sumStats([index().file('packages/shop/src/pay.ts'), index().file('packages/shop/src/cart.ts'), index().file('nope.ts')]);
    expect(s).toMatchObject({ lines: 8, covered: 5, percent: 62 });
    expect(sumStats([index().file('nope.ts')]).percent).toBeNull();
  });

  it('a box: its builds code, else the code of its Flow-Box files; a box with children adds them all up', () => {
    const builds = new Map([['checkout/pay', [pay]], ['checkout/refund', [refund, testFile]]]);
    const code = boxCode({
      paths: ['checkout', 'checkout/pay', 'checkout/refund', 'checkout/cart', 'checkout/ask'],
      builds,
      flowBoxFiles: new Map([['checkout/cart', ['packages/shop/src/cart.ts', 'packages/shop/test/pay.test.ts']]]),
      defined: (f) => NODES.filter((n) => n.file === f),
    });
    expect([...code.keys()]).toEqual(['checkout', 'checkout/pay', 'checkout/refund', 'checkout/cart']);
    expect(code.get('checkout/cart')!.map((n) => n.name)).toEqual(['cart']);
    const cov = boxCoverage(index(), code);
    expect(cov['checkout/pay']).toMatchObject({ percent: 75, tests: 2 });
    expect(cov['checkout/refund']).toMatchObject({ percent: 0, tests: 0 });
    expect(cov['checkout']).toMatchObject({ lines: 8, covered: 5, percent: 62, tests: 2 });
    expect(cov['checkout/ask']).toBeUndefined();
  });

  it('no coverage data: every number is null, the hint names the repo command or the general lcov way', () => {
    const none = new CoverageIndex({ reports: [], files: new Map() }, NODES, EDGES);
    expect(none.found).toBe(false);
    expect(none.node(pay.id)).toMatchObject({ percent: null, tests: 2 });
    const root = mkdtempSync(join(tmpdir(), 'rehearse-cov-'));
    expect(coverageHint(root)).toMatch(/^No coverage file yet\. Write coverage\/lcov\.info .*coverage lcov/);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { coverage: 'x' } }));
    expect(coverageHint(root)).toMatch(/Run `pnpm coverage`/);
  });
});

describe('T43 coverage: files on disk', () => {
  it('finds every coverage/lcov.info below the repo but node_modules; reads again only when it changed', () => {
    const root = mkdtempSync(join(tmpdir(), 'rehearse-cov-'));
    for (const d of ['packages/shop/coverage', 'node_modules/x/coverage', 'packages/shop/src']) mkdirSync(join(root, d), { recursive: true });
    writeFileSync(join(root, 'packages/shop/src/pay.ts'), 'x\n');
    writeFileSync(join(root, 'packages/shop/coverage/lcov.info'), 'SF:src/pay.ts\nDA:1,1\nend_of_record\n');
    writeFileSync(join(root, 'node_modules/x/coverage/lcov.info'), 'SF:a.ts\nDA:1,1\nend_of_record\n');
    expect(findLcovFiles(root)).toEqual(['packages/shop/coverage/lcov.info']);
    const first = loadCoverage(root);
    expect([...first.files.keys()]).toEqual(['packages/shop/src/pay.ts']);
    writeFileSync(join(root, 'packages/shop/coverage/lcov.info'), 'SF:src/pay.ts\nDA:1,0\nDA:2,0\nend_of_record\n');
    utimesSync(join(root, 'packages/shop/coverage/lcov.info'), new Date(), new Date(Date.now() + 5000));
    expect([...loadCoverage(root).files.get('packages/shop/src/pay.ts')!.lines]).toEqual([[1, 0], [2, 0]]);
    expect(loadCoverage(mkdtempSync(join(tmpdir(), 'rehearse-cov-'))).reports).toEqual([]);
  });

  it('the coverage of a target from the store: a file, a function, a box, and not found', () => {
    const root = mkdtempSync(join(tmpdir(), 'rehearse-cov-'));
    const store = new Store(join(root, 'graph.db'));
    try {
      store.putNodes(NODES, 'test');
      store.putEdges(EDGES, 'test');
      const index = new CoverageIndex(data(), NODES, EDGES, () => 500);
      const file = coverageOf(store, index, root, 'packages/shop/src/pay.ts');
      expect(file).toMatchObject({ ok: true, kind: 'file', stats: { percent: 50 } });
      expect(file.entries.map((x) => [x.name, x.stats.percent, x.uncovered])).toEqual([['refund', 0, ['11-12']], ['pay', 75, ['4']]]);
      const fn = coverageOf(store, index, root, 'pay');
      expect(fn).toMatchObject({ ok: true, kind: 'node', name: 'pay', stats: { percent: 75 } });
      expect(fn.testedBy.map((t) => t.name)).toEqual(['pays', 'pays twice']);
      const b = coverageOf(store, index, root, 'box checkout', { epic: EPIC });
      expect(b).toMatchObject({ ok: true, kind: 'box', stats: { lines: 6, covered: 3 } });
      expect(coverageOf(store, index, root, 'checkout/pay')).toMatchObject({ kind: 'box', stats: { percent: 75 } });
      expect(coverageOf(store, index, root, 'checkout/cart')).toMatchObject({ ok: true, notes: ['this box has no code yet'] });
      expect(coverageOf(store, index, root, 'nothing/here')).toMatchObject({ ok: false, notes: ['not found'] });
      expect(file.info.found).toBe(true);
    } finally {
      store.close();
    }
  });
});
