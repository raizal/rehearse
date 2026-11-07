// Box read-unit-report (T53): a vitest JSON report (`--unit-report <file>`, made by
// `pnpm test:report` into .rehearse/unit-report.json). The deck counts, per story, the unit tests
// whose name has one of the story's scenario or criterion ids (`S4-A3`, `S1-new`), and how many of
// them passed. A missing or unreadable report is said; the deck is made anyway.
// T59: a test counts only for the plan of the code next to it. The test file decides. The globs of
// `testPaths:` in .rehearse/config.yaml give each EPIC its test files. An EPIC with no globs gets
// all tests that no other EPIC gets. If an old report has no test files, the ids alone decide, and
// the facts tell this.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseYaml, type Id } from '@rehearse/core';

export const UNIT_REPORT_UNREADABLE = 'unit report missing or unreadable';

/** The report cannot be read: the message says why. */
export class UnitReportError extends Error {}

export interface UnitTest {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  /** The test file, from the repo top (`packages/graph/test/x.test.ts`). An old report does not have it. */
  file?: string;
}

export interface UnitReport {
  file: string;
  /** When the tests ran (ISO): the report's start time, else the file's time. */
  date: string;
  tests: UnitTest[];
}

/** Vitest's JSON (`--reporter=json`): testResults[]{name, assertionResults[]{fullName, title, status}}. */
export function parseUnitReport(text: string, file: string, fileTime?: Date): UnitReport {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new UnitReportError(`${UNIT_REPORT_UNREADABLE}: ${file} is not JSON`);
  }
  const results = (json as { testResults?: unknown })?.testResults;
  if (!Array.isArray(results)) throw new UnitReportError(`${UNIT_REPORT_UNREADABLE}: ${file} has no testResults (make it with vitest --reporter=json, or pnpm test:report)`);
  const tests: UnitTest[] = [];
  for (const r of results) {
    const list = (r as { assertionResults?: unknown })?.assertionResults;
    if (!Array.isArray(list)) continue;
    const path = (r as { name?: unknown }).name;
    const file = typeof path === 'string' && path !== '' ? path.replace(/\\/g, '/') : undefined;
    for (const a of list as Record<string, unknown>[]) {
      const name = typeof a.fullName === 'string' ? a.fullName : typeof a.title === 'string' ? a.title : undefined;
      if (name === undefined) continue;
      tests.push({ name, status: a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'skipped', ...(file !== undefined ? { file } : {}) });
    }
  }
  const start = (json as { startTime?: unknown }).startTime;
  const date = typeof start === 'number' && start > 0 ? new Date(start) : (fileTime ?? new Date(0));
  return { file, date: date.toISOString(), tests };
}

/** Reads the report; throws UnitReportError when it is missing or unreadable. */
export function readUnitReport(file: string): UnitReport {
  let text: string;
  let time: Date;
  try {
    text = readFileSync(file, 'utf8');
    time = statSync(file).mtime;
  } catch {
    throw new UnitReportError(`${UNIT_REPORT_UNREADABLE}: no file ${file} (make it with pnpm test:report)`);
  }
  return parseUnitReport(text, file, time);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The file with the test globs of each EPIC, from the repo top. It is not in an EPIC folder, thus no hash covers it. */
export const TEST_PATHS_FILE = '.rehearse/config.yaml';

/** EPIC slug → the globs of its test files (`packages/graph/**`). */
export type TestPaths = Record<string, string[]>;

/** `testPaths:` of .rehearse/config.yaml. If the file is missing, there are no globs. If the file is bad, there are no globs, and `why` tells the cause. */
export function readTestPaths(top: string): { paths: TestPaths; why?: string } {
  let text: string;
  try {
    text = readFileSync(join(top, TEST_PATHS_FILE), 'utf8');
  } catch {
    return { paths: {} };
  }
  const bad = (why: string) => ({ paths: {}, why: `${TEST_PATHS_FILE} ${why}; all EPICs get all tests` });
  const { value: doc, finding } = parseYaml(text, TEST_PATHS_FILE);
  if (finding) return bad('is not YAML');
  const raw = (doc as { testPaths?: unknown } | null)?.testPaths;
  if (raw === undefined) return { paths: {} };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('has testPaths that is not a map of EPIC to globs');
  const paths: TestPaths = {};
  for (const [slug, globs] of Object.entries(raw)) {
    if (!Array.isArray(globs) || !globs.every((g) => typeof g === 'string' && g !== '')) return bad(`has testPaths.${slug} that is not a list of globs`);
    paths[slug] = globs as string[];
  }
  return { paths };
}

/** A glob of paths: `**` is zero or more folders, `*` and `?` stay in one name. */
export function globRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        i++;
        re += '(?:.*/)?';
      } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += escape(c);
  }
  return new RegExp(`^${re}$`);
}

export interface EpicUnitTests {
  tests: UnitTest[];
  /** The tests of this EPIC, in plain words. */
  scope: string;
  /** Set if the report does not show the test files. Then the ids alone decide, in all EPICs. */
  note?: string;
}

export const NO_TEST_FILES = 'the report does not show the test files, thus the ids alone decide, in all EPICs. To make a new report, run pnpm test:report';

/** The one rule (T59): the tests of the report that are in the files of the EPIC `slug`. */
export function unitTestsOfEpic(report: UnitReport, slug: string, paths: TestPaths): EpicUnitTests {
  if (report.tests.some((t) => t.file === undefined)) return { tests: report.tests, scope: 'all tests of the report', note: NO_TEST_FILES };
  const matches = (globs: string[]) => {
    const res = globs.map(globRegExp);
    return (t: UnitTest) => res.some((re) => re.test(t.file!));
  };
  const own = paths[slug];
  if (own && own.length > 0) return { tests: report.tests.filter(matches(own)), scope: `the tests in ${own.join(', ')}` };
  const others = Object.entries(paths).filter(([s]) => s !== slug).flatMap(([, g]) => g);
  if (others.length === 0) return { tests: report.tests, scope: 'all tests of the report' };
  const claimed = matches(others);
  return { tests: report.tests.filter((t) => !claimed(t)), scope: `all tests that are not in ${others.join(', ')}` };
}

/** The unit tests that name one of these ids (a whole id: `S1-new` is not `S1-newer`). */
export function unitCount(report: Pick<UnitReport, 'tests'>, ids: Id[]): { tests: number; passed: number; failed: number } {
  if (ids.length === 0) return { tests: 0, passed: 0, failed: 0 };
  const re = new RegExp(`(?<![\\w-])(?:${ids.map(escape).join('|')})(?![\\w-])`);
  const named = report.tests.filter((t) => re.test(t.name));
  return { tests: named.length, passed: named.filter((t) => t.status === 'passed').length, failed: named.filter((t) => t.status === 'failed').length };
}
