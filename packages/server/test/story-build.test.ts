// T44, a signed story handed to a bb thread and watched in rehearse: the build spawn (worktree on
// the current branch, model and reasoning only when set), the plan-changed notice and "send the
// change", and the progress from Flow-Box commits on every branch. Every git and bb call goes to a
// fake runner: no test touches the real repo or runs a real `bb thread spawn`.

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEpic, type GateItem } from '@rehearse/core';
import { coverageIndexOf, EMPTY_COVERAGE, Store, type CoverageIndex } from '@rehearse/graph';
import { makeEpic } from '../../core/test/helpers.js';
import { editYaml, signedEpic } from '../../core/test/trust/helpers.js';
import {
  newToken,
  parseBranchLog,
  progressText,
  spawnArgs,
  startServer,
  storyProgress,
  STORY_THREADS_FILE,
  type GraphService,
  type PlayerClient,
  type RunResult,
  type Runner,
  type RunningServer,
  type ServerSession,
} from '../src/index.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: '' });
const SHOW = fixture('bb-thread-show.json');
const THREAD_BRANCH = 'bb/implement-collapsible-story-thread-panel-thr_sz8f4bedm4';

/** `git log --all --source` output: a commit on the thread branch, one on main, one of another story. */
const ALL_LOG = [
  ['aaaaaaa1111111111111111111111111111111aa', `refs/heads/${THREAD_BRANCH}`, 'Cart page', 'Cart page\n\nFlow-Box: cart\n'],
  ['bbbbbbb2222222222222222222222222222222bb', 'refs/heads/main', 'Cart total', 'Cart total\n\nFlow-Box: cart\nFlow-Box: ship/pack\n'],
  ['ccccccc3333333333333333333333333333333cc', 'refs/remotes/origin/x', 'Ship', 'Ship\n\nFlow-Box: ship\n'],
]
  .map((f) => f.join('\x1f'))
  .join('\x1e');

interface Call {
  command: 'git' | 'bb';
  args: string[];
  input?: string;
}

interface Fake {
  branch?: string;
  bb?: (args: string[]) => RunResult;
}

function fakeRunner(repo: string, fake: Fake): { run: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const run: Runner = async (command, args, opts) => {
    calls.push({ command, args, ...(opts.input !== undefined ? { input: opts.input } : {}) });
    if (command === 'git') {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return ok(`${repo}\n`);
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return ok(`${fake.branch ?? 'feature/plan'}\n`);
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return ok('0123456789abcdef0123456789abcdef01234567\n');
      if (args[0] === 'log' && args.includes('--all')) return ok(ALL_LOG);
      if (args[0] === 'log' && args.includes(THREAD_BRANCH)) return ok('aaaaaaa1111111111111111111111111111111aa\n');
      return ok('');
    }
    if (fake.bb) return fake.bb(args);
    if (args[1] === 'show') return ok(SHOW.replace(/"status": "active"/, '"status": "idle"'));
    if (args[1] === 'log') return ok('[]');
    if (args[1] === 'spawn') return ok(fixture('bb-thread-spawn.json'));
    if (args[1] === 'tell') return ok(fixture('bb-thread-tell.json'));
    return { code: 1, stdout: '', stderr: 'unknown' };
  };
  return { run, calls };
}

/** The e2e player is off; no test reaches a real one. */
const offPlayer: PlayerClient = {
  state: () => Promise.reject(new Error('no player')),
  setup: () => Promise.reject(new Error('no player')),
  projects: () => Promise.reject(new Error('no player')),
  useProject: () => Promise.reject(new Error('no player')),
  writePlaylist: () => Promise.reject(new Error('no player')),
  play: () => Promise.reject(new Error('no player')),
};

/** An indexed graph that knows the coverage of one box. */
/** A graph with an empty store: the briefs' code section (T49) finds no code in it. */
function fakeGraph(): GraphService {
  const stats = { lines: 10, covered: 7, branches: 0, branchesCovered: 0, percent: 70, tests: 2, stale: false };
  const store = new Store(':memory:');
  return {
    status: () => ({ indexed: true, busy: false }),
    coverage: async () => ({ ok: true, boxes: { cart: stats }, info: { files: [] } }),
    withGraph: async <T>(fn: (g: { store: Store; root: string; coverage: CoverageIndex }) => T) => fn({ store, root: tmpdir(), coverage: coverageIndexOf(store, tmpdir(), EMPTY_COVERAGE) }),
    close: async () => undefined,
  } as unknown as GraphService;
}

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function serve(epicDir: string, fake: Fake = {}, extra: { threadModel?: string; threadReasoning?: string; testProject?: string } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'rehearse-repo-'));
  const f = fakeRunner(repo, fake);
  const session: ServerSession = { token: newToken(), identity: { by: 'me@example.com' }, signer: { ok: false, reason: 'off' } };
  running = await startServer({
    epicDir,
    uiDir: mkdtempSync(join(tmpdir(), 'rehearse-ui-')),
    port: 0,
    session,
    run: f.run,
    bbProject: 'proj_abc',
    graph: fakeGraph(),
    birdview: { port: 1, client: offPlayer, ...(extra.testProject ? { projectDir: extra.testProject } : {}) },
    ...(extra.threadModel ? { threadModel: extra.threadModel } : {}),
    ...(extra.threadReasoning ? { threadReasoning: extra.threadReasoning } : {}),
  });
  const url = running.url;
  const headers = { 'x-rehearse-token': session.token };
  const get = (path: string, h: Record<string, string> = headers) => fetch(new URL(path, url), { headers: h });
  const post = (path: string, body: unknown, h: Record<string, string> = headers) =>
    fetch(new URL(`api/story-thread/${path}`, url), { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
  const linkFile = join(repo, STORY_THREADS_FILE);
  const links = () => JSON.parse(readFileSync(linkFile, 'utf8'));
  return { get, post, headers, calls: f.calls, linkFile, links, slug: '2026-11-05-shop' };
}

const spawnCall = (calls: Call[]) => calls.find((c) => c.command === 'bb' && c.args[1] === 'spawn');

describe('T44 build with an agent (box start-build)', () => {
  it('spawns in a new worktree on the current branch with the build brief, without model flags when unset', async () => {
    const s = await serve(signedEpic());
    const before = await (await s.get('api/story-thread?story=S1')).json();
    expect(before.build).toMatchObject({ status: 'signed', buildable: true });
    expect(before.link).toBeNull();
    const res = await s.post('build', { story: 'S1' });
    expect(res.status).toBe(200);
    const spawn = spawnCall(s.calls)!;
    expect(spawn.args).toEqual([
      'thread', 'spawn', '--json', '--prompt-file', '-', '--title', 'Build S1 · to pay for my cart',
      '--project', 'proj_abc', '--new-environment', 'worktree', '--base-branch', 'feature/plan',
    ]);
    expect(spawn.input).toContain('Build story S1 of the EPIC 2026-11-05-shop from this brief.');
    expect(spawn.input).toContain('# Build brief: story S1 of the EPIC 2026-11-05-shop');
    expect(spawn.input).toContain('## How to work in this repo');
    // T49: the code each box starts from, here from a graph with no code yet.
    expect(spawn.input).toContain('## Code you start from');
    expect(spawn.input).toContain('### `pay`: no code yet');
    const link = s.links()[s.slug].S1;
    expect(link).toMatchObject({ thread: 'thr_newstory1', kind: 'build', hash: before.build.hash, at: expect.any(String) });
    expect(link.content).toBeTypeOf('object');
    const body = await res.json();
    expect(body.link).toMatchObject({ kind: 'build', hash: before.build.hash });
    expect(body.planChanged).toBeNull();
    expect((await s.post('build', { story: 'S1' })).status).toBe(409);
  });

  it('passes --model and --reasoning-level only when serve has them', async () => {
    const s = await serve(signedEpic(), {}, { threadModel: 'claude-opus-5-5', threadReasoning: 'medium' });
    expect((await s.post('build', { story: 'S2' })).status).toBe(200);
    expect(spawnCall(s.calls)!.args.slice(-4)).toEqual(['--model', 'claude-opus-5-5', '--reasoning-level', 'medium']);
    expect(spawnArgs({ title: 't' })).toEqual(['thread', 'spawn', '--json', '--prompt-file', '-', '--title', 't']);
  });

  it('starts a detached checkout from its commit', async () => {
    const s = await serve(signedEpic(), { branch: 'HEAD' });
    await s.post('build', { story: 'S1' });
    expect(spawnCall(s.calls)!.args).toContain('0123456789abcdef0123456789abcdef01234567');
  });

  it('refuses an unsigned story with the reason, and spawns nothing', async () => {
    const s = await serve(makeEpic());
    const view = await (await s.get('api/story-thread?story=S1')).json();
    expect(view.build).toMatchObject({ status: 'draft', buildable: false, refusal: expect.stringContaining('not signed off') });
    const res = await s.post('build', { story: 'S1' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('not signed off');
    expect(spawnCall(s.calls)).toBeUndefined();
  });

  it('refuses a stale story, and the question thread still starts with the short brief', async () => {
    const dir = signedEpic();
    editYaml(dir, 'prd.yaml', (doc) => doc.setIn(['requirements', 0, 'text'], 'The buyer pays for an order by card.'));
    const s = await serve(dir);
    const res = await s.post('build', { story: 'S1' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('changed since it was signed off');
    expect((await s.post('start', { story: 'S1' })).status).toBe(200);
    const spawn = spawnCall(s.calls)!;
    expect(spawn.args).not.toContain('--new-environment');
    expect(spawn.input).toContain('Story thread for S1');
  });

  it('every new route needs the session token and a same-origin Origin', async () => {
    const s = await serve(signedEpic());
    for (const path of ['build', 'send-change']) {
      expect((await s.post(path, { story: 'S1' }, {})).status).toBe(403);
      expect((await s.post(path, { story: 'S1' }, { ...s.headers, origin: 'http://evil.example' })).status).toBe(403);
    }
    expect((await s.get('api/story-progress?story=S1', {})).status).toBe(403);
    expect((await s.get('api/story-progress', { ...s.headers, origin: 'http://evil.example' })).status).toBe(403);
    expect(s.calls.filter((c) => c.command === 'bb')).toEqual([]);
    expect(s.calls.filter((c) => c.command === 'git' && c.args[0] === 'log')).toEqual([]);
  });
});

describe('T44 the plan changed since the thread started (box watch-build)', () => {
  it('shows what changed and sends it to the thread, then the notice goes away', async () => {
    const dir = signedEpic();
    const s = await serve(dir);
    await s.post('build', { story: 'S1' });
    expect((await s.post('send-change', { story: 'S1' })).status).toBe(409);
    editYaml(dir, 'prd.yaml', (doc) => doc.setIn(['requirements', 0, 'text'], 'The buyer pays for an order by card.'));
    const view = await (await s.get('api/story-thread?story=S1')).json();
    expect(view.planChanged.changes.length).toBeGreaterThan(0);
    expect(view.planChanged.changes.join('\n')).toContain('R1');
    expect(view.build).toMatchObject({ status: 'stale', buildable: false });
    const res = await s.post('send-change', { story: 'S1' });
    expect(res.status).toBe(200);
    const tell = s.calls.find((c) => c.command === 'bb' && c.args[1] === 'tell')!;
    expect(tell.args).toEqual(['thread', 'tell', 'thr_newstory1', '--message-file', '-', '--json']);
    expect(tell.input).toContain('The plan of story S1 changed since this thread started');
    expect(tell.input).toContain('now: The buyer pays for an order by card.');
    expect(tell.input).toContain('not signed off yet');
    expect(tell.input).not.toContain('## Code you start from');
    const after = await res.json();
    expect(after.planChanged).toBeNull();
    expect(after.link.changedAt).toEqual(expect.any(String));
    expect(s.links()[s.slug].S1.hash).toBe(view.build.hash);
  });

  it('T49 a box the change adds to the story comes with the code it starts from', async () => {
    const dir = signedEpic();
    const s = await serve(dir);
    await s.post('build', { story: 'S1' });
    editYaml(dir, 'flow.yaml', (doc) => doc.setIn(['root', 'boxes', 3, 'stories'], ['S1']));
    expect((await s.post('send-change', { story: 'S1' })).status).toBe(200);
    const tell = s.calls.find((c) => c.command === 'bb' && c.args[1] === 'tell')!;
    expect(tell.input).toContain('## Code you start from');
    expect(tell.input).toContain('### `in-stock`: no code yet');
    expect(tell.input).not.toContain('### `pay`');
  });

  it('a thread linked by hand has no plan hash, so there is nothing to send', async () => {
    const s = await serve(signedEpic());
    await s.post('link', { story: 'S1', threadId: 'thr_sz8f4bedm4' });
    expect(s.links()[s.slug].S1).toBe('thr_sz8f4bedm4');
    expect((await (await s.get('api/story-thread?story=S1')).json()).link).toEqual({ kind: 'linked' });
    expect((await s.post('send-change', { story: 'S1' })).status).toBe(409);
  });
});

describe('T44 progress (box watch-build)', () => {
  it('reads Flow-Box commits on every branch, the thread branch, coverage, tests and the gate', async () => {
    const tests = mkdtempSync(join(tmpdir(), 'rehearse-e2e-'));
    writeFileSync(join(tests, 'shop.spec.ts'), "test('S1-buy', async () => {\n  await test.step('cart: open', async () => {});\n});\n");
    const s = await serve(signedEpic(), {}, { testProject: tests });
    await s.post('build', { story: 'S1' });
    const res = await s.get('api/story-progress?story=S1');
    expect(res.status).toBe(200);
    const { progress } = await res.json();
    expect(progress.thread).toMatchObject({ id: 'thr_newstory1', kind: 'build', status: 'idle', branch: THREAD_BRANCH, updatedAt: 1793886954664 });
    expect(progress.boxes).toEqual([
      expect.objectContaining({ path: 'cart', built: true, commits: 2, onThreadBranch: 1, branches: [THREAD_BRANCH, 'main'], coverage: expect.objectContaining({ percent: 70 }) }),
      expect.objectContaining({ path: 'pay', built: false, commits: 0 }),
    ]);
    expect(progress.scenarios).toEqual([
      { id: 'S1-buy', title: expect.any(String), state: 'not-run', test: 'shop.spec.ts:1' },
      { id: 'S1-empty', title: expect.any(String), state: 'missing' },
    ]);
    expect(progress.signOff).toMatchObject({ status: 'signed', valid: true });
    expect(progress.summary).toBe('1 of 2 boxes have code · 1 of 2 scenarios tested');
    const log = s.calls.find((c) => c.command === 'git' && c.args.includes('--all'))!;
    expect(log.args).toEqual(['log', '--all', '--source', '-n', '5000', '--grep=^Flow-Box:', '--format=%H%x1f%S%x1f%s%x1f%B%x1e']);
  });

  it('the overview has every story, with no thread where there is none', async () => {
    const s = await serve(signedEpic());
    const body = await (await s.get('api/story-progress')).json();
    expect(body.stories.map((p: { storyId: string }) => p.storyId)).toEqual(['S1', 'S2']);
    expect(body.stories[1]).toMatchObject({ thread: null, summary: '1 of 1 box has code · 0 of 1 scenario tested' });
    expect((await s.get('api/story-progress?story=S9')).status).toBe(404);
  });
});

describe('T44 progress (pure)', () => {
  it('parses branch names from git log --source', () => {
    expect(parseBranchLog(ALL_LOG).map((c) => [c.branch, c.boxes])).toEqual([
      [THREAD_BRANCH, ['cart']],
      ['main', ['cart', 'ship/pack']],
      ['origin/x', ['ship']],
    ]);
    expect(parseBranchLog('junk\x1e')).toEqual([]);
  });

  it('says passing, failing and not run honestly, and lists gate findings of the story', () => {
    const dir = signedEpic();
    const { record } = loadEpic(dir);
    const gate: GateItem[] = [
      { check: 'traced', finding: { kind: 'gate', file: 'prd.yaml', path: 'S1', message: 'S1 lacks a thing', refs: ['S1'] }, stories: ['S1'] },
      { check: 'traced', finding: { kind: 'gate', file: 'prd.yaml', path: 'S2', message: 'S2 lacks a thing', refs: ['S2'] }, stories: ['S2'] },
    ] as GateItem[];
    const tests = [
      { file: 'a.spec.ts', line: 3, name: 'S1-buy', steps: [] },
      { file: 'a.spec.ts', line: 9, name: 'S1-empty', steps: [] },
    ];
    const p = storyProgress({
      record,
      storyId: 'S1',
      commits: parseBranchLog(ALL_LOG),
      thread: null,
      tests,
      results: { 'a.spec.ts:3': { last: 'passed' }, 'a.spec.ts:9': { last: 'failed', failedStep: 'pay: card' } },
      gate,
    });
    expect(p.scenarios.map((s) => s.state)).toEqual(['passing', 'failing']);
    expect(p.counts).toMatchObject({ scenariosTested: 2, scenariosPassing: 1 });
    expect(p.gate).toEqual([{ check: 'traced', message: 'S1 lacks a thing' }]);
    expect(p.planChanged).toBe(false);
    const text = progressText(p);
    expect(text).toContain('Story S1 of 2026-11-05-shop: 1 of 2 boxes have code · 2 of 2 scenarios tested');
    expect(text).toContain('No thread works on this story yet.');
    expect(text).toContain('S1-empty: failing (a.spec.ts:9), failed at pay: card');
    expect(text).toContain('pay: not yet');
    expect(storyProgress({ record, storyId: 'S1', commits: [], thread: null, tests: [], gate: [], linkHash: 'sha256:old' }).planChanged).toBe(true);
  });
});
