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

/** `info:` lines for the notes of a validate report (T62). They do not change OK. */
function noteLines(report: Report): string {
  const notes = (report as { notes?: { file: string; path: string; message: string }[] }).notes ?? [];
  return notes.map((n) => `info: ${n.path === '' ? n.file : `${n.file}: ${n.path}`}: ${n.message}\n`).join('');
}

/** Human text: one line per finding with the file, the path and the reason, then the notes. */
export function reportToText(report: Report): string {
  if (report.ok) return `${report.command}: OK, no findings\n${noteLines(report)}`;
  const lines = report.findings.map((f) => {
    const where = f.path === '' ? f.file : `${f.file}: ${f.path}`;
    return `${where}: ${f.kind}: ${f.message}`;
  });
  const n = report.findings.length;
  lines.push(`${report.command}: ${n} finding${n === 1 ? '' : 's'}`);
  return `${lines.join('\n')}\n${noteLines(report)}`;
}
