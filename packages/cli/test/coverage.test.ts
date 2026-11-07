// `rehearse coverage` (code-graph EPIC S12): the numbers of a file, a function and a box from the
// repo's coverage/lcov.info, the lines not run, the tests that call it, and the no-data line.
// The repo is a git copy of packages/graph/test/fixtures/shop.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { badgeText } from '../src/commands/coverage.js';

const SHOP = fileURLToPath(new URL('../../graph/test/fixtures/shop', import.meta.url));

async function cli(args: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(args, { cwd, stdout: (t) => (out += t), stderr: (t) => (err += t) });
  return { code, out, err };
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });

/** charge runs lines 10-12 and 17-30, never 13-16; getOrderById (orders.ts) runs in full. */
const LCOV = [
  'TN:', 'SF:src/pay.ts', 'FN:10,30,charge', 'FNDA:2,charge',
  ...Array.from({ length: 21 }, (_, i) => i + 10).map((n) => `DA:${n},${n >= 13 && n <= 16 ? 0 : 2}`),
  'BRDA:11,0,0,2', 'BRDA:11,0,1,-', 'end_of_record', '',
].join('\n');

function shopRepo(lcov: boolean): string {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'rehearse-cli-coverage-'))), 'shop');
  cpSync(SHOP, dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'shop');
  if (lcov) {
    mkdirSync(join(dir, 'coverage'));
    writeFileSync(join(dir, 'coverage/lcov.info'), LCOV);
    // The coverage was written after the code.
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(dir, 'coverage/lcov.info'), later, later);
  }
  return dir;
}

let repo: string;
beforeAll(() => {
  repo = shopRepo(true);
});

describe('rehearse coverage', () => {
  it('S12-A6 a function: its badge, its lines and branches, and the lines not run', async () => {
    const { code, out } = await cli(['coverage', 'charge'], repo);
    expect(code).toBe(0);
    expect(out).toContain('node charge: 80% · 0 tests');
    expect(out).toContain('lines 17/21, branches 1/2');
    expect(out).toMatch(/charge {2}src\/pay\.ts:10-\d+ {2}not run: 13-16/);
    expect(out).not.toContain('older than this code');
  });

  it('S12-A6 a file lists its code, least covered first; --json gives the same numbers', async () => {
    const { code, out } = await cli(['coverage', 'src/pay.ts'], repo);
    expect(code).toBe(0);
    expect(out).toContain('file src/pay.ts: 80%');
    expect(out).toContain('Code, least covered first:');
    const json = JSON.parse((await cli(['coverage', 'src/pay.ts', '--json'], repo)).out);
    expect(json).toMatchObject({ ok: true, kind: 'file', stats: { lines: 21, covered: 17, percent: 80 } });
    expect(json.entries[0]).toMatchObject({ name: 'charge', uncovered: ['13-16'] });
  });

  it('S12-A3 tested by: the test that calls getOrderById', async () => {
    const lines = ['TN:', 'SF:src/orders.ts', ...Array.from({ length: 12 }, (_, i) => `DA:${i + 9},1`), 'end_of_record', ''].join('\n');
    const extra = join(repo, 'orders.lcov');
    writeFileSync(extra, lines);
    const { code, out } = await cli(['coverage', 'getOrderById', '--lcov', 'orders.lcov'], repo);
    rmSync(extra);
    expect(code).toBe(0);
    expect(out).toContain('Tested by:');
    expect(out).toMatch(/reads one order by its id {2}src\/orders\.test\.ts:\d+-\d+ {2}calls it/);
  });

  it('S12-A1 a box with no builds edge: the code of the files of its Flow-Box commits', async () => {
    const dir = shopRepo(true);
    const epic = join(dir, 'docs/epics/2026-01-01-shop');
    mkdirSync(epic, { recursive: true });
    writeFileSync(join(epic, 'flow.yaml'), 'version: 1\nepic: 2026-01-01-shop\nroot:\n  boxes:\n    - { id: pay, kind: process, title: Pay }\n  edges: []\n');
    git(dir, 'add', '-A');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'the pay box');
    writeFileSync(join(dir, 'src/pay.ts'), `${readFileSync(join(dir, 'src/pay.ts'), 'utf8')}\n`);
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'pay\n\nFlow-Box: pay');
    const { code, out } = await cli(['coverage', 'box pay'], dir);
    expect(code).toBe(0);
    expect(out).toContain('box pay: 80%');
    expect(out).toMatch(/charge {2}src\/pay\.ts:10-\d+ {2}not run: 13-16/);
  });

  it('S12-A4 coverage older than the code says so', async () => {
    const dir = shopRepo(true);
    const later = new Date(Date.now() + 120_000);
    utimesSync(join(dir, 'src/pay.ts'), later, later);
    const { out } = await cli(['coverage', 'charge'], dir);
    expect(out).toContain('coverage is older than this code; run the tests again');
  });

  it('S12-A5 no coverage file: the plain line on how to make one, exit 0', async () => {
    const { code, out } = await cli(['coverage', 'charge'], shopRepo(false));
    expect(code).toBe(0);
    expect(out).toContain('node charge: no coverage data');
    expect(out).toContain('No coverage file yet.');
    expect(out).toContain('coverage lcov');
  });

  it('S12-A6 not found exits 1; no target is a usage error', async () => {
    const nf = await cli(['coverage', 'nothingLikeThis'], repo);
    expect(nf.code).toBe(1);
    expect(nf.err).toContain('rehearse coverage: not found: nothingLikeThis');
    expect((await cli(['coverage'], repo)).code).toBe(2);
    expect((await cli(['coverage', 'charge', '--lcov'], repo)).code).toBe(2);
  });

  it('the badge text', () => {
    expect(badgeText({ lines: 10, covered: 7, branches: 0, branchesCovered: 0, percent: 72, tests: 3, stale: false })).toBe('72% · 3 tests');
    expect(badgeText({ lines: 10, covered: 7, branches: 0, branchesCovered: 0, percent: 70, tests: 1, stale: false })).toBe('70% · 1 test');
    expect(badgeText({ lines: 0, covered: 0, branches: 0, branchesCovered: 0, percent: null, tests: 0, stale: false })).toBe('no coverage data');
  });
});
