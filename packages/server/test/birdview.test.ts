// T13 feature 3 and T45: the Birdview player seen from `rehearse serve`. The routes need the
// session token and a same-origin Origin and talk to 127.0.0.1 only. A play switches the player to
// this repo's test project, writes the story playlist through it and plays, in that order, once;
// the player's errors come back in plain words. A fake player only: never the real one.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SHOP } from '../../core/test/helpers.js';
import {
  birdviewInfo,
  defaultProject,
  findTestProject,
  httpPlayerClient,
  parseSse,
  playerView,
  startServer,
  type PlayerClient,
  type RunningServer,
  type ServerSession,
} from '../src/index.js';

const SESSION: ServerSession = { token: 'tok-1', identity: { by: 'builder@example.com' }, signer: { ok: false, reason: 'no key in tests' } };
const H = { 'x-rehearse-token': 'tok-1' };

/** A test of the SHOP fixture's S1-buy scenario, at tests/S1.spec.ts:3. */
const SPEC = `import { test } from '@playwright/test';

test('S1-buy', async () => {
  await test.step('cart: Buyer checks out', async () => {});
  await test.step('pay: Shop charges', async () => {});
});
`;

function project(): { projectDir: string; playlistsDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'rehearse-bv-'));
  const projectDir = join(root, 'e2e');
  const playlistsDir = join(projectDir, 'birdview', 'playlists');
  mkdirSync(playlistsDir, { recursive: true });
  writeFileSync(join(projectDir, 'playwright.config.ts'), 'export default {};\n');
  mkdirSync(join(projectDir, 'tests'), { recursive: true });
  writeFileSync(join(projectDir, 'tests', 'S1.spec.ts'), SPEC);
  writeFileSync(
    join(playlistsDir, 'S1.json'),
    JSON.stringify({ name: 'S1 · to pay for my cart', tests: [{ file: 'tests/S1.spec.ts', line: 5, name: 'S1-buy', about: 'Buyer pays', steps: { 'cart: x': 'cart' } }] }),
  );
  return { projectDir, playlistsDir };
}

type Call = { call: string; body?: unknown };

/** A fake player: it plays `projectDir` (or another), records each call, and answers `replies[call]` when set. */
function fakePlayer(
  projectDir: string,
  extra: Partial<{ results: Record<string, unknown>; status: string; current: string; replies: Partial<Record<string, { status: number; body: unknown }>>; defaultDir: string }> = {},
) {
  const calls: Call[] = [];
  let active = projectDir;
  const reply = (call: string, body: unknown, ok: unknown) => {
    calls.push(body === undefined ? { call } : { call, body });
    return extra.replies?.[call] ?? { status: 200, body: ok };
  };
  const client: PlayerClient = {
    state: async () => ({
      status: extra.status ?? 'idle',
      current: extra.current ?? null,
      results: extra.results ?? {},
      project: { projectDir: active, config: 'playwright.config.ts', playlistsDir: join(active, 'birdview', 'playlists') },
      playlist: { id: 's1-to-pay-for-my-cart', name: 'S1 · to pay for my cart' },
    }),
    setup: async () => ({ config: { project: active }, playlists: { selected: { id: 'other' }, dir: '/somewhere/playlists', project: active } }),
    projects: async () => {
      const def = { projectDir: extra.defaultDir ?? '/elsewhere/digital-audits', config: 'playwright.config.ts', playlistsDir: '/elsewhere/digital-audits/e2e/birdview/playlists' };
      return reply('projects', undefined, { active: { projectDir: active }, default: def, projects: [{ ...def, default: true, active: false }] });
    },
    useProject: async (p) => {
      const r = reply('project', p, { active: p });
      if (r.status === 200) active = p.projectDir;
      return r;
    },
    writePlaylist: async (pl) => reply('playlist', pl, { id: 's1-to-pay-for-my-cart', name: pl.name, file: 'x.json', tests: pl.tests.map((t) => `${t.file}:${t.line}`), selected: false }),
    play: async (what) => reply('play', what, { status: 'running', project: { projectDir: active }, playlist: { id: 's1-to-pay-for-my-cart', name: 'S1 · to pay for my cart' } }),
  };
  return { client, calls };
}

const OFF: PlayerClient = {
  state: async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:3298');
  },
  setup: async () => ({}),
  projects: async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:3298');
  },
  useProject: async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:3298');
  },
  writePlaylist: async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:3298');
  },
  play: async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:3298');
  },
};

let running: RunningServer | undefined;
let player: Server | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
  await new Promise<void>((done) => (player ? player.close(() => done()) : done()));
  player = undefined;
});

describe('T13 3 Birdview: pure parts', () => {
  it('T13 3.1 reads the config and playlists events of the player stream', () => {
    const text = 'event: config\ndata: {"project":"/p"}\n\nevent: playlists\ndata: {"dir":"/d"}\n\nevent: playlist\ndata: [{"file":"a"';
    expect(parseSse(text)).toEqual([
      { event: 'config', data: { project: '/p' } },
      { event: 'playlists', data: { dir: '/d' } },
    ]);
  });

  it('T13 3.2 a player of another project is "other"; of ours it keeps only this story\'s results', () => {
    const { projectDir } = project();
    expect(playerView(projectDir, {}, { config: { project: '/elsewhere/eudr-fe' } }, [])).toEqual({ kind: 'other', projectDir: '/elsewhere/eudr-fe' });
    expect(playerView(undefined, {}, { config: { project: projectDir } }, [])).toEqual({ kind: 'other', projectDir });
    const v = playerView(
      projectDir,
      { status: 'held', current: 'tests/S1.spec.ts:5', results: { 'tests/S1.spec.ts:5': { last: 'failed', failedStep: 'cart: x', reason: 'boom', at: 1 }, 'tests/S2.spec.ts:3': { last: 'passed' } } },
      { config: { project: projectDir + '/' }, playlists: { selected: { id: 'S1' }, dir: '/d' } },
      ['tests/S1.spec.ts:5'],
    );
    expect(v).toEqual({ kind: 'ours', playlistsDir: '/d', selected: 'S1', status: 'held', current: 'tests/S1.spec.ts:5', results: { 'tests/S1.spec.ts:5': { last: 'failed', failedStep: 'cart: x', reason: 'boom', at: 1 } } });
  });

  it('T13 3.3 finds the nearest e2e/ test project above the EPIC folder', () => {
    const { projectDir } = project();
    const epic = join(projectDir, '..', 'docs', 'epics', 'x');
    mkdirSync(epic, { recursive: true });
    expect(findTestProject(epic)).toBe(projectDir);
    expect(findTestProject(mkdtempSync(join(tmpdir(), 'rehearse-none-')))).toBeUndefined();
  });

  it('T13 3.4 birdviewInfo: the player off, with the story playlist read from the playlists folder', async () => {
    const { projectDir, playlistsDir } = project();
    const info = await birdviewInfo({ port: 3298, projectDir, client: OFF }, 'S1');
    expect(info).toMatchObject({ port: 3298, playerUrl: 'http://127.0.0.1:3298/', projectDir, playlistsDir, storyId: 'S1', player: { kind: 'off' } });
    expect(info.playlist?.tests.map((t) => t.name)).toEqual(['S1-buy']);
    expect((await birdviewInfo({ port: 3298, projectDir, client: OFF }, 'S2')).playlist).toBeUndefined();
  });
});

describe('T13 3 Birdview: proxy routes', () => {
  const serve = (birdview: Parameters<typeof startServer>[0]['birdview']) => startServer({ epicDir: SHOP, uiDir: '/nonexistent', port: 0, session: SESSION, birdview });

  it('T13 3.5 GET /api/birdview needs the token and a same-origin Origin, and a story id', async () => {
    const { projectDir } = project();
    running = await serve({ port: 3298, projectDir, client: fakePlayer(projectDir).client });
    const url = new URL('api/birdview?story=S1', running.url);
    expect((await fetch(url)).status).toBe(403);
    expect((await fetch(url, { headers: { 'x-rehearse-token': 'nope' } })).status).toBe(403);
    expect((await fetch(url, { headers: { ...H, origin: 'http://evil.example' } })).status).toBe(403);
    expect((await fetch(new URL('api/birdview?story=../x', running.url), { headers: H })).status).toBe(400);
    expect((await fetch(url, { method: 'POST', headers: H })).status).toBe(405);
    const ok = await fetch(url, { headers: { ...H, origin: new URL(running.url).origin } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ storyId: 'S1', player: { kind: 'ours', status: 'idle' }, playlist: { name: 'S1 · to pay for my cart' } });
  });
});

describe('T13 3 Birdview: the HTTP client', () => {
  it('T13 3.8 reads /api/state, the first events of /events and /api/projects, and posts a switch, a playlist and a play, on 127.0.0.1', async () => {
    const seen: string[] = [];
    player = createServer((req, res) => {
      seen.push(`${req.method} ${req.url}${req.headers.origin ? ` origin=${req.headers.origin}` : ''} host=${req.headers.host?.split(':')[0]}`);
      if (req.url === '/api/state') return res.end(JSON.stringify({ status: 'idle', results: {} }));
      if (req.url === '/api/projects') return res.end(JSON.stringify({ default: { projectDir: '/d' }, projects: [] }));
      if (req.url === '/events?lite') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('event: config\ndata: {"project":"/p"}\n\n');
        res.write('event: playlists\ndata: {"dir":"/d"}\n\n');
        return; // an event stream stays open
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.writeHead(req.url === '/api/play' ? 409 : 200);
        res.end(JSON.stringify({ got: JSON.parse(body) }));
      });
    });
    await new Promise<void>((done) => player!.listen(0, '127.0.0.1', done));
    const client = httpPlayerClient((player.address() as AddressInfo).port);
    expect(await client.state()).toEqual({ status: 'idle', results: {} });
    expect(await client.setup()).toEqual({ config: { project: '/p' }, playlists: { dir: '/d' } });
    expect(await client.projects()).toEqual({ status: 200, body: { default: { projectDir: '/d' }, projects: [] } });
    expect(await client.useProject({ projectDir: '/p' })).toEqual({ status: 200, body: { got: { projectDir: '/p' } } });
    expect(await client.writePlaylist({ name: 'S1', tests: [] })).toEqual({ status: 200, body: { got: { name: 'S1', tests: [] } } });
    expect(await client.play({ playlist: 'S1' })).toEqual({ status: 409, body: { got: { playlist: 'S1' } } });
    // From a backend: no Origin header, and the loopback host the player takes.
    expect(seen).toEqual([
      'GET /api/state host=127.0.0.1',
      'GET /events?lite host=127.0.0.1',
      'GET /api/projects host=127.0.0.1',
      'POST /api/project host=127.0.0.1',
      'POST /api/playlist host=127.0.0.1',
      'POST /api/play host=127.0.0.1',
    ]);
    player.closeAllConnections();
  });

  it('T13 3.9 a player that is not running fails fast', async () => {
    const client = httpPlayerClient(1, 500);
    await expect(client.state()).rejects.toThrow();
  });
});

describe('T45 one button plays a story in Birdview', () => {
  const serve = (birdview: Parameters<typeof startServer>[0]['birdview']) => startServer({ epicDir: SHOP, uiDir: '/nonexistent', port: 0, session: SESSION, birdview });
  const post = (path: string, body: unknown, headers: Record<string, string> = H) =>
    fetch(new URL(`api/birdview/${path}`, running!.url), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  it('T45 1 GET /api/birdview builds the story playlist from the record and the spec files, before Birdview has it', async () => {
    const { projectDir, playlistsDir } = project();
    rmSync(join(playlistsDir, 'S1.json'));
    const info = await birdviewInfo({ port: 3298, projectDir, client: OFF }, 'S1', SHOP);
    expect(info.player.kind).toBe('off');
    expect(info.playlist).toEqual({
      name: 'S1 · to pay for my cart',
      tests: [{ file: 'tests/S1.spec.ts', line: 3, name: 'S1-buy', about: expect.any(String), steps: { 'cart: Buyer checks out': 'cart', 'pay: Shop charges': 'pay' } }],
    });
  });

  it('T45 2 GET /api/birdview says the active project and playlist, whether it is ours, and the default project', async () => {
    const { projectDir } = project();
    const ours = await birdviewInfo({ port: 3298, projectDir, client: fakePlayer(projectDir).client }, 'S1', SHOP);
    expect(ours.player.kind).toBe('ours');
    expect(ours.active).toMatchObject({ projectDir, playlist: { id: 's1-to-pay-for-my-cart', name: 'S1 · to pay for my cart' } });
    expect(ours.defaultProject).toEqual({ projectDir: '/elsewhere/digital-audits', config: 'playwright.config.ts', playlistsDir: '/elsewhere/digital-audits/e2e/birdview/playlists' });
    const other = await birdviewInfo({ port: 3298, projectDir, client: fakePlayer('/elsewhere/digital-audits').client }, 'S1', SHOP);
    expect(other.player).toEqual({ kind: 'other', projectDir: '/elsewhere/digital-audits' });
    expect(other.active?.projectDir).toBe('/elsewhere/digital-audits');
    // An older player without /api/projects: no default, and no failure.
    const old = await birdviewInfo({ port: 3298, projectDir, client: { ...fakePlayer(projectDir).client, projects: async () => ({ status: 404, body: { error: 'no' } }) } }, 'S1', SHOP);
    expect(old.defaultProject).toBeUndefined();
    expect(old.player.kind).toBe('ours');
  });

  it('T45 2b the default project as Birdview names it: a path in `default`, its config in `projects`', () => {
    // GET /api/projects of Birdview e28babe: `default` is the projectDir; the entry keeps config and playlistsDir.
    const body = {
      active: { projectDir: '/w/eudr-fe', config: 'playwright.golden.config.ts', playlistsDir: '/w/data/playlists', playlist: 'digital-audits' },
      default: '/w/eudr-fe',
      projects: [{ projectDir: '/w/eudr-fe', config: 'playwright.golden.config.ts', playlistsDir: '/w/data/playlists', default: true, active: true }],
    };
    expect(defaultProject(body)).toEqual({ projectDir: '/w/eudr-fe', config: 'playwright.golden.config.ts', playlistsDir: '/w/data/playlists' });
    expect(defaultProject({ default: '/w/x', projects: [] })).toEqual({ projectDir: '/w/x' });
    expect(defaultProject({ projects: [{ projectDir: '/w/y', default: true }] })).toEqual({ projectDir: '/w/y' });
    expect(defaultProject('nope')).toBeUndefined();
  });

  it('T45 3 play-story: switch to this repo, write the story playlist through Birdview, play it, in that order', async () => {
    const { projectDir } = project();
    const fake = fakePlayer('/elsewhere/digital-audits');
    running = await serve({ port: 3298, projectDir, client: fake.client });
    const res = await post('play-story', { story: 'S1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      project: { projectDir },
      playlist: { id: 's1-to-pay-for-my-cart', name: 'S1 · to pay for my cart', tests: 1 },
      played: { playlist: 's1-to-pay-for-my-cart' },
      active: { projectDir, playlist: { name: 'S1 · to pay for my cart' } },
      problems: [],
    });
    expect(fake.calls.map((c) => c.call)).toEqual(['project', 'playlist', 'play']);
    expect(fake.calls[0]!.body).toEqual({ projectDir });
    // The playlist body has only the fields of Birdview's playlist file.
    expect(fake.calls[1]!.body).toEqual({
      name: 'S1 · to pay for my cart',
      tests: [{ file: 'tests/S1.spec.ts', line: 3, name: 'S1-buy', about: expect.any(String), steps: { 'cart: Buyer checks out': 'cart', 'pay: Shop charges': 'pay' } }],
    });
    // Played by the id Birdview gave it: an older playlist file with the same name is not picked.
    expect(fake.calls[2]!.body).toEqual({ playlist: 's1-to-pay-for-my-cart' });
  });

  it('T45 4 play-test plays one test of the story; a test of no scenario of it is refused before any call', async () => {
    const { projectDir } = project();
    const fake = fakePlayer(projectDir);
    running = await serve({ port: 3298, projectDir, client: fake.client });
    expect((await post('play-test', { story: 'S1', test: 'tests/other.spec.ts:9' })).status).toBe(400);
    expect((await post('play-test', { story: 'S1', test: 'no key' })).status).toBe(400);
    expect((await post('play-story', { story: 'S2' })).status).toBe(404);
    expect(fake.calls).toEqual([]);
    const res = await post('play-test', { story: 'S1', test: 'tests/S1.spec.ts:3' });
    expect(res.status).toBe(200);
    expect(fake.calls.map((c) => c.call)).toEqual(['project', 'playlist', 'play']);
    expect(fake.calls[2]!.body).toEqual({ keys: ['tests/S1.spec.ts:3'] });
  });

  it('T45 5 use-project switches to this repo, or back to the default project, and plays nothing', async () => {
    const { projectDir } = project();
    const fake = fakePlayer('/elsewhere/digital-audits');
    running = await serve({ port: 3298, projectDir, client: fake.client });
    expect(await (await post('use-project', { to: 'this' })).json()).toEqual({ ok: true, project: { projectDir } });
    const back = await post('use-project', { to: 'default' });
    expect(await back.json()).toEqual({ ok: true, project: { projectDir: '/elsewhere/digital-audits', config: 'playwright.config.ts', playlistsDir: '/elsewhere/digital-audits/e2e/birdview/playlists' } });
    expect(fake.calls.map((c) => c.call)).toEqual(['project', 'projects', 'project']);
    // Only the folder goes back: Birdview keeps the known project's config and playlists folder.
    expect(fake.calls[2]!.body).toEqual({ projectDir: '/elsewhere/digital-audits' });
    expect((await post('use-project', { to: '/tmp/x' })).status).toBe(400);
  });

  it('T45 6 the player errors in plain words: 409 busy, 404, 400, 403, and down; no retry', async () => {
    const { projectDir } = project();
    const cases: [string, { status: number; body: unknown }, number, string, RegExp][] = [
      ['project', { status: 409, body: { error: 'A test is running.' } }, 409, 'busy', /^Birdview is busy, try again\. \(A test is running\)$/],
      ['play', { status: 409, body: { error: 'The project changed meanwhile.' } }, 409, 'busy', /^Birdview is busy, try again/],
      ['play', { status: 404, body: { error: 'No such playlist.' } }, 404, 'not-found', /^Birdview could not find the playlist "S1 · to pay for my cart": No such playlist\.$/],
      ['playlist', { status: 400, body: { error: 'Unknown field: x.' } }, 400, 'bad-request', /^Birdview did not take the playlist "S1 · to pay for my cart": Unknown field: x\.$/],
      ['project', { status: 403, body: { error: 'Foreign origin.' } }, 502, 'refused', /refused the call from rehearse/],
    ];
    for (const [call, reply, status, reason, words] of cases) {
      const fake = fakePlayer(projectDir, { replies: { [call]: reply } });
      running = await serve({ port: 3298, projectDir, client: fake.client });
      const res = await post('play-story', { story: 'S1' });
      expect(res.status, call).toBe(status);
      const body = (await res.json()) as { ok: boolean; reason: string; error: string };
      expect(body).toMatchObject({ ok: false, reason });
      expect(body.error).toMatch(words);
      // One try: nothing after the failed call, and the failed call once.
      const order = ['project', 'playlist', 'play'];
      expect(fake.calls.map((c) => c.call)).toEqual(order.slice(0, order.indexOf(call) + 1));
      await running.close();
      running = undefined;
    }
    running = await serve({ port: 3298, projectDir, client: OFF });
    const down = await post('play-story', { story: 'S1' });
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ ok: false, reason: 'off', error: 'Birdview is not running; open it from the bb sidebar.' });
  });

  it('T45 7 the play routes need the token, a same-origin Origin, a POST and a JSON body', async () => {
    const { projectDir } = project();
    const fake = fakePlayer(projectDir);
    running = await serve({ port: 3298, projectDir, client: fake.client });
    for (const path of ['play-story', 'play-test', 'use-project']) {
      expect((await post(path, { story: 'S1', test: 'tests/S1.spec.ts:3', to: 'this' }, {})).status, path).toBe(403);
      expect((await post(path, { story: 'S1', test: 'tests/S1.spec.ts:3', to: 'this' }, { 'x-rehearse-token': 'nope' })).status, path).toBe(403);
      expect((await post(path, { story: 'S1', test: 'tests/S1.spec.ts:3', to: 'this' }, { ...H, origin: 'http://evil.example' })).status, path).toBe(403);
      expect((await fetch(new URL(`api/birdview/${path}`, running.url), { headers: H })).status, path).toBe(405);
    }
    expect((await post('play-story', { story: '../../x' })).status).toBe(400);
    expect((await post('playlist-select', { storyId: 'S1' })).status).toBe(404);
    expect(fake.calls).toEqual([]);
  });
});
