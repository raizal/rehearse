// T52, `rehearse present` (box present-cli): the deck file and its default path, --pdf with a fake
// printer and without Chromium, --committed-only, and the usage errors.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PrinterUnavailable, NO_CHROMIUM } from '@rehearse/server';
import { SHOP } from '../../core/test/helpers.js';
import { runPresent } from '../src/commands/present.js';
import { main, USAGE } from '../src/index.js';

function io(cwd: string) {
  const out = { stdout: '', stderr: '' };
  return { out, io: { cwd, stdout: (t: string) => (out.stdout += t), stderr: (t: string) => (out.stderr += t) } };
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=Ada', '-c', 'user.email=ada@x.y', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

/** A repo with the shop EPIC at docs/epics/2026-11-05-shop, committed on main. */
function repo(): { top: string; dir: string; sha: string; date: string } {
  const top = mkdtempSync(join(tmpdir(), 'rehearse-present-'));
  const dir = join(top, 'docs', 'epics', '2026-11-05-shop');
  mkdirSync(dir, { recursive: true });
  cpSync(SHOP, dir, { recursive: true });
  git(top, 'init', '-q', '-b', 'main');
  git(top, 'add', '-A');
  git(top, 'commit', '-q', '-m', 'shop');
  return { top, dir, sha: git(top, 'rev-parse', '--short=7', 'HEAD').trim(), date: git(top, 'log', '-1', '--format=%cs').trim() };
}

const deps = { birdview: false } as const;

describe('rehearse present', () => {
  it('writes presentations/<slug>-<date>-<sha>.html at the git top and prints its slides and size', async () => {
    const { top, sha, date } = repo();
    const { out, io: x } = io(top);
    expect(await runPresent(['2026-11-05-shop'], x, deps)).toBe(0);
    const file = join(top, 'presentations', `2026-11-05-shop-${date}-${sha}.html`);
    expect(existsSync(file)).toBe(true);
    const html = readFileSync(file, 'utf8');
    const slides = html.match(/<section class="slide/g)!.length;
    expect(out.stdout).toMatch(new RegExp(`^presentations/2026-11-05-shop-${date}-${sha}\\.html  ${slides} slides, \\d+ KB\\n$`));
    expect(out.stderr).toBe('');
  });

  it('--out writes where it is told', async () => {
    const { top } = repo();
    const { io: x } = io(top);
    expect(await runPresent(['docs/epics/2026-11-05-shop', '--out', 'deck/my.html'], x, deps)).toBe(0);
    expect(readFileSync(join(top, 'deck', 'my.html'), 'utf8')).toMatch(/^<!doctype html>/);
  });

  it('--pdf prints with the printer', async () => {
    const { top } = repo();
    const { out, io: x } = io(top);
    const printer = async (html: string) => new TextEncoder().encode(`%PDF ${html.length}`);
    expect(await runPresent(['2026-11-05-shop', '--out', 'd.html', '--pdf', 'd.pdf'], x, { ...deps, printer })).toBe(0);
    expect(readFileSync(join(top, 'd.pdf'), 'utf8')).toMatch(/^%PDF \d+$/);
    expect(out.stdout).toMatch(/d\.pdf {2}\d+ pages/);
  });

  it('--pdf without Chromium: exit 1, plain words, and the HTML is still written', async () => {
    const { top } = repo();
    const { out, io: x } = io(top);
    const printer = async (): Promise<Uint8Array> => {
      throw new PrinterUnavailable(NO_CHROMIUM);
    };
    expect(await runPresent(['2026-11-05-shop', '--out', 'd.html', '--pdf', 'd.pdf'], x, { ...deps, printer })).toBe(1);
    expect(out.stderr).toContain('Chromium is not available here');
    expect(out.stderr).toContain('open d.html in a browser and print it');
    expect(existsSync(join(top, 'd.html'))).toBe(true);
    expect(existsSync(join(top, 'd.pdf'))).toBe(false);
  });

  it('uncommitted record changes: a notice by default; --committed-only refuses with exit 1 and writes nothing', async () => {
    const { top, dir } = repo();
    writeFileSync(join(dir, 'presentation.yaml'), 'asks: [Decide.]\nhide: [S9]\n');
    const a = io(top);
    expect(await runPresent(['2026-11-05-shop', '--out', 'a.html'], a.io, deps)).toBe(0);
    expect(a.out.stderr).toContain('uncommitted changes; the deck says so on every slide');
    expect(a.out.stderr).toContain('presentation.yaml: unknown story S9 in hide (left out of the deck)');
    expect(readFileSync(join(top, 'a.html'), 'utf8')).toContain('includes uncommitted changes');
    const b = io(top);
    expect(await runPresent(['2026-11-05-shop', '--out', 'b.html', '--committed-only'], b.io, deps)).toBe(1);
    expect(b.out.stderr).toMatch(/^rehearse present: no deck: the EPIC folder has uncommitted changes/);
    expect(existsSync(join(top, 'b.html'))).toBe(false);
  });

  it('usage errors exit 2', async () => {
    const { top } = repo();
    for (const args of [[], ['a', 'b'], ['2026-11-05-shop', '--out'], ['2026-11-05-shop', '--nope'], ['no-such-epic']]) {
      const { io: x } = io(top);
      expect(await runPresent(args, x, deps), args.join(' ')).toBe(2);
    }
  });

  it('is a command of main and in the usage text', async () => {
    expect(USAGE).toContain('present <epic-dir-or-slug> [--out <file.html>] [--pdf <file.pdf>] [--committed-only]');
    const { top } = repo();
    const { io: x } = io(top);
    expect(await main(['present'], x)).toBe(2);
  });
});
