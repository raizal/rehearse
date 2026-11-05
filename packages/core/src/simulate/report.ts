// Box `simulate/report`: sorted, deterministic report (R18, S3-A5).
// Findings use the validate report helpers. The matrix and the stale list are built sorted.
// Drafts mode (T22): `mode` and `notice` come first, and the draft-only list is sorted like findings.

import type { Finding, PermissionMatrix } from '../types.js';
import { makeReport, sortFindings } from '../validate/report.js';
import { DRAFTS_NOTICE, type CountedScenario, type PermissionBoxes, type SimulationReport, type StaleScenario } from './types.js';

export function makeSimulationReport(
  findings: Finding[],
  permissionMatrix: PermissionMatrix,
  permissionBoxes: PermissionBoxes,
  stale: StaleScenario[],
  drafts?: { draftOnly: Finding[]; counted: CountedScenario[] },
): SimulationReport {
  const { ok, findings: sorted } = makeReport('simulate', findings);
  if (!drafts) return { command: 'simulate', ok, findings: sorted, permissionMatrix, permissionBoxes, stale };
  return {
    command: 'simulate',
    mode: 'drafts',
    notice: DRAFTS_NOTICE,
    ok,
    findings: sorted,
    draftOnly: sortFindings(drafts.draftOnly),
    counted: drafts.counted,
    permissionMatrix,
    permissionBoxes,
    stale,
  };
}

/**
 * Human text: the findings, then one line per stale scenario (information, not a finding).
 * Drafts mode: the notice line first, the findings, then what only drafts cover and the stale
 * scenarios that were counted (information too).
 */
export function simulationToText(report: SimulationReport): string {
  const where = (f: Finding): string => `${f.path === '' ? f.file : `${f.file}: ${f.path}`}: ${f.kind}: `;
  const findings = report.findings.map((f) => where(f) + f.message);
  const n = report.findings.length;
  if (report.mode === 'drafts') {
    const draftOnly = (report.draftOnly ?? []).map((f) => `${where(f)}${f.message} (information, needs the builder)`);
    const stale = report.stale.map((s) => `${s.file}: ${s.scenario}: stale, counted for checks only: ${s.reason}`);
    const name = 'simulate --drafts';
    const summary = report.ok ? `${name}: OK, no findings` : `${name}: ${n} finding${n === 1 ? '' : 's'}`;
    const d = draftOnly.length;
    const note = d ? ` (${d} covered only by drafts)` : '';
    return `${[`${name}: ${report.notice ?? DRAFTS_NOTICE}`, ...findings, ...draftOnly, ...stale, summary + note].join('\n')}\n`;
  }
  const lines = report.stale.map((s) => `${s.file}: ${s.scenario}: stale, not evidence: ${s.reason}`);
  const summary = report.ok
    ? 'simulate: OK, no findings'
    : `simulate: ${n} finding${n === 1 ? '' : 's'}`;
  const staleNote = report.stale.length ? ` (${report.stale.length} stale scenario${report.stale.length === 1 ? '' : 's'} not used)` : '';
  return `${[...findings, ...lines, summary + staleNote].join('\n')}\n`;
}
