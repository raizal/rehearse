// Box `simulate/report`: sorted, deterministic report (R18, S3-A5).
// Findings use the validate report helpers. The matrix and the stale list are built sorted.

import type { Finding, PermissionMatrix } from '../types.js';
import { makeReport } from '../validate/report.js';
import type { PermissionBoxes, SimulationReport, StaleScenario } from './types.js';

export function makeSimulationReport(
  findings: Finding[],
  permissionMatrix: PermissionMatrix,
  permissionBoxes: PermissionBoxes,
  stale: StaleScenario[],
): SimulationReport {
  const { ok, findings: sorted } = makeReport('simulate', findings);
  return { command: 'simulate', ok, findings: sorted, permissionMatrix, permissionBoxes, stale };
}

/** Human text: the findings, then one line per stale scenario (information, not a finding). */
export function simulationToText(report: SimulationReport): string {
  const lines = report.stale.map((s) => `${s.file}: ${s.scenario}: stale, not evidence: ${s.reason}`);
  const findings = report.findings.map((f) => `${f.path === '' ? f.file : `${f.file}: ${f.path}`}: ${f.kind}: ${f.message}`);
  const n = report.findings.length;
  const summary = report.ok
    ? 'simulate: OK, no findings'
    : `simulate: ${n} finding${n === 1 ? '' : 's'}`;
  const staleNote = report.stale.length ? ` (${report.stale.length} stale scenario${report.stale.length === 1 ? '' : 's'} not used)` : '';
  return `${[...findings, ...lines, summary + staleNote].join('\n')}\n`;
}
