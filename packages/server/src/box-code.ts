// The code of a box, found only from git (D42 review, design page 13): commits carry
// `Flow-Box: <box path>` trailers. A box has the commits whose trailer names it or a box inside
// it. Git runs through an injectable runner with argument arrays (no shell), in the top level
// of the repo that holds the EPIC folder.

import { execFile } from 'node:child_process';
import { indexBoxes, loadEpic } from '@rehearse/core';
import {
  capDiff,
  LOG_FORMAT,
  LOG_FORMAT_BODY,
  parseLog,
  parseNumstat,
  parseUnifiedDiff,
  trailerServes,
  type CappedDiff,
  type CommitRef,
  type FileStat,
  type LogCommit,
} from './git-parse.js';

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Runs `git <args>` in `cwd`. Tests pass a fake; the server uses `execGit`. */
export type GitRunner = (args: string[], cwd: string) => Promise<GitResult>;

/** The real runner: `git` from PATH, no shell, no pager, no prompts. */
export const execGit: GitRunner = (args, cwd) =>
  new Promise((done) => {
    execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' } }, (err, stdout, stderr) =>
      done({ ok: err === null, stdout: String(stdout), stderr: String(stderr) }),
    );
  });

/** Diff lines the server sends per file at most. */
export const MAX_DIFF_LINES = 2000;
/** The tree of a commit with no files: the "before" of a box whose first commit has no parent. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
/** What `before` and `after` may be. */
export const REV = /^(?:[0-9a-f]{7,40}|HEAD)$/;

/** Global options of every git call: literal paths, no quoted names, no external diff tools. */
const GIT = ['--literal-pathspecs', '-c', 'core.quotePath=false'];

export interface BoxCodeSummary {
  /** Commits whose Flow-Box trailer names the box or a box inside it, oldest first. */
  commits: CommitRef[];
  /** Files those commits touched, sorted. */
  files: string[];
}

export type CodeIndex =
  | { ok: true; head: CommitRef; boxes: Record<string, BoxCodeSummary> }
  | { ok: false; reason: string };

export interface BoxCommit extends CommitRef {
  body: string;
  boxes: string[];
}

export interface BoxCodeQuery {
  box: string;
  before?: string;
  after?: string;
  /** The file to diff; default: the first file of the change. */
  file?: string;
}

export interface BoxCodeView {
  ok: true;
  box: string;
  /** Every commit of the box, oldest first. */
  commits: CommitRef[];
  head: CommitRef;
  before: CommitRef;
  after: CommitRef;
  /** The commits of the box in before..after, oldest first, with their bodies. */
  range: BoxCommit[];
  /** EPIC boxes with a commit in before..after. */
  changedBoxes: string[];
  /** Files of the box that differ between before and after, with numstat. */
  files: FileStat[];
  /** Files the box touched before but that do not differ in this range. */
  unchanged: string[];
  /** The diffed file and its diff, capped at MAX_DIFF_LINES lines. */
  file?: string;
  diff?: CappedDiff;
}

export type BoxCodeResult = BoxCodeView | { ok: false; status: number; error: string };

/** Box paths of the EPIC's flow.yaml, in file order. */
export function epicBoxPaths(epicDir: string): string[] {
  return [...indexBoxes(loadEpic(epicDir).record.flow).keys()];
}

const ref = (c: LogCommit | BoxCommit): CommitRef => ({ sha: c.sha, short: c.short, subject: c.subject, date: c.date });

async function topLevel(run: GitRunner, epicDir: string): Promise<string | undefined> {
  const r = await run(['rev-parse', '--show-toplevel'], epicDir);
  return r.ok ? r.stdout.trim() : undefined;
}

/** Every commit with a Flow-Box trailer, newest first, with the files it touched. */
async function trailerLog(run: GitRunner, top: string): Promise<LogCommit[]> {
  const r = await run([...GIT, 'log', '--grep=^Flow-Box:', `--format=${LOG_FORMAT}`, '--name-only', 'HEAD', '--'], top);
  return r.ok ? parseLog(r.stdout).filter((c) => c.boxes.length > 0) : [];
}

async function describe(run: GitRunner, top: string, rev: string): Promise<CommitRef | undefined> {
  if (rev === EMPTY_TREE) return { sha: EMPTY_TREE, short: EMPTY_TREE.slice(0, 7), subject: 'empty: before the first commit', date: '' };
  const r = await run([...GIT, 'log', '-1', `--format=${LOG_FORMAT}`, rev, '--'], top);
  const c = r.ok ? parseLog(r.stdout)[0] : undefined;
  return c && ref(c);
}

function summarize(log: LogCommit[], path: string): BoxCodeSummary {
  const own = log.filter((c) => c.boxes.some((t) => trailerServes(t, path))).reverse();
  return { commits: own.map(ref), files: [...new Set(own.flatMap((c) => c.files))].sort() };
}

/** For each EPIC box: its commits and files. */
export async function codeIndex(run: GitRunner, epicDir: string, boxPaths: string[]): Promise<CodeIndex> {
  const top = await topLevel(run, epicDir);
  if (top === undefined) return { ok: false, reason: 'the EPIC folder is not in a git repository' };
  const head = await describe(run, top, 'HEAD');
  if (!head) return { ok: false, reason: 'the repository has no commits' };
  const log = await trailerLog(run, top);
  const boxes: Record<string, BoxCodeSummary> = {};
  for (const path of boxPaths) boxes[path] = summarize(log, path);
  return { ok: true, head, boxes };
}

/**
 * The code of one box between two commits. Default: before = the parent of the box's first
 * commit (the empty tree when it has none), after = the box's last commit.
 */
export async function boxCode(run: GitRunner, epicDir: string, boxPaths: string[], q: BoxCodeQuery): Promise<BoxCodeResult> {
  const bad = (error: string) => ({ ok: false as const, status: 400, error });
  if (!boxPaths.includes(q.box)) return bad(`no box ${q.box} in flow.yaml`);
  for (const [name, rev] of [['before', q.before], ['after', q.after]] as const) {
    if (rev !== undefined && !REV.test(rev)) return bad(`${name} must be a commit hash (7 to 40 hex digits) or HEAD`);
  }
  const top = await topLevel(run, epicDir);
  if (top === undefined) return { ok: false, status: 503, error: 'the EPIC folder is not in a git repository' };
  const log = await trailerLog(run, top);
  const own = summarize(log, q.box);
  const head = await describe(run, top, 'HEAD');
  if (!head) return { ok: false, status: 503, error: 'the repository has no commits' };

  const first = own.commits[0];
  let beforeRev = q.before;
  if (beforeRev === undefined) {
    if (first) {
      const parent = await run([...GIT, 'rev-parse', '--verify', '--quiet', `${first.sha}^`], top);
      beforeRev = parent.ok ? parent.stdout.trim() : EMPTY_TREE;
    } else beforeRev = 'HEAD';
  }
  const afterRev = q.after ?? own.commits[own.commits.length - 1]?.sha ?? 'HEAD';
  const before = await describe(run, top, beforeRev);
  const after = await describe(run, top, afterRev);
  if (!before) return { ok: false, status: 404, error: `no commit ${beforeRev}` };
  if (!after) return { ok: false, status: 404, error: `no commit ${afterRev}` };

  // Every commit in before..after with its trailers: the open box's commits and the marks.
  const span = before.sha === EMPTY_TREE ? [after.sha] : [`${before.sha}..${after.sha}`];
  const r = await run([...GIT, 'log', `--format=${LOG_FORMAT_BODY}`, ...span, '--'], top);
  const inRange = r.ok ? parseLog(r.stdout, true) : [];
  const range: BoxCommit[] = inRange
    .filter((c) => c.boxes.some((t) => trailerServes(t, q.box)))
    .reverse()
    .map((c) => ({ ...ref(c), body: c.body ?? '', boxes: c.boxes }));
  const trailers = inRange.flatMap((c) => c.boxes);
  const changedBoxes = boxPaths.filter((p) => trailers.some((t) => trailerServes(t, p)));

  const view: BoxCodeView = { ok: true, box: q.box, commits: own.commits, head, before, after, range, changedBoxes, files: [], unchanged: own.files };
  if (own.files.length === 0) return view;
  const stat = await run([...GIT, 'diff', '--numstat', '-z', '--find-renames', '--no-ext-diff', '--no-textconv', before.sha, after.sha, '--', ...own.files], top);
  view.files = stat.ok ? parseNumstat(stat.stdout) : [];
  const changed = new Set(view.files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path])));
  view.unchanged = own.files.filter((f) => !changed.has(f));

  const file = q.file ?? view.files[0]?.path;
  if (file === undefined) return view;
  const picked = view.files.find((f) => f.path === file);
  if (!picked) return q.file === undefined ? view : bad(`${file} is not a file of this change`);
  const paths = picked.oldPath ? [picked.oldPath, picked.path] : [picked.path];
  const d = await run([...GIT, 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--find-renames', before.sha, after.sha, '--', ...paths], top);
  const diff = d.ok ? parseUnifiedDiff(d.stdout)[0] : undefined;
  view.file = picked.path;
  if (diff) view.diff = capDiff(diff, MAX_DIFF_LINES);
  return view;
}
