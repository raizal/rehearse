// `rehearse brief <epic-dir-or-slug> <story> [--allow-unsigned] [--json]` (T44, box build-brief):
// the build brief a thread gets for a signed story. It refuses an unsigned or stale story (exit 1)
// unless --allow-unsigned, which says so on top of the brief.
//
// `rehearse brief <epic> <story> --tests [--scenario <id>]… [--json]` (T47, box test-brief): the
// test brief a test thread gets, for the named scenarios or, without --scenario, every approved
// scenario of the story that has no e2e test yet. Exit 1 when a scenario is not approved, or none
// is missing a test.

import { dirname } from 'node:path';
import { decisionTexts, loadEpic, storyBuildBrief } from '@rehearse/core';
import { findTestProject, storyTestBrief, testsNeeded } from '@rehearse/server';
import { EXIT, resolveEpicDir, USAGE, type Io } from '../index.js';

const OPTIONS = ['--json', '--allow-unsigned', '--tests'];
const VALUE_OPTIONS = ['--scenario'];

export function runBrief(args: string[], io: Io): number {
  const usage = () => {
    io.stderr(`rehearse brief: expected <epic-dir-or-slug> <story> [--allow-unsigned] [--json], or <epic-dir-or-slug> <story> --tests [--scenario <id>]… [--json]\n\n${USAGE}`);
    return EXIT.usage;
  };
  const positional: string[] = [];
  const scenarios: string[] = [];
  const flags = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (VALUE_OPTIONS.includes(a)) {
      const v = args[++i];
      if (v === undefined || v.startsWith('-')) return usage();
      scenarios.push(v);
    } else if (a.startsWith('-')) {
      if (!OPTIONS.includes(a)) return usage();
      flags.add(a);
    } else positional.push(a);
  }
  const json = flags.has('--json');
  const tests = flags.has('--tests');
  if (positional.length !== 2 || (scenarios.length > 0 && !tests) || (tests && flags.has('--allow-unsigned'))) return usage();
  const [epic, storyId] = positional as [string, string];
  const dir = resolveEpicDir(epic, io.cwd);
  if (!dir) {
    io.stderr(`rehearse brief: no EPIC folder ${epic} (not a folder, and not found as docs/epics/${epic})\n`);
    return EXIT.usage;
  }
  if (tests) return testBrief(dir, storyId, scenarios, json, io);
  let made;
  try {
    made = storyBuildBrief(loadEpic(dir).record, storyId, { allowUnsigned: flags.has('--allow-unsigned'), decisions: decisionTexts(dir) });
  } catch (e) {
    io.stderr(`rehearse brief: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.internal;
  }
  if (!made.ok) {
    if (json) io.stdout(JSON.stringify({ ok: false, storyId, reason: made.reason, ...(made.sign ? { sign: made.sign } : {}) }, null, 2) + '\n');
    else io.stderr(`rehearse brief: ${made.reason}\n`);
    return EXIT.findings;
  }
  if (json) io.stdout(JSON.stringify({ ok: true, storyId, hash: made.hash, sign: made.sign, markdown: made.markdown }, null, 2) + '\n');
  else io.stdout(made.markdown.endsWith('\n') ? made.markdown : `${made.markdown}\n`);
  return EXIT.ok;
}

/** The test brief. Paths are relative to the folder that holds the test project (the repo top). */
function testBrief(dir: string, storyId: string, named: string[], json: boolean, io: Io): number {
  let made;
  try {
    const { record } = loadEpic(dir);
    const testProject = findTestProject(dir);
    const top = testProject ? dirname(testProject) : dirname(dir);
    let ids = named;
    if (ids.length === 0 && record.prd?.stories.some((s) => s.id === storyId)) {
      const needed = testsNeeded(record, storyId, testProject);
      ids = needed.missing;
      if (ids.length === 0) {
        const drafts = needed.notApproved.map((n) => `${n.id} (${n.status})`).join(', ');
        const reason = `no approved scenario of ${storyId} is without an e2e test${drafts ? `; not approved yet: ${drafts}, approve them first` : ''}; name one with --scenario <id>`;
        if (json) io.stdout(JSON.stringify({ ok: false, storyId, reason, ...(drafts ? { notApproved: needed.notApproved } : {}) }, null, 2) + '\n');
        else io.stderr(`rehearse brief: ${reason}\n`);
        return EXIT.findings;
      }
    }
    made = storyTestBrief(record, storyId, ids, testProject, top);
  } catch (e) {
    io.stderr(`rehearse brief: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.internal;
  }
  if (!made.ok) {
    if (json) io.stdout(JSON.stringify({ ok: false, storyId, reason: made.reason, ...(made.notApproved ? { notApproved: made.notApproved } : {}) }, null, 2) + '\n');
    else io.stderr(`rehearse brief: ${made.reason}\n`);
    return EXIT.findings;
  }
  if (json) io.stdout(JSON.stringify({ ok: true, storyId, scenarios: made.scenarios, specFile: made.specFile, hash: made.hash, markdown: made.markdown }, null, 2) + '\n');
  else io.stdout(made.markdown);
  return EXIT.ok;
}
