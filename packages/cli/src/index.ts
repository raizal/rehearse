// The `rehearse` binary. A thin wrapper over @rehearse/core.
// It has no approve and no sign-off command: only the UI does those (R13, R14).

import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { reportToJson, reportToText, validateEpic } from '@rehearse/core';
import { runSimulate } from './commands/simulate.js';
import { runGate } from './commands/gate.js';
import { runNew } from './commands/new.js';
import { runPlaylists } from './commands/playlists.js';
import { runPlay } from './commands/play.js';
import { runServe } from './commands/serve.js';
import { runCoverage } from './commands/coverage.js';
import { isGraphVerb, runGraph } from './commands/graph.js';
import { runBrief } from './commands/brief.js';
import { runProgress } from './commands/progress.js';

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
  simulate <epic-dir-or-slug> [--drafts] [--json]
                                         Simulate the scenarios: contracts, coverage, lifecycles, acceptance, permission matrix.
                                         --drafts counts draft and stale scenarios too: findings only, never evidence.
  gate check <epic-dir-or-slug> [--json] Check the gate: traced, sim-clean, no-stale, signed-off. Never signs off.
  new <slug> --title "<title>"           Create docs/epics/<slug>/ (slug YYYY-MM-DD-<kebab>) at the git top-level.
  serve [epic-dir-or-slug] [--port N] [--birdview-port N] [--thread-model M] [--thread-reasoning R]
                                         Serve the review UI on 127.0.0.1 (default port 4700; Birdview player 3298).
                                         --thread-model/--thread-reasoning: the model and reasoning level of story threads.
  brief <epic-dir-or-slug> <story> [--allow-unsigned] [--json]
                                         The build brief of a signed story, as a thread gets it. Exit 1 when the story is
                                         not signed off or changed since (--allow-unsigned prints it, saying so on top).
  progress <epic-dir-or-slug> <story> [--json]
                                         What rehearse sees of the work on a story: boxes with code (Flow-Box commits on
                                         every branch), e2e tests per scenario, gate findings, whether it is signed, its thread.
  playlists <epic-dir-or-slug> [--tests <dir>] [--out <dir> | --push [--birdview-port N]]
                                         Write one Birdview playlist per story from the e2e tests named after scenarios.
                                         --push writes them through the Birdview player (switching it to the test project).
  play <epic-dir-or-slug> <story> [--test <file:line>] [--birdview-port N] [--json]
                                         Switch Birdview to this repo's test project, write the story playlist through it
                                         and play it (or one test). Exit 1 when Birdview is busy or not running: try again.

Code graph (each verb first updates .rehearse/graph.db at the git top-level; --rebuild makes it again):
  find <words> [--json] [--rebuild]      Find code by words (BM25; camelCase and snake_case are split).
  show <target> [--json] [--rebuild]     One node: its code, file, ID, and its edges with their trust marks.
  near <target> [--depth n] [--json] [--rebuild]
                                         The nodes up to n edges away, both ways (default 1).
  path <from> <to> [--json] [--rebuild]  The shortest chain of edges from one node to the other.
  context <target> [--budget tokens] [--json] [--rebuild]
                                         The code to read for a target, within a token budget (default 2000;
                                         a token is 4 characters): the target, then by graph distance, then PageRank.
  coverage <file|symbol|box> [--lcov path] [--json] [--rebuild]
                                         Unit test coverage from every coverage/lcov.info of the repo (and --lcov files):
                                         percent, lines and branches run, tests, the lines not run, and the tests that call it.
                                         A box is "box <path>"; its code is its builds edges. Run \`pnpm coverage\` first.
  A target is a node ID, a name, a route ("GET /api/orders/{order_id}") or a file path.
  Exit 1 with "not found" (no such target) or "no path".

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

/** The entry of bin/rehearse.js: the code graph verbs, progress, playlists and play are async; the other commands run in `run`. */
export async function main(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  if (isGraphVerb(command)) return runGraph(command, rest, io);
  if (command === 'coverage') return runCoverage(rest, io);
  if (command === 'progress') return runProgress(rest, io);
  if (command === 'playlists') return runPlaylists(rest, io);
  if (command === 'play') return runPlay(rest, io);
  return run(argv, io);
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
  if (command === 'serve') return runServe(rest, io);
  if (command === 'brief') return runBrief(rest, io);
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
