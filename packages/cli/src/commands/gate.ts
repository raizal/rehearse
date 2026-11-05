// `rehearse gate check <epic-dir-or-slug> [--json]` (R14, R19). Checks only: the CLI never signs off.

import { gateEpic, reportToJson, reportToText } from '@rehearse/core';
import { EXIT, resolveEpicDir, USAGE, type Io } from '../index.js';

/** Note shown while sim-clean has no simulator: then it checks validate findings only. */
export const VALIDATE_ONLY_NOTE = 'gate: sim-clean checked validate findings only; simulate is not wired in yet\n';

export function runGate(args: string[], io: Io): number {
  const [sub, ...rest] = args;
  const json = rest.includes('--json');
  const unknown = rest.filter((a) => a.startsWith('-') && a !== '--json');
  const positional = rest.filter((a) => !a.startsWith('-'));
  if (sub !== 'check' || unknown.length > 0 || positional.length !== 1) {
    io.stderr(`rehearse gate: expected check <epic-dir-or-slug> [--json]\n\n${USAGE}`);
    return EXIT.usage;
  }
  const dir = resolveEpicDir(positional[0]!, io.cwd);
  if (!dir) {
    io.stderr(`rehearse gate: no EPIC folder ${positional[0]} (not a folder, and not found as docs/epics/${positional[0]})\n`);
    return EXIT.usage;
  }
  let report;
  try {
    report = gateEpic(dir);
  } catch (e) {
    io.stderr(`rehearse gate: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.internal;
  }
  if (json) io.stdout(reportToJson(report));
  else io.stdout((report.simulation === 'validate-only' ? VALIDATE_ONLY_NOTE : '') + reportToText(report));
  return report.ok ? EXIT.ok : EXIT.findings;
}
