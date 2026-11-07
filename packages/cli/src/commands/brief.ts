// `rehearse brief <epic-dir-or-slug> <story> [--scenario <id>]… [--allow-unsigned] [--json]` (T44, box
// build-brief): the build brief a thread gets for a signed story. It refuses an unsigned or stale story
// (exit 1) unless --allow-unsigned, which says so on top of the brief. A brief too long for its budget
// shows its first approved scenarios in full and the others in one line each (T56); --scenario names
// the ones to show in full (exit 1 when one is not an approved scenario of the story).
//
// `rehearse brief <epic> <story> --tests [--scenario <id>]… [--json]` (T47, box test-brief): the
// test brief a test thread gets, for the named scenarios or, without --scenario, every approved
// scenario of the story that has no e2e test yet. Exit 1 when a scenario is not approved, or none
// is missing a test.
//
// Both briefs carry "Code you start from" (T49): the code graph of the repo is brought up to date
// and asked for the code of the story's boxes; when it cannot open, the brief says so in one line.
// `--json` holds the facts under `code`. No tests run.
//
// The build brief names the story's design (T50): its links in design/links.yaml, under `design` in `--json`.

import { existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { briefBoxPaths, decisionTexts, loadEpic, repoCommands, storyBriefDesign, storyBuildBrief, testBriefBoxPaths, type EpicRecord, type StoryDesignLinks } from '@rehearse/core';
import { findTestProject, gatherBriefCode, openGraphAccess, repoRoot, storyTestBrief, testsNeeded, type BriefCode } from '@rehearse/server';
import { EXIT, resolveEpicDir, USAGE, type Io } from '../index.js';

const OPTIONS = ['--json', '--allow-unsigned', '--tests'];
const VALUE_OPTIONS = ['--scenario'];

export async function runBrief(args: string[], io: Io): Promise<number> {
  const usage = () => {
    io.stderr(`rehearse brief: expected <epic-dir-or-slug> <story> [--scenario <id>]… [--allow-unsigned] [--json], or <epic-dir-or-slug> <story> --tests [--scenario <id>]… [--json]\n\n${USAGE}`);
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
  if (positional.length !== 2 || (tests && flags.has('--allow-unsigned'))) return usage();
  const [epic, storyId] = positional as [string, string];
  const dir = resolveEpicDir(epic, io.cwd);
  if (!dir) {
    io.stderr(`rehearse brief: no EPIC folder ${epic} (not a folder, and not found as docs/epics/${epic})\n`);
    return EXIT.usage;
  }
  if (tests) return testBrief(dir, storyId, scenarios, json, io);
  let made;
  let code: BriefCode;
  let design: StoryDesignLinks;
  try {
    const { record } = loadEpic(dir);
    const top = repoTop(dir);
    code = await briefCode(dir, record, briefBoxPaths(record, storyId), findTestProject(dir));
    design = storyBriefDesign(top, record, storyId);
    made = storyBuildBrief(record, storyId, { ...code, allowUnsigned: flags.has('--allow-unsigned'), ...(scenarios.length > 0 ? { scenarios } : {}), decisions: decisionTexts(dir), commands: repoCommands(top), design });
  } catch (e) {
    io.stderr(`rehearse brief: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.internal;
  }
  if (!made.ok) {
    if (json) io.stdout(JSON.stringify({ ok: false, storyId, reason: made.reason, ...(made.sign ? { sign: made.sign } : {}) }, null, 2) + '\n');
    else io.stderr(`rehearse brief: ${made.reason}\n`);
    return EXIT.findings;
  }
  if (json) io.stdout(JSON.stringify({ ok: true, storyId, hash: made.hash, sign: made.sign, code, design, markdown: made.markdown }, null, 2) + '\n');
  else io.stdout(made.markdown.endsWith('\n') ? made.markdown : `${made.markdown}\n`);
  return EXIT.ok;
}

/** The git top-level above an EPIC folder (the folder holding `.git`), else the folder above docs/epics. */
function repoTop(dir: string): string {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return d;
    if (dirname(d) === d) return dirname(dirname(dir));
  }
}

/** The test brief. Paths are relative to the folder that holds the test project (the repo top). */
async function testBrief(dir: string, storyId: string, named: string[], json: boolean, io: Io): Promise<number> {
  let made;
  let code: BriefCode = {};
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
    code = await briefCode(dir, record, testBriefBoxPaths(record, storyId, ids), testProject);
    made = storyTestBrief(record, storyId, ids, testProject, top, code);
  } catch (e) {
    io.stderr(`rehearse brief: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.internal;
  }
  if (!made.ok) {
    if (json) io.stdout(JSON.stringify({ ok: false, storyId, reason: made.reason, ...(made.notApproved ? { notApproved: made.notApproved } : {}) }, null, 2) + '\n');
    else io.stderr(`rehearse brief: ${made.reason}\n`);
    return EXIT.findings;
  }
  if (json) io.stdout(JSON.stringify({ ok: true, storyId, scenarios: made.scenarios, specFile: made.specFile, hash: made.hash, code, markdown: made.markdown }, null, 2) + '\n');
  else io.stdout(made.markdown);
  return EXIT.ok;
}

/** The code facts of the boxes from the repo's graph, opened for this one brief and closed after. */
function briefCode(dir: string, record: EpicRecord, boxes: string[], testProject: string | undefined): Promise<BriefCode> {
  const root = repoRoot(dir);
  return gatherBriefCode({
    epicDir: dir,
    record,
    boxes,
    root,
    graph: openGraphAccess(root),
    ...(testProject ? { testProject: relative(root, testProject).split(sep).join('/') } : {}),
  });
}
