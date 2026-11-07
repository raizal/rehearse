// T48, a thread's work lands through a merge the owner presses (boxes thread-branch and
// merge-thread): what the thread's branch brings, `git merge --no-ff` with "Merge <title>" and the
// Co-Authored-By line, and each refusal (uncommitted changes in a file the merge touches, a conflict
// that is aborted, nothing new, a thread still working), asking the thread to rebase, and the token
// and Origin. git is real, in a temp repo made here; bb is a fake runner. No test merges into the
// real checkout or runs a real `bb thread tell`.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { approvedEpic } from '../../core/test/trust/helpers.js';
import {
  listFiles,
  newToken,
  processRunner,
  startServer,
  storyThreadsJson,
  STORY_THREADS_FILE,
  withStoryThread,
  withTestThread,
  type PlayerClient,
  type RunResult,
  type Runner,
  type RunningServer,
  type ServerSession,
} from '../src/index.js';

const SHOW = readFileSync(new URL('./fixtures/bb-thread-show.json', import.meta.url), 'utf8');
const TELL = readFileSync(new URL('./fixtures/bb-thread-tell.json', import.meta.url), 'utf8');
const SLUG = '2026-11-05-shop';
const CO = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';

const offPlayer: PlayerClient = {
  state: () => Promise.reject(new Error('no player')),
  setup: () => Promise.reject(new Error('no player')),
  projects: () => Promise.reject(new Error('no player')),
  useProject: () => Promise.reject(new Error('no player')),
  writePlaylist: () => Promise.reject(new Error('no player')),
  play: () => Promise.reject(new Error('no player')),
};

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

function commit(repo: string, file: string, text: string, message: string): void {
  mkdirSync(join(repo, file, '..'), { recursive: true });
  writeFileSync(join(repo, file), text);
  git(repo, 'add', file);
  git(repo, 'commit', '-q', '-m', message);
}

/**
 * A temp repo on main with the shop EPIC (every scenario approved), an e2e project and README. The
 * build thread's branch adds two commits; the test thread's branch adds S1's tests.
 */
function repoWithThreads(): { repo: string; epicDir: string } {
  const repo = join(mkdtempSync(join(tmpdir(), 'rehearse-merge-')), 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'Owner');
  git(repo, 'config', 'user.email', 'owner@example.com');
  git(repo, 'config', 'commit.gpgsign', 'false');
  const epicDir = join(repo, 'docs', 'epics', SLUG);
  cpSync(approvedEpic(), epicDir, { recursive: true });
  writeFileSync(join(repo, '.gitignore'), '.rehearse/\n');
  mkdirSync(join(repo, 'e2e', 'tests'), { recursive: true });
  writeFileSync(join(repo, 'e2e', 'playwright.config.ts'), 'export default {};\n');
  writeFileSync(join(repo, 'README.md'), 'shop\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'the shop');
  git(repo, 'checkout', '-q', '-b', 'bb/build-s1');
  commit(repo, 'src/cart.ts', 'export const cart = 1;\n', `T1: the cart\n\nFlow-Box: cart\n${CO}`);
  commit(repo, 'src/pay.ts', 'export const pay = 1;\n', `T1: pay\n\nFlow-Box: pay\n${CO}`);
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'checkout', '-q', '-b', 'bb/tests-s1');
  const spec = "import { test } from '@playwright/test';\n\ntest('S1-buy', async () => {});\n\ntest('S1-empty', async () => {});\n";
  commit(repo, 'e2e/tests/S1.spec.ts', spec, `tests of S1\n\n${CO}`);
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'branch', 'bb/nothing-new');
  git(repo, 'checkout', '-q', '-b', 'bb/conflict');
  commit(repo, 'README.md', 'shop, from the thread\n', 'thread readme');
  git(repo, 'checkout', '-q', 'main');
  commit(repo, 'README.md', 'shop, from main\n', 'main readme');
  mkdirSync(join(repo, '.rehearse'));
  return { repo, epicDir };
}

interface Thread {
  status: string;
  branch: string;
  title: string;
}

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

/** serve on the temp repo; git runs for real there, bb answers from `threads`. */
async function serve(threads: { build?: Thread; tests?: Thread } = {}) {
  const { repo, epicDir } = repoWithThreads();
  let all = {};
  let tests = {};
  if (threads.build) all = withStoryThread(all, SLUG, 'S1', { thread: 'thr_build1', kind: 'build' });
  if (threads.tests) tests = withTestThread(tests, SLUG, 'S1', { thread: 'thr_tests1', scenarios: ['S1-buy', 'S1-empty'] });
  writeFileSync(join(repo, STORY_THREADS_FILE), storyThreadsJson(all, tests));
  const realGit = processRunner();
  const calls: { command: string; args: string[]; input?: string }[] = [];
  const run: Runner = async (command, args, o) => {
    calls.push({ command, args, ...(o.input !== undefined ? { input: o.input } : {}) });
    if (command === 'git') return realGit(command, args, o);
    const t = args[2] === 'thr_build1' ? threads.build : args[2] === 'thr_tests1' ? threads.tests : undefined;
    if (args[1] === 'show' && t) {
      return ok(
        SHOW.replace('"status": "active"', `"status": "${t.status}"`)
          .replace('"displayStatus": "active"', `"displayStatus": "${t.status}"`)
          .replace(/"branchName": "[^"]*"/, `"branchName": "${t.branch}"`)
          .replace(/"title": "[^"]*"/, `"title": "${t.title}"`),
      );
    }
    if (args[1] === 'log') return ok('[]');
    if (args[1] === 'tell') return ok(TELL);
    return { code: 1, stdout: '', stderr: 'unknown' };
  };
  const session: ServerSession = { token: newToken(), identity: { by: 'owner@example.com' }, signer: { ok: false, reason: 'off' } };
  running = await startServer({ epicDir, uiDir: mkdtempSync(join(tmpdir(), 'rehearse-ui-')), port: 0, session, run, bbProject: 'proj_abc', birdview: { port: 1, client: offPlayer, projectDir: join(repo, 'e2e') } });
  const url = running.url;
  const headers = { 'x-rehearse-token': session.token };
  const get = (kind: string, h: Record<string, string> = headers) => fetch(new URL(`api/thread/merge?story=S1&kind=${kind}`, url), { headers: h });
  const post = (path: 'merge' | 'ask-rebase', body: unknown, h: Record<string, string> = headers) =>
    fetch(new URL(`api/thread/${path}`, url), { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
  const head = () => git(repo, 'rev-parse', 'HEAD').trim();
  const merges = () => calls.filter((c) => c.command === 'git' && c.args[0] === 'merge');
  return { repo, get, post, head, merges, calls, headers };
}

function ok(stdout: string): RunResult {
  return { code: 0, stdout, stderr: '' };
}

const idle = (branch: string, title = 'Build S1'): Thread => ({ status: 'idle', branch, title });

describe('T48 what a thread branch brings (box thread-branch)', () => {
  it('lists the commits and files of the build thread that main has not, and offers the merge', async () => {
    const s = await serve({ build: idle('bb/build-s1') });
    const res = await s.get('build');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      storyId: 'S1',
      kind: 'build',
      threadId: 'thr_build1',
      title: 'Build S1',
      status: 'idle',
      branch: 'bb/build-s1',
      current: 'main',
      files: ['src/cart.ts', 'src/pay.ts'],
      scenarios: [],
      dirty: [],
      refusal: null,
      text: '2 commits in the thread, not in main yet',
    });
    expect(body.commits.map((c: { subject: string; files: string[] }) => [c.subject, c.files])).toEqual([
      ['T1: pay', ['src/pay.ts']],
      ['T1: the cart', ['src/cart.ts']],
    ]);
    expect(s.merges()).toEqual([]);
  });

  it('a test thread says which scenario rows its commits fill', async () => {
    const s = await serve({ tests: idle('bb/tests-s1', 'Tests: S1 S1-buy S1-empty') });
    expect(await (await s.get('tests')).json()).toMatchObject({ kind: 'tests', files: ['e2e/tests/S1.spec.ts'], scenarios: ['S1-buy', 'S1-empty'], refusal: null, text: '1 commit in the thread, not in main yet' });
  });

  it('no thread of that kind is a 409 in plain words', async () => {
    const s = await serve({ build: idle('bb/build-s1') });
    const res = await s.get('tests');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Story S1 has no test thread.');
  });
});

describe('T48 Merge into main (box merge-thread)', () => {
  it('merges the idle thread with --no-ff, "Merge <title>" and the Co-Authored-By line; then nothing is left', async () => {
    const s = await serve({ build: idle('bb/build-s1') });
    const before = s.head();
    const res = await s.post('merge', { story: 'S1', kind: 'build' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(s.merges().map((c) => c.args)).toEqual([['merge', '--no-ff', '--no-edit', '-m', `Merge Build S1\n\n${CO}`, 'bb/build-s1']]);
    expect(body.merged).toEqual({ sha: s.head(), message: `Merge Build S1\n\n${CO}`, branch: 'bb/build-s1', into: 'main' });
    expect(git(s.repo, 'log', '-1', '--format=%P').trim().split(' ')).toEqual([before, git(s.repo, 'rev-parse', 'bb/build-s1').trim()]);
    expect(git(s.repo, 'log', '-1', '--format=%B').trim()).toBe(`Merge Build S1\n\n${CO}`);
    expect(existsSync(join(s.repo, 'src', 'pay.ts'))).toBe(true);
    expect(body.summary).toMatchObject({ commits: [], text: 'Nothing in the thread that main does not have.', refusal: 'Nothing in the thread that main does not have.' });
  });

  it('a test merge returns the new tests with their Birdview keys', async () => {
    const s = await serve({ tests: idle('bb/tests-s1', 'Tests: S1 S1-buy S1-empty') });
    const body = await (await s.post('merge', { story: 'S1', kind: 'tests' })).json();
    expect(body.tests).toEqual([
      { scenario: 'S1-buy', key: 'tests/S1.spec.ts:3' },
      { scenario: 'S1-empty', key: 'tests/S1.spec.ts:5' },
    ]);
    expect(git(s.repo, 'log', '-1', '--format=%s').trim()).toBe('Merge Tests: S1 S1-buy S1-empty');
  });

  it('refuses when a file the merge touches has uncommitted changes, and changes nothing; other changes do not stop it', async () => {
    const s = await serve({ build: idle('bb/build-s1') });
    mkdirSync(join(s.repo, 'src'));
    writeFileSync(join(s.repo, 'src', 'pay.ts'), 'mine\n');
    const before = s.head();
    const summary = await (await s.get('build')).json();
    const text = 'The checkout has uncommitted changes in files the merge touches: src/pay.ts. Commit or put them aside, then merge.';
    expect(summary).toMatchObject({ dirty: ['src/pay.ts'], refusal: text });
    const res = await s.post('merge', { story: 'S1', kind: 'build' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(text);
    expect(s.merges()).toEqual([]);
    expect(s.head()).toBe(before);
    expect(readFileSync(join(s.repo, 'src', 'pay.ts'), 'utf8')).toBe('mine\n');
    // A change in a file the merge does not touch stays, and the merge goes.
    rmSync(join(s.repo, 'src'), { recursive: true });
    writeFileSync(join(s.repo, 'README.md'), 'shop, edited\n');
    expect((await s.post('merge', { story: 'S1', kind: 'build' })).status).toBe(200);
    expect(readFileSync(join(s.repo, 'README.md'), 'utf8')).toBe('shop, edited\n');
  });

  it('a conflict is aborted: 409 with the files and the offer to ask the thread to rebase, which tells it', async () => {
    const s = await serve({ tests: idle('bb/conflict', 'Tests: S1') });
    const before = s.head();
    const res = await s.post('merge', { story: 'S1', kind: 'tests' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, conflict: { files: ['README.md'], canAskRebase: true } });
    expect(body.error).toBe("The thread's branch bb/conflict conflicts with main in README.md. Nothing was merged. Ask the thread to rebase onto main.");
    expect(s.merges().map((c) => c.args.slice(0, 2))).toEqual([['merge', '--no-ff'], ['merge', '--abort']]);
    expect(s.head()).toBe(before);
    expect(git(s.repo, 'status', '--porcelain', '--untracked-files=no')).toBe('');
    expect(existsSync(join(s.repo, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(readFileSync(join(s.repo, 'README.md'), 'utf8')).toBe('shop, from main\n');

    const ask = await s.post('ask-rebase', { story: 'S1', kind: 'tests', files: ['README.md'] });
    expect(ask.status).toBe(200);
    expect(await ask.json()).toEqual({ ok: true, threadId: 'thr_tests1' });
    const tells = s.calls.filter((c) => c.command === 'bb' && c.args[1] === 'tell');
    expect(tells.map((c) => c.args)).toEqual([['thread', 'tell', 'thr_tests1', '--message-file', '-', '--json']]);
    expect(tells[0]!.input).toContain('The owner could not merge your branch bb/conflict into main: it conflicts in README.md. Nothing was merged.');
    expect(tells[0]!.input).toContain('Rebase your branch onto main');
  });

  it('a branch with nothing new has nothing to merge: no merge runs', async () => {
    const s = await serve({ build: idle('bb/nothing-new') });
    expect(await (await s.get('build')).json()).toMatchObject({ commits: [], files: [], text: 'Nothing in the thread that main does not have.', refusal: 'Nothing in the thread that main does not have.' });
    const res = await s.post('merge', { story: 'S1', kind: 'build' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Nothing in the thread that main does not have.');
    expect(s.merges()).toEqual([]);
  });

  it('a thread still working cannot be merged at all; the commits so far still show', async () => {
    const s = await serve({ build: { status: 'active', branch: 'bb/build-s1', title: 'Build S1' } });
    const text = 'The thread is still working (bb says working). Merge when bb says it is idle.';
    expect(await (await s.get('build')).json()).toMatchObject({ status: 'working', refusal: text, text: '2 commits in the thread, not in main yet' });
    const res = await s.post('merge', { story: 'S1', kind: 'build' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(text);
    expect(s.merges()).toEqual([]);
  });

  it('needs the session token and a same-origin Origin, and a story and kind', async () => {
    const s = await serve({ build: idle('bb/build-s1') });
    const before = s.head();
    expect((await s.get('build', {})).status).toBe(403);
    expect((await s.post('merge', { story: 'S1', kind: 'build' }, {})).status).toBe(403);
    expect((await s.post('merge', { story: 'S1', kind: 'build' }, { 'x-rehearse-token': 'wrong' })).status).toBe(403);
    const cross = await s.post('merge', { story: 'S1', kind: 'build' }, { ...s.headers, origin: 'http://evil.example' });
    expect(cross.status).toBe(403);
    expect((await s.post('ask-rebase', { story: 'S1', kind: 'build' }, {})).status).toBe(403);
    expect((await s.post('merge', { story: 'S1', kind: 'all' })).status).toBe(400);
    expect((await s.get('nope')).status).toBe(400);
    expect((await s.post('ask-rebase', { story: 'S1', kind: 'build', files: ['a\nb'] })).status).toBe(400);
    expect(s.merges()).toEqual([]);
    expect(s.calls.filter((c) => c.command === 'bb' && c.args[1] === 'tell')).toEqual([]);
    expect(s.head()).toBe(before);
  });

  it('listFiles names eight files and counts the rest', () => {
    expect(listFiles(['a', 'b'])).toBe('a, b');
    expect(listFiles(Array.from({ length: 10 }, (_, i) => `f${i}`))).toBe('f0, f1, f2, f3, f4, f5, f6, f7 and 2 more');
  });
});
