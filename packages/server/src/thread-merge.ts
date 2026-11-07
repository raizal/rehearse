// Land a thread's work (T48, boxes thread-branch and merge-thread). A build thread or a test thread
// commits on its own branch (bb names it in `bb thread show --json`) and stops; the owner presses
// "Merge into <branch>" in rehearse. This module says what the branch brings that the checkout's
// branch has not (commits, files, and for a test thread the scenario rows the commits fill), and
// merges it with `git merge --no-ff` in the checkout serve runs in. It refuses in plain words and
// changes nothing when the thread is still working, when there is nothing new, when the checkout
// has uncommitted changes in files the merge touches, or when the merge conflicts (then it aborts
// the merge and lists the files, and the owner can ask the thread to rebase).
//
// Only the owner merges, through the UI's POST /api/thread/merge. There is no CLI command for it.

import { realpathSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { loadEpic, scenarioStatuses, type Id } from '@rehearse/core';
import { parseSpec } from './playlist.js';
import { StoryThreadError, type BbState, type Runner, type StoryThreadService } from './story-thread.js';

export type MergeKind = 'build' | 'tests';

/** One commit of the thread's branch the checkout's branch has not. */
export interface BranchCommitSummary {
  sha: string;
  subject: string;
  files: string[];
}

/** A test the merge brings: its scenario and its Birdview key `file:line`. */
export interface NewTest {
  scenario: Id;
  key: string;
}

/** What `GET /api/thread/merge?story=&kind=` returns. */
export interface MergeSummary {
  ok: true;
  storyId: Id;
  kind: MergeKind;
  threadId: string;
  /** The thread's title in bb: the merge commit says "Merge <title>". */
  title: string;
  /** What bb says of the thread, in words (idle, working, …), or null when bb cannot be asked. */
  status: string | null;
  branch: string | null;
  /** The branch checked out where serve runs: what the merge goes into. */
  current: string | null;
  commits: BranchCommitSummary[];
  /** Every file the merge touches. */
  files: string[];
  /** Test thread: the story's scenarios whose test the commits add. */
  scenarios: Id[];
  /** Files the merge touches that have uncommitted changes in the checkout. */
  dirty: string[];
  /** Why there is no merge now, in plain words; null when the owner may merge. */
  refusal: string | null;
  /** The headline: "2 commits in the thread, not in main yet". */
  text: string;
}

/** What a merge returns. */
export interface MergeDone {
  ok: true;
  merged: { sha: string; message: string; branch: string; into: string };
  /** Test thread: the new tests, with their keys in the merged checkout, to play in Birdview. */
  tests: NewTest[];
  summary: MergeSummary;
}

/** bb statuses (in words) of a thread that may be merged: it is not working any more. */
const MERGEABLE = new Set(['idle', 'done', 'completed', 'stopped', 'failed']);
/** A branch name rehearse passes to git. */
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,250}$/;
const MAX_COMMITS = 200;
const DEFAULT_CO_AUTHOR = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
const MAX_LISTED = 8;

export interface ThreadMergeOptions {
  epicDir: string;
  run: Runner;
  threads: Pick<StoryThreadService, 'threadFor' | 'tell'>;
  /** The e2e test project (absolute), to find the tests a test thread adds. */
  testProject?: string;
}

export interface ThreadMergeService {
  summary(storyId: string, kind: MergeKind): Promise<MergeSummary>;
  merge(storyId: string, kind: MergeKind): Promise<MergeDone>;
  /** Tell the thread its branch conflicts with the checkout's branch, and ask it to rebase. */
  askRebase(storyId: string, kind: MergeKind, files: string[]): Promise<{ ok: true; threadId: string }>;
}

/** "a, b and 3 more" */
export function listFiles(files: string[]): string {
  const shown = files.slice(0, MAX_LISTED).join(', ');
  return files.length > MAX_LISTED ? `${shown} and ${files.length - MAX_LISTED} more` : shown;
}

export function createThreadMerge(opts: ThreadMergeOptions): ThreadMergeService {
  const { epicDir, run } = opts;
  let merging = false;

  async function git(args: string[], cwd: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    const r = await run('git', args, { cwd });
    return { ok: r.code === 0 && r.spawnError === undefined, stdout: r.stdout, stderr: r.spawnError ?? r.stderr };
  }

  async function topLevel(): Promise<string> {
    const r = await git(['rev-parse', '--show-toplevel'], epicDir);
    const top = r.stdout.trim();
    if (!r.ok || top === '') throw new StoryThreadError(503, 'The EPIC folder is not in a git repo, so there is nothing to merge into.');
    return top;
  }

  /** The test project relative to the repo top, both resolved (a temp folder may be a symlink). */
  function projectIn(top: string): string {
    const real = (p: string) => {
      try {
        return realpathSync(p);
      } catch {
        return p;
      }
    };
    return relative(real(top), real(opts.testProject!)).split(sep).join('/');
  }

  async function thread(storyId: string, kind: MergeKind) {
    const t = await opts.threads.threadFor(storyId, kind);
    if (!t) throw new StoryThreadError(409, kind === 'build' ? `Story ${storyId} has no thread.` : `Story ${storyId} has no test thread.`);
    return t;
  }

  /** The story's scenario ids whose test a spec file of the branch adds (not in HEAD's version of the file). */
  async function filledScenarios(top: string, storyId: string, ref: string, files: string[]): Promise<Id[]> {
    if (!opts.testProject) return [];
    const ids = new Set(scenarioStatuses(loadEpic(epicDir).record, storyId).map((s) => s.id));
    const project = projectIn(top);
    const out = new Set<Id>();
    for (const file of files.filter((f) => f.endsWith('.spec.ts') && (project === '' || f.startsWith(`${project}/`)))) {
      const now = await git(['show', `${ref}:${file}`], top);
      if (!now.ok) continue;
      const before = await git(['show', `HEAD:${file}`], top);
      const had = new Set(before.ok ? parseSpec(file, before.stdout).map((t) => t.name) : []);
      for (const t of parseSpec(file, now.stdout)) if (ids.has(t.name) && !had.has(t.name)) out.add(t.name);
    }
    return [...out];
  }

  /** The Birdview keys of some scenarios' tests in HEAD's spec files. */
  async function testKeys(top: string, files: string[], scenarios: Id[]): Promise<NewTest[]> {
    if (!opts.testProject || scenarios.length === 0) return [];
    const project = projectIn(top);
    const want = new Set(scenarios);
    const out: NewTest[] = [];
    for (const file of files.filter((f) => f.endsWith('.spec.ts') && (project === '' || f.startsWith(`${project}/`)))) {
      const text = await git(['show', `HEAD:${file}`], top);
      if (!text.ok) continue;
      const rel = project === '' ? file : file.slice(project.length + 1);
      for (const t of parseSpec(rel, text.stdout)) if (want.has(t.name)) out.push({ scenario: t.name, key: `${rel}:${t.line}` });
    }
    return out;
  }

  /** Files with uncommitted changes (staged, unstaged or untracked), from `git status --porcelain -z`. */
  async function changedFiles(top: string): Promise<string[]> {
    const r = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], top);
    if (!r.ok) throw new StoryThreadError(503, 'git could not say what is uncommitted in the checkout.', r.stderr.trim());
    const parts = r.stdout.split('\0');
    const out: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i]!;
      if (entry.length < 4) continue;
      out.push(entry.slice(3));
      // A rename or copy names the old path next.
      if (entry[0] === 'R' || entry[0] === 'C') out.push(parts[++i] ?? '');
    }
    return out.filter(Boolean);
  }

  async function summaryOf(storyId: string, kind: MergeKind): Promise<{ summary: MergeSummary; top: string; coAuthor: string }> {
    const t = await thread(storyId, kind);
    const top = await topLevel();
    const bb: BbState = t.bb;
    const head = await git(['rev-parse', '--abbrev-ref', 'HEAD'], top);
    const currentName = head.ok ? head.stdout.trim() : '';
    const current = currentName !== '' && currentName !== 'HEAD' ? currentName : null;
    const branch = bb.ok ? (bb.branch ?? null) : null;
    const base: MergeSummary = {
      ok: true,
      storyId: t.brief.storyId,
      kind,
      threadId: t.threadId,
      title: (bb.ok ? bb.title : null) ?? `${kind === 'build' ? 'Build' : 'Tests of'} ${t.brief.storyId}`,
      status: bb.ok ? bb.statusText : null,
      branch,
      current,
      commits: [],
      files: [],
      scenarios: [],
      dirty: [],
      refusal: null,
      text: '',
    };
    const into = current ?? 'the checkout';
    const refuse = (refusal: string, text = refusal) => ({ summary: { ...base, refusal, text }, top, coAuthor: DEFAULT_CO_AUTHOR });
    if (!bb.ok) return refuse(`bb cannot say what the thread is doing, so rehearse does not merge it (${bb.error}).`);
    if (branch === null) return refuse('bb names no branch for the thread, so there is nothing to merge.');
    if (!BRANCH.test(branch) || branch.includes('..')) return refuse(`The thread's branch "${branch}" is not a branch name rehearse merges.`);
    if (current === null) return refuse('The checkout is not on a branch (detached HEAD), so there is nothing to merge into. Check out a branch first.');
    const ref = `refs/heads/${branch}`;
    if (!(await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], top)).ok) {
      return refuse(`The thread's branch ${branch} is not in this repo, so there is nothing to merge.`);
    }
    const log = await git(['log', '-n', String(MAX_COMMITS), '--format=%x1e%H%x1f%s', '--name-only', `HEAD..${ref}`, '--'], top);
    if (!log.ok) throw new StoryThreadError(503, `git could not list the commits of ${branch}.`, log.stderr.trim());
    const commits = log.stdout
      .split('\x1e')
      .filter((c) => c.trim() !== '')
      .map((c) => {
        const [first = '', ...rest] = c.split('\n');
        const [sha = '', subject = ''] = first.split('\x1f');
        return { sha, subject, files: rest.map((l) => l.trim()).filter(Boolean) };
      });
    const diff = await git(['diff', '--name-only', `HEAD...${ref}`, '--'], top);
    const files = diff.ok ? diff.stdout.split('\n').map((l) => l.trim()).filter(Boolean) : [...new Set(commits.flatMap((c) => c.files))].sort();
    const changed = new Set(await changedFiles(top));
    const dirty = files.filter((f) => changed.has(f));
    const scenarios = kind === 'tests' && commits.length > 0 ? await filledScenarios(top, t.brief.storyId, ref, files) : [];
    const trailers = await git(['log', '-n', '50', '--format=%(trailers:key=Co-Authored-By,valueonly,separator=%x1f)', `HEAD..${ref}`, '--'], top);
    const lastCoAuthor = trailers.ok ? trailers.stdout.split(/[\n\x1f]/).map((l) => l.trim()).find((l) => l !== '') : undefined;
    const coAuthor = lastCoAuthor ? `Co-Authored-By: ${lastCoAuthor}` : DEFAULT_CO_AUTHOR;
    const text =
      commits.length === 0
        ? `Nothing in the thread that ${into} does not have.`
        : `${commits.length} commit${commits.length === 1 ? '' : 's'} in the thread, not in ${into} yet`;
    const summary: MergeSummary = { ...base, commits, files, scenarios, dirty, text };
    const inMerge = (await git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], top)).ok;
    const refusal =
      !MERGEABLE.has(bb.statusText)
        ? `The thread is still working (bb says ${bb.statusText}). Merge when bb says it is idle.`
        : commits.length === 0
          ? `Nothing in the thread that ${into} does not have.`
          : inMerge
            ? 'A merge is going on in the checkout already. Finish it or run git merge --abort, then merge.'
            : dirty.length > 0
              ? `The checkout has uncommitted changes in files the merge touches: ${listFiles(dirty)}. Commit or put them aside, then merge.`
              : null;
    return { summary: { ...summary, refusal }, top, coAuthor };
  }

  return {
    async summary(storyId, kind) {
      return (await summaryOf(storyId, kind)).summary;
    },

    async merge(storyId, kind) {
      if (merging) throw new StoryThreadError(409, 'A merge is going on already; wait for it.');
      merging = true;
      try {
        const { summary, top, coAuthor } = await summaryOf(storyId, kind);
        if (summary.refusal !== null) throw new StoryThreadError(409, summary.refusal);
        const branch = summary.branch!;
        const into = summary.current!;
        const before = await git(['rev-parse', 'HEAD'], top);
        const message = `Merge ${summary.title}\n\n${coAuthor}`;
        const m = await git(['merge', '--no-ff', '--no-edit', '-m', message, branch], top);
        if (!m.ok) {
          const conflicts = await git(['diff', '--name-only', '--diff-filter=U'], top);
          const files = conflicts.ok ? conflicts.stdout.split('\n').map((l) => l.trim()).filter(Boolean) : [];
          const inMerge = (await git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], top)).ok;
          if (inMerge) {
            const abort = await git(['merge', '--abort'], top);
            if (!abort.ok) {
              throw new StoryThreadError(500, `The merge of ${branch} stopped and git could not abort it: run git merge --abort in ${top}.`, abort.stderr.trim());
            }
          }
          const after = await git(['rev-parse', 'HEAD'], top);
          if (before.ok && after.ok && before.stdout.trim() !== after.stdout.trim()) {
            throw new StoryThreadError(500, `The merge of ${branch} failed and HEAD moved; look at ${top} before you go on.`, (m.stdout + m.stderr).trim());
          }
          if (files.length > 0) {
            throw new MergeConflictError(`The thread's branch ${branch} conflicts with ${into} in ${listFiles(files)}. Nothing was merged. Ask the thread to rebase onto ${into}.`, files, (m.stdout + m.stderr).trim());
          }
          throw new StoryThreadError(409, `git did not merge ${branch}; nothing changed.`, (m.stdout + m.stderr).trim());
        }
        const sha = (await git(['rev-parse', 'HEAD'], top)).stdout.trim();
        const tests = kind === 'tests' ? await testKeys(top, summary.files, summary.scenarios) : [];
        const now = (await summaryOf(storyId, kind)).summary;
        return { ok: true, merged: { sha, message, branch, into }, tests, summary: now };
      } finally {
        merging = false;
      }
    },

    async askRebase(storyId, kind, files) {
      const { summary } = await summaryOf(storyId, kind);
      if (summary.branch === null || summary.current === null) throw new StoryThreadError(409, summary.refusal ?? 'There is no branch to rebase.');
      const text = [
        `The owner could not merge your branch ${summary.branch} into ${summary.current}: it conflicts${files.length > 0 ? ` in ${files.join(', ')}` : ''}. Nothing was merged.`,
        `Please rebase your branch onto ${summary.current} (this once, the owner asks for it), fix the conflicts, run the tests again and commit. Do not merge or push.`,
        'Then say so in the thread and stop: the owner merges from rehearse.',
      ].join('\n\n');
      await opts.threads.tell(summary.threadId, text);
      return { ok: true, threadId: summary.threadId };
    },
  };
}

/** A merge that conflicted and was aborted: the files, and the offer to ask the thread to rebase. */
export class MergeConflictError extends StoryThreadError {
  constructor(
    message: string,
    readonly files: string[],
    details?: string,
  ) {
    super(409, message, details);
  }
}
