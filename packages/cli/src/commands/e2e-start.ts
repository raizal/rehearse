// `rehearse e2e-start <epic-dir-or-slug> <story> [--scenario <id>]… [--main-path] [--stdout] [--append]`
// (T61, S26, box e2e-start): write the start file of a story's e2e tests from its approved scenarios,
// in `<test project>/tests/<story>.spec.ts`. One test for each scenario, one step for each scenario
// step, each step failing until it is written. --main-path: only the story's main path scenario.
// A file that exists is never written again; --append adds the missing tests and changes none.
// Exit 0 when the file is written or printed, 1 when there is nothing to write, 2 on a usage error.

import { e2eStart, loadEpic, readReview, repoTopOf } from '@rehearse/core';
import { findTestProject, testFixtures } from '@rehearse/server';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { EXIT, resolveEpicDir, USAGE, type Io } from '../index.js';

const usage = (io: Io, why: string): number => {
  io.stderr(`rehearse e2e-start: ${why}\n\n${USAGE}`);
  return EXIT.usage;
};

export function runE2eStart(args: string[], io: Io): number {
  const scenarios: string[] = [];
  let mainPath = false;
  let stdout = false;
  let append = false;
  let out: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--main-path') mainPath = true;
    else if (a === '--stdout') stdout = true;
    else if (a === '--append') append = true;
    else if (a === '--scenario' || a === '--out') {
      const value = args[++i];
      if (value === undefined || value === '' || value.startsWith('-')) return usage(io, `${a} needs ${a === '--out' ? 'a file path' : 'a scenario id'}`);
      if (a === '--scenario') scenarios.push(value);
      else out = resolve(io.cwd, value);
    } else if (a.startsWith('-')) return usage(io, `unknown option ${a}`);
    else positional.push(a);
  }
  if (positional.length !== 2) return usage(io, 'expected <epic-dir-or-slug> <story> [--scenario <id>]… [--main-path] [--stdout] [--append] [--out <file>]');
  if (mainPath && scenarios.length > 0) return usage(io, '--main-path and --scenario do not go together: --main-path picks the scenario');
  if (stdout && append) return usage(io, '--stdout prints a new start file; --append adds to the file on disk: use one of them');
  const [epic, storyId] = positional as [string, string];
  const dir = resolveEpicDir(epic, io.cwd);
  if (!dir) {
    io.stderr(`rehearse e2e-start: no EPIC folder ${epic} (not a folder, and not found as docs/epics/${epic})\n`);
    return EXIT.usage;
  }
  try {
    const { record } = loadEpic(dir);
    const top = repoTopOf(dir);
    const testProject = findTestProject(dir) ?? join(top, 'e2e');
    const specFile = out ?? join(testProject, 'tests', `${storyId}.spec.ts`);
    const exists = existsSync(specFile);
    const pick = readReview(record).inputs.mainPath?.[storyId];
    const r = e2eStart(record, storyId, {
      specFile,
      fixtures: testFixtures(testProject),
      ...(scenarios.length > 0 ? { scenarios } : {}),
      ...(mainPath ? { mainPath: true } : {}),
      ...(pick ? { mainPathPick: pick } : {}),
      ...(exists && !stdout ? { existing: readFileSync(specFile, 'utf8') } : {}),
      ...(append ? { append: true } : {}),
    });
    const shown = relative(io.cwd, specFile) || specFile;
    if (!r.ok) {
      io.stderr(`rehearse e2e-start: ${r.reason.replace(specFile, shown)}\n`);
      return r.error === 'no-story' || r.error === 'no-scenario' ? EXIT.usage : EXIT.findings;
    }
    if (stdout) {
      io.stdout(r.text);
      return EXIT.ok;
    }
    mkdirSync(dirname(specFile), { recursive: true });
    writeFileSync(specFile, r.text);
    const main = r.mainId && r.scenarios.includes(r.mainId) ? ` (${r.mainId} is the main path)` : '';
    const lines = [`${r.appended ? 'Added to' : 'Wrote'} ${shown}: ${r.scenarios.length === 1 ? 'a test' : `${r.scenarios.length} tests`} for ${r.scenarios.join(', ')}${main}.`];
    if (r.kept.length > 0) lines.push(`Kept the tests of ${r.kept.join(', ')} as they are.`);
    lines.push('Each step fails with "not written" until you write it. Work from the scenarios and the running product, not from the code of the boxes.');
    io.stdout(`${lines.join('\n')}\n`);
    return EXIT.ok;
  } catch (e) {
    io.stderr(`rehearse e2e-start: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.internal;
  }
}
