// `rehearse playlists <epic-dir-or-slug> [--tests <dir>] [--out <dir>]` (T13): write one Birdview
// playlist per story, `<out>/<story id>.json`, from the record and the Playwright spec files of
// the test project. A test is named after its scenario id; a step title starts with its box.
// Default test project: the nearest e2e/ with a playwright.config.ts; default out:
// <tests>/birdview/playlists. It never writes into Birdview's own playlists folder unless told to.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { loadEpic, type Scenario } from '@rehearse/core';
import { buildPlaylist, defaultPlaylistsDir, findTestProject, parseSpec, playlistJson, storiesWithTests, type SpecTest } from '@rehearse/server';
import { EXIT, resolveEpicDir, type Io } from '../index.js';

const HELP = 'Usage: rehearse playlists <epic-dir-or-slug> [--tests <test-project-dir>] [--out <dir>]\n';

export function runPlaylists(args: string[], io: Io): number {
  const positional: string[] = [];
  let tests: string | undefined;
  let out: string | undefined;
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
    } else if (a.startsWith('-')) {
      io.stderr(`rehearse playlists: unknown option ${a}\n\n${HELP}`);
      return EXIT.usage;
    } else positional.push(a);
  }
  if (positional.length !== 1) {
    io.stderr(`rehearse playlists: expected <epic-dir-or-slug>\n\n${HELP}`);
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
  const outDir = out ?? defaultPlaylistsDir(project);

  const { record } = loadEpic(dir);
  const scenarios: Scenario[] = record.scenarioFiles.flatMap((f) => f.scenarios.map((s) => ({ ...s, story: s.story ?? f.story })));
  const specs: SpecTest[] = specFiles(project).flatMap((file) => parseSpec(relative(project, file).split(sep).join('/'), readFileSync(file, 'utf8')));
  const stories = storiesWithTests(record.prd, scenarios, specs);
  if (stories.length === 0) {
    io.stderr(`rehearse playlists: no test in ${project} is named after a scenario of ${record.slug}\n`);
    return EXIT.findings;
  }
  mkdirSync(outDir, { recursive: true });
  const problems: string[] = [];
  for (const story of stories) {
    const built = buildPlaylist(story, record.prd, scenarios, specs);
    problems.push(...built.problems);
    const file = join(outDir, `${story}.json`);
    writeFileSync(file, playlistJson(built.playlist));
    io.stdout(`${relative(io.cwd, file) || file}: ${built.playlist.tests.length} test(s), ${built.playlist.name}\n`);
  }
  for (const p of problems) io.stderr(`problem: ${p}\n`);
  return problems.length > 0 ? EXIT.findings : EXIT.ok;
}

/** Every *.spec.ts under the test project, sorted, outside node_modules and test output. */
function specFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name.startsWith('.') || name === 'test-results' || name === 'playwright-report') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...specFiles(full));
    else if (name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}
