// `rehearse playlists <epic-dir-or-slug> [--tests <dir>] [--out <dir> | --push [--birdview-port N]]`
// (T13, T45): one Birdview playlist per story, from the record and the Playwright spec files of the
// test project. A test is named after its scenario id; a step title starts with its box.
// Default test project: the nearest e2e/ with a playwright.config.ts. Without --push it writes
// `<out>/<story id>.json` (default out: <tests>/birdview/playlists). With --push it writes them
// through the Birdview player instead, after switching the player to the test project: they land
// in the project's playlists folder and the player shows them at once.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { DEFAULT_BIRDVIEW_PORT, defaultPlaylistsDir, epicPlaylists, findTestProject, playlistJson, pushPlaylists, type PlayerClient } from '@rehearse/server';
import { EXIT, resolveEpicDir, type Io } from '../index.js';
import { birdviewExit, portArg } from './birdview-args.js';

const HELP = 'Usage: rehearse playlists <epic-dir-or-slug> [--tests <test-project-dir>] [--out <dir> | --push [--birdview-port N]]\n';

export async function runPlaylists(args: string[], io: Io, client?: PlayerClient): Promise<number> {
  const positional: string[] = [];
  let tests: string | undefined;
  let out: string | undefined;
  let push = false;
  let port = DEFAULT_BIRDVIEW_PORT;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--tests' || a === '--out') {
      const v = args[++i];
      if (v === undefined || v.startsWith('-')) {
        io.stderr(`rehearse playlists: ${a} needs a folder\n\n${HELP}`);
        return EXIT.usage;
      }
      if (a === '--tests') tests = resolve(io.cwd, v);
      else out = resolve(io.cwd, v);
    } else if (a === '--push') push = true;
    else if (a === '--birdview-port') {
      const p = portArg(args[++i]);
      if (typeof p === 'string') {
        io.stderr(`rehearse playlists: ${p}\n\n${HELP}`);
        return EXIT.usage;
      }
      port = p;
    } else if (a.startsWith('-')) {
      io.stderr(`rehearse playlists: unknown option ${a}\n\n${HELP}`);
      return EXIT.usage;
    } else positional.push(a);
  }
  if (positional.length !== 1) {
    io.stderr(`rehearse playlists: expected <epic-dir-or-slug>\n\n${HELP}`);
    return EXIT.usage;
  }
  if (push && out !== undefined) {
    io.stderr(`rehearse playlists: --push writes into the player's playlists folder; leave out --out\n\n${HELP}`);
    return EXIT.usage;
  }
  const dir = resolveEpicDir(positional[0]!, io.cwd);
  if (!dir) {
    io.stderr(`rehearse playlists: no EPIC folder ${positional[0]} (not a folder, and not found as docs/epics/${positional[0]})\n`);
    return EXIT.usage;
  }
  const project = tests ?? findTestProject(dir);
  if (!project) {
    io.stderr(`rehearse playlists: no test project (no e2e/playwright.config.ts above ${dir}); name one with --tests <dir>\n`);
    return EXIT.usage;
  }
  return push ? pushAll(dir, project, port, io, client) : writeAll(dir, project, out ?? defaultPlaylistsDir(project), io);
}

function writeAll(dir: string, project: string, outDir: string, io: Io): number {
  const { slug, stories } = epicPlaylists(dir, project);
  if (stories.length === 0) {
    io.stderr(`rehearse playlists: no test in ${project} is named after a scenario of ${slug}\n`);
    return EXIT.findings;
  }
  mkdirSync(outDir, { recursive: true });
  const problems = stories.flatMap((s) => s.build.problems);
  for (const { story, build } of stories) {
    const file = join(outDir, `${story}.json`);
    writeFileSync(file, playlistJson(build.playlist));
    io.stdout(`${relative(io.cwd, file) || file}: ${build.playlist.tests.length} test(s), ${build.playlist.name}\n`);
  }
  for (const p of problems) io.stderr(`problem: ${p}\n`);
  return problems.length > 0 ? EXIT.findings : EXIT.ok;
}

async function pushAll(dir: string, project: string, port: number, io: Io, client?: PlayerClient): Promise<number> {
  try {
    const out = await pushPlaylists({ port, projectDir: project, ...(client ? { client } : {}) }, dir);
    io.stdout(`Birdview: ${out.project.projectDir}\n`);
    for (const w of out.written) io.stdout(`${w.story}: playlist ${w.name} (id ${w.id}), ${w.tests} test(s)\n`);
    for (const p of out.problems) io.stderr(`problem: ${p}\n`);
    return out.problems.length > 0 ? EXIT.findings : EXIT.ok;
  } catch (e) {
    const { code, message } = birdviewExit(e);
    io.stderr(`rehearse playlists: ${message}\n`);
    return code;
  }
}
