// Unit test coverage on the page (T43, S12): the badge text and colour of a piece of code, the sum
// over the files of a folder, and the plain line of a gutter mark. The numbers come from the server
// (`@rehearse/graph`'s coverage index over the repo's lcov files).

import type { CoverageInfo, CoverageStats, LineMark } from '@rehearse/server';

export type { CoverageInfo, CoverageStats, LineMark, NodeCoverage, TestRef } from '@rehearse/server';

/** ≥80% good (green), 50–79% fair (orange), below 50% poor (red), no data (grey). */
export type CoverageTone = 'good' | 'fair' | 'poor' | 'none';

export function coverageTone(s: CoverageStats | undefined): CoverageTone {
  if (s?.percent === null || s?.percent === undefined) return 'none';
  return s.percent >= 80 ? 'good' : s.percent >= 50 ? 'fair' : 'poor';
}

export const NO_DATA = 'no coverage data';
export const STALE_TEXT = 'coverage is older than this code; run the tests again';

/** `72% · 3 tests`, or `no coverage data`. */
export function badgeText(s: CoverageStats | undefined): string {
  if (s?.percent === null || s?.percent === undefined) return NO_DATA;
  return `${s.percent}% · ${s.tests} ${s.tests === 1 ? 'test' : 'tests'}`;
}

/** The badge's tooltip and label: the lines and branches it counts, and when it is stale. */
export function badgeTitle(s: CoverageStats | undefined): string {
  if (s?.percent === null || s?.percent === undefined) return 'No unit test coverage data for this code';
  const branches = s.branches > 0 ? `, ${s.branchesCovered} of ${s.branches} branches` : '';
  return `Unit tests run ${s.covered} of ${s.lines} lines${branches}; ${s.tests} ${s.tests === 1 ? 'test calls' : 'tests call'} it${s.stale ? `. ${STALE_TEXT}` : ''}`;
}

/** The sum over many pieces of code (a folder's files): lines and branches add up. */
export function sumStats(list: readonly (CoverageStats | undefined)[]): CoverageStats | undefined {
  const known = list.filter((s): s is CoverageStats => s !== undefined && s.percent !== null);
  if (known.length === 0) return list.some((s) => s !== undefined) ? { lines: 0, covered: 0, branches: 0, branchesCovered: 0, percent: null, tests: 0, stale: false } : undefined;
  const t = { lines: 0, covered: 0, branches: 0, branchesCovered: 0, tests: 0, stale: false };
  for (const s of known) {
    t.lines += s.lines;
    t.covered += s.covered;
    t.branches += s.branches;
    t.branchesCovered += s.branchesCovered;
    t.tests += s.tests;
    t.stale ||= s.stale;
  }
  return { ...t, percent: t.lines === 0 ? null : Math.floor((t.covered * 100) / t.lines) };
}

/** The class and the words of one gutter mark. */
export function lineMark(m: LineMark | undefined): { cls: string; label: string } | undefined {
  if (!m || m.state === 'none') return undefined;
  const of = m.branches ? ` (${m.branches.hit} of ${m.branches.found})` : '';
  const branch = m.branch === 'partial' ? ` · branches partly taken${of}` : m.branch === 'none' ? ` · no branch taken${of}` : '';
  const cls = `cov-${m.state}${m.branch === 'partial' || m.branch === 'none' ? ' cov-branch' : ''}`;
  return { cls, label: m.state === 'run' ? `run${m.hits !== undefined ? ` ${m.hits}×` : ''}${branch}` : `not run${branch}` };
}

/** The one line shown when the repo has no coverage file. */
export const hintOf = (info: CoverageInfo | undefined): string | undefined => (info && !info.found ? info.hint : undefined);
