// T13 feature 2: `rehearse playlists` writes one Birdview playlist per story into the folder it
// is told (default <test project>/birdview/playlists), from tests named after scenario ids.
// T45: `--push` writes them through the Birdview player, and `rehearse play` plays a story; both
// against a fake player.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHOP } from '../../core/test/helpers.js';
import { main } from '../src/index.js';
import { runPlay } from '../src/commands/play.js';
import { runPlaylists } from '../src/commands/playlists.js';
import type { PlayerClient, PlayerReply } from '@rehearse/server';

function io(cwd: string) {
  const out = { stdout: '', stderr: '' };
  return { out, io: { cwd, stdout: (t: string) => (out.stdout += t), stderr: (t: string) => (out.stderr += t) } };
}

const SPEC = `import { test } from '@playwright/test';

test('S1-buy', async () => {
  await test.step('cart: Buyer checks out', async () => {});
  await test.step('pay: Shop charges', async () => {});
});
`;

function testProject(spec = SPEC): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'rehearse-pl-')), 'e2e');
  mkdirSync(join(dir, 'tests'), { recursive: true });
  writeFileSync(join(dir, 'playwright.config.ts'), 'export default {};\n');
  writeFileSync(join(dir, 'tests', 'shop.spec.ts'), spec);
  return dir;
}

describe('T13 2 rehearse playlists', () => {
  it('T13 2.6 writes <out>/<story>.json for each story with a test, and nothing else', async () => {
    const tests = testProject();
    const out = join(tests, 'out');
    const t = io(tests);
    expect(await main(['playlists', SHOP, '--tests', tests, '--out', out], t.io)).toBe(0);
    const playlist = JSON.parse(readFileSync(join(out, 'S1.json'), 'utf8'));
    expect(playlist.name).toBe('S1 · to pay for my cart');
    expect(playlist.tests).toHaveLength(1);
    expect(playlist.tests[0]).toMatchObject({ file: 'tests/shop.spec.ts', line: 3, name: 'S1-buy', steps: { 'cart: Buyer checks out': 'cart', 'pay: Shop charges': 'pay' } });
    expect(existsSync(join(out, 'S2.json'))).toBe(false);
    expect(t.out.stdout).toContain('S1.json: 1 test(s)');
  });

  it('T13 2.7 defaults to <test project>/birdview/playlists', async () => {
    const tests = testProject();
    expect(await main(['playlists', SHOP, '--tests', tests], io(tests).io)).toBe(0);
    expect(existsSync(join(tests, 'birdview', 'playlists', 'S1.json'))).toBe(true);
  });

  it('T13 2.8 exits 1 on a step whose box the scenario does not walk, or when no test names a scenario', async () => {
    const bad = testProject(SPEC.replace('pay: Shop charges', 'ship: Shop ships'));
    const t = io(bad);
    expect(await main(['playlists', SHOP, '--tests', bad], t.io)).toBe(1);
    expect(t.out.stderr).toContain('names ship');
    const none = testProject("import { test } from '@playwright/test';\ntest('unrelated', () => {});\n");
    const n = io(none);
    expect(await main(['playlists', SHOP, '--tests', none], n.io)).toBe(1);
    expect(n.out.stderr).toContain('no test');
  });

  it('T13 2.9 usage errors exit 2', async () => {
    const tests = testProject();
    for (const args of [[], ['--tests'], [SHOP, '--nope'], ['no-such-epic', '--tests', tests], [SHOP, '--push', '--out', tests], [SHOP, '--push', '--birdview-port', 'x']]) {
      expect(await main(['playlists', ...args], io(tests).io), args.join(' ')).toBe(2);
    }
  });
});

/** A fake Birdview player: it records each call and answers `replies[call]` when set. Never the real one. */
function fakePlayer(replies: Partial<Record<string, PlayerReply>> = {}) {
  const calls: { call: string; body?: unknown }[] = [];
  const reply = (call: string, body: unknown, ok: unknown): PlayerReply => {
    calls.push(body === undefined ? { call } : { call, body });
    return replies[call] ?? { status: 200, body: ok };
  };
  const client: PlayerClient = {
    state: async () => ({}),
    setup: async () => ({}),
    projects: async () => reply('projects', undefined, { default: { projectDir: '/elsewhere' } }),
    useProject: async (p) => reply('project', p, { active: p }),
    writePlaylist: async (pl) => reply('playlist', pl, { id: pl.name.toLowerCase().replace(/\W+/g, '-'), name: pl.name, tests: [] }),
    play: async (what) => reply('play', what, { status: 'running' }),
  };
  return { client, calls };
}

const DOWN: PlayerClient = {
  ...fakePlayer().client,
  useProject: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:3298')),
};

describe('T45 rehearse playlists --push', () => {
  it('T45 cli 1 switches Birdview to the test project, then writes each story playlist through it; nothing on disk', async () => {
    const tests = testProject();
    const fake = fakePlayer();
    const t = io(tests);
    expect(await runPlaylists([SHOP, '--tests', tests, '--push'], t.io, fake.client)).toBe(0);
    expect(fake.calls.map((c) => c.call)).toEqual(['project', 'playlist']);
    expect(fake.calls[0]!.body).toEqual({ projectDir: tests });
    expect(fake.calls[1]!.body).toMatchObject({ name: 'S1 · to pay for my cart', tests: [{ file: 'tests/shop.spec.ts', line: 3, name: 'S1-buy' }] });
    expect(existsSync(join(tests, 'birdview', 'playlists', 'S1.json'))).toBe(false);
    expect(t.out.stdout).toContain(`Birdview: ${tests}`);
    expect(t.out.stdout).toContain('S1: playlist S1 · to pay for my cart');
  });

  it('T45 cli 2 busy or not running: exit 1 in plain words, and no retry', async () => {
    const tests = testProject();
    const busy = fakePlayer({ project: { status: 409, body: { error: 'A test is running.' } } });
    const t = io(tests);
    expect(await runPlaylists([SHOP, '--tests', tests, '--push'], t.io, busy.client)).toBe(1);
    expect(t.out.stderr).toContain('Birdview is busy, try again.');
    expect(busy.calls.map((c) => c.call)).toEqual(['project']);
    const d = io(tests);
    expect(await runPlaylists([SHOP, '--tests', tests, '--push'], d.io, DOWN)).toBe(1);
    expect(d.out.stderr).toContain('Birdview is not running; open it from the bb sidebar.');
  });
});

describe('T45 rehearse play', () => {
  /** SHOP has no e2e/ above it: a copy of it with a test project beside it. */
  function shopRepo(): string {
    const tests = testProject();
    const epic = join(tests, '..', 'docs', 'epics', 'shop');
    cpSync(SHOP, epic, { recursive: true });
    return epic;
  }

  it('T45 cli 3 switches, writes the story playlist and plays it, in that order', async () => {
    const epic = shopRepo();
    const fake = fakePlayer();
    const t = io(epic);
    expect(await runPlay([epic, 'S1'], t.io, fake.client)).toBe(0);
    expect(fake.calls.map((c) => c.call)).toEqual(['project', 'playlist', 'play']);
    expect(fake.calls[2]!.body).toEqual({ playlist: 's1-to-pay-for-my-cart' });
    expect(t.out.stdout).toMatch(/^Birdview: .*e2e · playlist S1 · to pay for my cart \(1 test\)\nPlaying the playlist\.\n$/);
  });

  it('T45 cli 4 --test plays one test; --json prints the outcome', async () => {
    const epic = shopRepo();
    const fake = fakePlayer();
    const t = io(epic);
    expect(await runPlay([epic, 'S1', '--test', 'tests/shop.spec.ts:3', '--json'], t.io, fake.client)).toBe(0);
    expect(fake.calls[2]!.body).toEqual({ keys: ['tests/shop.spec.ts:3'] });
    expect(JSON.parse(t.out.stdout)).toMatchObject({ played: { keys: ['tests/shop.spec.ts:3'] }, playlist: { tests: 1 } });
  });

  it('T45 cli 5 exit codes: 1 busy, not running or no test; 2 usage or a test of another story', async () => {
    const epic = shopRepo();
    const busy = fakePlayer({ play: { status: 409, body: { error: 'Busy.' } } });
    const b = io(epic);
    expect(await runPlay([epic, 'S1'], b.io, busy.client)).toBe(1);
    expect(b.out.stderr).toBe('rehearse play: Birdview is busy, try again. (Busy)\n');
    const d = io(epic);
    expect(await runPlay([epic, 'S1'], d.io, DOWN)).toBe(1);
    expect(d.out.stderr).toBe('rehearse play: Birdview is not running; open it from the bb sidebar.\n');
    const none = fakePlayer();
    expect(await runPlay([epic, 'S2'], io(epic).io, none.client)).toBe(1);
    expect(await runPlay([epic, 'S1', '--test', 'tests/x.spec.ts:1'], io(epic).io, none.client)).toBe(2);
    expect(none.calls).toEqual([]);
    for (const args of [[], [epic], [epic, 'S1', '--test'], [epic, 'S1', '--test', 'nokey'], [epic, 'S1', '--nope'], ['no-such-epic', 'S1'], [epic, 'S1', '--birdview-port', '0']]) {
      expect(await runPlay(args, io(epic).io, none.client), args.join(' ')).toBe(2);
    }
    expect(await main(['play'], io(epic).io)).toBe(2);
  });
});
