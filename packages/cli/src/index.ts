// The `rehearse` binary. A thin wrapper over @rehearse/core.
// It has no approve and no sign-off command: only the UI does those (R13, R14).

import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { reportToJson, reportToText, validateEpic } from '@rehearse/core';
import { runSimulate } from './commands/simulate.js';
import { runGate } from './commands/gate.js';
import { runNew } from './commands/new.js';
import { runChange } from './commands/change.js';
import { runPlaylists } from './commands/playlists.js';
import { runPlay } from './commands/play.js';
import { runServe } from './commands/serve.js';
import { runCoverage } from './commands/coverage.js';
import { isGraphVerb, runGraph } from './commands/graph.js';
import { runBrief } from './commands/brief.js';
import { runPresent } from './commands/present.js';
import { runProgress } from './commands/progress.js';
import { runE2eStart } from './commands/e2e-start.js';
import { runStatus } from './commands/status.js';
import { runFigcraft } from './commands/figcraft.js';
import { runDesign } from './commands/design.js';

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
  change new <epic-dir-or-slug> <story> --title "<title>"
                                         Write the start file of a small change to a story: changes/C<n>.yaml (T62).
                                         A change adds 1 to 3 criteria and 5 scenarios or fewer; it edits no item.
  serve [epic-dir-or-slug] [--port N] [--birdview-port N] [--thread-model M] [--thread-reasoning R]
                                         Serve the review UI on 127.0.0.1 (default port 4700; Birdview player 3298).
                                         --thread-model/--thread-reasoning: the model of story threads and how much it reasons.
  brief <epic-dir-or-slug> <story> [--scenario <id>]… [--allow-unsigned] [--json]
                                         The build brief of a signed story, as a thread gets it. Exit 1 when the story is
                                         not signed off or changed since (--allow-unsigned prints it, with a note on top).
                                         --scenario: these scenarios in full, the others in one line each.
  brief <epic-dir-or-slug> <story> --tests [--scenario <id>]… [--json]
                                         The test brief of scenarios without an e2e test, as a test thread gets it
                                         (default: all of the story's). Exit 1 on a draft or stale scenario, or when all have a test.
  e2e-start <epic-dir-or-slug> <story> [--scenario <id>]… [--main-path] [--stdout] [--append] [--out <file>]
                                         Write the start file of a story's e2e tests (default <test project>/tests/<story>.spec.ts):
                                         one test for each scenario the owner accepted, one test.step for each step, with the example
                                         data. Each step fails with "not written" until you write it. --main-path: only the
                                         story's main path scenario. A file that exists is never written again: --append adds
                                         the missing tests and changes none. --stdout prints the file. Exit 1 when there is
                                         nothing to write (the file exists, nothing new, or a draft scenario).
  progress <epic-dir-or-slug> <story> [--json]
                                         What rehearse sees of the work on a story: each box built (Flow-Box commits on
                                         every branch, code the code graph maps to it), no code of its own (start/end, or a
                                         decision a built neighbour branches on) or not built, with the evidence; e2e tests
                                         per scenario, gate findings, whether it is signed, its thread.
  status <epic-dir-or-slug> [--json] [--not-done] [--unit-report <file.json>] [--birdview-data <dir>]
                                         Per story: signed, built, tests on the real screens, automated tests, done, and what
                                         the story still needs and who acts; not done first. The same rule as the deck and the Status page.
                                         --not-done shows only the stories not done. Exit 0.
  present <epic-dir-or-slug> [--full] [--out <file.html>] [--pdf <file.pdf>] [--committed-only]
          [--with-recordings <dir>] [--unit-report <file.json>] [--birdview-data <dir>]
                                         The EPIC as a deck for a supervisor: one self-contained HTML file (default
                                         presentations/<slug>-<date>-<sha>.html), and a PDF with --pdf (Chromium from e2e/).
                                         By default a short executive summary: where we are, what is done, what is not
                                         and why, how we know, what is next. --full adds every story slide after it
                                         (file <name>-full.html).
                                         It says what is done and what is not, with the proof: e2e results (the Birdview player,
                                         else its saved results), unit tests (--unit-report, default .rehearse/unit-report.json
                                         from pnpm test:report), signatures. --with-recordings writes the deck into <dir> and
                                         copies the videos it links into <dir>/<deck>-media/.
                                         Exit 1 with --committed-only on uncommitted record changes, when no PDF, or when the
                                         named --unit-report cannot be read (the deck is still written).
  playlists <epic-dir-or-slug> [--tests <dir>] [--out <dir> | --push [--birdview-port N]]
                                         Write one Birdview playlist per story from the e2e tests named after scenarios.
                                         --push writes them through the Birdview player and switches it to the test project.
  play <epic-dir-or-slug> <story> [--test <file:line>] [--wait [--timeout <seconds>]] [--birdview-port N] [--json]
                                         Switch Birdview to this repo's test project, write the story playlist through it
                                         and play it (or one test). Exit 1 when Birdview is busy or not running: try again.
                                         --wait waits for the run to end and prints each result from Birdview's state:
                                         exit 0 when all passed, 1 when one failed or the timeout ran out (default 600 s).
  figcraft fetch [--version <v>] [--json]
                                         Download the FigCraft web build (default: the installed app's version, else the
                                         latest release), check its SHA-256 and unpack it into .rehearse/figcraft-web/<v>/
                                         for the Design tab of rehearse serve. Exit 1 on a hash mismatch or a network error.
  design suggest <epic-dir-or-slug> [--json]
                                         For each story with no design linked, the top 3 pages and frames of design/**/*.figcraft
                                         by the words they share with it, and why. Never links: the owner links in the Design tab.
                                         Exit 1 when there is no readable design file under design/.

Code graph (each verb first updates .rehearse/graph.db at the git top-level; --rebuild makes it again):
  find <words> [--json] [--rebuild]      Find code by words (BM25; the search splits camelCase and snake_case).
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

/** The entry of bin/rehearse.js: the code graph verbs, coverage, brief, progress, status, present, playlists, play and figcraft are async; the other commands run in `run`. */
export async function main(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  if (isGraphVerb(command)) return runGraph(command, rest, io);
  if (command === 'coverage') return runCoverage(rest, io);
  if (command === 'brief') return runBrief(rest, io);
  if (command === 'progress') return runProgress(rest, io);
  if (command === 'status') return runStatus(rest, io);
  if (command === 'e2e-start') return runE2eStart(rest, io);
  if (command === 'present') return runPresent(rest, io);
  if (command === 'playlists') return runPlaylists(rest, io);
  if (command === 'play') return runPlay(rest, io);
  if (command === 'figcraft') return runFigcraft(rest, io);
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
  if (command === 'change') return runChange(rest, io);
  if (command === 'serve') return runServe(rest, io);
  if (command === 'design') return runDesign(rest, io);
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
