// T58 (S23, boxes status-cli and status-text): `rehearse status <epic> [--json] [--not-done]` prints
// the Status table, the same facts as the deck and the UI's Status page, and exits 0.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StatusTable } from '@rehearse/core';
import { SHOP } from '../../core/test/helpers.js';
import { approvedEpic } from '../../core/test/trust/helpers.js';
import { runStatus } from '../src/commands/status.js';
import { main, USAGE } from '../src/index.js';

function io(cwd: string) {
  const out = { stdout: '', stderr: '' };
  return { out, io: { cwd, stdout: (t: string) => (out.stdout += t), stderr: (t: string) => (out.stderr += t) } };
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=Ada', '-c', 'user.email=ada@x.y', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

/** The shop EPIC committed on main; a commit builds the cart box. */
function repo(approved = false): { top: string; dir: string } {
  let top: string;
  let dir: string;
  if (approved) {
    dir = approvedEpic();
    top = join(dir, '..');
    git(top, 'checkout', '-q', '-b', 'main');
  } else {
    top = mkdtempSync(join(tmpdir(), 'rehearse-status-'));
    dir = join(top, 'docs', 'epics', '2026-11-05-shop');
    mkdirSync(dir, { recursive: true });
    cpSync(SHOP, dir, { recursive: true });
    git(top, 'init', '-q', '-b', 'main');
  }
  git(top, 'add', '-A');
  git(top, 'commit', '-q', '-m', 'shop');
  git(top, 'commit', '-q', '--allow-empty', '-m', 'build cart\n\nFlow-Box: cart');
  return { top, dir };
}

const deps = { birdview: false } as const;

describe('rehearse status', () => {
  it('prints the header, one row per story with its columns, and where the facts come from; exit 0', async () => {
    const { top, dir } = repo();
    const { out, io: o } = io(top);
    expect(await runStatus([dir], o, deps)).toBe(0);
    const text = out.stdout;
    expect(text).toMatch(/^.+ \(2026-11-05-shop\)\n0 of 2 stories done on the main path · 0 of \d+ scenarios? seen on the real screens · 2 not done\n/);
    expect(text).toMatch(/Story\s+Signed\s+Built\s+Real screens\s+Automated\s+Done\s+What's missing — who acts/);
    expect(text).toMatch(/^S1\s+no\s+/m);
    expect(text).toMatch(/^S2\s+no\s+/m);
    expect(text).toContain('not done');
    expect(text).toMatch(/: you/);
    expect(text).toContain('Where the facts come from:');
    expect(text).toMatch(/ {2}commit: main @ [0-9a-f]{7}, \d{4}-\d{2}-\d{2}\n/);
    expect(text).toContain('  built: code graph not built yet: "built" counts Flow-Box commits only');
    expect(text).toMatch(/ {2}automated tests: no unit report: /);
    expect(out.stderr).toBe('');
    // Read-only: no graph was made.
    expect(existsSync(join(top, '.rehearse', 'graph.db'))).toBe(false);
  });

  it('--json prints the table: header, counts, rows with built evidence, sources', async () => {
    const { top } = repo();
    const { out, io: o } = io(top);
    expect(await runStatus(['2026-11-05-shop', '--json'], o, deps)).toBe(0);
    const t = JSON.parse(out.stdout) as StatusTable & { filter: string };
    expect(t.filter).toBe('all');
    expect(t.counts).toMatchObject({ stories: 2, done: 0, notDone: 2 });
    expect(t.rows.map((r) => r.id)).toEqual(['S1', 'S2']);
    const cart = t.rows.find((r) => r.id === 'S1')!.built.evidence.find((e) => e.path === 'cart')!;
    expect(cart).toMatchObject({ state: 'built', text: 'built: 1 Flow-Box commit' });
    expect(Object.keys(t.sources).sort()).toEqual(['commit', 'e2e', 'graph', 'unit']);
  });

  it('--not-done keeps only the stories not done, and says so', async () => {
    const { top } = repo();
    const { out, io: o } = io(top);
    expect(await runStatus(['2026-11-05-shop', '--not-done'], o, deps)).toBe(0);
    expect(out.stdout).toContain('Showing the 2 stories not done.');
    const { out: j, io: oj } = io(top);
    expect(await runStatus(['2026-11-05-shop', '--not-done', '--json'], oj, deps)).toBe(0);
    const t = JSON.parse(j.stdout) as StatusTable & { filter: string };
    expect(t.filter).toBe('not-done');
    expect(t.rows.every((r) => r.done.state !== 'done')).toBe(true);
  });

  it('a story waiting for sign-off says the owner acts', async () => {
    const { top, dir } = repo(true);
    const { out, io: o } = io(top);
    expect(await runStatus([dir, '--json'], o, deps)).toBe(0);
    const t = JSON.parse(out.stdout) as StatusTable;
    expect(t.rows.find((r) => r.id === 'S1')!.missing).toContainEqual({ text: 'sign off', who: 'you', blocking: true });
  });

  it('usage errors exit 2', async () => {
    const { top } = repo();
    const { out, io: o } = io(top);
    expect(await runStatus([], o, deps)).toBe(2);
    expect(out.stderr).toContain('rehearse status: expected <epic-dir-or-slug>');
    expect(await runStatus(['2026-11-05-shop', '--bad'], o, deps)).toBe(2);
    expect(await runStatus(['2026-11-05-shop', '--unit-report'], o, deps)).toBe(2);
    expect(await runStatus(['2026-11-05-nope'], o, deps)).toBe(2);
  });

  it('is a command of main and in the usage', async () => {
    expect(USAGE).toContain('status <epic-dir-or-slug> [--json] [--not-done]');
    const { top } = repo();
    const { out, io: o } = io(top);
    expect(await main(['status', '2026-11-05-shop', '--not-done'], o)).toBe(0);
    expect(out.stdout).toContain('stories done');
  });
});
