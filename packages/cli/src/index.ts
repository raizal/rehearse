// The `rehearse` binary. A thin wrapper over @rehearse/core.
// It has no approve and no sign-off command: only the UI does those (R13, R14).

import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { reportToJson, reportToText, validateEpic } from '@rehearse/core';
import { runSimulate } from './commands/simulate.js';
import { runGate } from './commands/gate.js';
import { runNew } from './commands/new.js';

export interface Io {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** Exit codes: 0 OK, 1 findings, 2 usage error, 3 internal error (a bug in rehearse, not in the record). */
export const EXIT = { ok: 0, findings: 1, usage: 2, internal: 3 } as const;

export const USAGE = `Usage: rehearse <command> [options]

Commands:
  validate <epic-dir-or-slug> [--json]   Check the record files of one EPIC (schema, references, flow structure).
  simulate <epic-dir-or-slug> [--json]   Simulate the scenarios: contracts, coverage, lifecycles, acceptance, permission matrix.
  gate check <epic-dir-or-slug> [--json] Check the gate: traced, sim-clean, no-stale. Never signs off.
  new <slug> --title "<title>"           Create docs/epics/<slug>/ (slug YYYY-MM-DD-<kebab>) at the git top-level.

Exit codes: 0 OK, 1 findings, 2 usage error, 3 internal error.
`;

/** An EPIC folder path, or a slug looked up as docs/epics/<slug> in cwd and its parents. */
export function resolveEpicDir(arg: string, cwd: string): string | undefined {
  const direct = resolve(cwd, arg);
  if (isDir(direct)) return direct;
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const candidate = join(dir, 'docs', 'epics', arg);
    if (isDir(candidate)) return candidate;
    if (dirname(dir) === dir) return undefined;
  }
}

function isDir(p: string): boolean {
  return existsSync(p) && statSync(p).isDirectory();
}

export function run(argv: string[], io: Io): number {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    io.stdout(USAGE);
    return command === undefined ? EXIT.usage : EXIT.ok;
  }
  if (command === 'simulate') return runSimulate(rest, io);
  if (command === 'gate') return runGate(rest, io);
  if (command === 'new') return runNew(rest, io);
  if (command !== 'validate') {
    io.stderr(`rehearse: unknown command ${command}\n\n${USAGE}`);
    return EXIT.usage;
  }
  const json = rest.includes('--json');
  const unknown = rest.filter((a) => a.startsWith('-') && a !== '--json');
  const positional = rest.filter((a) => !a.startsWith('-'));
  if (unknown.length > 0 || positional.length !== 1) {
    io.stderr(`rehearse validate: expected <epic-dir-or-slug> [--json]\n\n${USAGE}`);
    return EXIT.usage;
  }
  const dir = resolveEpicDir(positional[0]!, io.cwd);
  if (!dir) {
    io.stderr(`rehearse validate: no EPIC folder ${positional[0]} (not a folder, and not found as docs/epics/${positional[0]})\n`);
    return EXIT.usage;
  }
  let report;
  try {
    report = validateEpic(dir);
  } catch (e) {
    io.stderr(`rehearse validate: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.internal;
  }
  io.stdout(json ? reportToJson(report) : reportToText(report));
  return report.ok ? EXIT.ok : EXIT.findings;
}
