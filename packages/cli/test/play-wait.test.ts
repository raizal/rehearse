// T48, box play-wait: `rehearse play … --wait` waits for the run to end, prints each result from
// Birdview's state and exits 0 when every test passed, 1 when one failed, the player stopped or the
// timeout ran out, 2 on a bad argument. Against a fake player whose state moves on each look; never
// the real one. And the root `pnpm rehearse` script runs the CLI.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SHOP } from '../../core/test/helpers.js';
import { runPlay } from '../src/commands/play.js';
import type { PlayerClient } from '@rehearse/server';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const KEY = 'tests/shop.spec.ts:3';

function io(cwd: string) {
  const out = { stdout: '', stderr: '' };
  return { out, io: { cwd, stdout: (t: string) => (out.stdout += t), stderr: (t: string) => (out.stderr += t) } };
}

/** A copy of the shop EPIC with a test project beside it, whose one test is S1-buy at line 3. */
function shopRepo(): { epic: string; tests: string } {
  const tests = join(mkdtempSync(join(tmpdir(), 'rehearse-wait-')), 'e2e');
  mkdirSync(join(tests, 'tests'), { recursive: true });
  writeFileSync(join(tests, 'playwright.config.ts'), 'export default {};\n');
  writeFileSync(join(tests, 'tests', 'shop.spec.ts'), "import { test } from '@playwright/test';\n\ntest('S1-buy', async () => {\n  await test.step('cart: Buyer checks out', async () => {});\n});\n");
  const epic = join(tests, '..', 'docs', 'epics', 'shop');
  cpSync(SHOP, epic, { recursive: true });
  return { epic, tests };
}

/**
 * A fake player: `states` are what /api/state answers, one per look (the last one repeats). The
 * first look is the one before the play. It records how often it was played.
 */
function fakePlayer(project: string, states: unknown[]) {
  let look = 0;
  const played: unknown[] = [];
  const client: PlayerClient = {
    state: async () => {
      const s = states[Math.min(look, states.length - 1)];
      look += 1;
      return typeof s === 'function' ? (s as () => unknown)() : s;
    },
    setup: async () => ({}),
    projects: async () => ({ status: 200, body: {} }),
    useProject: async (p) => ({ status: 200, body: { active: p } }),
    writePlaylist: async (pl) => ({ status: 200, body: { id: 's1', name: pl.name } }),
    play: async (what) => {
      played.push(what);
      return { status: 200, body: { status: 'running', project: { projectDir: project } } };
    },
  };
  return { client, played, looks: () => look };
}

/** A clock that moves only when the wait sleeps. */
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

const state = (project: string, status: string, result?: Record<string, unknown>) => ({ status, project: { projectDir: project }, results: result ? { [KEY]: result } : {} });

describe('T48 rehearse play --wait (box play-wait)', () => {
  it('waits for a result newer than the one before the play, prints passed <key> (<name>) and exits 0', async () => {
    const { epic, tests } = shopRepo();
    const old = { last: 'failed', at: 100, reason: 'old run' };
    const fake = fakePlayer(tests, [
      state(tests, 'idle', old), // before the play
      state(tests, 'running', old),
      state(tests, 'running', old),
      state(tests, 'idle', { last: 'passed', at: 200 }),
    ]);
    const t = io(epic);
    expect(await runPlay([epic, 'S1', '--test', KEY, '--wait'], t.io, fake.client, fakeClock())).toBe(0);
    expect(t.out.stdout).toContain(`passed ${KEY} (S1-buy)\n`);
    expect(t.out.stderr).toBe('');
    expect(fake.played).toEqual([{ keys: [KEY] }]);
  });

  it('a failed test prints its step and reason and exits 1; --json has the results', async () => {
    const { epic, tests } = shopRepo();
    const fake = fakePlayer(tests, [state(tests, 'idle'), state(tests, 'idle', { last: 'failed', at: 5, failedStep: 'cart: Buyer checks out', reason: 'no button' })]);
    const t = io(epic);
    expect(await runPlay([epic, 'S1', '--wait'], t.io, fake.client, fakeClock())).toBe(1);
    expect(t.out.stdout).toContain(`failed ${KEY} (S1-buy) at step "cart: Buyer checks out": no button\n`);
    // The whole playlist was played and waited for.
    expect(fake.played).toEqual([{ playlist: 's1' }]);
    const j = io(epic);
    const again = fakePlayer(tests, [state(tests, 'idle'), state(tests, 'idle', { last: 'passed', at: 5 })]);
    expect(await runPlay([epic, 'S1', '--wait', '--json'], j.io, again.client, fakeClock())).toBe(0);
    expect(JSON.parse(j.out.stdout)).toMatchObject({ passed: true, results: [{ key: KEY, name: 'S1-buy', last: 'passed' }] });
  });

  it('the timeout runs out while the test still runs: exit 1, and it never plays again', async () => {
    const { epic, tests } = shopRepo();
    const fake = fakePlayer(tests, [state(tests, 'running')]);
    const t = io(epic);
    expect(await runPlay([epic, 'S1', '--test', KEY, '--wait', '--timeout', '5'], t.io, fake.client, fakeClock())).toBe(1);
    expect(t.out.stdout).toContain(`no result ${KEY} (S1-buy): still running when the wait ran out\n`);
    expect(fake.played).toHaveLength(1);
    expect(fake.looks()).toBeGreaterThan(3);
  });

  it('the player stands idle with no new result, or switches to another project: exit 1 in plain words', async () => {
    const { epic, tests } = shopRepo();
    const idle = fakePlayer(tests, [state(tests, 'idle')]);
    const i = io(epic);
    expect(await runPlay([epic, 'S1', '--wait'], i.io, idle.client, fakeClock())).toBe(1);
    expect(i.out.stdout).toContain('Birdview stopped before it ended');
    const other = fakePlayer(tests, [state(tests, 'idle'), state('/somewhere/else', 'running')]);
    const o = io(epic);
    expect(await runPlay([epic, 'S1', '--wait'], o.io, other.client, fakeClock())).toBe(1);
    expect(o.out.stderr).toBe('rehearse play: Birdview switched to another project (/somewhere/else) before the tests ended; play them again.\n');
  });

  it('bad arguments exit 2 and play nothing: --timeout without --wait, or not a number of seconds', async () => {
    const { epic, tests } = shopRepo();
    const fake = fakePlayer(tests, [state(tests, 'idle')]);
    for (const args of [[epic, 'S1', '--timeout', '5'], [epic, 'S1', '--wait', '--timeout'], [epic, 'S1', '--wait', '--timeout', '0'], [epic, 'S1', '--wait', '--timeout', 'soon']]) {
      expect(await runPlay(args, io(epic).io, fake.client, fakeClock()), args.join(' ')).toBe(2);
    }
    expect(fake.played).toEqual([]);
  });
});

describe('T48 the root pnpm rehearse script', () => {
  it('names the CLI entry, and running it prints the usage with play --wait', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.rehearse).toBe('node packages/cli/bin/rehearse.js');
    const r = spawnSync('pnpm', ['-s', 'rehearse', '--help'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('Usage: rehearse <command> [options]');
    expect(r.stdout).toContain('[--wait [--timeout <seconds>]]');
  });
});
