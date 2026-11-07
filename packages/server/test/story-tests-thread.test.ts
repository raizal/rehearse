// T47, a story's missing e2e tests handed to a bb thread (box start-test-thread): the spawn (a
// worktree on the current branch, the test brief on stdin, model and reasoning only when set), the
// `tests` link beside the story thread in .rehearse/story-threads.json (the old file still reads),
// one test thread per story at a time, sending more scenarios to it, and the token and Origin.
// Every git and bb call goes to a fake runner: no test runs a real `bb thread spawn` or `tell`.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { e2eStart, loadEpic, testTitleLine } from '@rehearse/core';
import { makeEpic } from '../../core/test/helpers.js';
import { approvedEpic } from '../../core/test/trust/helpers.js';
import {
  buildPlaylist,
  exportNames,
  newToken,
  parseSpec,
  parseStoryThreads,
  parseTestThreads,
  startServer,
  storyThreadsJson,
  STORY_THREADS_FILE,
  testPrompt,
  testTitle,
  type PlayerClient,
  type RunResult,
  type Runner,
  type RunningServer,
  type ServerSession,
} from '../src/index.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: '' });
const SHOW = fixture('bb-thread-show.json');

interface Call {
  command: 'git' | 'bb';
  args: string[];
  input?: string;
}

/** git answers for a repo at `repo` on branch feature/tests; bb's thread is `status` (default idle). */
function fakeRunner(repo: string, state: { status: string; tell?: RunResult; show?: RunResult; afterSpawn?: string }): { run: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const run: Runner = async (command, args, opts) => {
    calls.push({ command, args, ...(opts.input !== undefined ? { input: opts.input } : {}) });
    if (command === 'git') {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return ok(`${repo}\n`);
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return ok('feature/tests\n');
      return ok('');
    }
    if (args[1] === 'show' && state.show) return state.show;
    if (args[1] === 'show') return ok(SHOW.replace(/"status": "active"/, `"status": "${state.status}"`).replace(/"displayStatus": "active"/, `"displayStatus": "${state.status}"`));
    if (args[1] === 'log') return ok('[]');
    if (args[1] === 'spawn' && state.afterSpawn) state.status = state.afterSpawn;
    if (args[1] === 'spawn') return ok(fixture('bb-thread-spawn.json').replace('thr_newstory1', 'thr_tests1'));
    if (args[1] === 'tell') return state.tell ?? ok(fixture('bb-thread-tell.json'));
    return { code: 1, stdout: '', stderr: 'unknown' };
  };
  return { run, calls };
}

const offPlayer: PlayerClient = {
  state: () => Promise.reject(new Error('no player')),
  setup: () => Promise.reject(new Error('no player')),
  projects: () => Promise.reject(new Error('no player')),
  useProject: () => Promise.reject(new Error('no player')),
  writePlaylist: () => Promise.reject(new Error('no player')),
  play: () => Promise.reject(new Error('no player')),
};

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

/** A repo with an e2e project whose only spec has the test of S2-out-of-stock. */
async function serve(epicDir: string, extra: { threadModel?: string; threadReasoning?: string } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'rehearse-repo-'));
  const e2e = join(repo, 'e2e');
  mkdirSync(join(e2e, 'tests'), { recursive: true });
  writeFileSync(join(e2e, 'playwright.config.ts'), 'export default {};\n');
  writeFileSync(join(e2e, 'tests', 'S2.spec.ts'), "import { test } from './serve.js';\n\ntest('S2-out-of-stock', async ({ page }) => {\n  await page.goto('/');\n});\n");
  const state = { status: 'active' } as { status: string; tell?: RunResult; show?: RunResult; afterSpawn?: string };
  const f = fakeRunner(repo, state);
  const session: ServerSession = { token: newToken(), identity: { by: 'me@example.com' }, signer: { ok: false, reason: 'off' } };
  running = await startServer({
    epicDir,
    uiDir: mkdtempSync(join(tmpdir(), 'rehearse-ui-')),
    port: 0,
    session,
    run: f.run,
    bbProject: 'proj_abc',
    birdview: { port: 1, client: offPlayer, projectDir: e2e },
    ...extra,
  });
  const url = running.url;
  const headers = { 'x-rehearse-token': session.token };
  const get = (story: string, h: Record<string, string> = headers) => fetch(new URL(`api/story-tests/thread?story=${story}`, url), { headers: h });
  const post = (path: 'thread' | 'send', body: unknown, h: Record<string, string> = headers) =>
    fetch(new URL(`api/story-tests/${path}`, url), { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
  const linkFile = join(repo, STORY_THREADS_FILE);
  const links = () => JSON.parse(readFileSync(linkFile, 'utf8'));
  const bbCalls = (verb: string) => f.calls.filter((c) => c.command === 'bb' && c.args[1] === verb);
  return { get, post, headers, calls: f.calls, bbCalls, state, linkFile, links, e2e, slug: '2026-11-05-shop' };
}

describe('T47 write the missing tests with an agent (box start-test-thread)', () => {
  it('the view lists the approved scenarios without a test, the ones not approved, and no thread yet', async () => {
    const s = await serve(approvedEpic());
    expect(await (await s.get('S1')).json()).toEqual({ storyId: 'S1', missing: ['S1-buy', 'S1-empty'], notApproved: [], thread: null });
    expect(await (await s.get('S2')).json()).toMatchObject({ missing: [], thread: null });
    await running!.close();
    const d = await serve(makeEpic());
    expect(await (await d.get('S1')).json()).toMatchObject({ missing: [], notApproved: [{ id: 'S1-buy', status: 'draft' }, { id: 'S1-empty', status: 'draft' }] });
    expect(d.bbCalls('spawn')).toEqual([]);
  });

  it('spawns one thread in a worktree on the current branch with the test brief, titled "Tests: <story> <ids>", and stores the tests link', async () => {
    const s = await serve(approvedEpic());
    const res = await s.post('thread', { story: 'S1' });
    expect(res.status).toBe(200);
    const [spawn] = s.bbCalls('spawn');
    expect(spawn!.args).toEqual([
      'thread', 'spawn', '--json', '--prompt-file', '-', '--title', 'Tests: S1 S1-buy S1-empty',
      '--project', 'proj_abc', '--new-environment', 'worktree', '--base-branch', 'feature/tests',
    ]);
    expect(spawn!.input).toContain('Write the e2e tests of story S1 of the EPIC 2026-11-05-shop for S1-buy, S1-empty, from this brief.');
    expect(spawn!.input).toContain('# Test brief: e2e tests for S1-buy, S1-empty');
    // Paths relative to the repo; the new spec goes beside the existing one, which is the style to copy.
    expect(spawn!.input).toContain('- File: `e2e/tests/S1.spec.ts`');
    expect(spawn!.input).toContain('from `e2e/tests/S2.spec.ts`');
    // T61: a separate test thread gets no code of the boxes, and writes the main path test first.
    expect(spawn!.input).toContain('## Code you start from');
    expect(spawn!.input).not.toMatch(/`cart`: no code yet/);
    expect(spawn!.input).toContain("You are a separate test thread. Work only from the scenarios and the product that runs (the UI and the CLI). Do not read the code of the story's boxes");
    expect(spawn!.input).toContain('First task: run `rehearse e2e-start 2026-11-05-shop S1 --main-path` and write the main path test (S1-buy) from it.');
    expect(spawn!.input).toContain('The main path of this story is S1-buy, the first scenario below. Write the main path test first.');
    expect(s.links()[s.slug].S1).toEqual({ tests: { thread: 'thr_tests1', scenarios: ['S1-buy', 'S1-empty'], hash: expect.stringMatching(/^sha256:/), at: expect.any(String) } });
    expect(await res.json()).toMatchObject({ thread: { id: 'thr_tests1', scenarios: ['S1-buy', 'S1-empty'], running: true, bb: { ok: true, statusText: 'working' } } });
  });

  it('T48 the brief names the fixtures of the test project with their exports, and writes commands as they run in the repo', async () => {
    const s = await serve(approvedEpic());
    writeFileSync(join(s.e2e, 'tests', 'cli.ts'), 'export function freshRepo() {}\nexport function rehearse() {}\nexport const git = () => 1;\n');
    writeFileSync(join(s.e2e, '..', 'package.json'), JSON.stringify({ scripts: { rehearse: 'node packages/cli/bin/rehearse.js' } }));
    writeFileSync(join(s.e2e, '..', 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    expect((await s.post('thread', { story: 'S1' })).status).toBe(200);
    const input = s.bbCalls('spawn')[0]!.input!;
    expect(input).toContain('Start from: a CLI scenario (no box of the app), `e2e/tests/cli.ts`.');
    expect(input).toContain('- CLI scenario: `e2e/tests/cli.ts` (`freshRepo`, `rehearse`, `git`) makes a fresh git repo and runs the CLI in it.');
    expect(input).toContain('- UI scenario: no fixture in `e2e/tests/`');
    expect(input).toContain('`pnpm rehearse play 2026-11-05-shop S1 --test <file:line> --wait`');
    expect(input).toContain('Set up first: `pnpm install --frozen-lockfile && pnpm -r build`');
    expect(input).toContain("Commit on your thread's branch. Do not merge, push or rebase onto main yourself");
  });

  it('T48 exportNames reads functions, consts, classes and export lists', () => {
    const text = "export const CLI = 'x';\nexport async function serve() {}\nexport function stop() {}\nexport class Box {}\nexport { expect } from '@playwright/test';\nexport { a as b, type T };\nconst hidden = 1;\n";
    expect(exportNames(text)).toEqual(['CLI', 'serve', 'stop', 'Box', 'expect', 'b']);
  });

  it('starts for the named scenarios only, and passes --model and --reasoning-level when serve has them', async () => {
    const s = await serve(approvedEpic(), { threadModel: 'claude-opus-5-5', threadReasoning: 'medium' });
    expect((await s.post('thread', { story: 'S1', scenarios: ['S1-empty'] })).status).toBe(200);
    const args = s.bbCalls('spawn')[0]!.args;
    expect(args[6]).toBe('Tests: S1 S1-empty');
    expect(args.slice(-4)).toEqual(['--model', 'claude-opus-5-5', '--reasoning-level', 'medium']);
  });

  it('refuses a draft scenario (approve it first) and a story with no missing test, spawning nothing', async () => {
    const d = await serve(makeEpic());
    const res = await d.post('thread', { story: 'S1', scenarios: ['S1-buy'] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('S1-buy (draft): approve this scenario first; an agent writes tests for approved scenarios only');
    expect((await d.post('thread', { story: 'S1' })).status).toBe(409);
    await running!.close();
    const s = await serve(approvedEpic());
    const none = await s.post('thread', { story: 'S2' });
    expect(none.status).toBe(409);
    expect((await none.json()).error).toBe('every approved scenario of S2 has a test');
    expect(s.bbCalls('spawn')).toEqual([]);
  });

  it('one test thread per story at a time: a second start while it works is refused, and send tells it the new scenarios', async () => {
    const s = await serve(approvedEpic());
    await s.post('thread', { story: 'S1', scenarios: ['S1-buy'] });
    const again = await s.post('thread', { story: 'S1' });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toContain('send these scenarios to it');
    expect(s.bbCalls('spawn')).toHaveLength(1);
    const sent = await s.post('send', { story: 'S1' });
    expect(sent.status).toBe(200);
    const [tell] = s.bbCalls('tell');
    expect(tell!.args).toEqual(['thread', 'tell', 'thr_tests1', '--message-file', '-', '--json']);
    expect(tell!.input).toContain('Also write the e2e tests of S1-empty of story S1');
    expect(tell!.input).toContain('## S1-empty:');
    expect(tell!.input).not.toContain('## S1-buy:');
    expect(s.links()[s.slug].S1.tests).toMatchObject({ scenarios: ['S1-buy', 'S1-empty'], sentAt: expect.any(String) });
    // Nothing left to send.
    expect((await s.post('send', { story: 'S1' })).status).toBe(409);
  });

  it('a finished (idle) test thread does not block a new one; send without a thread, or when bb fails, says so', async () => {
    const s = await serve(approvedEpic());
    expect((await s.post('send', { story: 'S1' })).status).toBe(409);
    await s.post('thread', { story: 'S1', scenarios: ['S1-buy'] });
    s.state.status = 'idle';
    expect((await (await s.get('S1')).json()).thread).toMatchObject({ running: false, bb: { statusText: 'idle' } });
    s.state.tell = { code: 1, stdout: fixture('bb-error.json'), stderr: '' };
    const failed = await s.post('send', { story: 'S1', scenarios: ['S1-empty'] });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ error: 'bb could not send to the test thread.', details: 'HTTP 404: Thread not found' });
    expect((await s.post('thread', { story: 'S1' })).status).toBe(200);
    expect(s.bbCalls('spawn')).toHaveLength(2);
  });

  it('a linked thread blocks a new one unless bb says it is done: an unknown status or no answer from bb counts as working', async () => {
    const s = await serve(approvedEpic());
    await s.post('thread', { story: 'S1', scenarios: ['S1-buy'] });
    s.state.status = 'queued';
    expect((await (await s.get('S1')).json()).thread).toMatchObject({ running: true, bb: { statusText: 'queued' } });
    expect((await s.post('thread', { story: 'S1' })).status).toBe(409);
    s.state.show = { code: 1, stdout: '', stderr: 'bb is restarting' };
    const down = await s.post('thread', { story: 'S1' });
    expect(down.status).toBe(409);
    expect((await down.json()).error).toContain('bb did not answer');
    expect(s.bbCalls('spawn')).toHaveLength(1);
    // Two presses at once on a stopped thread: one new thread (bb says it works once spawned).
    s.state.show = undefined;
    s.state.status = 'stopped';
    s.state.afterSpawn = 'active';
    const both = await Promise.all([s.post('thread', { story: 'S1' }), s.post('thread', { story: 'S1' })]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(s.bbCalls('spawn')).toHaveLength(2);
  });

  it('keeps the story thread beside the tests link, both ways', async () => {
    const s = await serve(approvedEpic());
    mkdirSync(join(s.linkFile, '..'), { recursive: true });
    writeFileSync(s.linkFile, JSON.stringify({ [s.slug]: { S1: 'thr_story1', S2: { thread: 'thr_build2', kind: 'build' } } }));
    await s.post('thread', { story: 'S1' });
    expect(s.links()[s.slug]).toEqual({
      S1: { thread: 'thr_story1', tests: expect.objectContaining({ thread: 'thr_tests1' }) },
      S2: { thread: 'thr_build2', kind: 'build' },
    });
    // The story thread routes read it and write it back without losing the tests link.
    const view = await (await fetch(new URL('api/story-thread?story=S1', running!.url), { headers: s.headers })).json();
    expect(view.threadId).toBe('thr_story1');
    await fetch(new URL('api/story-thread/link', running!.url), { method: 'POST', headers: { 'content-type': 'application/json', ...s.headers }, body: JSON.stringify({ story: 'S1', threadId: 'thr_story9' }) });
    expect(s.links()[s.slug].S1).toEqual({ thread: 'thr_story9', tests: expect.objectContaining({ thread: 'thr_tests1' }) });
  });

  it('every route needs the session token and a same-origin Origin, and checks its body', async () => {
    const s = await serve(approvedEpic());
    expect((await s.get('S1', {})).status).toBe(403);
    expect((await s.get('S1', { ...s.headers, origin: 'http://evil.example' })).status).toBe(403);
    for (const path of ['thread', 'send'] as const) {
      expect((await s.post(path, { story: 'S1' }, {})).status).toBe(403);
      expect((await s.post(path, { story: 'S1' }, { ...s.headers, origin: 'http://evil.example' })).status).toBe(403);
    }
    expect((await s.post('thread', { story: 'S1', scenarios: ['x; rm -rf /'] })).status).toBe(400);
    expect((await s.post('thread', {})).status).toBe(400);
    expect((await s.get('S9')).status).toBe(404);
    expect(s.calls.filter((c) => c.command === 'bb')).toEqual([]);
  });
});

describe('T47 the tests link in .rehearse/story-threads.json', () => {
  it('an old file reads as before; a tests-only entry is no story thread; writing keeps both', () => {
    const old = '{"e":{"S1":"thr_abc","S2":{"thread":"thr_b","kind":"build"}}}';
    expect(parseTestThreads(old)).toEqual({});
    const text = storyThreadsJson(parseStoryThreads(old), { e: { S1: { thread: 'thr_t1', scenarios: ['S1-a'] } }, f: { S3: { thread: 'thr_t3', scenarios: [] } } });
    expect(JSON.parse(text)).toEqual({
      e: { S1: { thread: 'thr_abc', tests: { thread: 'thr_t1', scenarios: ['S1-a'] } }, S2: { thread: 'thr_b', kind: 'build' } },
      f: { S3: { tests: { thread: 'thr_t3', scenarios: [] } } },
    });
    expect(parseStoryThreads(text)).toEqual({ e: { S1: { thread: 'thr_abc' }, S2: { thread: 'thr_b', kind: 'build' } } });
    expect(parseTestThreads(text)).toEqual({ e: { S1: { thread: 'thr_t1', scenarios: ['S1-a'] } }, f: { S3: { thread: 'thr_t3', scenarios: [] } } });
    expect(parseTestThreads('{"e":{"S1":{"tests":{"thread":"nope"}}}}')).toEqual({});
  });

  it('a test written from the brief title line is the one the Tests tab matches (parseSpec, buildPlaylist)', () => {
    const spec = `import { test } from './serve.js';\n\n${testTitleLine('S1-buy')}\n  await test.step('cart: add an item', async () => {});\n});\n`;
    const tests = parseSpec('tests/S1.spec.ts', spec);
    expect(tests.map((t) => t.name)).toEqual(['S1-buy']);
    const { record } = loadEpic(approvedEpic());
    const built = buildPlaylist('S1', record.prd, record.scenarioFiles.flatMap((f) => f.scenarios), tests);
    expect(built.playlist.tests.map((t) => t.name)).toEqual(['S1-buy']);
    expect(built.problems).toEqual([]);
    expect(testTitle('S1', ['S1-buy', 'S1-empty'])).toBe('Tests: S1 S1-buy S1-empty');
  });

  it('T61 a test of the e2e-start file, "<id>: <title>", is the test of its scenario', () => {
    const { record } = loadEpic(approvedEpic());
    const start = e2eStart(record, 'S1', { specFile: 'e2e/tests/S1.spec.ts' });
    if (!start.ok) throw new Error(start.reason);
    const tests = parseSpec('tests/S1.spec.ts', start.text);
    expect(tests.map((t) => t.name)).toEqual(['S1-buy', 'S1-empty']);
    const built = buildPlaylist('S1', record.prd, record.scenarioFiles.flatMap((f) => f.scenarios), tests);
    expect(built.playlist.tests.map((t) => t.name)).toEqual(['S1-buy', 'S1-empty']);
    expect(built.problems).toEqual([]);
    expect(testPrompt('e', 'S1', ['S1-empty'], 'brief', { id: 'S1-buy', cli: 'rehearse' })).not.toContain('First task');
  });
});
