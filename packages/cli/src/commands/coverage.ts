// `rehearse coverage <file|symbol|box>` (code-graph EPIC S12, boxes `read-coverage` and
// `show-coverage`): the unit test coverage of a target, read from every coverage/lcov.info of the
// repo, with the lines not run and the tests that call it. Exit 1 with "not found"; with no
// coverage file, the plain line on how to make one (exit 0: nothing is wrong with the target).

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  coverageIndexOf, coverageOf, loadCoverage, openGraph, type BoxOptions, type CoverageAnswer, type CoverageStats,
} from '@rehearse/graph';
import { codeIndex, epicBoxPaths, execGit } from '@rehearse/server';
import { EXIT, USAGE, type Io } from '../index.js';
import { repoRoot } from './new.js';

export async function runCoverage(args: string[], io: Io): Promise<number> {
  let json = false;
  let rebuild = false;
  const lcov: string[] = [];
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--json') json = true;
    else if (a === '--rebuild') rebuild = true;
    else if (a === '--lcov' || a.startsWith('--lcov=')) {
      const value = a === '--lcov' ? args[++i] : a.slice('--lcov='.length);
      if (value === undefined || value === '') return usage(io, '--lcov needs a path to an lcov file');
      lcov.push(resolve(io.cwd, value));
    } else if (a.startsWith('-')) return usage(io, `unknown option ${a}`);
    else positional.push(a);
  }
  if (positional.length === 0) return usage(io, 'expected <file|symbol|box> [--lcov path] [--json] [--rebuild]');
  const target = positional.join(' ');

  const root = repoRoot(io.cwd);
  const graph = openGraph(root);
  let answer: CoverageAnswer;
  try {
    await graph.update(rebuild);
    const index = coverageIndexOf(graph.store, root, loadCoverage(root, lcov));
    answer = coverageOf(graph.store, index, root, target);
    // A box with no builds edge: the files of its Flow-Box commits, as serve and the drill-down do.
    if (answer.ok && answer.kind === 'box' && answer.entries.length === 0) {
      const opts = await flowBoxOptions(root, answer.name);
      if (opts) answer = coverageOf(graph.store, index, root, target, opts);
    }
  } catch (e) {
    io.stderr(`rehearse coverage: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.internal;
  } finally {
    graph.close();
  }
  if (json) io.stdout(`${JSON.stringify(answer, null, 2)}\n`);
  else if (answer.ok) io.stdout(coverageText(answer));
  if (!answer.ok) io.stderr(`rehearse coverage: ${answer.notes.join('; ')}: ${target}\n`);
  return answer.ok ? EXIT.ok : EXIT.findings;
}

/** The EPIC whose Flow-Box commits name the box, with the files of each of its boxes. */
async function flowBoxOptions(root: string, box: string): Promise<BoxOptions | undefined> {
  const epics = join(root, 'docs', 'epics');
  if (!existsSync(epics)) return undefined;
  for (const slug of readdirSync(epics).sort()) {
    const epicDir = join(epics, slug);
    const paths = existsSync(join(epicDir, 'flow.yaml')) ? epicBoxPaths(epicDir) : [];
    if (!paths.includes(box)) continue;
    const found = await codeIndex(execGit, epicDir, paths);
    if (!found.ok || (found.boxes[box]?.files.length ?? 0) === 0) continue;
    return { epic: slug, flowBoxFiles: new Map(Object.entries(found.boxes).map(([b, c]) => [b, c.files] as const)) };
  }
  return undefined;
}

/** The badge text: `72% · 3 tests`, or `no coverage data`. */
export function badgeText(s: CoverageStats): string {
  if (s.percent === null) return 'no coverage data';
  return `${s.percent}% · ${s.tests} ${s.tests === 1 ? 'test' : 'tests'}`;
}

const STALE = 'coverage is older than this code; run the tests again';

export function coverageText(a: CoverageAnswer): string {
  const out: string[] = [];
  if (!a.info.found) {
    out.push(`${a.kind} ${a.name}: no coverage data`, a.info.hint ?? '');
    return `${out.join('\n')}\n`;
  }
  const s = a.stats;
  out.push(`${a.kind} ${a.name}: ${badgeText(s)}`);
  if (s.percent !== null) {
    out.push(`  lines ${s.covered}/${s.lines}${s.branches > 0 ? `, branches ${s.branchesCovered}/${s.branches}` : ''}`);
  }
  if (s.stale) out.push(`  ${STALE}`);
  out.push(...a.notes.map((n) => `  ${n}`));
  if (a.entries.length > 0) {
    const allRun = a.kind === 'node' && a.entries.every((e) => e.uncovered.length === 0);
    out.push('', a.kind === 'node' ? (allRun ? 'Every line was run:' : 'Lines not run:') : 'Code, least covered first:');
    for (const e of a.entries) {
      const where = `${e.file}${e.range ? `:${e.range}` : ''}`;
      const missed = e.uncovered.length > 0 ? `  not run: ${e.uncovered.join(', ')}` : '';
      out.push(`  ${badgeText(e.stats).padEnd(18)} ${e.name}  ${where}${missed}`);
    }
  }
  if (a.testedBy.length > 0) {
    out.push('', 'Tested by:');
    for (const t of a.testedBy) {
      out.push(`  ${t.name}  ${t.file ?? ''}${t.range ? `:${t.range}` : ''}  ${t.direct ? 'calls it' : 'through a helper'}`);
    }
  }
  return `${out.join('\n')}\n`;
}

function usage(io: Io, message: string): number {
  io.stderr(`rehearse coverage: ${message}\n\n${USAGE}`);
  return EXIT.usage;
}
