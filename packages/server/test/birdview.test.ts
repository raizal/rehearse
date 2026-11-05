// T13 feature 3: the Birdview player seen from `rehearse serve`. The proxy routes need the
// session token and a same-origin Origin, talk to 127.0.0.1 only, and forward only allowed
// actions, and only to a player that plays this EPIC's test project.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SHOP } from '../../core/test/helpers.js';
import {
  birdviewInfo,
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

function project(): { projectDir: string; playlistsDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'rehearse-bv-'));
  const projectDir = join(root, 'e2e');
  const playlistsDir = join(projectDir, 'birdview', 'playlists');
  mkdirSync(playlistsDir, { recursive: true });
  writeFileSync(join(projectDir, 'playwright.config.ts'), 'export default {};\n');
  writeFileSync(
    join(playlistsDir, 'S1.json'),
    JSON.stringify({ name: 'S1 · to pay for my cart', tests: [{ file: 'tests/S1.spec.ts', line: 5, name: 'S1-buy', about: 'Buyer pays', steps: { 'cart: x': 'cart' } }] }),
  );
  return { projectDir, playlistsDir };
}

function fakePlayer(projectDir: string, extra: Partial<{ results: Record<string, unknown>; status: string; current: string }> = {}) {
  const posts: { name: string; body: unknown }[] = [];
  const client: PlayerClient = {
    state: async () => ({ status: extra.status ?? 'idle', current: extra.current ?? null, results: extra.results ?? {}, log: [], chat: { threadId: 'thr_x' } }),
    setup: async () => ({ config: { project: projectDir }, playlists: { selected: { id: 'other' }, dir: '/somewhere/playlists', project: projectDir } }),
    action: async (name, body) => {
      posts.push({ name, body });
      return { status: 200, body: { status: 'idle' } };
    },
  };
  return { client, posts };
}

const OFF: PlayerClient = {
  state: async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:3298');
  },
  setup: async () => ({}),
  action: async () => ({ status: 500, body: undefined }),
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
    expect(info).toMatchObject({ port: 3298, playerUrl: 'http://127.0.0.1:3298/', projectDir, playlistsDir, storyId: 'S1', playlistId: 'S1', player: { kind: 'off' } });
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

  it('T13 3.6 POST /api/birdview/action forwards playlist-select with the story id as playlist id', async () => {
    const { projectDir } = project();
    const fake = fakePlayer(projectDir);
    running = await serve({ port: 3298, projectDir, client: fake.client });
    const post = (body: unknown, headers: Record<string, string> = H) =>
      fetch(new URL('api/birdview/action', running!.url), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    expect((await post({ action: 'playlist-select', storyId: 'S1' }, {})).status).toBe(403);
    expect((await post({ action: 'playlist-select', storyId: 'S1' }, { ...H, origin: 'http://evil.example' })).status).toBe(403);
    expect((await post({ action: 'play', storyId: 'S1' })).status).toBe(400);
    expect((await post({ action: 'tutorial-reset', storyId: 'S1' })).status).toBe(400);
    expect((await post({ action: 'playlist-select', storyId: '../../x' })).status).toBe(400);
    expect(fake.posts).toEqual([]);
    const ok = await post({ action: 'playlist-select', storyId: 'S1' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(fake.posts).toEqual([{ name: 'playlist-select', body: { id: 'S1' } }]);
  });

  it('T13 3.7 refuses to touch a player of another project (409), and reports a player error (502)', async () => {
    const { projectDir } = project();
    const other = fakePlayer('/elsewhere/eudr-fe');
    running = await serve({ port: 3298, projectDir, client: other.client });
    const body = JSON.stringify({ action: 'playlist-select', storyId: 'S1' });
    const res = await fetch(new URL('api/birdview/action', running.url), { method: 'POST', headers: { 'content-type': 'application/json', ...H }, body });
    expect(res.status).toBe(409);
    expect(other.posts).toEqual([]);
    await running.close();
    const failing: PlayerClient = { ...fakePlayer(projectDir).client, action: async () => ({ status: 400, body: { error: 'No such playlist.' } }) };
    running = await serve({ port: 3298, projectDir, client: failing });
    const bad = await fetch(new URL('api/birdview/action', running.url), { method: 'POST', headers: { 'content-type': 'application/json', ...H }, body });
    expect(bad.status).toBe(502);
    expect((await bad.json()).error).toContain('No such playlist.');
  });
});

describe('T13 3 Birdview: the HTTP client', () => {
  it('T13 3.8 reads /api/state and the first events of /events, and posts actions, on 127.0.0.1', async () => {
    const seen: string[] = [];
    player = createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      if (req.url === '/api/state') return res.end(JSON.stringify({ status: 'idle', results: {} }));
      if (req.url === '/events?lite') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('event: config\ndata: {"project":"/p"}\n\n');
        res.write('event: playlists\ndata: {"dir":"/d"}\n\n');
        return; // an event stream stays open
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => res.end(JSON.stringify({ got: JSON.parse(body) })));
    });
    await new Promise<void>((done) => player!.listen(0, '127.0.0.1', done));
    const client = httpPlayerClient((player.address() as AddressInfo).port);
    expect(await client.state()).toEqual({ status: 'idle', results: {} });
    expect(await client.setup()).toEqual({ config: { project: '/p' }, playlists: { dir: '/d' } });
    expect(await client.action('playlist-select', { id: 'S1' })).toEqual({ status: 200, body: { got: { id: 'S1' } } });
    expect(seen).toEqual(['GET /api/state', 'GET /events?lite', 'POST /api/playlist-select']);
    player.closeAllConnections();
  });

  it('T13 3.9 a player that is not running fails fast', async () => {
    const client = httpPlayerClient(1, 500);
    await expect(client.state()).rejects.toThrow();
  });
});
