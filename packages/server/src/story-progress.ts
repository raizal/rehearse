// What rehearse sees of the work on one story (T44, box `watch-build`): per box whether code is
// built for it (Flow-Box commits on any branch, and how many on the story thread's branch), its
// unit test coverage (T43), per approved scenario whether its e2e test is found and how it last
// ran, the gate findings of the story, and whether its sign-off still holds. The same progress
// feeds the story page, the Stories overview and `rehearse progress`.
//
// `storyProgress` is pure. `readProgressInputs` gathers its inputs with git (argument arrays) and
// the file system; the thread state and the test results come from the caller (bb and Birdview).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  briefSignState,
  gateItems,
  loadEpic,
  scenarioTrust,
  servingBoxes,
  simulateRecord,
  simulationFindings,
  type EpicRecord,
  type GateItem,
  type Id,
  type Scenario,
} from '@rehearse/core';
import type { CoverageStats } from '@rehearse/graph';
import type { TestResult } from './birdview.js';
import { parseSpec, type SpecTest } from './playlist.js';

/** A Flow-Box commit and the branch git reached it from. */
export interface BranchCommit {
  sha: string;
  subject: string;
  boxes: string[];
  /** Branch name (`refs/heads/` and `refs/remotes/` cut), or the ref as git prints it. */
  branch: string;
}

/** The story thread as the progress block shows it. */
export interface ProgressThread {
  id: string;
  /** bb's word, or null when bb could not be asked. */
  status: string | null;
  statusText: string;
  /** Epoch milliseconds of the thread's last activity. */
  updatedAt: number | null;
  branch: string | null;
  error?: string;
  /** Build thread (from the build brief), question thread, or a thread linked by hand. */
  kind: 'build' | 'question' | 'linked';
  startedAt?: string;
}

export interface BoxProgress {
  path: string;
  title: string;
  built: boolean;
  /** Flow-Box commits that name the box or a box inside it, on any branch. */
  commits: number;
  /** Of them, on the story thread's branch. */
  onThreadBranch: number;
  branches: string[];
  coverage?: CoverageStats;
}

export type ScenarioTestState = 'missing' | 'not-run' | 'passing' | 'failing';

export interface ScenarioProgress {
  id: Id;
  title: string;
  state: ScenarioTestState;
  /** `file:line` of the e2e test, relative to the test project. */
  test?: string;
  failedStep?: string;
}

export interface StoryProgress {
  slug: string;
  storyId: Id;
  thread: ProgressThread | null;
  boxes: BoxProgress[];
  scenarios: ScenarioProgress[];
  /** Approved scenarios are the ones counted; drafts are listed by id. */
  draftScenarios: Id[];
  gate: { check: string; message: string }[];
  signOff: { status: 'signed' | 'stale' | 'draft'; valid: boolean; refusal?: string; at?: string };
  /** The plan hash the thread started from differs from the plan now. */
  planChanged: boolean;
  counts: { boxes: number; boxesWithCode: number; scenarios: number; scenariosTested: number; scenariosPassing: number };
  /** "N of M boxes have code · K of L scenarios tested" */
  summary: string;
}

export interface ProgressInputs {
  record: EpicRecord;
  storyId: Id;
  commits: BranchCommit[];
  /** Shas of the Flow-Box commits on the thread's branch (git log <branch>). */
  threadShas?: ReadonlySet<string>;
  thread: ProgressThread | null;
  /** The plan hash stored with the thread link. */
  linkHash?: string;
  /** The e2e tests found in the test project. */
  tests: SpecTest[];
  /** Last results by `file:line`, from the e2e player. */
  results?: Record<string, TestResult>;
  coverage?: Record<string, CoverageStats>;
  gate: GateItem[];
}

const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** `git log --all --source --format=%H%x1f%S%x1f%s%x1f%B%x1e` output → commits with their Flow-Box trailers. */
export function parseBranchLog(text: string): BranchCommit[] {
  const out: BranchCommit[] = [];
  for (const rec of text.split('\x1e')) {
    const [sha, source, subject, body] = rec.replace(/^\s+/, '').split('\x1f');
    if (!sha || !/^[0-9a-f]{7,64}$/.test(sha) || body === undefined) continue;
    const boxes = [...body.matchAll(/^Flow-Box:[ \t]*(.+)$/gm)].flatMap((m) => m[1]!.trim().split(/[\s,]+/)).filter(Boolean);
    const branch = (source ?? '').trim().replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, '');
    out.push({ sha, subject: subject ?? '', boxes, branch });
  }
  return out;
}

/** The progress of one story. */
export function storyProgress(input: ProgressInputs): StoryProgress {
  const { record, storyId } = input;
  const titles = new Map<string, string>();
  const walk = (boxes: unknown, prefix: string) => {
    for (const b of asArray<Record<string, any>>(boxes)) {
      if (!isObject(b) || typeof b.id !== 'string') continue;
      const path = prefix === '' ? b.id : `${prefix}/${b.id}`;
      titles.set(path, typeof b.title === 'string' ? b.title : path);
      if (isObject(b.children)) walk(b.children.boxes, path);
    }
  };
  walk(record.flow?.root?.boxes, '');

  const boxes: BoxProgress[] = servingBoxes(record.flow, storyId).map((path) => {
    const mine = input.commits.filter((c) => c.boxes.some((b) => b === path || b.startsWith(`${path}/`)));
    const box: BoxProgress = {
      path,
      title: titles.get(path) ?? path,
      built: mine.length > 0,
      commits: mine.length,
      onThreadBranch: input.threadShas ? mine.filter((c) => input.threadShas!.has(c.sha)).length : 0,
      branches: [...new Set(mine.map((c) => c.branch).filter((b) => b !== ''))].sort(),
    };
    const cov = input.coverage?.[path];
    if (cov) box.coverage = cov;
    return box;
  });

  const scenarios: ScenarioProgress[] = [];
  const draftScenarios: Id[] = [];
  for (const f of record.scenarioFiles) {
    for (const s of asArray<Scenario>(f.scenarios)) {
      if (!isObject(s) || s.story !== storyId) continue;
      if (scenarioTrust(s, f.file).status !== 'approved') {
        draftScenarios.push(s.id);
        continue;
      }
      const test = input.tests.find((t) => t.name === s.id);
      const entry: ScenarioProgress = { id: s.id, title: typeof s.title === 'string' ? s.title : s.id, state: 'missing' };
      if (test) {
        const key = `${test.file}:${test.line}`;
        const result = input.results?.[key];
        entry.test = key;
        entry.state = result?.last === 'passed' ? 'passing' : result?.last === 'failed' ? 'failing' : 'not-run';
        if (result?.failedStep) entry.failedStep = result.failedStep;
      }
      scenarios.push(entry);
    }
  }

  const sign = briefSignState(record, storyId);
  const gate = input.gate.filter((g) => g.stories.includes(storyId)).map((g) => ({ check: g.check, message: g.finding.message }));
  const counts = {
    boxes: boxes.length,
    boxesWithCode: boxes.filter((b) => b.built).length,
    scenarios: scenarios.length,
    scenariosTested: scenarios.filter((s) => s.state !== 'missing').length,
    scenariosPassing: scenarios.filter((s) => s.state === 'passing').length,
  };
  return {
    slug: record.slug,
    storyId,
    thread: input.thread,
    boxes,
    scenarios,
    draftScenarios,
    gate,
    signOff: {
      status: sign?.status ?? 'draft',
      valid: sign?.buildable ?? false,
      ...(sign?.refusal ? { refusal: sign.refusal } : {}),
      ...(sign?.at ? { at: sign.at } : {}),
    },
    planChanged: input.linkHash !== undefined && sign !== undefined && input.linkHash !== sign.currentHash,
    counts,
    summary: progressSummary(counts),
  };
}

export function progressSummary(c: StoryProgress['counts']): string {
  return `${c.boxesWithCode} of ${plural(c.boxes, 'box', 'boxes')} ${c.boxesWithCode === 1 && c.boxes === 1 ? 'has' : 'have'} code · ${c.scenariosTested} of ${plural(c.scenarios, 'scenario')} tested`;
}

const SCENARIO_WORDS: Record<ScenarioTestState, string> = {
  missing: 'no e2e test yet',
  'not-run': 'test found, not run yet',
  passing: 'passing',
  failing: 'failing',
};

/** The progress in plain words, as `rehearse progress` prints it. */
export function progressText(p: StoryProgress): string {
  const lines = [`Story ${p.storyId} of ${p.slug}: ${p.summary}`];
  if (p.thread) {
    const when = p.thread.updatedAt ? `, last activity ${new Date(p.thread.updatedAt).toISOString()}` : '';
    const branch = p.thread.branch ? `, branch ${p.thread.branch}` : '';
    lines.push(`Thread ${p.thread.id} (${p.thread.kind}): ${p.thread.statusText}${when}${branch}`);
  } else lines.push('No thread works on this story yet.');
  lines.push(p.signOff.valid ? `Sign-off: valid (signed ${p.signOff.at}).` : `Sign-off: not valid (${p.signOff.refusal ?? p.signOff.status}).`);
  if (p.planChanged) lines.push('The plan changed since the thread started.');
  lines.push('', 'Boxes:');
  for (const b of p.boxes) {
    const work = b.built ? `built, ${plural(b.commits, 'commit')}${p.thread?.branch ? `, ${b.onThreadBranch} on the thread branch` : ''}` : 'not yet';
    const cov = b.coverage ? (b.coverage.percent === null ? ', no coverage data' : `, ${b.coverage.percent}% covered`) : '';
    lines.push(`  ${b.path}: ${work}${cov}`);
  }
  lines.push('', 'Approved scenarios:');
  if (p.scenarios.length === 0) lines.push('  none approved yet');
  for (const s of p.scenarios) lines.push(`  ${s.id}: ${SCENARIO_WORDS[s.state]}${s.test ? ` (${s.test})` : ''}${s.failedStep ? `, failed at ${s.failedStep}` : ''}`);
  if (p.draftScenarios.length > 0) lines.push(`  not approved: ${p.draftScenarios.join(', ')}`);
  lines.push('', p.gate.length === 0 ? 'Gate: no findings for this story.' : `Gate: ${plural(p.gate.length, 'finding')} for this story:`);
  for (const g of p.gate) lines.push(`  ${g.check}: ${g.message}`);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------- inputs (IO)

/** Runs git with an argument array in a folder. */
export type GitCall = (args: string[]) => Promise<{ ok: boolean; stdout: string }>;

/** Most Flow-Box commits read. */
const MAX_COMMITS = 5000;
const LOG_FORMAT = '--format=%H%x1f%S%x1f%s%x1f%B%x1e';

/** Flow-Box commits on every branch. */
export async function branchCommits(git: GitCall): Promise<BranchCommit[]> {
  const r = await git(['log', '--all', '--source', '-n', String(MAX_COMMITS), '--grep=^Flow-Box:', LOG_FORMAT]);
  return r.ok ? parseBranchLog(r.stdout) : [];
}

/** Shas of the Flow-Box commits on one branch; empty when git cannot read it. */
export async function branchShas(git: GitCall, branch: string): Promise<Set<string>> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,250}$/.test(branch) || branch.includes('..')) return new Set();
  const r = await git(['log', '-n', String(MAX_COMMITS), '--grep=^Flow-Box:', '--format=%H', branch, '--']);
  return new Set(r.ok ? r.stdout.split('\n').map((l) => l.trim()).filter(Boolean) : []);
}

/** The e2e tests (`*.spec.ts`) of a test project. */
export function specTests(projectDir: string | undefined): SpecTest[] {
  if (projectDir === undefined) return [];
  const files: string[] = [];
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (name === 'node_modules' || name.startsWith('.') || name === 'test-results' || name === 'playwright-report') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.spec.ts')) files.push(full);
    }
  };
  walk(projectDir);
  return files.flatMap((f) => parseSpec(relative(projectDir, f).split(sep).join('/'), readFileSync(f, 'utf8')));
}

/** The gate items of the EPIC, with simulate (no signature checks: the sign-off state comes from the hashes). */
export function epicGateItems(epicDir: string): { record: EpicRecord; gate: GateItem[] } {
  const loaded = loadEpic(epicDir);
  const findings = simulationFindings(loaded, simulateRecord);
  if (findings.some((f) => f.kind === 'schema')) return { record: loaded.record, gate: [] };
  return { record: loaded.record, gate: gateItems(loaded.record, findings) };
}
