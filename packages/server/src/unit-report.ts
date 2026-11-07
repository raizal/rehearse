// Box read-unit-report (T53): a vitest JSON report (`--unit-report <file>`, made by
// `pnpm test:report` into .rehearse/unit-report.json). The deck counts, per story, the unit tests
// whose name has one of the story's scenario or criterion ids (`S4-A3`, `S1-new`), and how many of
// them passed. A missing or unreadable report is said; the deck is made anyway.

import { readFileSync, statSync } from 'node:fs';
import type { Id } from '@rehearse/core';

export const UNIT_REPORT_UNREADABLE = 'unit report missing or unreadable';

/** The report cannot be read: the message says why. */
export class UnitReportError extends Error {}

export interface UnitTest {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
}

export interface UnitReport {
  file: string;
  /** When the tests ran (ISO): the report's start time, else the file's time. */
  date: string;
  tests: UnitTest[];
}

/** Vitest's JSON (`--reporter=json`): testResults[].assertionResults[]{fullName, title, status}. */
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
    for (const a of list as Record<string, unknown>[]) {
      const name = typeof a.fullName === 'string' ? a.fullName : typeof a.title === 'string' ? a.title : undefined;
      if (name === undefined) continue;
      tests.push({ name, status: a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'skipped' });
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

/** The unit tests that name one of these ids (a whole id: `S1-new` is not `S1-newer`). */
export function unitCount(report: UnitReport, ids: Id[]): { tests: number; passed: number; failed: number } {
  if (ids.length === 0) return { tests: 0, passed: 0, failed: 0 };
  const re = new RegExp(`(?<![\\w-])(?:${ids.map(escape).join('|')})(?![\\w-])`);
  const named = report.tests.filter((t) => re.test(t.name));
  return { tests: named.length, passed: named.filter((t) => t.status === 'passed').length, failed: named.filter((t) => t.status === 'failed').length };
}
