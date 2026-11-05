// The `rehearse` binary. A thin wrapper over @rehearse/core.
// It has no approve and no sign-off command: only the UI does those (R13, R14).

import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { reportToJson, reportToText, validateEpic } from '@rehearse/core';

export interface Io {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** Exit codes: 0 OK, 1 findings, 2 usage error. */
export const EXIT = { ok: 0, findings: 1, usage: 2 } as const;

export const USAGE = `Usage: rehearse <command> [options]

Commands:
  validate <epic-dir-or-slug> [--json]   Check the record files of one EPIC (schema, references, flow structure).

Exit codes: 0 OK, 1 findings, 2 usage error.
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
  const report = validateEpic(dir);
  io.stdout(json ? reportToJson(report) : reportToText(report));
  return report.ok ? EXIT.ok : EXIT.findings;
}
