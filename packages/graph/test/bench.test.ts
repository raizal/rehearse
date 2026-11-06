// S10: the speed benchmark (G11, G24). The full run is `pnpm --filter @rehearse/graph bench` on
// 1,000 files; here it runs on 100 files with the cold limit scaled, so `pnpm -r test` stays fast.

import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { benchMain } from '../src/bench/cli.js';
import { generateBenchRepo, writeBenchRepo } from '../src/bench/generate.js';
import { BENCH_RESOLVER_SETS, benchResolvers } from '../src/bench/resolvers.js';
import { benchTable, limitsFor, runBench } from '../src/bench/run.js';
import { openGraph, type Graph, type Resolver } from '../src/index.js';
import { snapshot } from './helpers.js';

const open: Graph[] = [];
afterEach(() => {
  for (const g of open.splice(0)) g.close();
});

/** sha256 of the 1,000-file repo of seed 1 (path, NUL, content, NUL for each file in path order). */
const SEED_1_DIGEST = '1b050e70be07414e0d777a6a4263079ea45c4bcf93231daef8333dda3e091ce9';

const tempDir = () => join(mkdtempSync(join(tmpdir(), 'rehearse-bench-test-')), 'repo');
const digest = (files: Map<string, string>) => {
  const h = createHash('sha256');
  for (const [path, text] of files) h.update(`${path}\u0000${text}\u0000`);
  return h.digest('hex');
};

describe('G24 the benchmark repo', () => {
  it('G24 the same seed makes a byte-identical repo, on disk too; another seed makes another repo', () => {
    const a = writeBenchRepo(tempDir(), { files: 100, seed: 1 });
    const dirB = tempDir();
    writeBenchRepo(dirB, { files: 100, seed: 1 });
    const dirA = tempDir();
    writeBenchRepo(dirA, { files: 100, seed: 1 });
    expect(snapshot(dirB)).toEqual(snapshot(dirA));
    expect(generateBenchRepo({ files: 100, seed: 1 })).toEqual(a);
    expect(digest(generateBenchRepo({ files: 100, seed: 2 }).files)).not.toBe(digest(a.files));
  });

  it('G24 the repo of seed 1 does not change: bench numbers stay comparable between runs', () => {
    // A change to the generator changes this digest. Update it on purpose, and say so with the new numbers.
    expect(digest(generateBenchRepo({ files: 1000, seed: 1 }).files)).toBe(SEED_1_DIGEST);
  });

  it('G24 1,000 files: half TypeScript, half Python, with Vitest and pytest test files', () => {
    const { files } = generateBenchRepo({ files: 1000, seed: 1 });
    const paths = [...files.keys()];
    expect(paths.filter((p) => p.endsWith('.ts'))).toHaveLength(500);
    expect(paths.filter((p) => p.endsWith('.py'))).toHaveLength(500);
    expect(paths.filter((p) => p.endsWith('.test.ts')).length).toBeGreaterThanOrEqual(50);
    expect(paths.filter((p) => /\/test_[^/]+\.py$/.test(p)).length).toBeGreaterThanOrEqual(50);
  });

  it('G24 every reader path runs on it: imports, calls, classes, outside packages, routes and tests in both languages', async () => {
    const root = tempDir();
    writeBenchRepo(root, { files: 100, seed: 1 });
    // The tree-sitter readers only (wave1): the resolvers would turn the name-match calls exact.
    const graph = openGraph(root, { resolvers: [] });
    open.push(graph);
    const run = await graph.update();
    expect(run).toMatchObject({ mode: 'cold', files: 100 });
    const { store } = graph;
    for (const language of ['typescript', 'python']) {
      const of = (kind: string) => store.nodesWhere('kind = ? AND language = ? AND target_only = 0', kind, language);
      expect(of('class').length, `${language} classes`).toBeGreaterThan(0);
      expect(of('method').length, `${language} methods`).toBeGreaterThan(0);
      expect(of('test').length, `${language} tests`).toBeGreaterThan(0);
      const files = new Set(of('file').map((n) => n.id));
      const between = (kind: string) => store.edgesWhere('kind = ?', kind).filter((e) => files.has(e.from));
      expect(between('imports').some((e) => files.has(e.to)), `${language} imports between files`).toBe(true);
      expect(between('imports').some((e) => e.trust === 'unresolved'), `${language} imports of outside packages`).toBe(true);
    }
    const calls = store.edgesWhere('kind = ?', 'calls');
    expect(calls.some((e) => e.trust === 'name-match')).toBe(true);
    expect(calls.some((e) => e.trust === 'unresolved')).toBe(true);
    expect(store.edgesWhere('kind = ?', 'extends').length).toBeGreaterThan(0);
    const routes = store.nodesWhere('kind = ?', 'route').map((n) => n.route);
    expect(routes).toContain('GET /api/orders/0/{row_id}');
    expect(routes).toContain('POST /api/orders/0/');
  });
});

describe('S10 the speed benchmark (100 files, cold limit scaled)', () => {
  it('S10 the limits are the G11 targets; the cold one scales with the files (30 s per 1,000)', () => {
    expect(limitsFor(1000)).toEqual({ coldMs: 30_000, updateMs: 300, queryMs: 100 });
    expect(limitsFor(100)).toEqual({ coldMs: 3_000, updateMs: 300, queryMs: 100 });
  });

  it('S10-A1 S10-A2 the cold index, a one-file update and each query verb are under their targets: exit code 0', async () => {
    const result = await runBench({ files: 100, seed: 1, runs: 3 });
    expect(result.timings.map((t) => t.step.split(' ')[0])).toEqual(['cold', 'update', 'update', 'freshness', 'find', 'show', 'near', 'near', 'path']);
    for (const t of result.timings) expect(t.ms, t.step).toBeLessThan(t.limitMs);
    expect(result.timings.slice(1).every((t) => t.runs === 3)).toBe(true);
    expect(result).toMatchObject({ files: 100, seed: 1, resolvers: ['tree-sitter'], exitCode: 0 });
    expect(benchTable(result)).toContain('every time is under its target');
  });

  it('S10-too-slow a resolver set that makes the cold index miss its target gives exit code 1, with the timings', async () => {
    const slow: Resolver = {
      name: 'ts-morph',
      language: 'typescript',
      resolve: async ({ mode }) => {
        if (mode === 'cold') await new Promise((r) => setTimeout(r, 150));
        return [];
      },
    };
    const result = await runBench({ files: 40, seed: 1, runs: 1, resolvers: [slow], limits: { coldMs: 100 } });
    expect(result.exitCode).toBe(1);
    expect(result.resolvers).toEqual(['tree-sitter', 'ts-morph']);
    const cold = result.timings[0]!;
    expect(cold).toMatchObject({ step: 'cold index', runs: 1, limitMs: 100, ok: false });
    expect(cold.ms).toBeGreaterThanOrEqual(100);
    expect(benchTable(result)).toMatch(/cold index\s+\d+\.\d\s+\d+\.\d\s+1\s+< 100\s+TOO SLOW/);
  });

  it('S10 the bench command prints the table and returns the exit code; a usage error returns 2', async () => {
    let out = '';
    let err = '';
    const code = await benchMain(['--', '--files', '40', '--runs', '1', '--json'], (s) => (out += s), (s) => (err += s));
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ files: 40, seed: 1, exitCode: 0 });
    expect(await benchMain(['--resolvers', 'nope'], () => {}, (s) => (err += s))).toBe(2);
    expect(err).toContain('no resolver set "nope"');
    expect(await benchMain(['--files', 'ten'], () => {}, () => {})).toBe(2);
    expect(await benchMain(['--seed', '-1'], () => {}, () => {})).toBe(2);
  });

  it('S10 the bench never writes over a folder that has files; that is an error the command reports with exit code 2', async () => {
    const dir = tempDir();
    writeBenchRepo(dir, { files: 20, seed: 1 });
    const before = snapshot(dir);
    await expect(runBench({ files: 40, seed: 2, dir })).rejects.toThrow(/is not empty/);
    let err = '';
    expect(await benchMain(['--files', '40', '--dir', dir], () => {}, (s) => (err += s))).toBe(2);
    expect(err).toContain('bench could not run');
    expect(snapshot(dir)).toEqual(before);
  });

  it('S10 the resolver sets: wave1 is the tree-sitter readers alone; an unknown set is an error', () => {
    expect(Object.keys(BENCH_RESOLVER_SETS)).toContain('wave1');
    expect(benchResolvers('wave1')).toEqual([]);
    expect(() => benchResolvers('nope')).toThrow(/no resolver set "nope"/);
  });
});
