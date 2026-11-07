// T52, presentation mode, server side: the facts of a deck from git and the record (box
// gather-deck-facts), GET /api/present (box present-view) and the PDF printer (box print-deck-pdf).

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readZip, solidPng } from '@rehearse/core';
import { makeEpic } from '../../core/test/helpers.js';
import { approvedEpic, ME } from '../../core/test/trust/helpers.js';
import { inRepo, VERIFIER } from '../../core/test/trust/keys.js';
import { makeZip } from './zip.js';
import {
  brainstormIdea, buildDeckHtml, chromiumPrinter, execGit, gatherDeckFacts, NO_BIRDVIEW_DATA, newToken, NO_CHROMIUM, PrinterUnavailable, resultsFileOf, startServer, UncommittedError,
  type Printer, type RunningServer, type ServerSession,
} from '../src/index.js';

const UI = mkdtempSync(join(tmpdir(), 'rehearse-ui-'));
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=Ada', '-c', 'user.email=ada@x.y', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

/** The shop EPIC committed in a fresh repo (branch main), with a wide design picture linked to S1. */
function committedShop(approved = false): { dir: string; top: string } {
  const dir = inRepo(approved ? approvedEpic() : makeEpic());
  const top = dirname(dir);
  mkdirSync(join(top, 'design'));
  writeFileSync(join(top, 'design', 'links.yaml'), 'epics:\n  2026-11-05-shop:\n    S1:\n      file: design/shop.figcraft\n      page: 1\n      png: design/s1.png\n');
  writeFileSync(join(top, 'design', 'shop.figcraft'), 'x');
  writeFileSync(join(top, 'design', 's1.png'), solidPng(2400, 20, [10, 120, 200, 255]));
  writeFileSync(join(dir, 'brainstorm.md'), '# Shop\n\n## Idea\n\nPeople want to pay for a cart\nwithout calling us.\n\nGoals:\n- fast\n\n## Other\n\nno\n');
  git(top, 'checkout', '-q', '-b', 'main');
  git(top, 'add', '-A');
  git(top, 'commit', '-q', '-m', 'shop');
  git(top, 'commit', '-q', '--allow-empty', '-m', 'build cart\n\nFlow-Box: cart');
  return { dir, top };
}

const gitIn = (dir: string) => (args: string[]) => execGit(args, dir);
const NOW = () => new Date('2026-11-07T10:00:00Z');

const RAN = Date.parse('2026-11-06T09:00:00Z');

/** An e2e project with S1's tests, and a Birdview data folder with their saved runs and one recording. */
function savedRuns(top: string): { testProject: string; data: string } {
  const testProject = join(top, 'e2e');
  mkdirSync(join(testProject, 'tests'), { recursive: true });
  writeFileSync(join(testProject, 'tests', 'shop.spec.ts'), "test('S1-buy', async () => {});\ntest('S1-empty', async () => {});\n");
  const data = mkdtempSync(join(tmpdir(), 'rehearse-bv-'));
  writeFileSync(join(data, 'projects.json'), '{}');
  const results = resultsFileOf(data, testProject);
  mkdirSync(dirname(results), { recursive: true });
  // Written after the spec: the spec's titles are trusted as they are.
  writeFileSync(results, JSON.stringify({ 'tests/shop.spec.ts:1': { last: 'passed', at: Date.now() + 60_000 }, 'tests/shop.spec.ts:2': { last: 'failed', at: Date.now() + 60_000, failedStep: 'cart: the error is shown' }, 'tests/gone.spec.ts:4': { last: 'passed', at: RAN } }));
  const rec = join(data, 'recordings', '20261106-buy-passed');
  mkdirSync(rec, { recursive: true });
  writeFileSync(join(rec, 'about.json'), JSON.stringify({ file: 'tests/shop.spec.ts:1', status: 'passed', at: Date.now() + 50_000, ms: 5000 }));
  writeFileSync(join(rec, 'video.webm'), 'a video');
  writeFileSync(join(rec, 'trace.zip'), makeZip([{ name: 'resources/page@p-10.jpeg', data: 'jpeg bytes' }]));
  return { testProject, data };
}

describe('gatherDeckFacts', () => {
  it('reads branch, short sha, commit date, owner, Flow-Box commits, the idea and the design picture (≤1600 px)', async () => {
    const { dir, top } = committedShop();
    const { facts, assets } = await gatherDeckFacts({ epicDir: dir, repoTop: top, git: gitIn(dir), verifier: VERIFIER, now: NOW });
    const sha = git(top, 'rev-parse', '--short=7', 'HEAD').trim();
    expect(facts.commit).toEqual({ branch: 'main', sha, date: git(top, 'log', '-1', '--format=%cs').trim() });
    expect(facts.uncommitted).toBe(false);
    expect(facts.idea).toBe('People want to pay for a cart without calling us.');
    expect(facts.gate.ok).toBe(false);
    expect(facts.gate.items.length).toBeGreaterThan(0);
    expect(facts.stories.S1?.design?.asset).toBe('design-S1');
    expect(assets['design-S1']).toMatchObject({ mime: 'image/png', width: 1600 });
    // The Flow-Box commit on HEAD counts as code for the boxes of the stories it serves.
    expect(Object.values(facts.stories).some((s) => s.built > 0)).toBe(true);
    // No Birdview results asked for: every approved scenario's test is "not written" or "not run".
    expect(facts.testResults).toBe(false);
  });

  it('uncommitted record changes: a notice, today as the date; --committed-only refuses in plain words', async () => {
    const { dir, top } = committedShop();
    writeFileSync(join(dir, 'presentation.yaml'), 'asks: [Decide.]\n');
    const built = await buildDeckHtml({ epicDir: dir, repoTop: top, git: gitIn(dir), verifier: VERIFIER, now: NOW });
    expect(built.facts.uncommitted).toBe(true);
    expect(built.facts.commit.date).toBe('2026-11-07');
    expect(built.deck.footer).toMatch(/includes uncommitted changes$/);
    expect(built.deck.slides.some((s) => s.key === 'asks')).toBe(true);
    await expect(buildDeckHtml({ epicDir: dir, repoTop: top, git: gitIn(dir), verifier: VERIFIER, committedOnly: true })).rejects.toThrow(UncommittedError);
    await expect(buildDeckHtml({ epicDir: dir, repoTop: top, git: gitIn(dir), verifier: VERIFIER, committedOnly: true })).rejects.toThrow(/uncommitted changes.*Commit them first/s);
  });

  it('test results from Birdview mark scenarios passed or failed', async () => {
    const { dir, top } = committedShop();
    const { facts } = await gatherDeckFacts({ epicDir: dir, repoTop: top, git: gitIn(dir), verifier: VERIFIER, testResults: async () => ({}) });
    expect(facts.testResults).toBe(true);
  });

  it("no player results: Birdview's saved results, the recording's last screen and video, and the evidence", async () => {
    const { dir, top } = committedShop(true);
    const { testProject, data } = savedRuns(top);
    const built = await buildDeckHtml({ epicDir: dir, repoTop: top, git: gitIn(dir), verifier: VERIFIER, testProject, birdviewData: { dir: data, how: 'test' }, media: { folder: 'shop-media' }, now: NOW });
    const s1 = built.facts.stories.S1!;
    expect(s1.tests).toMatchObject({ 'S1-buy': 'passed', 'S1-empty': 'failed' });
    expect(s1.runs?.['S1-buy']).toMatchObject({ recorded: true, video: 'shop-media/20261106-buy-passed.webm', picture: 'run-S1-buy' });
    expect(s1.runs?.['S1-empty']).toMatchObject({ failedStep: 'cart: the error is shown' });
    expect(s1.runs?.['S1-empty']?.recorded).toBeUndefined();
    expect(built.html).toContain(`data:image/jpeg;base64,${Buffer.from('jpeg bytes').toString('base64')}`);
    expect(built.videos).toEqual([{ src: join(data, 'recordings', '20261106-buy-passed', 'video.webm'), name: '20261106-buy-passed.webm' }]);
    expect(built.facts.evidence?.e2e).toMatchObject({ source: 'saved', used: 2, dropped: 1 });
    expect(built.warnings.join(' ')).toMatch(/1 saved Birdview result left out/);
    expect(built.html).toContain('href="shop-media/20261106-buy-passed.webm"');
    expect(built.html).toContain('not written by hand');
  });

  it('without --with-recordings the deck links no video; a missing data folder is said, not fatal', async () => {
    const { dir, top } = committedShop(true);
    const { testProject, data } = savedRuns(top);
    const kept = await buildDeckHtml({ epicDir: dir, repoTop: top, git: gitIn(dir), verifier: VERIFIER, testProject, birdviewData: { dir: data, how: 'test' }, full: true, now: NOW });
    expect(kept.videos).toEqual([]);
    expect(kept.facts.stories.S1?.runs?.['S1-buy']?.video).toBeUndefined();
    expect(kept.html).toMatch(/recording kept by/);
    const none = await buildDeckHtml({ epicDir: dir, repoTop: top, git: gitIn(dir), verifier: VERIFIER, testProject, birdviewData: null, now: NOW });
    expect(none.facts.testResults).toBe(false);
    expect(none.warnings.join(' ')).toContain(NO_BIRDVIEW_DATA);
  });

  it('a unit report counts the tests naming the story; an unreadable one is a warning', async () => {
    const { dir, top } = committedShop();
    const report = join(top, 'unit.json');
    writeFileSync(report, JSON.stringify({ startTime: RAN, testResults: [{ assertionResults: [{ fullName: 'S1-buy works', status: 'passed' }, { fullName: 'S1-A1 holds', status: 'failed' }] }] }));
    const ok = await gatherDeckFacts({ epicDir: dir, repoTop: top, git: gitIn(dir), verifier: VERIFIER, unitReport: report, now: NOW });
    expect(ok.facts.evidence?.unit).toMatchObject({ file: 'unit.json', tests: 2, passed: 1, failed: 1 });
    expect(ok.facts.stories.S1?.unit).toEqual({ tests: 2, passed: 1, failed: 1 });
    const bad = await gatherDeckFacts({ epicDir: dir, repoTop: top, git: gitIn(dir), verifier: VERIFIER, unitReport: join(top, 'none.json'), now: NOW });
    expect(bad.facts.evidence?.unit?.why).toMatch(/unit report missing or unreadable/);
    expect(bad.warnings).toHaveLength(1);
  });

  it('brainstormIdea: the Idea section up to its first list or label line', () => {
    expect(brainstormIdea('## Idea\nOne.\nTwo.\n- a\n')).toBe('One. Two.');
    expect(brainstormIdea('## Other\nx\n')).toBeUndefined();
  });
});

describe('chromiumPrinter', () => {
  it('no Playwright in the repo: PrinterUnavailable, in plain words', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'rehearse-noplay-'));
    const printing = chromiumPrinter(empty)('<p>x</p>');
    await expect(printing).rejects.toThrow(PrinterUnavailable);
    await expect(chromiumPrinter(empty)('<p>x</p>')).rejects.toThrow(/Chromium is not available here.*print it to PDF/s);
  });
});

describe('GET /api/present', () => {
  async function serve(dir: string, printer?: Printer): Promise<{ url: string; token: string; origin: string }> {
    const session: ServerSession = { token: newToken(), identity: ME, signer: { ok: false, reason: 'no key in this test' } };
    running = await startServer({ epicDir: dir, uiDir: UI, port: 0, session, verifier: VERIFIER, birdview: { port: 9 }, ...(printer ? { printer } : {}) });
    return { url: running.url, token: session.token, origin: new URL(running.url).origin };
  }

  it('needs the token and a same-origin Origin; only GET', async () => {
    const { dir } = committedShop();
    const { url, token } = await serve(dir);
    expect((await fetch(new URL('api/present?epic=2026-11-05-shop', url))).status).toBe(403);
    expect((await fetch(new URL('api/present', url), { headers: { 'x-rehearse-token': 'wrong' } })).status).toBe(403);
    expect((await fetch(new URL('api/present', url), { headers: { 'x-rehearse-token': token, origin: 'http://evil.example' } })).status).toBe(403);
    expect((await fetch(new URL('api/present', url), { method: 'POST', headers: { 'x-rehearse-token': token } })).status).toBe(405);
  });

  it('returns the deck as one HTML file named <slug>-<date>-<sha>.html', async () => {
    const { dir, top } = committedShop();
    const { url, token, origin } = await serve(dir);
    const res = await fetch(new URL('api/present?epic=2026-11-05-shop', url), { headers: { 'x-rehearse-token': token, origin } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const sha = git(top, 'rev-parse', '--short=7', 'HEAD').trim();
    expect(res.headers.get('content-disposition')).toMatch(new RegExp(`filename="2026-11-05-shop-\\d{4}-\\d{2}-\\d{2}-${sha}\\.html"`));
    const html = await res.text();
    expect(html).toMatch(/^<!doctype html>/);
    expect(Number(res.headers.get('x-deck-slides'))).toBe(html.match(/<section class="slide/g)!.length);
  });

  it('full=1 returns the full deck: the summary, then the details story by story; the name ends in -full', async () => {
    const { dir } = committedShop();
    const { url, token, origin } = await serve(dir);
    const headers = { 'x-rehearse-token': token, origin };
    const summary = await fetch(new URL('api/present?epic=2026-11-05-shop', url), { headers });
    const full = await fetch(new URL('api/present?epic=2026-11-05-shop&full=1', url), { headers });
    expect(full.status).toBe(200);
    expect(full.headers.get('content-disposition')).toMatch(/-full\.html"$/);
    expect(summary.headers.get('content-disposition')).not.toMatch(/-full/);
    const short = Number(summary.headers.get('x-deck-slides'));
    expect(short).toBeLessThanOrEqual(6);
    expect(Number(full.headers.get('x-deck-slides'))).toBeGreaterThan(short);
    const html = await full.text();
    expect(html).toContain('Details, story by story');
    expect(await summary.text()).not.toContain('Details, story by story');
  });

  it('another EPIC is a 404; a bad format a 400', async () => {
    const { dir } = committedShop();
    const { url, token, origin } = await serve(dir);
    const other = await fetch(new URL('api/present?epic=2026-11-05-other', url), { headers: { 'x-rehearse-token': token, origin } });
    expect(other.status).toBe(404);
    expect(((await other.json()) as { error: string }).error).toMatch(/shows the EPIC 2026-11-05-shop/);
    expect((await fetch(new URL('api/present?format=doc', url), { headers: { 'x-rehearse-token': token, origin } })).status).toBe(400);
  });

  it('format=pdf prints the deck with the printer', async () => {
    const { dir } = committedShop();
    let printed = '';
    const { url, token, origin } = await serve(dir, async (html) => {
      printed = html;
      return new TextEncoder().encode('%PDF-1.7 fake');
    });
    const res = await fetch(new URL('api/present?epic=2026-11-05-shop&format=pdf', url), { headers: { 'x-rehearse-token': token, origin } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="2026-11-05-shop-.*\.pdf"$/);
    expect(await res.text()).toBe('%PDF-1.7 fake');
    expect(printed).toMatch(/^<!doctype html>/);
  });

  it('format=zip: the HTML and the media folder with the videos it links', async () => {
    const { dir, top } = committedShop(true);
    const { testProject, data } = savedRuns(top);
    const session: ServerSession = { token: newToken(), identity: ME, signer: { ok: false, reason: 'no key in this test' } };
    running = await startServer({ epicDir: dir, uiDir: UI, port: 0, session, verifier: VERIFIER, birdview: { port: 9, projectDir: testProject }, deckSources: async () => ({ birdviewData: { dir: data, how: 'test' } }) });
    const res = await fetch(new URL('api/present?format=zip', running.url), { headers: { 'x-rehearse-token': session.token, origin: new URL(running.url).origin } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    const name = /filename="(.+)\.zip"/.exec(res.headers.get('content-disposition') ?? '')![1]!;
    expect(res.headers.get('x-deck-videos')).toBe('1');
    const files = readZip(Buffer.from(await res.arrayBuffer()), { maxBytes: 10_000_000 });
    expect(files.map((f) => f.name)).toEqual([`${name}.html`, `${name}-media/20261106-buy-passed.webm`]);
    expect(files[0]!.data.toString()).toContain(`href="${name}-media/20261106-buy-passed.webm"`);
    expect(files[1]!.data.equals(readFileSync(join(data, 'recordings', '20261106-buy-passed', 'video.webm')))).toBe(true);
  });

  it('no Chromium: 503 with the plain words', async () => {
    const { dir } = committedShop();
    const { url, token, origin } = await serve(dir, async () => {
      throw new PrinterUnavailable(NO_CHROMIUM);
    });
    const res = await fetch(new URL('api/present?format=pdf', url), { headers: { 'x-rehearse-token': token, origin } });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: NO_CHROMIUM });
  });
});
