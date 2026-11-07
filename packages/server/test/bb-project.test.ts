// T46, the bb project of new story threads: the option, then the environment, then the one
// `bb project list` project at the repo root or the main checkout of a worktree, then none and a
// plain error. Every git and bb call goes to a fake runner: no real `bb thread spawn`.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeEpic } from '../../core/test/helpers.js';
import {
  bbProjectFrom,
  createStoryThreads,
  findBbProject,
  matchProject,
  newToken,
  NO_BB_PROJECT,
  parseProjectList,
  startServer,
  StoryThreadError,
  type RunResult,
  type Runner,
  type RunningServer,
} from '../src/index.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: '' });

const project = (id: string, ...paths: string[]) => ({
  id,
  kind: 'standard',
  name: id,
  sources: paths.map((path, i) => ({ id: `src_${i}`, projectId: id, type: 'local_path', hostId: 'host_1', path, isDefault: i === 0 })),
});

interface Repo {
  top: string;
  /** `git rev-parse --git-common-dir`; `<top>/.git` in a main checkout. */
  common?: string;
  projects: unknown[];
  /** `bb thread spawn` answer. */
  spawn?: RunResult;
}

function fakeRunner(repo: Repo): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = async (command, args) => {
    calls.push([command, ...args]);
    if (command === 'git') {
      if (args.join(' ') === 'rev-parse --show-toplevel') return ok(`${repo.top}\n`);
      if (args.join(' ') === 'rev-parse --path-format=absolute --git-common-dir') return ok(`${repo.common ?? `${repo.top}/.git`}\n`);
      if (args[0] === 'rev-parse') return ok('main\n');
      return ok('');
    }
    if (args.join(' ') === 'project list --json') return ok(JSON.stringify(repo.projects));
    if (args[1] === 'spawn') return repo.spawn ?? ok(fixture('bb-thread-spawn.json'));
    return { code: 1, stdout: '', stderr: 'unknown' };
  };
  return { run, calls };
}

describe('T46 which bb project', () => {
  it('the option first, then REHEARSE_BB_PROJECT, then BB_PROJECT_ID, else none', () => {
    const env = { REHEARSE_BB_PROJECT: 'proj_env', BB_PROJECT_ID: 'proj_thread' };
    expect(bbProjectFrom('proj_opt', env)).toBe('proj_opt');
    expect(bbProjectFrom(undefined, env)).toBe('proj_env');
    expect(bbProjectFrom(undefined, { BB_PROJECT_ID: 'proj_thread' })).toBe('proj_thread');
    expect(bbProjectFrom(undefined, { REHEARSE_BB_PROJECT: '', BB_PROJECT_ID: '' })).toBeUndefined();
  });

  it('reads the local paths of each project from bb project list --json, and nothing from broken output', () => {
    const list = [project('proj_a', '/r/a'), { ...project('proj_b'), sources: [{ type: 'git_remote', path: '/r/b' }] }];
    expect(parseProjectList(JSON.stringify(list))).toEqual([{ id: 'proj_a', paths: ['/r/a'] }, { id: 'proj_b', paths: [] }]);
    expect(parseProjectList('not json')).toEqual([]);
    expect(parseProjectList('{"ok":false}')).toEqual([]);
  });

  it('matches the repo root, ignoring a trailing slash', () => {
    expect(matchProject([{ id: 'proj_a', paths: ['/r/a/'] }, { id: 'proj_b', paths: ['/r/b'] }], ['/r/a'])).toBe('proj_a');
    expect(matchProject([{ id: 'proj_b', paths: ['/r/b'] }], ['/r/a'])).toBeNull();
  });

  it('finds the project of the repo root from bb project list', async () => {
    const { run, calls } = fakeRunner({ top: '/r/shop', projects: [project('proj_other', '/r/other'), project('proj_shop', '/r/shop')] });
    expect(await findBbProject(run, '/r/shop/docs/epics/x')).toBe('proj_shop');
    expect(calls).toContainEqual(['bb', 'project', 'list', '--json']);
  });

  it('in a git worktree, finds the project of the main checkout', async () => {
    const { run } = fakeRunner({ top: '/wt/thr_1/shop', common: '/r/shop/.git', projects: [project('proj_shop', '/r/shop')] });
    expect(await findBbProject(run, '/wt/thr_1/shop')).toBe('proj_shop');
  });

  it('several matching projects, or none, is no guess', async () => {
    const several = fakeRunner({ top: '/r/shop', projects: [project('proj_a', '/r/shop'), project('proj_b', '/r/shop')] });
    expect(await findBbProject(several.run, '/r/shop')).toBeNull();
    const worktreeAndMain = fakeRunner({ top: '/wt/shop', common: '/r/shop/.git', projects: [project('proj_a', '/wt/shop'), project('proj_b', '/r/shop')] });
    expect(await findBbProject(worktreeAndMain.run, '/wt/shop')).toBeNull();
    const none = fakeRunner({ top: '/r/shop', projects: [project('proj_a', '/r/elsewhere')] });
    expect(await findBbProject(none.run, '/r/shop')).toBeNull();
  });
});

describe('T46 starting a thread without a given project', () => {
  it('spawns in the project found from bb project list, and looks it up only once', async () => {
    const epicDir = makeEpic();
    const top = mkdtempSync(join(tmpdir(), 'rehearse-repo-'));
    const { run, calls } = fakeRunner({ top, projects: [project('proj_found', top)] });
    const threads = createStoryThreads({ epicDir, run });
    await threads.start('S1');
    await threads.start('S2');
    const spawns = calls.filter((c) => c[2] === 'spawn');
    expect(spawns).toHaveLength(2);
    for (const s of spawns) expect(s.slice(s.indexOf('--project'), s.indexOf('--project') + 2)).toEqual(['--project', 'proj_found']);
    expect(calls.filter((c) => c[1] === 'project')).toHaveLength(1);
  });

  it('the given project wins: no bb project list', async () => {
    const epicDir = makeEpic();
    const top = mkdtempSync(join(tmpdir(), 'rehearse-repo-'));
    const { run, calls } = fakeRunner({ top, projects: [project('proj_found', top)] });
    await createStoryThreads({ epicDir, run, bbProject: 'proj_given' }).start('S1');
    expect(calls.find((c) => c[2] === 'spawn')).toContain('proj_given');
    expect(calls.filter((c) => c[1] === 'project')).toEqual([]);
  });

  it('no project at all: a plain error and no spawn, for a question and a build thread', async () => {
    const epicDir = makeEpic();
    const top = mkdtempSync(join(tmpdir(), 'rehearse-repo-'));
    const { run, calls } = fakeRunner({ top, projects: [] });
    const threads = createStoryThreads({ epicDir, run });
    const err = await threads.start('S1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StoryThreadError);
    expect((err as StoryThreadError).message).toBe(NO_BB_PROJECT);
    expect(NO_BB_PROJECT).toBe(
      'rehearse could not tell which bb project this repo is in. Open rehearse from the bb panel, or start serve with REHEARSE_BB_PROJECT=<id>.',
    );
    expect(calls.filter((c) => c[2] === 'spawn')).toEqual([]);
  });

  it('another spawn failure: plain words, and bb\'s own message as details', async () => {
    const epicDir = makeEpic();
    const top = mkdtempSync(join(tmpdir(), 'rehearse-repo-'));
    const { run } = fakeRunner({ top, projects: [project('proj_found', top)], spawn: { code: 1, stdout: '', stderr: 'error: HTTP 500: the daemon is down' } });
    const err = (await createStoryThreads({ epicDir, run }).start('S1').catch((e: unknown) => e)) as StoryThreadError;
    expect(err.message).toBe('bb could not start the thread.');
    expect(err.details).toBe('error: HTTP 500: the daemon is down');
  });
});

describe('T46 the route answers the plain error, with details when there are any', () => {
  let running: RunningServer | undefined;
  afterEach(async () => {
    await running?.close();
    running = undefined;
    vi.unstubAllEnvs();
  });

  async function serveWith(repo: (top: string) => Omit<Repo, 'top'>) {
    vi.stubEnv('REHEARSE_BB_PROJECT', '');
    vi.stubEnv('BB_PROJECT_ID', '');
    const top = mkdtempSync(join(tmpdir(), 'rehearse-repo-'));
    const { run } = fakeRunner({ top, ...repo(top) });
    const token = newToken();
    running = await startServer({
      epicDir: makeEpic(),
      uiDir: mkdtempSync(join(tmpdir(), 'rehearse-ui-')),
      port: 0,
      session: { token, identity: { by: 'me@example.com' }, signer: { ok: false, reason: 'off' } },
      run,
    });
    const res = await fetch(new URL('api/story-thread/start', running.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rehearse-token': token },
      body: JSON.stringify({ story: 'S1' }),
    });
    return { status: res.status, body: await res.json() };
  }

  it('no project: the plain error, no details', async () => {
    const r = await serveWith(() => ({ projects: [] }));
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ ok: false, error: NO_BB_PROJECT });
  });

  it('bb fails to spawn: plain words, the raw message under details', async () => {
    const r = await serveWith((top) => ({ projects: [project('proj_x', top)], spawn: { code: 1, stdout: '', stderr: "error: required option '--title <t>' not specified" } }));
    expect(r.status).toBe(502);
    expect(r.body).toEqual({ ok: false, error: 'bb could not start the thread.', details: "error: required option '--title <t>' not specified" });
  });
});
