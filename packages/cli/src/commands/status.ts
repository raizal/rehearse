// `rehearse status <epic-dir-or-slug> [--json] [--not-done]` (T58, S23, box status-cli): the Status
// page as text. Per story: signed, built, tests on the real screens, automated tests, done, and what
// is missing and who acts; then where the facts come from. The same facts and rule as the deck and
// the UI's Status page. Read-only; exit 0 when the table is printed, whatever it says.

import { filterRows, repoTopOf, statusText } from '@rehearse/core';
import { birdviewInfo, buildStatus, DEFAULT_BIRDVIEW_PORT, deckSources, execGit, findTestProject } from '@rehearse/server';
import { resolve } from 'node:path';
import { EXIT, resolveEpicDir, USAGE, type Io } from '../index.js';
import type { PresentDeps } from './present.js';

export type StatusDeps = Omit<PresentDeps, 'printer'>;

const usage = (io: Io, why: string): number => {
  io.stderr(`rehearse status: ${why}\n\n${USAGE}`);
  return EXIT.usage;
};

export async function runStatus(args: string[], io: Io, deps: StatusDeps = {}): Promise<number> {
  let json = false;
  let notDone = false;
  let unitReport: string | undefined;
  let birdviewData: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--json') json = true;
    else if (a === '--not-done') notDone = true;
    else if (a === '--unit-report' || a === '--birdview-data') {
      const value = args[++i];
      if (value === undefined || value === '' || value.startsWith('-')) return usage(io, `${a} needs a ${a === '--birdview-data' ? 'folder' : 'file'} path`);
      if (a === '--unit-report') unitReport = resolve(io.cwd, value);
      else birdviewData = resolve(io.cwd, value);
    } else if (a.startsWith('-')) return usage(io, `unknown option ${a}`);
    else positional.push(a);
  }
  if (positional.length !== 1) return usage(io, 'expected <epic-dir-or-slug> [--json] [--not-done] [--unit-report <file.json>] [--birdview-data <dir>]');
  const epic = positional[0]!;
  const dir = resolveEpicDir(epic, io.cwd);
  if (!dir) {
    io.stderr(`rehearse status: no EPIC folder ${epic} (not a folder, and not found as docs/epics/${epic})\n`);
    return EXIT.usage;
  }
  const top = repoTopOf(dir);
  const git = deps.git ?? execGit;
  const testProject = findTestProject(dir);
  const birdview = { port: DEFAULT_BIRDVIEW_PORT, projectDir: testProject };
  try {
    const sources = await deckSources({
      repoTop: top,
      git,
      ...(testProject ? { testProject } : {}),
      ...(birdviewData ? { birdviewData } : {}),
      ...(unitReport ? { unitReport } : {}),
      ...(deps.birdview === false ? { pluginConfig: () => undefined, env: {} } : {}),
      ...deps.sources,
    });
    if (deps.birdview === false && !birdviewData) delete sources.birdviewData;
    const table = await buildStatus({
      ...sources,
      epicDir: dir,
      repoTop: top,
      git: (a) => git(a, dir),
      ...(testProject ? { testProject } : {}),
      ...(deps.birdview === false
        ? {}
        : {
            testResults: async (storyId: string) => {
              const info = await birdviewInfo(birdview, storyId, dir);
              return info.player.kind === 'ours' ? info.player.results : undefined;
            },
          }),
      ...(deps.now ? { now: deps.now } : {}),
    });
    const filter = notDone ? 'not-done' : 'all';
    io.stdout(json ? `${JSON.stringify({ ...table, filter, rows: filterRows(table.rows, filter) }, null, 2)}\n` : statusText(table, filter));
    return EXIT.ok;
  } catch (e) {
    io.stderr(`rehearse status: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.internal;
  }
}
