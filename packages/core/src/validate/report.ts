// Box `validate/report`: a sorted, deterministic report (R18).

import type { Finding, Report, ReportCommand } from '../types.js';
import { cmp } from '../util.js';

/** Order: file, path, kind, message, refs. Code-unit order, so the locale has no effect. */
export function compareFindings(a: Finding, b: Finding): number {
  return (
    cmp(a.file, b.file) ||
    cmp(a.path, b.path) ||
    cmp(a.kind, b.kind) ||
    cmp(a.message, b.message) ||
    cmp(a.refs.join(','), b.refs.join(','))
  );
}

/** Sort, drop exact duplicates, and fix the key order of each finding. */
export function sortFindings(findings: Finding[]): Finding[] {
  const out: Finding[] = [];
  let prev: Finding | undefined;
  for (const f of [...findings].sort(compareFindings)) {
    if (prev && compareFindings(prev, f) === 0) continue;
    const clean: Finding = { kind: f.kind, file: f.file, path: f.path, message: f.message, refs: [...f.refs].sort(cmp) };
    out.push(clean);
    prev = clean;
  }
  return out;
}

export function makeReport(command: ReportCommand, findings: Finding[]): Report {
  const sorted = sortFindings(findings);
  return { command, ok: sorted.length === 0, findings: sorted };
}

/** Canonical JSON text of a report: same report → same bytes. */
export function reportToJson(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

const findingLine = (f: Finding, kind: string): string => `${f.path === '' ? f.file : `${f.file}: ${f.path}`}: ${kind}: ${f.message}`;

/**
 * Human text: one line per finding with the file, the path and the reason. Then one line per
 * information note (T60), and a count of the notes on the summary line.
 */
export function reportToText(report: Report): string {
  const info = report.information ?? [];
  const lines = report.findings.map((f) => findingLine(f, f.kind));
  lines.push(...info.map((f) => findingLine(f, 'information')));
  const n = report.findings.length;
  const summary = report.ok ? `${report.command}: OK, no findings` : `${report.command}: ${n} finding${n === 1 ? '' : 's'}`;
  const i = info.length;
  lines.push(i === 0 ? summary : `${summary} (${i} STE note${i === 1 ? '' : 's'} on draft text: information only)`);
  return `${lines.join('\n')}\n`;
}
