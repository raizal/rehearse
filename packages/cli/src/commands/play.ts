// `rehearse play <epic-dir-or-slug> <story> [--test <file:line>] [--birdview-port N] [--json]` (T45,
// box play-cli): the Tests tab's "Play in Birdview" for agents and the owner. It switches the
// Birdview player to this repo's test project, writes the story playlist through it and plays it,
// or only the one test. One try: when Birdview is busy or not running it says so and exits 1.
//
// `--wait [--timeout <seconds>]` (T48, box play-wait): then wait for the run to end, print each
// test's result from Birdview's state, and exit 0 when every test passed, 1 when one failed, the
// player stopped without a result, or the timeout (default 600 s) ran out.

import { DEFAULT_BIRDVIEW_PORT, findTestProject, playAndWait, playStory, type PlayerClient, type WaitOptions, type WaitResult } from '@rehearse/server';
import { EXIT, resolveEpicDir, type Io } from '../index.js';
import { birdviewExit, portArg } from './birdview-args.js';

const HELP = 'Usage: rehearse play <epic-dir-or-slug> <story> [--test <file:line>] [--wait [--timeout <seconds>]] [--birdview-port N] [--json]\n';

/** How long `--wait` waits by default. */
export const DEFAULT_WAIT_SECONDS = 600;

/** One line per test: `passed <key> (<name>)`, or `failed <key> (<name>) at step "…": reason`. */
export function resultLine(r: WaitResult): string {
  const who = `${r.key}${r.name ? ` (${r.name})` : ''}`;
  if (r.last === 'passed') return `passed ${who}`;
  if (r.last === 'failed') return `failed ${who}${r.failedStep ? ` at step "${r.failedStep}"` : ''}${r.reason ? `: ${r.reason}` : ''}`;
  if (r.last === 'stopped') return `no result ${who}: Birdview stopped before it ended`;
  return `no result ${who}: still running when the wait ran out`;
}

export async function runPlay(args: string[], io: Io, client?: PlayerClient, wait: Omit<WaitOptions, 'timeoutMs'> = {}): Promise<number> {
  const positional: string[] = [];
  let test: string | undefined;
  let port = DEFAULT_BIRDVIEW_PORT;
  let json = false;
  let waiting = false;
  let timeout: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--json') json = true;
    else if (a === '--wait') waiting = true;
    else if (a === '--timeout') {
      const v = args[++i];
      if (v === undefined || !/^\d+$/.test(v) || Number(v) < 1) {
        io.stderr(`rehearse play: --timeout needs a number of seconds, at least 1, got ${v ?? 'nothing'}\n\n${HELP}`);
        return EXIT.usage;
      }
      timeout = Number(v);
    } else if (a === '--test') {
      const v = args[++i];
      if (v === undefined || !/^[^-].*:\d+$/.test(v)) {
        io.stderr(`rehearse play: --test needs a test key <file>:<line>, got ${v ?? 'nothing'}\n\n${HELP}`);
        return EXIT.usage;
      }
      test = v;
    } else if (a === '--birdview-port') {
      const p = portArg(args[++i]);
      if (typeof p === 'string') {
        io.stderr(`rehearse play: ${p}\n\n${HELP}`);
        return EXIT.usage;
      }
      port = p;
    } else if (a.startsWith('-')) {
      io.stderr(`rehearse play: unknown option ${a}\n\n${HELP}`);
      return EXIT.usage;
    } else positional.push(a);
  }
  if (positional.length !== 2) {
    io.stderr(`rehearse play: expected <epic-dir-or-slug> <story>\n\n${HELP}`);
    return EXIT.usage;
  }
  if (timeout !== undefined && !waiting) {
    io.stderr(`rehearse play: --timeout goes with --wait\n\n${HELP}`);
    return EXIT.usage;
  }
  const [epic, storyId] = positional as [string, string];
  const dir = resolveEpicDir(epic, io.cwd);
  if (!dir) {
    io.stderr(`rehearse play: no EPIC folder ${epic} (not a folder, and not found as docs/epics/${epic})\n`);
    return EXIT.usage;
  }
  const projectDir = findTestProject(dir);
  const setup = { port, ...(projectDir ? { projectDir } : {}), ...(client ? { client } : {}) };
  if (waiting) {
    try {
      const { outcome, results } = await playAndWait(setup, dir, storyId, test, { ...wait, timeoutMs: (timeout ?? DEFAULT_WAIT_SECONDS) * 1000 });
      const passed = results.every((r) => r.last === 'passed');
      if (json) io.stdout(JSON.stringify({ ...outcome, results, passed }, null, 2) + '\n');
      else {
        io.stdout(`Birdview: ${outcome.project.projectDir} · playlist ${outcome.playlist.name}; waited for ${results.length} test${results.length === 1 ? '' : 's'}.\n`);
        for (const r of results) io.stdout(`${resultLine(r)}\n`);
      }
      for (const p of outcome.problems) io.stderr(`problem: ${p}\n`);
      return passed ? EXIT.ok : EXIT.findings;
    } catch (e) {
      const { code, message } = birdviewExit(e);
      io.stderr(`rehearse play: ${message}\n`);
      return code;
    }
  }
  try {
    const out = await playStory(setup, dir, storyId, test);
    if (json) io.stdout(JSON.stringify(out, null, 2) + '\n');
    else {
      io.stdout(`Birdview: ${out.project.projectDir} · playlist ${out.playlist.name} (${out.playlist.tests} test${out.playlist.tests === 1 ? '' : 's'})\n`);
      io.stdout('keys' in out.played ? `Playing ${out.played.keys.join(', ')}.\n` : `Playing the playlist.\n`);
    }
    for (const p of out.problems) io.stderr(`problem: ${p}\n`);
    return EXIT.ok;
  } catch (e) {
    const { code, message } = birdviewExit(e);
    io.stderr(`rehearse play: ${message}\n`);
    return code;
  }
}
