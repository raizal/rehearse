// Box `bench` (G11, G24, S10): index the generated repo cold, change one file per language and
// update, then run each query verb. Each time is checked against its target; one miss makes exit
// code 1, so CI blocks the PR with the timings attached (S10-too-slow).

import { appendFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Resolver } from '../extend.js';
import { openGraph, type Graph } from '../graph.js';
import type { CodeLanguage, IndexRun, QueryAnswer } from '../types.js';
import { writeBenchRepo } from './generate.js';
import { benchResolvers, DEFAULT_RESOLVER_SET } from './resolvers.js';

/** The speed targets of G11. The cold index target is per 1,000 files. */
export const TARGETS = { coldMsPer1000Files: 30_000, updateMs: 300, queryMs: 100 } as const;

export interface BenchLimits {
  coldMs: number;
  updateMs: number;
  queryMs: number;
}

/** The G11 limits for a repo of `files` files: the cold limit scales with the size, the others do not. */
export function limitsFor(files: number): BenchLimits {
  return { coldMs: (TARGETS.coldMsPer1000Files * files) / 1000, updateMs: TARGETS.updateMs, queryMs: TARGETS.queryMs };
}

export interface BenchOptions {
  files: number;
  seed: number;
  /** A name from BENCH_RESOLVER_SETS (default `wave1`), or the resolvers themselves. */
  resolvers?: string | Resolver[];
  /** Times each update and query runs; the median is checked (a shared CI runner is noisy). */
  runs?: number;
  /** A new or empty folder to write the repo in (kept); a new temporary folder by default, removed at the end. */
  dir?: string;
  limits?: Partial<BenchLimits>;
}

export interface BenchTiming {
  step: string;
  /** The median of the runs: the number checked against the target. */
  ms: number;
  /** The slowest run, shown for the noise. */
  maxMs: number;
  runs: number;
  limitMs: number;
  ok: boolean;
}

export interface BenchResult {
  files: number;
  seed: number;
  /** IndexRun.resolvers of the cold index. */
  resolvers: string[];
  timings: BenchTiming[];
  exitCode: 0 | 1;
}

export async function runBench(opts: BenchOptions): Promise<BenchResult> {
  const own = opts.dir === undefined;
  // The repo writes package.json, tsconfig.json, web/ and api/: never over a project, nor over an old repo.
  if (opts.dir !== undefined && existsSync(opts.dir) && readdirSync(opts.dir).length > 0) {
    throw new Error(`bench: ${opts.dir} is not empty; give a new or empty folder`);
  }
  const dir = opts.dir ?? join(mkdtempSync(join(tmpdir(), 'rehearse-bench-')), 'repo');
  const limits = { ...limitsFor(opts.files), ...opts.limits };
  const runs = opts.runs ?? 5;
  const resolvers = typeof opts.resolvers === 'object' ? opts.resolvers : benchResolvers(opts.resolvers ?? DEFAULT_RESOLVER_SET);
  let opened: Graph | undefined;
  const timings: BenchTiming[] = [];
  const time = (step: string, all: number[], limitMs: number) => {
    const ms = median(all);
    timings.push({ step, ms: round(ms), maxMs: round(Math.max(...all)), runs: all.length, limitMs, ok: ms < limitMs });
  };
  try {
    const repo = writeBenchRepo(dir, opts);
    const graph = (opened = openGraph(dir, { trigger: 'bench', resolvers }));
    const cold = expectRun(await graph.update(true), 'cold', opts.files);
    time('cold index', [cold.ms], limits.coldMs);

    for (const language of ['typescript', 'python'] as CodeLanguage[]) {
      const path = repo.probes.update[language];
      const all: number[] = [];
      for (let i = 0; i < runs; i++) {
        appendFileSync(join(dir, path), language === 'typescript'
          ? `\nexport function benchEdit${i}(id: string): string {\n  return id;\n}\n`
          : `\n\ndef bench_edit_${i}(row_id: str) -> str:\n    return row_id\n`);
        const run = expectRun(await graph.update(), 'update', opts.files);
        if (run.changedFiles !== 1) throw new Error(`bench: the update read ${run.changedFiles} files, not 1`);
        all.push(run.ms);
      }
      time(`update 1 file (${language === 'typescript' ? 'ts' : 'py'})`, all, limits.updateMs);
    }

    // Every query starts with the freshness check (G5): hash every file, find no change.
    const checks: number[] = [];
    for (let i = 0; i < runs; i++) checks.push(expectRun(await graph.update(), 'none', opts.files).ms);
    time('freshness check, no change', checks, limits.queryMs);

    // A query is what the CLI does: the freshness check, then the answer.
    const { find, show, path } = repo.probes;
    const queries: [string, () => Promise<QueryAnswer>][] = [
      [`find "${find}"`, () => graph.find(find)],
      [`show ${show}`, () => graph.show(show)],
      [`near ${show}`, () => graph.near(show)],
      [`near ${show} --depth 2`, () => graph.near(show, { depth: 2 })],
      [`path ${path[0]} ${path[1]}`, () => graph.path(path[0], path[1])],
    ];
    for (const [step, q] of queries) {
      const all: number[] = [];
      for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        const answer = await q();
        all.push(performance.now() - t0);
        if (answer.nodes.length === 0) throw new Error(`bench: "${step}" found nothing (${answer.notes.join('; ')})`);
      }
      time(step, all, limits.queryMs);
    }
    return { files: opts.files, seed: opts.seed, resolvers: cold.resolvers, timings, exitCode: timings.every((t) => t.ok) ? 0 : 1 };
  } finally {
    opened?.close();
    if (own) rmSync(join(dir, '..'), { recursive: true, force: true });
  }
}

/** The run must be what the bench asked for, or its time measures something else. */
function expectRun(run: IndexRun, mode: IndexRun['mode'], files: number): IndexRun {
  if (run.mode !== mode) throw new Error(`bench: expected a ${mode} run, got ${run.mode}`);
  if (run.files !== files) throw new Error(`bench: ${run.files} files in scope, not ${files}`);
  return run;
}

const round = (ms: number) => Math.round(ms * 10) / 10;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The timings as a text table, one line per step, with the result last. */
export function benchTable(r: BenchResult): string {
  const rows = r.timings.map((t) => [t.step, t.ms.toFixed(1), t.maxMs.toFixed(1), String(t.runs), `< ${t.limitMs}`, t.ok ? 'ok' : 'TOO SLOW']);
  const head = ['step', 'median ms', 'max ms', 'runs', 'target ms', ''];
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => (i >= 1 && i <= 4 ? c.padStart(width[i]!) : c.padEnd(width[i]!))).join('  ').trimEnd();
  const missed = r.timings.filter((t) => !t.ok).length;
  return [
    `graph bench: ${r.files} files, seed ${r.seed}, resolvers ${r.resolvers.join(', ')}`,
    line(head),
    ...rows.map(line),
    missed === 0 ? 'every time is under its target' : `${missed} of ${r.timings.length} times missed the target`,
    '',
  ].join('\n');
}
