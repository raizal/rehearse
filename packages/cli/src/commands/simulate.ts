// `rehearse simulate <epic-dir-or-slug> [--drafts] [--json]` (S3, S7, S10, T22). A thin wrapper over simulateEpic.
// `--drafts` only passes the option: findings with drafts counted, never evidence, nothing written.

import { reportToJson, simulateEpic, simulationToText } from '@rehearse/core';
import { EXIT, resolveEpicDir, USAGE, type Io } from '../index.js';

export function runSimulate(args: string[], io: Io): number {
  const json = args.includes('--json');
  const drafts = args.includes('--drafts');
  const unknown = args.filter((a) => a.startsWith('-') && a !== '--json' && a !== '--drafts');
  const positional = args.filter((a) => !a.startsWith('-'));
  if (unknown.length > 0 || positional.length !== 1) {
    io.stderr(`rehearse simulate: expected <epic-dir-or-slug> [--drafts] [--json]\n\n${USAGE}`);
    return EXIT.usage;
  }
  const dir = resolveEpicDir(positional[0]!, io.cwd);
  if (!dir) {
    io.stderr(`rehearse simulate: no EPIC folder ${positional[0]} (not a folder, and not found as docs/epics/${positional[0]})\n`);
    return EXIT.usage;
  }
  let report;
  try {
    report = simulateEpic(dir, { drafts });
  } catch (e) {
    io.stderr(`rehearse simulate: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.internal;
  }
  io.stdout(json ? reportToJson(report) : simulationToText(report));
  return report.ok ? EXIT.ok : EXIT.findings;
}
