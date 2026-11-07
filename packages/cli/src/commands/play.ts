// `rehearse play <epic-dir-or-slug> <story> [--test <file:line>] [--birdview-port N] [--json]` (T45,
// box play-cli): the Tests tab's "Play in Birdview" for agents and the owner. It switches the
// Birdview player to this repo's test project, writes the story playlist through it and plays it,
// or only the one test. One try: when Birdview is busy or not running it says so and exits 1.

import { DEFAULT_BIRDVIEW_PORT, findTestProject, playStory, type PlayerClient } from '@rehearse/server';
import { EXIT, resolveEpicDir, type Io } from '../index.js';
import { birdviewExit, portArg } from './birdview-args.js';

const HELP = 'Usage: rehearse play <epic-dir-or-slug> <story> [--test <file:line>] [--birdview-port N] [--json]\n';

export async function runPlay(args: string[], io: Io, client?: PlayerClient): Promise<number> {
  const positional: string[] = [];
  let test: string | undefined;
  let port = DEFAULT_BIRDVIEW_PORT;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--json') json = true;
    else if (a === '--test') {
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
  const [epic, storyId] = positional as [string, string];
  const dir = resolveEpicDir(epic, io.cwd);
  if (!dir) {
    io.stderr(`rehearse play: no EPIC folder ${epic} (not a folder, and not found as docs/epics/${epic})\n`);
    return EXIT.usage;
  }
  const projectDir = findTestProject(dir);
  try {
    const out = await playStory({ port, ...(projectDir ? { projectDir } : {}), ...(client ? { client } : {}) }, dir, storyId, test);
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
