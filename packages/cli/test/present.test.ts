// T52, `rehearse present` (box present-cli): the deck file and its default path, --pdf with a fake
// printer and without Chromium, --committed-only, and the usage errors. T53: --with-recordings copies
// the videos the deck links (box copy-recordings), --unit-report, and their exit codes.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PrinterUnavailable, NO_CHROMIUM, resultsFileOf } from '@rehearse/server';
import { SHOP } from '../../core/test/helpers.js';
import { approvedEpic } from '../../core/test/trust/helpers.js';
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

/**
 * The shop with its scenarios approved, committed; an e2e project with S1's tests; a Birdview data
 * folder where S1-buy passed with a recording, S1-empty failed with one, and another test's recording
 * that the deck does not link.
 */
function withRuns(): { top: string; dir: string; data: string } {
  const dir = approvedEpic();
  const top = join(dir, '..');
  const e2e = join(top, 'e2e');
  mkdirSync(join(e2e, 'tests'), { recursive: true });
  writeFileSync(join(e2e, 'playwright.config.ts'), 'export default {};\n');
  writeFileSync(join(e2e, 'tests', 'shop.spec.ts'), "test('S1-buy', async () => {});\ntest('S1-empty', async () => {});\n");
  git(top, 'checkout', '-q', '-b', 'main');
  git(top, 'add', '-A');
  git(top, 'commit', '-q', '-m', 'shop');
  const data = mkdtempSync(join(tmpdir(), 'rehearse-bv-'));
  writeFileSync(join(data, 'projects.json'), '{}');
  const results = resultsFileOf(data, e2e);
  mkdirSync(join(results, '..'), { recursive: true });
  const at = Date.now() + 60_000;
  writeFileSync(results, JSON.stringify({ 'tests/shop.spec.ts:1': { last: 'passed', at }, 'tests/shop.spec.ts:2': { last: 'failed', at, failedStep: 'cart: the error is shown' } }));
  const recording = (name: string, about: object, video: string) => {
    mkdirSync(join(data, 'recordings', name), { recursive: true });
    writeFileSync(join(data, 'recordings', name, 'about.json'), JSON.stringify(about));
    writeFileSync(join(data, 'recordings', name, video), `video of ${name}`);
  };
  recording('1-buy-passed', { file: 'tests/shop.spec.ts:1', status: 'passed', at: at - 5000, ms: 3000 }, 'video.webm');
  recording('2-empty-failed', { file: 'tests/shop.spec.ts:2', status: 'failed', at: at - 5000, ms: 3000 }, 'video.mp4');
  recording('3-other-passed', { file: 'tests/other.spec.ts:9', status: 'passed', at: at - 5000, ms: 3000 }, 'video.webm');
  return { top, dir, data };
}

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

  it('--with-recordings <dir>: the deck and only the videos it links, in <dir>/<deck>-media/', async () => {
    const { top, data } = withRuns();
    const { out, io: x } = io(top);
    expect(await runPresent(['2026-11-05-shop', '--with-recordings', 'share', '--out', 'share/deck.html', '--birdview-data', data], x, deps)).toBe(0);
    expect(readdirSync(join(top, 'share', 'deck-media')).sort()).toEqual(['1-buy-passed.webm', '2-empty-failed.mp4']);
    expect(readFileSync(join(top, 'share', 'deck-media', '2-empty-failed.mp4'), 'utf8')).toBe('video of 2-empty-failed');
    const html = readFileSync(join(top, 'share', 'deck.html'), 'utf8');
    expect(html).toContain('href="deck-media/1-buy-passed.webm"');
    expect(html).toContain('href="deck-media/2-empty-failed.mp4"');
    expect(html).not.toContain('3-other-passed');
    expect(out.stdout).toMatch(/share\/deck-media\/ {2}2 videos, 1 KB/);
  });

  it('--with-recordings without --out names the deck in <dir>; no recording: it says so', async () => {
    const { top } = withRuns();
    const { out, io: x } = io(top);
    expect(await runPresent(['2026-11-05-shop', '--with-recordings', 'share'], x, deps)).toBe(0);
    expect(readdirSync(join(top, 'share')).filter((f) => f.endsWith('.html'))).toHaveLength(1);
    expect(existsSync(join(top, 'share', 'deck-media'))).toBe(false);
    expect(out.stdout).toContain('no recording of these tests to copy; the deck says so');
  });

  it('without --with-recordings the deck says who keeps the recording, and copies nothing', async () => {
    const { top, data } = withRuns();
    const { io: x } = io(top);
    expect(await runPresent(['2026-11-05-shop', '--out', 'd.html', '--birdview-data', data], x, deps)).toBe(0);
    expect(readFileSync(join(top, 'd.html'), 'utf8')).toMatch(/recording kept by/);
    expect(existsSync(join(top, 'd-media'))).toBe(false);
  });

  it('--unit-report: counted in the deck; unreadable is exit 1 with the deck still written', async () => {
    const { top } = repo();
    writeFileSync(join(top, 'unit.json'), JSON.stringify({ startTime: Date.parse('2026-11-06T09:00:00Z'), testResults: [{ assertionResults: [{ fullName: 'S1-buy works', status: 'passed' }] }] }));
    const good = io(top);
    expect(await runPresent(['2026-11-05-shop', '--out', 'a.html', '--unit-report', 'unit.json'], good.io, deps)).toBe(0);
    expect(readFileSync(join(top, 'a.html'), 'utf8')).toContain('unit.json');
    writeFileSync(join(top, 'bad.json'), 'not json');
    const bad = io(top);
    expect(await runPresent(['2026-11-05-shop', '--out', 'b.html', '--unit-report', 'bad.json'], bad.io, deps)).toBe(1);
    expect(bad.out.stderr).toMatch(/unit report missing or unreadable: .*bad\.json is not JSON/);
    expect(existsSync(join(top, 'b.html'))).toBe(true);
  });

  it('usage errors exit 2', async () => {
    const { top } = repo();
    for (const args of [[], ['a', 'b'], ['2026-11-05-shop', '--out'], ['2026-11-05-shop', '--nope'], ['no-such-epic'], ['2026-11-05-shop', '--with-recordings', 'share', '--out', 'elsewhere/d.html'], ['2026-11-05-shop', '--unit-report'], ['2026-11-05-shop', '--with-recordings', '--out', 'd.html']]) {
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
