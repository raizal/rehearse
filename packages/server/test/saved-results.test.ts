// T53, the proof behind a deck: Birdview's saved results and recordings (box read-saved-test-results),
// the last screen of a run (box last-screen-picture), the unit report (box read-unit-report) and the
// zip of a deck with its recordings (box download-with-recordings). Fixtures only; never Birdview's folder.

import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readZip } from '@rehearse/core';
import {
  findBirdviewData, globRegExp, lastScreen, lastTraceFrame, NO_TEST_FILES, parseSpec, parseUnitReport, readRecordings, readSavedResults, readTestPaths, readUnitReport,
  recordingOf, resultsFileOf, UNIT_REPORT_UNREADABLE, UnitReportError, unitCount, unitTestsOfEpic, writeZip, type SpecAt,
} from '../src/index.js';
import { makeZip } from './zip.js';

const T0 = Date.parse('2026-11-06T10:00:00Z');

const SPEC_NOW = [
  "import { test } from '@playwright/test';",
  '',
  "test('S1-pay: a person pays for the cart', async () => {});",
  '',
  "test('S1-empty: an empty cart cannot be paid', async () => {});",
  "test('S4-new: a new story', async () => {});",
  '',
].join('\n');

/** The spec as it was before two lines were added above the tests. */
const SPEC_BEFORE = [
  "import { test } from '@playwright/test';",
  "test('S1-pay: a person pays for the cart', async () => {});",
  "test('S1-empty: an empty cart cannot be paid', async () => {});",
  "test('S9-gone: a test that was removed', async () => {});",
].join('\n');

/** A data folder, a main checkout's e2e and a worktree's e2e, the spec written now (after the runs). */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rehearse-bv-'));
  const data = join(root, 'data');
  const main = join(root, 'main', 'e2e');
  const worktree = join(root, 'wt', 'e2e');
  for (const p of [data, join(main, 'tests'), join(worktree, 'tests')]) mkdirSync(p, { recursive: true });
  for (const p of [main, worktree]) writeFileSync(join(p, 'tests', 'shop.spec.ts'), SPEC_NOW);
  writeFileSync(join(data, 'projects.json'), JSON.stringify({ defaultDir: join(root, 'other'), active: main }));
  const tests = parseSpec('tests/shop.spec.ts', SPEC_NOW);
  return { root, data, main, worktree, tests };
}

function saveResults(dataDir: string, project: string, results: Record<string, unknown>) {
  const file = resultsFileOf(dataDir, project);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(results));
  return file;
}

function saveRecording(dataDir: string, name: string, about: Record<string, unknown>, files: Record<string, string | Buffer>) {
  const dir = join(dataDir, 'recordings', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'about.json'), JSON.stringify(about));
  for (const [f, body] of Object.entries(files)) writeFileSync(join(dir, f), body);
  return dir;
}

const specBefore: SpecAt = async (_dir, file) => (file === 'tests/shop.spec.ts' ? SPEC_BEFORE : undefined);

describe('findBirdviewData', () => {
  it('the option, then REHEARSE_BIRDVIEW_DATA, then the plugin setting, then the default place; a folder without projects is not found', () => {
    const { root, data } = fixture();
    const empty = mkdtempSync(join(tmpdir(), 'rehearse-empty-'));
    expect(findBirdviewData({ explicit: data })).toEqual({ dir: data, how: '--birdview-data' });
    expect(findBirdviewData({ explicit: empty, env: { REHEARSE_BIRDVIEW_DATA: data } })).toBeUndefined();
    expect(findBirdviewData({ env: { REHEARSE_BIRDVIEW_DATA: data }, home: empty })).toMatchObject({ dir: data, how: 'REHEARSE_BIRDVIEW_DATA' });
    expect(findBirdviewData({ env: {}, pluginConfig: () => JSON.stringify({ values: { dataDir: data } }), home: empty })).toMatchObject({ dir: data });
    expect(findBirdviewData({ env: {}, pluginConfig: () => 'not json', home: empty })).toBeUndefined();
    const home = join(root, 'home');
    mkdirSync(join(home, '.bb', 'plugins', 'birdview-e2e'), { recursive: true });
    writeFileSync(join(home, '.bb', 'plugins', 'birdview-e2e', 'results.json'), '{}');
    expect(findBirdviewData({ env: {}, pluginConfig: () => undefined, home })).toMatchObject({ how: 'the default place' });
    expect(findBirdviewData({ env: {}, pluginConfig: () => undefined, home: empty })).toBeUndefined();
  });

  it("names a project's results file like Birdview: name-hash, results.json for the default project", () => {
    const { data, main } = fixture();
    expect(resultsFileOf(data, main)).toMatch(/projects\/e2e-[0-9a-f]{8}\/results\.json$/);
    expect(resultsFileOf(data, main, main)).toBe(join(data, 'results.json'));
  });
});

describe('readSavedResults', () => {
  it('no saved file for our project or the main one: undefined (the deck says "not run")', async () => {
    const { data, worktree, main, tests } = fixture();
    expect(await readSavedResults({ data: { dir: data, how: 'x' }, testProject: worktree, mainProject: main, tests })).toBeUndefined();
  });

  it("our checkout's own file comes first", async () => {
    const { data, worktree, main, tests } = fixture();
    saveResults(data, main, { 'tests/shop.spec.ts:3': { last: 'failed', at: T0 } });
    saveResults(data, worktree, { 'tests/shop.spec.ts:3': { last: 'passed', at: T0 } });
    utimesSync(join(worktree, 'tests', 'shop.spec.ts'), new Date(T0 - 1000), new Date(T0 - 1000));
    const saved = await readSavedResults({ data: { dir: data, how: 'x' }, testProject: worktree, mainProject: main, tests });
    expect(saved?.project).toBe(worktree);
    expect(saved?.note).toBe("this checkout's own test project");
    expect(saved?.runs['tests/shop.spec.ts:3']?.result.last).toBe('passed');
  });

  it("falls back to the main checkout's file; moved lines match by title, stale and unknown keys are dropped and counted", async () => {
    const { data, worktree, main, tests } = fixture();
    // The spec on disk is newer than every run, so titles come from git's copy (SPEC_BEFORE).
    const file = join(main, 'tests', 'shop.spec.ts');
    utimesSync(file, new Date(T0 + 3_600_000), new Date(T0 + 3_600_000));
    const saved0 = saveResults(data, main, {
      'tests/shop.spec.ts:2': { last: 'passed', at: T0 }, // S1-pay, now line 3
      'tests/shop.spec.ts:3': { last: 'failed', at: T0 + 1000, failedStep: 'cart: the total is shown', reason: 'timeout' }, // S1-empty, now line 5
      'tests/shop.spec.ts:4': { last: 'passed', at: T0 }, // S9-gone: no such test now
      'tests/other.spec.ts:9': { last: 'passed', at: T0 }, // unknown file
      'tests/shop.spec.ts:77': { at: T0 }, // no outcome
    });
    const saved = await readSavedResults({ data: { dir: data, how: 'x' }, testProject: worktree, mainProject: main, tests, specAt: specBefore });
    expect(saved?.file).toBe(saved0);
    expect(saved?.project).toBe(main);
    expect(saved?.note).toMatch(/main checkout/);
    expect(Object.keys(saved?.runs ?? {}).sort()).toEqual(['tests/shop.spec.ts:3', 'tests/shop.spec.ts:5']);
    expect(saved?.runs['tests/shop.spec.ts:3']).toMatchObject({ savedKey: 'tests/shop.spec.ts:2', result: { last: 'passed' } });
    expect(saved?.runs['tests/shop.spec.ts:5']).toMatchObject({ savedKey: 'tests/shop.spec.ts:3', result: { last: 'failed', failedStep: 'cart: the total is shown', reason: 'timeout' } });
    expect(saved).toMatchObject({ used: 2, dropped: 3, older: 0, oldest: T0, newest: T0 + 1000 });
  });

  it('without git, a spec that changed after the run cannot be trusted: its keys are dropped', async () => {
    const { data, worktree, main, tests } = fixture();
    utimesSync(join(main, 'tests', 'shop.spec.ts'), new Date(T0 + 3_600_000), new Date(T0 + 3_600_000));
    saveResults(data, main, { 'tests/shop.spec.ts:3': { last: 'passed', at: T0 } });
    const saved = await readSavedResults({ data: { dir: data, how: 'x' }, testProject: worktree, mainProject: main, tests });
    expect(saved).toMatchObject({ used: 0, dropped: 1 });
  });

  it('two saved runs of one test (an old key and a moved key): the newer counts, the older is counted apart', async () => {
    const { data, worktree, tests } = fixture();
    // The test moved from line 2 to line 3 between the runs: the old run's title comes from git.
    utimesSync(join(worktree, 'tests', 'shop.spec.ts'), new Date(T0 + 1000), new Date(T0 + 1000));
    saveResults(data, worktree, {
      'tests/shop.spec.ts:2': { last: 'failed', at: T0 },
      'tests/shop.spec.ts:3': { last: 'passed', at: T0 + 5000 },
      'tests/shop.spec.ts:30': { last: 'failed', at: T0 + 5000 }, // line 30 has no test in the file as it is
    });
    const saved = await readSavedResults({ data: { dir: data, how: 'x' }, testProject: worktree, tests, specAt: specBefore });
    expect(saved?.runs['tests/shop.spec.ts:3']).toMatchObject({ savedKey: 'tests/shop.spec.ts:3', result: { last: 'passed' } });
    expect(saved).toMatchObject({ used: 1, dropped: 1, older: 1 });
  });

  it('links the recording made by the run: same key and outcome, saved while it ran', async () => {
    const { data, worktree, tests } = fixture();
    utimesSync(join(worktree, 'tests', 'shop.spec.ts'), new Date(T0 - 60_000), new Date(T0 - 60_000));
    saveResults(data, worktree, { 'tests/shop.spec.ts:3': { last: 'passed', at: T0 + 20_000 }, 'tests/shop.spec.ts:5': { last: 'failed', at: T0 } });
    saveRecording(data, '20261106-pay-passed', { file: 'tests/shop.spec.ts:3', status: 'passed', at: T0, ms: 15_000 }, { 'video.webm': 'w', 'video.mp4': 'm', 'trace.zip': 'z' });
    saveRecording(data, '20261106-pay-failed', { file: 'tests/shop.spec.ts:3', status: 'failed', at: T0, ms: 15_000 }, { 'video.webm': 'w' });
    saveRecording(data, '20261105-empty-failed', { file: 'tests/shop.spec.ts:5', status: 'failed', at: T0 - 86_400_000, ms: 1000 }, { 'video.webm': 'w' });
    saveRecording(data, 'broken', { nothing: true }, {});
    const recordings = readRecordings(data);
    expect(recordings.map((r) => r.name)).toEqual(['20261105-empty-failed', '20261106-pay-failed', '20261106-pay-passed']);
    expect(recordings[2]?.video).toMatch(/video\.mp4$/);
    const saved = await readSavedResults({ data: { dir: data, how: 'x' }, testProject: worktree, tests });
    expect(saved?.runs['tests/shop.spec.ts:3']?.recording?.name).toBe('20261106-pay-passed');
    // The only recording of S1-empty is a day older than its result: not that run's.
    expect(saved?.runs['tests/shop.spec.ts:5']?.recording).toBeUndefined();
    expect(saved?.recordings).toBe(1);
    expect(recordingOf(recordings, 'tests/shop.spec.ts:3', { last: 'passed' })).toBeUndefined();
  });

  it('reads nothing outside the data folder and writes nothing into it', async () => {
    const { data, worktree, tests } = fixture();
    saveResults(data, worktree, { 'tests/shop.spec.ts:3': { last: 'passed', at: T0 } });
    const before = JSON.stringify(readRecordings(data));
    await readSavedResults({ data: { dir: data, how: 'x' }, testProject: worktree, tests });
    expect(JSON.stringify(readRecordings(data))).toBe(before);
  });
});

describe('last screen', () => {
  const trace = () =>
    makeZip([
      { name: 'trace.trace', data: '{}' },
      { name: 'resources/page@abc-100.jpeg', data: 'first' },
      { name: 'resources/page@abc-900.jpeg', data: 'last', deflate: true },
      { name: 'resources/page@abc-500.jpeg', data: 'middle' },
      { name: 'resources/other.png', data: 'x' },
    ]);

  it("the trace's frame with the highest time stamp", () => {
    const still = lastTraceFrame(trace());
    expect(still?.mime).toBe('image/jpeg');
    expect(Buffer.from(still!.data).toString()).toBe('last');
    expect(lastTraceFrame(makeZip([{ name: 'trace.trace', data: '{}' }]))).toBeUndefined();
    expect(lastTraceFrame(Buffer.from('not a zip'))).toBeUndefined();
  });

  it('a recording: the trace first, else the video through ffmpeg, else nothing', async () => {
    const { data } = fixture();
    const withTrace = saveRecording(data, 'a-passed', { file: 'k:1', status: 'passed', at: T0 }, { 'video.webm': 'w', 'trace.zip': trace() });
    saveRecording(data, 'b-passed', { file: 'k:2', status: 'passed', at: T0 }, { 'video.webm': 'w' });
    const [a, b] = readRecordings(data);
    expect(a?.dir).toBe(withTrace);
    const calls: string[][] = [];
    const ffmpeg = async (args: string[]) => {
      calls.push(args);
      return new Uint8Array([1, 2, 3]);
    };
    expect(Buffer.from((await lastScreen(a!, ffmpeg))!.data).toString()).toBe('last');
    expect(calls).toEqual([]);
    expect((await lastScreen(b!, ffmpeg))?.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls[0]).toEqual(expect.arrayContaining(['-sseof', '-1', b!.video!]));
    expect(await lastScreen(b!)).toBeUndefined();
    expect(await lastScreen(b!, async () => undefined)).toBeUndefined();
  });
});

describe('unit report', () => {
  const report = {
    startTime: T0,
    testResults: [
      {
        assertionResults: [
          { fullName: 'pay S1-pay: the total is right', status: 'passed' },
          { fullName: 'pay S1-A2 the card is checked', status: 'failed' },
          { fullName: 'pay S1-payment only', status: 'passed' },
          { title: 'S4-new works', status: 'pending' },
          { status: 'passed' },
        ],
      },
      { assertionResults: 'not a list' },
    ],
  };

  it('reads vitest JSON: names, outcomes and when it ran', () => {
    const r = parseUnitReport(JSON.stringify(report), 'r.json');
    expect(r.date).toBe(new Date(T0).toISOString());
    expect(r.tests).toHaveLength(4);
    expect(r.tests[3]).toEqual({ name: 'S4-new works', status: 'skipped' });
  });

  it('counts the tests that name a whole id of the story', () => {
    const r = parseUnitReport(JSON.stringify(report), 'r.json');
    expect(unitCount(r, ['S1-pay', 'S1-A2'])).toEqual({ tests: 2, passed: 1, failed: 1 });
    expect(unitCount(r, ['S1-pa'])).toEqual({ tests: 0, passed: 0, failed: 0 });
    expect(unitCount(r, [])).toEqual({ tests: 0, passed: 0, failed: 0 });
  });

  it('missing or unreadable: an error that says so in plain words', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rehearse-unit-'));
    expect(() => readUnitReport(join(dir, 'none.json'))).toThrow(UnitReportError);
    expect(() => readUnitReport(join(dir, 'none.json'))).toThrow(new RegExp(`^${UNIT_REPORT_UNREADABLE}: no file .*pnpm test:report`));
    writeFileSync(join(dir, 'bad.json'), '{');
    expect(() => readUnitReport(join(dir, 'bad.json'))).toThrow(/is not JSON/);
    writeFileSync(join(dir, 'other.json'), '{"x":1}');
    expect(() => readUnitReport(join(dir, 'other.json'))).toThrow(/has no testResults/);
    writeFileSync(join(dir, 'ok.json'), JSON.stringify({ testResults: [] }));
    expect(readUnitReport(join(dir, 'ok.json')).tests).toEqual([]);
  });
});

describe('the tests of an EPIC, by folder (T59)', () => {
  // The same id S4-A3 in a test of each EPIC: each EPIC counts only its own test.
  const report = parseUnitReport(
    JSON.stringify({
      testResults: [
        { name: 'packages/server/test/a.test.ts', assertionResults: [{ fullName: 'S4-A3 the deck counts', status: 'failed' }, { fullName: 'S1-A1 other', status: 'passed' }] },
        { name: 'packages/graph/test/b.test.ts', assertionResults: [{ fullName: 'S4-A3 the graph finds', status: 'passed' }] },
      ],
    }),
    'r.json',
  );
  const paths = { 'code-graph': ['packages/graph/**'] };

  it('keeps the test file of each test', () => {
    expect(report.tests.map((t) => t.file)).toEqual(['packages/server/test/a.test.ts', 'packages/server/test/a.test.ts', 'packages/graph/test/b.test.ts']);
  });

  it('the same id in two EPICs: each EPIC gets only its own test', () => {
    const graph = unitTestsOfEpic(report, 'code-graph', paths);
    expect(graph.tests.map((t) => t.name)).toEqual(['S4-A3 the graph finds']);
    expect(graph.scope).toBe('the tests in packages/graph/**');
    expect(unitCount(graph, ['S4-A3'])).toEqual({ tests: 1, passed: 1, failed: 0 });
    const first = unitTestsOfEpic(report, 'rehearse', paths);
    expect(first.tests.map((t) => t.name)).toEqual(['S4-A3 the deck counts', 'S1-A1 other']);
    expect(first.scope).toBe('all tests that are not in packages/graph/**');
    expect(first.note).toBeUndefined();
    expect(unitCount(first, ['S4-A3'])).toEqual({ tests: 1, passed: 0, failed: 1 });
  });

  it('no mapping: the EPIC gets all tests', () => {
    expect(unitTestsOfEpic(report, 'rehearse', {}).tests).toHaveLength(3);
    expect(unitTestsOfEpic(report, 'rehearse', {}).scope).toBe('all tests of the report');
    expect(unitTestsOfEpic(report, 'code-graph', { 'code-graph': [] }).tests).toHaveLength(3);
  });

  it('an old report without test files: the ids alone decide, with the note', () => {
    const old = parseUnitReport(JSON.stringify({ testResults: [{ assertionResults: [{ fullName: 'S4-A3 x', status: 'failed' }] }] }), 'r.json');
    const graph = unitTestsOfEpic(old, 'code-graph', paths);
    expect(graph.tests).toHaveLength(1);
    expect(graph.note).toBe(NO_TEST_FILES);
    expect(NO_TEST_FILES).toMatch(/does not show the test files.*pnpm test:report/);
  });

  it('globs: ** is zero or more folders, * stays in one name', () => {
    expect(globRegExp('packages/graph/**').test('packages/graph/test/a.test.ts')).toBe(true);
    expect(globRegExp('packages/graph/**').test('packages/graphs/a.ts')).toBe(false);
    expect(globRegExp('packages/**/test/*.ts').test('packages/test/a.ts')).toBe(true);
    expect(globRegExp('packages/*/a.ts').test('packages/x/y/a.ts')).toBe(false);
    expect(globRegExp('a?.ts').test('ab.ts')).toBe(true);
  });

  it('readTestPaths: the testPaths of .rehearse/config.yaml; missing is no globs; bad is said', () => {
    const top = mkdtempSync(join(tmpdir(), 'rehearse-paths-'));
    expect(readTestPaths(top)).toEqual({ paths: {} });
    mkdirSync(join(top, '.rehearse'));
    writeFileSync(join(top, '.rehearse', 'config.yaml'), 'testPaths:\n  code-graph: [packages/graph/**]\n');
    expect(readTestPaths(top)).toEqual({ paths: { 'code-graph': ['packages/graph/**'] } });
    writeFileSync(join(top, '.rehearse', 'config.yaml'), 'other: 1\n');
    expect(readTestPaths(top)).toEqual({ paths: {} });
    writeFileSync(join(top, '.rehearse', 'config.yaml'), 'testPaths:\n  code-graph: packages/graph\n');
    expect(readTestPaths(top).why).toMatch(/testPaths.code-graph that is not a list of globs; all EPICs get all tests/);
    writeFileSync(join(top, '.rehearse', 'config.yaml'), 'testPaths: [a]\n');
    expect(readTestPaths(top).why).toMatch(/not a map/);
    writeFileSync(join(top, '.rehearse', 'config.yaml'), 'testPaths: {\n');
    expect(readTestPaths(top).why).toMatch(/is not YAML/);
  });
});

describe('writeZip', () => {
  it('a zip any reader opens: the deck and its media folder, bytes unchanged', () => {
    const video = Buffer.alloc(70_000, 7);
    const zip = writeZip([
      { name: 'deck.html', data: Buffer.from('<html>ü</html>') },
      { name: 'deck-media/run 1.mp4', data: video },
    ]);
    const files = readZip(zip, { maxBytes: 1_000_000 });
    expect(files.map((f) => f.name)).toEqual(['deck.html', 'deck-media/run 1.mp4']);
    expect(files[0]?.data.toString()).toBe('<html>ü</html>');
    expect(files[1]?.data.equals(video)).toBe(true);
  });
});
