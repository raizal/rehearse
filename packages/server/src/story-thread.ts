// One bb thread per story (T12). The link story → thread is local state, not record: a record
// field would change the story hash. It lives in `<repo>/.rehearse/story-threads.json`:
// `{ "<epic slug>": { "<story id>": "thr_…" } }`. The repo ignores that file: a thread id only
// means something to the bb install that made it.
//
// A build thread (T44, box `start-build`) starts from the build brief of a signed story, in a new
// worktree on the current branch. Its link keeps the plan hash and content it started from and
// when: `{ "thread": "thr_…", "kind": "build", "hash": "sha256:…", "at": "…", "content": {…} }`.
// When the plan changes later, the view says so and `sendChange` tells the thread what changed
// (box `watch-build`). The progress of the work comes from story-progress.ts.
//
// A test thread (T47, box `start-test-thread`) writes the missing e2e tests of a story's approved
// scenarios from the test brief. One per story at a time; its link sits beside the story thread as
// `tests`: `{ "S1": { "thread": "thr_…", "tests": { "thread": "thr_…", "scenarios": [...],
// "hash": "sha256:…", "at": "…" } } }`. A story with a test thread only has no `thread` of its own;
// older readers skip such an entry and ignore `tests`.
//
// Every `git` and `bb` call goes through a Runner (argument arrays, no shell), so tests use a
// fake and never the real repo or bb. Text for bb goes on stdin (`--message-file -`).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import {
  briefSignState,
  scenarioStatuses,
  scenarioTestBrief,
  decisionTexts,
  diffStoryContent,
  loadEpic,
  repoCommands,
  storyBuildBrief,
  storyChangeMessage,
  type BriefSignState,
  type Box,
  type Diagram,
  type EpicRecord,
  type TestBrief,
  type TestFixture,
  type Id,
} from '@rehearse/core';
import type { CoverageStats } from '@rehearse/graph';
import { bbProjectResolver, findBbProject, NO_BB_PROJECT } from './bb-project.js';
import { parseSpawn, parseTell, parseThreadLog, parseThreadShow, statusWords, THREAD_ID, type ThreadMessage } from './bb-json.js';
import type { TestResult } from './birdview.js';
import {
  branchCommits,
  branchShas,
  epicGateItems,
  specTests,
  storyProgress,
  type BranchCommit,
  type ProgressThread,
  type StoryProgress,
} from './story-progress.js';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** The program could not start (not on PATH). */
  spawnError?: string;
}

export interface RunOptions {
  cwd: string;
  /** Written to stdin, then stdin is closed. */
  input?: string;
}

/** Runs `git` or `bb` with an argument array. */
export type Runner = (command: 'git' | 'bb', args: string[], opts: RunOptions) => Promise<RunResult>;

/** Output kept per stream. */
const OUTPUT_LIMIT = 8 * 1024 * 1024;

/** The real runner: spawn, no shell, a time limit. */
export function processRunner(env: NodeJS.ProcessEnv = process.env, timeoutMs = 20_000): Runner {
  return (command, args, opts) =>
    new Promise((resolve) => {
      let child;
      try {
        child = spawn(command, args, { cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (e) {
        resolve({ code: -1, stdout: '', stderr: '', spawnError: e instanceof Error ? e.message : String(e) });
        return;
      }
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let size = 0;
      const keep = (into: Buffer[]) => (b: Buffer) => {
        size += b.length;
        if (size <= OUTPUT_LIMIT) into.push(b);
      };
      child.stdout.on('data', keep(out));
      child.stderr.on('data', keep(err));
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      let done = false;
      const settle = (r: RunResult) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(r);
      };
      child.on('error', (e) => settle({ code: -1, stdout: '', stderr: '', spawnError: e.message }));
      child.on('close', (code, signal) =>
        settle({
          code: code ?? -1,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8') + (signal === 'SIGKILL' ? `\n${command} ran longer than ${timeoutMs} ms and was stopped` : ''),
        }),
      );
      child.stdin.on('error', () => undefined);
      child.stdin.end(opts.input ?? '');
    });
}

// ---------------------------------------------------------------- the link file (pure parts)

/** The link file, relative to the git top-level. */
export const STORY_THREADS_FILE = '.rehearse/story-threads.json';

/** One story's thread. A thread linked by hand has only the id (and is written as a bare string). */
export interface StoryLink {
  thread: string;
  kind?: 'build' | 'question';
  /** Story hash rule 2 of the plan the thread started from, or was last told about. */
  hash?: string;
  /** When the thread started (ISO). */
  at?: string;
  /** When the thread was last told of a change (ISO). */
  changedAt?: string;
  /** The plan content (`storyContentV2`) of `hash`, for the change list. */
  content?: Record<string, unknown>;
}

export type StoryThreads = Record<string, Record<string, StoryLink>>;

const HASH = /^sha256:[0-9a-f]{64}$/;

function parseLink(v: unknown): StoryLink | undefined {
  if (typeof v === 'string') return THREAD_ID.test(v) ? { thread: v } : undefined;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.thread !== 'string' || !THREAD_ID.test(o.thread)) return undefined;
  const link: StoryLink = { thread: o.thread };
  if (o.kind === 'build' || o.kind === 'question') link.kind = o.kind;
  if (typeof o.hash === 'string' && HASH.test(o.hash)) link.hash = o.hash;
  if (typeof o.at === 'string') link.at = o.at;
  if (typeof o.changedAt === 'string') link.changedAt = o.changedAt;
  if (typeof o.content === 'object' && o.content !== null && !Array.isArray(o.content)) link.content = o.content as Record<string, unknown>;
  return link;
}

/** A story's test thread (T47): the scenarios it writes tests for, the story hash it started from, when. */
export interface TestLink {
  thread: string;
  scenarios: Id[];
  hash?: string;
  /** When the thread started (ISO). */
  at?: string;
  /** When scenarios were last sent to it (ISO). */
  sentAt?: string;
}

export type TestThreads = Record<string, Record<string, TestLink>>;

function parseTestLink(v: unknown): TestLink | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.thread !== 'string' || !THREAD_ID.test(o.thread)) return undefined;
  const link: TestLink = { thread: o.thread, scenarios: Array.isArray(o.scenarios) ? o.scenarios.filter((x): x is string => typeof x === 'string') : [] };
  if (typeof o.hash === 'string' && HASH.test(o.hash)) link.hash = o.hash;
  if (typeof o.at === 'string') link.at = o.at;
  if (typeof o.sentAt === 'string') link.sentAt = o.sentAt;
  return link;
}

/** The file form of a story entry: a bare thread id when that is all it has. */
function linkJson(link: StoryLink | undefined, tests: TestLink | undefined): string | Record<string, unknown> {
  if (link && !tests && Object.keys(link).length === 1) return link.thread;
  return { ...link, ...(tests ? { tests } : {}) };
}

/** The links in the file text. Entries that are not a story id → thread id (or link) are dropped. */
export function parseStoryThreads(text: string): StoryThreads {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {};
  }
  const out: StoryThreads = {};
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return out;
  for (const [slug, stories] of Object.entries(json)) {
    if (typeof stories !== 'object' || stories === null || Array.isArray(stories)) continue;
    const kept = Object.entries(stories).flatMap(([id, v]) => {
      const link = parseLink(v);
      return link ? [[id, link] as const] : [];
    });
    if (kept.length > 0) out[slug] = Object.fromEntries(kept);
  }
  return out;
}

/** The test threads in the file text (the `tests` of each story entry). */
export function parseTestThreads(text: string): TestThreads {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {};
  }
  const out: TestThreads = {};
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return out;
  for (const [slug, stories] of Object.entries(json)) {
    if (typeof stories !== 'object' || stories === null || Array.isArray(stories)) continue;
    const kept = Object.entries(stories).flatMap(([id, v]) => {
      const link = typeof v === 'object' && v !== null ? parseTestLink((v as Record<string, unknown>).tests) : undefined;
      return link ? [[id, link] as const] : [];
    });
    if (kept.length > 0) out[slug] = Object.fromEntries(kept);
  }
  return out;
}

export function withStoryThread(all: StoryThreads, slug: string, storyId: Id, link: StoryLink | string): StoryThreads {
  return { ...all, [slug]: { ...all[slug], [storyId]: typeof link === 'string' ? { thread: link } : link } };
}

export function withTestThread(all: TestThreads, slug: string, storyId: Id, link: TestLink): TestThreads {
  return { ...all, [slug]: { ...all[slug], [storyId]: link } };
}

/** The link file text: the story threads, and beside them the test threads. */
export function storyThreadsJson(all: StoryThreads, tests: TestThreads = {}): string {
  const out: Record<string, Record<string, string | Record<string, unknown>>> = {};
  for (const slug of new Set([...Object.keys(all), ...Object.keys(tests)])) {
    const ids = new Set([...Object.keys(all[slug] ?? {}), ...Object.keys(tests[slug] ?? {})]);
    out[slug] = Object.fromEntries([...ids].map((id) => [id, linkJson(all[slug]?.[id], tests[slug]?.[id])]));
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

// ---------------------------------------------------------------- the story brief (pure)

export interface StoryBrief {
  slug: string;
  storyId: Id;
  want: string;
  soThat: string;
  role: string;
  /** The boxes that serve the story (a parent serves what its children serve), in file order. */
  boxes: { path: string; title: string }[];
  scenarios: Id[];
}

function boxesOf(diagram: Diagram | undefined): Box[] {
  return Array.isArray(diagram?.boxes) ? diagram.boxes.filter((b) => b && typeof b.id === 'string') : [];
}

function serves(box: Box, storyId: Id): boolean {
  if (Array.isArray(box.stories) && box.stories.includes(storyId)) return true;
  return boxesOf(box.children).some((c) => serves(c, storyId));
}

/** The brief of a story, or undefined when the record has no such story. */
export function storyBrief(record: EpicRecord, storyId: Id): StoryBrief | undefined {
  const story = (Array.isArray(record.prd?.stories) ? record.prd.stories : []).find((s) => s && s.id === storyId);
  if (!story) return undefined;
  const boxes: StoryBrief['boxes'] = [];
  const walk = (diagram: Diagram | undefined, prefix: string) => {
    for (const b of boxesOf(diagram)) {
      const path = prefix === '' ? b.id : `${prefix}/${b.id}`;
      if (serves(b, storyId)) boxes.push({ path, title: typeof b.title === 'string' ? b.title : path });
      walk(b.children, path);
    }
  };
  walk(record.flow?.root, '');
  const scenarios = record.scenarioFiles.flatMap((f) =>
    (Array.isArray(f.scenarios) ? f.scenarios : []).filter((s) => (s.story ?? f.story) === storyId).map((s) => s.id),
  );
  const role = (Array.isArray(record.prd?.roles) ? record.prd.roles : []).find((r) => r.id === story.role);
  return {
    slug: record.slug,
    storyId,
    want: String(story.want ?? ''),
    soThat: String(story.soThat ?? ''),
    role: typeof role?.name === 'string' ? role.name : String(story.role ?? ''),
    boxes,
    scenarios,
  };
}

/** The first message of a new story thread. */
export function briefPrompt(brief: StoryBrief): string {
  const boxes = brief.boxes.length > 0 ? brief.boxes.map((b) => `${b.path} (${b.title})`).join(', ') : 'none';
  return [
    `Story thread for ${brief.storyId} of the EPIC ${brief.slug}.`,
    '',
    `As ${brief.role}, I want ${brief.want}, so that ${brief.soThat}.`,
    '',
    `Boxes that serve it: ${boxes}.`,
    `Scenarios: ${brief.scenarios.length}${brief.scenarios.length > 0 ? ` (${brief.scenarios.join(', ')})` : ''}.`,
    `Record: docs/epics/${brief.slug} (prd.yaml, flow.yaml, scenarios/).`,
    '',
    'This thread holds the questions and the work on this story. Read the story in the record and say in a few lines what it needs, then wait for questions here.',
  ].join('\n');
}

/** The title of a new story thread. */
export function briefTitle(brief: StoryBrief, prefix = ''): string {
  const title = `${prefix}${brief.storyId} · ${brief.want}`;
  return title.length > 80 ? `${title.slice(0, 79)}…` : title;
}

/** The first message of a build thread: one line on top, then the build brief. */
export function buildPrompt(slug: string, storyId: Id, markdown: string): string {
  return [
    `Build story ${storyId} of the EPIC ${slug} from this brief. It is the plan the owner signed off; the owner watches the work in rehearse (Flow-Box commits per box, the e2e test of each approved scenario, the gate).`,
    'Start by saying in a few lines how you will build it, box by box. Then build.',
    '',
    markdown,
  ].join('\n');
}

/** A story's scenarios: the approved ones without a test in the test project, and the ones not approved. */
export function testsNeeded(record: EpicRecord, storyId: Id, testProject: string | undefined): { missing: Id[]; notApproved: { id: Id; status: 'draft' | 'stale' }[] } {
  const named = new Set(specTests(testProject).map((t) => t.name));
  const all = scenarioStatuses(record, storyId);
  return {
    missing: all.filter((s) => s.status === 'approved' && !named.has(s.id)).map((s) => s.id),
    notApproved: all.flatMap((s) => (s.status === 'approved' ? [] : [{ id: s.id, status: s.status }])),
  };
}

/**
 * The test brief of some scenarios with the paths relative to the repo top: the spec file goes
 * beside the first existing spec of the test project (its style to copy), else in `<project>/tests/`.
 */
export function storyTestBrief(record: EpicRecord, storyId: Id, ids: Id[], testProject: string | undefined, top: string): TestBrief {
  const rel = (p: string) => relative(top, p).split(sep).join('/');
  const project = testProject ? rel(testProject) : 'e2e';
  const example = specTests(testProject)[0];
  const specDir = example ? dirname(`${project}/${example.file}`) : `${project}/tests`;
  const fixtures = testFixtures(testProject);
  const relFixture = (f: TestFixture | undefined) => (f ? { file: rel(f.file), exports: f.exports } : undefined);
  const ui = relFixture(fixtures.ui);
  const cli = relFixture(fixtures.cli);
  return scenarioTestBrief(record, storyId, ids, {
    testProject: project,
    specFile: `${specDir}/${storyId}.spec.ts`,
    ...(example ? { exampleSpec: `${project}/${example.file}` } : {}),
    commands: repoCommands(top),
    fixtures: { ...(ui ? { ui } : {}), ...(cli ? { cli } : {}) },
  });
}

/** The names a TypeScript file exports: `export function|const|class X` and `export { X, Y }`. */
export function exportNames(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) names.push(m[1]!);
  for (const m of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1]!.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()!.trim();
      if (name && !name.startsWith('type ')) names.push(name);
    }
  }
  return [...new Set(names)];
}

/**
 * The fixtures of the test project (T48): `tests/serve.ts` serves the app (UI scenarios),
 * `tests/cli.ts` runs the CLI in a fresh repo (CLI scenarios). Absolute paths and their exports.
 */
export function testFixtures(testProject: string | undefined): { ui?: TestFixture; cli?: TestFixture } {
  if (!testProject) return {};
  const read = (name: string): TestFixture | undefined => {
    const file = join(testProject, 'tests', name);
    if (!existsSync(file)) return undefined;
    return { file, exports: exportNames(readFileSync(file, 'utf8')) };
  };
  const ui = read('serve.ts');
  const cli = read('cli.ts');
  return { ...(ui ? { ui } : {}), ...(cli ? { cli } : {}) };
}

/** The first message of a test thread: one line on top, then the test brief. */
export function testPrompt(slug: string, storyId: Id, scenarios: Id[], markdown: string): string {
  return [
    `Write the e2e tests of story ${storyId} of the EPIC ${slug} for ${scenarios.join(', ')}, from this brief. The scenarios are approved by the owner; the owner watches the tests in rehearse (the story's Tests tab, Birdview).`,
    'Write only tests. Start by saying in a few lines which spec file you will write and how each test walks its scenario. Then write and run them.',
    '',
    markdown,
  ].join('\n');
}

/** The message that sends more scenarios to a running test thread: one line, then their test brief. */
export function testSendMessage(storyId: Id, scenarios: Id[], markdown: string): string {
  return [`Also write the e2e tests of ${scenarios.join(', ')} of story ${storyId}, from this brief. Same rules: write only tests.`, '', markdown].join('\n');
}

/** The title of a test thread: "Tests: S1 S1-buy S1-empty". */
export function testTitle(storyId: Id, scenarios: Id[]): string {
  const title = `Tests: ${storyId} ${scenarios.join(' ')}`;
  return title.length > 80 ? `${title.slice(0, 79)}…` : title;
}

export interface SpawnOptions {
  title: string;
  bbProject?: string;
  /** `--new-environment worktree --base-branch <ref>` */
  baseBranch?: string;
  model?: string;
  reasoning?: string;
}

/** The `bb thread spawn` arguments. Model and reasoning only when set. */
export function spawnArgs(o: SpawnOptions): string[] {
  return [
    'thread', 'spawn', '--json', '--prompt-file', '-', '--title', o.title,
    ...(o.bbProject ? ['--project', o.bbProject] : []),
    ...(o.baseBranch ? ['--new-environment', 'worktree', '--base-branch', o.baseBranch] : []),
    ...(o.model ? ['--model', o.model] : []),
    ...(o.reasoning ? ['--reasoning-level', o.reasoning] : []),
  ];
}

/** A sent message: the context line on top, then the text. */
export function composeMessage(text: string, context: string | undefined): string {
  const line = (context ?? '').replace(/\s+/g, ' ').trim();
  return line === '' ? text : `Context: ${line}\n\n${text}`;
}

// ---------------------------------------------------------------- earlier work (pure)

export interface FlowBoxCommit {
  sha: string;
  subject: string;
  boxes: string[];
  threads: string[];
}

/** `git log --format=%H%x1f%s%x1f%B%x1e` output → commits with their Flow-Box trailers and thr_ ids. */
export function parseFlowBoxLog(text: string): FlowBoxCommit[] {
  const out: FlowBoxCommit[] = [];
  for (const rec of text.split('\x1e')) {
    const [sha, subject, body] = rec.replace(/^\s+/, '').split('\x1f');
    if (!sha || !/^[0-9a-f]{7,64}$/.test(sha) || body === undefined) continue;
    const boxes = [...body.matchAll(/^Flow-Box:[ \t]*(.+)$/gm)].flatMap((m) => m[1]!.trim().split(/[\s,]+/)).filter(Boolean);
    const threads = [...new Set([...`${subject}\n${body}`.matchAll(/\bthr_[A-Za-z0-9]+\b/g)].map((m) => m[0]))];
    out.push({ sha, subject: subject ?? '', boxes, threads });
  }
  return out;
}

export interface EarlierWork {
  threadId: string;
  /** Subject of the newest commit that names the thread. */
  subject: string;
  sha: string;
  boxes: string[];
}

/** Threads named in commits whose Flow-Box trailers name one of the boxes (or a box inside one), newest first. */
export function earlierWork(commits: FlowBoxCommit[], boxPaths: string[], exclude?: string): EarlierWork[] {
  const byThread = new Map<string, EarlierWork>();
  for (const c of commits) {
    const hit = c.boxes.filter((b) => boxPaths.some((p) => b === p || b.startsWith(`${p}/`)));
    if (hit.length === 0) continue;
    for (const t of c.threads) {
      if (t === exclude) continue;
      const seen = byThread.get(t);
      if (seen) seen.boxes = [...new Set([...seen.boxes, ...hit])];
      else byThread.set(t, { threadId: t, subject: c.subject, sha: c.sha.slice(0, 7), boxes: hit });
    }
  }
  return [...byThread.values()];
}

// ---------------------------------------------------------------- the service

export type BbState =
  | { ok: true; status: string; statusText: string; title: string | null; updatedAt?: number | null; branch?: string | null }
  | { ok: false; error: string };

/** Whether an agent may build the story: its sign-off state. */
export interface BuildState {
  status: BriefSignState['status'];
  buildable: boolean;
  refusal?: string;
  /** The plan hash now. */
  hash: string;
}

/** What `GET /api/story-thread?story=` returns. */
export interface StoryThreadView {
  brief: StoryBrief;
  threadId: string | null;
  /** null when the story has no thread. */
  bb: BbState | null;
  messages: ThreadMessage[];
  earlier: EarlierWork[];
  build: BuildState;
  /** How the thread was started, the plan hash and the time; null without a thread. */
  link: { kind: 'build' | 'question' | 'linked'; hash?: string; at?: string; changedAt?: string } | null;
  /** The plan changed since the thread started: what changed. null when it did not, or there is no plan hash. */
  planChanged: { changes: string[] } | null;
}

/** What `GET /api/story-tests/thread?story=` returns: the story's test thread and what it could take. */
export interface TestThreadView {
  storyId: Id;
  /** Approved scenarios without a test now: what "Write the K missing tests" asks for. */
  missing: Id[];
  /** Scenarios that are not approved: the owner approves them before an agent writes their tests. */
  notApproved: { id: Id; status: 'draft' | 'stale' }[];
  /** null when the story has no test thread. */
  thread: {
    id: string;
    scenarios: Id[];
    at?: string;
    sentAt?: string;
    bb: BbState;
    /** The thread may still work: bb does not say it is done (idle, failed or stopped), or bb cannot
     * be asked. A second press sends to it instead of starting another. */
    running: boolean;
  } | null;
}

/** bb statuses (in words) of a thread that is done: only then may a new test thread start. */
const DONE = new Set(['idle', 'failed', 'stopped']);

export class StoryThreadError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The raw message behind a plain one, for a "details" toggle. */
    readonly details?: string,
  ) {
    super(message);
  }
}

export interface StoryThreadOptions {
  epicDir: string;
  run: Runner;
  /** bb project for `bb thread spawn --project`. Unset: found once from `bb project list` (bb-project.ts). */
  bbProject?: string;
  /** `--model` and `--reasoning-level` of a build thread; left out when unset. */
  threadModel?: string;
  threadReasoning?: string;
  /** The base branch of a build thread's worktree. Default: the branch checked out in the EPIC's repo. */
  baseBranch?: string;
  /** Unit test coverage per box path (T43), when the code graph can answer. */
  coverage?: () => Promise<Record<string, CoverageStats> | undefined>;
  /** The e2e test project of the EPIC. */
  testProject?: string;
  /** Last e2e results by `file:line` for a story, when the player can answer. */
  testResults?: (storyId: Id) => Promise<Record<string, TestResult> | undefined>;
  now?: () => number;
}

/** Events per `bb thread log` page, and pages per request. */
const PAGE = 200;
const MAX_PAGES = 25;
/** Messages kept per thread. */
const KEEP_MESSAGES = 300;
const EARLIER_TTL_MS = 60_000;
export const MAX_MESSAGE_CHARS = 20_000;
export const MAX_CONTEXT_CHARS = 200;

export interface StoryThreadService {
  view(storyId: string): Promise<StoryThreadView>;
  link(storyId: string, threadId: string): Promise<StoryThreadView>;
  start(storyId: string): Promise<StoryThreadView>;
  /** Start a build thread from the build brief (signed, not stale stories only). */
  build(storyId: string): Promise<StoryThreadView>;
  /** Tell the thread what changed in its plan since it started. */
  sendChange(storyId: string): Promise<StoryThreadView>;
  send(storyId: string, text: string, context?: string): Promise<StoryThreadView>;
  open(storyId: string): Promise<void>;
  /** The progress of one story. */
  progress(storyId: string): Promise<StoryProgress>;
  /** The progress of every story (no e2e results: the overview stays cheap). */
  progressAll(): Promise<StoryProgress[]>;
  /** The story's test thread (T47). */
  testView(storyId: string): Promise<TestThreadView>;
  /** Start a test thread for approved scenarios; default: every approved one without a test. */
  startTests(storyId: string, scenarios?: string[]): Promise<TestThreadView>;
  /** Send more scenarios to the story's test thread; default: the missing ones it does not have. */
  sendTests(storyId: string, scenarios?: string[]): Promise<TestThreadView>;
}

function bbFailure(r: RunResult): string {
  if (r.spawnError !== undefined) return `bb is not available here (${r.spawnError})`;
  const text = `${r.stdout}\n${r.stderr}`;
  try {
    const parsed = JSON.parse(r.stdout) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    // Not JSON: use the last line of output.
  }
  const last = text.trim().split('\n').pop() ?? '';
  return last === '' ? `bb exited with code ${r.code}` : last.slice(0, 300);
}

export function createStoryThreads(opts: StoryThreadOptions): StoryThreadService {
  const { epicDir, run } = opts;
  const now = opts.now ?? Date.now;
  const logs = new Map<string, { lastSeq: number; messages: ThreadMessage[] }>();
  let earlierCache: { at: number; commits: FlowBoxCommit[] } | undefined;
  const starting = new Set<string>();
  const bbProject = bbProjectResolver(opts.bbProject, () => findBbProject(run, epicDir));

  const record = (): EpicRecord => loadEpic(epicDir).record;
  const briefOf = (storyId: string): StoryBrief => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(storyId)) throw new StoryThreadError(400, 'story must be a story id such as S1');
    const brief = storyBrief(record(), storyId);
    if (!brief) throw new StoryThreadError(404, `no story ${storyId} in prd.yaml`);
    return brief;
  };

  async function topLevel(): Promise<string> {
    const r = await run('git', ['rev-parse', '--show-toplevel'], { cwd: epicDir });
    const top = r.stdout.trim();
    if (r.code !== 0 || top === '') throw new StoryThreadError(503, `the EPIC folder is not in a git repo, so there is no ${STORY_THREADS_FILE}`);
    return top;
  }
  async function readLinks(): Promise<{ file: string; all: StoryThreads; tests: TestThreads }> {
    const file = join(await topLevel(), STORY_THREADS_FILE);
    const text = existsSync(file) ? readFileSync(file, 'utf8') : '{}';
    return { file, all: parseStoryThreads(text), tests: parseTestThreads(text) };
  }
  async function linkOf(brief: StoryBrief): Promise<StoryLink | null> {
    try {
      return (await readLinks()).all[brief.slug]?.[brief.storyId] ?? null;
    } catch {
      return null;
    }
  }
  async function threadOf(brief: StoryBrief): Promise<string | null> {
    return (await linkOf(brief))?.thread ?? null;
  }
  function writeLinks(file: string, text: string): void {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, file);
  }
  async function saveLink(brief: StoryBrief, link: StoryLink): Promise<void> {
    const { file, all, tests } = await readLinks();
    writeLinks(file, storyThreadsJson(withStoryThread(all, brief.slug, brief.storyId, link), tests));
  }
  async function saveTestLink(brief: StoryBrief, link: TestLink): Promise<void> {
    const { file, all, tests } = await readLinks();
    writeLinks(file, storyThreadsJson(all, withTestThread(tests, brief.slug, brief.storyId, link)));
  }
  async function testLinkOf(brief: StoryBrief): Promise<TestLink | null> {
    try {
      return (await readLinks()).tests[brief.slug]?.[brief.storyId] ?? null;
    } catch {
      return null;
    }
  }

  async function testBrief(storyId: string, ids: Id[]): Promise<TestBrief & { ok: true }> {
    const made = storyTestBrief(record(), storyId, ids, opts.testProject, await topLevel());
    if (!made.ok) throw new StoryThreadError(409, made.reason);
    return made;
  }

  async function testView(storyId: string): Promise<TestThreadView> {
    const brief = briefOf(storyId);
    const needed = testsNeeded(record(), storyId, opts.testProject);
    const link = await testLinkOf(brief);
    if (!link) return { storyId, ...needed, thread: null };
    const bb = await bbState(link.thread);
    return {
      storyId,
      ...needed,
      thread: {
        id: link.thread,
        scenarios: link.scenarios,
        ...(link.at ? { at: link.at } : {}),
        ...(link.sentAt ? { sentAt: link.sentAt } : {}),
        bb,
        running: !(bb.ok && DONE.has(bb.statusText)),
      },
    };
  }

  async function bbState(threadId: string): Promise<BbState> {
    const r = await run('bb', ['thread', 'show', threadId, '--json'], { cwd: epicDir });
    if (r.code !== 0 || r.spawnError !== undefined) return { ok: false, error: bbFailure(r) };
    const t = parseThreadShow(r.stdout);
    if (!t.ok) return { ok: false, error: t.error };
    return { ok: true, status: t.value.status, statusText: statusWords(t.value.status), title: t.value.title, updatedAt: t.value.updatedAt ?? null, branch: t.value.branch ?? null };
  }

  function buildState(storyId: string): { sign: BriefSignState; state: BuildState } {
    const sign = briefSignState(record(), storyId);
    if (!sign) throw new StoryThreadError(404, `no story ${storyId} in prd.yaml`);
    return { sign, state: { status: sign.status, buildable: sign.buildable, ...(sign.refusal ? { refusal: sign.refusal } : {}), hash: sign.currentHash } };
  }

  /** The plan now: hash and content (`storyContentV2`), signed or not. */
  function planNow(storyId: string): { hash: string; content: Record<string, unknown> } {
    const b = storyBuildBrief(record(), storyId, { allowUnsigned: true });
    if (!b.ok) throw new StoryThreadError(404, b.reason);
    return { hash: b.hash, content: b.content };
  }

  function linkView(link: StoryLink | null): StoryThreadView['link'] {
    if (!link) return null;
    return {
      kind: link.kind ?? 'linked',
      ...(link.hash ? { hash: link.hash } : {}),
      ...(link.at ? { at: link.at } : {}),
      ...(link.changedAt ? { changedAt: link.changedAt } : {}),
    };
  }

  function planChanged(storyId: string, link: StoryLink | null, hashNow: string): StoryThreadView['planChanged'] {
    if (!link?.hash || link.hash === hashNow) return null;
    const changes = link.content ? diffStoryContent(link.content, planNow(storyId).content).map((c) => c.text) : [];
    return { changes };
  }

  /** The branch a build worktree starts from: the configured one, else the checked-out branch, else the commit. */
  async function baseBranch(): Promise<string> {
    if (opts.baseBranch) return opts.baseBranch;
    const r = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: epicDir });
    const name = r.stdout.trim();
    if (r.code === 0 && name !== '' && name !== 'HEAD') return name;
    const sha = await run('git', ['rev-parse', 'HEAD'], { cwd: epicDir });
    if (sha.code === 0 && /^[0-9a-f]{40,64}$/.test(sha.stdout.trim())) return sha.stdout.trim();
    throw new StoryThreadError(503, 'the EPIC folder is not on a git branch or commit, so a worktree cannot start from it');
  }

  /** New messages since the last read, page by page. */
  async function messages(threadId: string): Promise<ThreadMessage[]> {
    const cache = logs.get(threadId) ?? { lastSeq: 0, messages: [] };
    for (let page = 0; page < MAX_PAGES; page++) {
      const args = ['thread', 'log', threadId, '--json', '--limit', String(PAGE), ...(cache.lastSeq > 0 ? ['--after-seq', String(cache.lastSeq)] : [])];
      const r = await run('bb', args, { cwd: epicDir });
      if (r.code !== 0 || r.spawnError !== undefined) break;
      const parsed = parseThreadLog(r.stdout);
      if (!parsed.ok) break;
      cache.messages = [...cache.messages, ...parsed.value.messages].slice(-KEEP_MESSAGES);
      cache.lastSeq = Math.max(cache.lastSeq, parsed.value.lastSeq);
      if (parsed.value.events < PAGE) break;
    }
    logs.set(threadId, cache);
    return cache.messages;
  }

  async function earlier(brief: StoryBrief, threadId: string | null): Promise<EarlierWork[]> {
    if (!earlierCache || now() - earlierCache.at > EARLIER_TTL_MS) {
      const r = await run('git', ['log', '-n', '2000', '--grep=^Flow-Box:', '--format=%H%x1f%s%x1f%B%x1e'], { cwd: epicDir });
      earlierCache = { at: now(), commits: r.code === 0 ? parseFlowBoxLog(r.stdout) : [] };
    }
    return earlierWork(earlierCache.commits, brief.boxes.map((b) => b.path), threadId ?? undefined);
  }

  async function view(storyId: string): Promise<StoryThreadView> {
    const brief = briefOf(storyId);
    const link = await linkOf(brief);
    const threadId = link?.thread ?? null;
    const past = await earlier(brief, threadId);
    const { state } = buildState(storyId);
    const extra = { build: state, link: linkView(link), planChanged: planChanged(storyId, link, state.hash) };
    if (threadId === null) return { brief, threadId, bb: null, messages: [], earlier: past, ...extra };
    const bb = await bbState(threadId);
    return { brief, threadId, bb, messages: bb.ok ? await messages(threadId) : [], earlier: past, ...extra };
  }

  const git = async (args: string[]) => {
    const r = await run('git', args, { cwd: epicDir });
    return { ok: r.code === 0 && r.spawnError === undefined, stdout: r.stdout };
  };

  async function progressThread(link: StoryLink | null): Promise<ProgressThread | null> {
    if (!link) return null;
    const bb = await bbState(link.thread);
    const base = { id: link.thread, kind: link.kind ?? ('linked' as const), ...(link.at ? { startedAt: link.at } : {}) };
    if (!bb.ok) return { ...base, status: null, statusText: 'bb cannot be asked', updatedAt: null, branch: null, error: bb.error };
    return { ...base, status: bb.status, statusText: bb.statusText, updatedAt: bb.updatedAt ?? null, branch: bb.branch ?? null };
  }

  async function progressOf(storyId: string, shared: { record: EpicRecord; gate: ReturnType<typeof epicGateItems>['gate']; commits: BranchCommit[]; coverage?: Record<string, CoverageStats> | undefined; links: StoryThreads }, results: boolean): Promise<StoryProgress> {
    const link = shared.links[shared.record.slug]?.[storyId] ?? null;
    const thread = await progressThread(link);
    const threadShas = thread?.branch ? await branchShas(git, thread.branch) : undefined;
    const testResults = results && opts.testResults ? await opts.testResults(storyId).catch(() => undefined) : undefined;
    return storyProgress({
      record: shared.record,
      storyId,
      commits: shared.commits,
      ...(threadShas ? { threadShas } : {}),
      thread,
      ...(link?.hash ? { linkHash: link.hash } : {}),
      tests: specTests(opts.testProject),
      ...(testResults ? { results: testResults } : {}),
      ...(shared.coverage ? { coverage: shared.coverage } : {}),
      gate: shared.gate,
    });
  }

  async function sharedInputs() {
    const { record: rec, gate } = epicGateItems(epicDir);
    const [commits, coverage, links] = await Promise.all([
      branchCommits(git),
      opts.coverage ? opts.coverage().catch(() => undefined) : Promise.resolve(undefined),
      readLinks().then((l) => l.all, () => ({}) as StoryThreads),
    ]);
    return { record: rec, gate, commits, coverage, links };
  }

  /** `bb thread spawn` into the project; the new thread's id. Failures in plain words, bb's own under details. */
  async function spawnThread(o: Omit<SpawnOptions, 'bbProject'>, prompt: string): Promise<string> {
    const project = await bbProject();
    if (!project) throw new StoryThreadError(503, NO_BB_PROJECT);
    const r = await run('bb', spawnArgs({ ...o, bbProject: project }), { cwd: epicDir, input: prompt });
    if (r.spawnError !== undefined) throw new StoryThreadError(502, 'bb is not available here, so rehearse cannot start a thread.', bbFailure(r));
    if (r.code !== 0) throw new StoryThreadError(502, 'bb could not start the thread.', bbFailure(r));
    const spawned = parseSpawn(r.stdout);
    if (!spawned.ok) throw new StoryThreadError(502, 'bb could not start the thread.', spawned.error);
    return spawned.value.id;
  }

  async function linked(storyId: string): Promise<{ brief: StoryBrief; threadId: string }> {
    const brief = briefOf(storyId);
    const threadId = await threadOf(brief);
    if (threadId === null) throw new StoryThreadError(409, `story ${storyId} has no thread`);
    return { brief, threadId };
  }

  return {
    view,
    async link(storyId, threadId) {
      const brief = briefOf(storyId);
      if (!THREAD_ID.test(threadId)) throw new StoryThreadError(400, 'a thread id looks like thr_abc123');
      await saveLink(brief, { thread: threadId });
      return view(storyId);
    },
    async start(storyId) {
      const brief = briefOf(storyId);
      if ((await threadOf(brief)) !== null) throw new StoryThreadError(409, `story ${storyId} has a thread already`);
      const key = `${brief.slug}/${storyId}`;
      if (starting.has(key)) throw new StoryThreadError(409, `a thread for ${storyId} is starting`);
      starting.add(key);
      try {
        const thread = await spawnThread({ title: briefTitle(brief) }, briefPrompt(brief));
        await saveLink(brief, { thread, kind: 'question', at: new Date(now()).toISOString() });
      } finally {
        starting.delete(key);
      }
      return view(storyId);
    },
    async build(storyId) {
      const brief = briefOf(storyId);
      const { state } = buildState(storyId);
      if (!state.buildable) throw new StoryThreadError(409, state.refusal ?? `story ${storyId} cannot be built yet`);
      if ((await threadOf(brief)) !== null) throw new StoryThreadError(409, `story ${storyId} has a thread already`);
      const key = `${brief.slug}/${storyId}`;
      if (starting.has(key)) throw new StoryThreadError(409, `a thread for ${storyId} is starting`);
      starting.add(key);
      try {
        const made = storyBuildBrief(record(), storyId, { decisions: decisionTexts(epicDir), commands: repoCommands(await topLevel()) });
        if (!made.ok) throw new StoryThreadError(409, made.reason);
        const thread = await spawnThread(
          {
            title: briefTitle(brief, 'Build '),
            baseBranch: await baseBranch(),
            ...(opts.threadModel ? { model: opts.threadModel } : {}),
            ...(opts.threadReasoning ? { reasoning: opts.threadReasoning } : {}),
          },
          buildPrompt(brief.slug, storyId, made.markdown),
        );
        await saveLink(brief, { thread, kind: 'build', hash: made.hash, at: new Date(now()).toISOString(), content: made.content });
      } finally {
        starting.delete(key);
      }
      return view(storyId);
    },
    async sendChange(storyId) {
      const brief = briefOf(storyId);
      const link = await linkOf(brief);
      if (!link) throw new StoryThreadError(409, `story ${storyId} has no thread`);
      const { sign } = buildState(storyId);
      if (!link.hash || !link.content) throw new StoryThreadError(409, 'this thread was not started from a plan, so there is no change to send');
      if (link.hash === sign.currentHash) throw new StoryThreadError(409, 'the plan has not changed since the thread started');
      const plan = planNow(storyId);
      const message = storyChangeMessage(brief.slug, storyId, link.content, plan.content, sign);
      if (message) {
        const r = await run('bb', ['thread', 'tell', link.thread, '--message-file', '-', '--json'], { cwd: epicDir, input: message.text });
        if (r.code !== 0 || r.spawnError !== undefined) throw new StoryThreadError(502, bbFailure(r));
        const told = parseTell(r.stdout);
        if (!told.ok) throw new StoryThreadError(502, told.error);
      }
      await saveLink(brief, { ...link, hash: plan.hash, content: plan.content, changedAt: new Date(now()).toISOString() });
      return view(storyId);
    },
    async progress(storyId) {
      briefOf(storyId);
      return progressOf(storyId, await sharedInputs(), true);
    },
    async progressAll() {
      const shared = await sharedInputs();
      const ids = (Array.isArray(shared.record.prd?.stories) ? shared.record.prd.stories : []).filter((s) => s && typeof s.id === 'string').map((s) => s.id);
      return Promise.all(ids.map((id) => progressOf(id, shared, false)));
    },
    async send(storyId, text, context) {
      if (text.trim() === '') throw new StoryThreadError(400, 'the message is empty');
      if (text.length > MAX_MESSAGE_CHARS) throw new StoryThreadError(400, `the message is longer than ${MAX_MESSAGE_CHARS} characters`);
      if ((context ?? '').length > MAX_CONTEXT_CHARS) throw new StoryThreadError(400, `the context is longer than ${MAX_CONTEXT_CHARS} characters`);
      const { threadId } = await linked(storyId);
      const r = await run('bb', ['thread', 'tell', threadId, '--message-file', '-', '--json'], { cwd: epicDir, input: composeMessage(text, context) });
      if (r.code !== 0 || r.spawnError !== undefined) throw new StoryThreadError(502, bbFailure(r));
      const told = parseTell(r.stdout);
      if (!told.ok) throw new StoryThreadError(502, told.error);
      return view(storyId);
    },
    async open(storyId) {
      const { threadId } = await linked(storyId);
      const r = await run('bb', ['thread', 'open', threadId, '--json'], { cwd: epicDir });
      if (r.code !== 0 || r.spawnError !== undefined) throw new StoryThreadError(502, bbFailure(r));
    },
    testView,
    async startTests(storyId, scenarios) {
      const brief = briefOf(storyId);
      // Taken before the first await: two presses at once never both get past the check below.
      const key = `${brief.slug}/${storyId}/tests`;
      if (starting.has(key)) throw new StoryThreadError(409, `a test thread for ${storyId} is starting`);
      starting.add(key);
      try {
        const now0 = await testView(storyId);
        if (now0.thread?.running) {
          throw new StoryThreadError(409, `a test thread of ${storyId} may still be working (@thread:${now0.thread.id}, ${now0.thread.bb.ok ? now0.thread.bb.statusText : 'bb did not answer'}): send these scenarios to it instead of starting another`);
        }
        const ids = scenarios && scenarios.length > 0 ? scenarios : now0.missing;
        if (ids.length === 0) throw new StoryThreadError(409, `every approved scenario of ${storyId} has a test`);
        const made = await testBrief(storyId, ids);
        const thread = await spawnThread(
          {
            title: testTitle(storyId, made.scenarios),
            baseBranch: await baseBranch(),
            ...(opts.threadModel ? { model: opts.threadModel } : {}),
            ...(opts.threadReasoning ? { reasoning: opts.threadReasoning } : {}),
          },
          testPrompt(brief.slug, storyId, made.scenarios, made.markdown),
        );
        await saveTestLink(brief, { thread, scenarios: made.scenarios, hash: made.hash, at: new Date(now()).toISOString() });
      } finally {
        starting.delete(key);
      }
      return testView(storyId);
    },
    async sendTests(storyId, scenarios) {
      const brief = briefOf(storyId);
      const link = await testLinkOf(brief);
      if (!link) throw new StoryThreadError(409, `story ${storyId} has no test thread`);
      const ids = scenarios && scenarios.length > 0 ? scenarios : testsNeeded(record(), storyId, opts.testProject).missing.filter((id) => !link.scenarios.includes(id));
      if (ids.length === 0) throw new StoryThreadError(409, `the test thread of ${storyId} has every approved scenario without a test already`);
      const made = await testBrief(storyId, ids);
      const r = await run('bb', ['thread', 'tell', link.thread, '--message-file', '-', '--json'], { cwd: epicDir, input: testSendMessage(storyId, made.scenarios, made.markdown) });
      if (r.code !== 0 || r.spawnError !== undefined) throw new StoryThreadError(502, 'bb could not send to the test thread.', bbFailure(r));
      const told = parseTell(r.stdout);
      if (!told.ok) throw new StoryThreadError(502, 'bb could not send to the test thread.', told.error);
      const merged = [...new Set([...link.scenarios, ...made.scenarios])];
      await saveTestLink(brief, { ...link, scenarios: merged, sentAt: new Date(now()).toISOString() });
      return testView(storyId);
    },
  };
}
