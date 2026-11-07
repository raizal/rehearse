// `rehearse brief` and `rehearse progress` (T44): the build brief a thread gets, and what rehearse
// sees of the work on a story. Progress reads git through a fake runner: no real repo, no bb.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Runner } from '@rehearse/server';
import { makeEpic } from '../../core/test/helpers.js';
import { approvedEpic, editYaml, signedEpic } from '../../core/test/trust/helpers.js';
import { runProgress } from '../src/commands/progress.js';
import { main, USAGE } from '../src/index.js';

async function cli(args: string[], cwd = tmpdir()): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(args, { cwd, stdout: (t) => (out += t), stderr: (t) => (err += t) });
  return { code, out, err };
}

/** The shop, approved, with an e2e project beside it whose spec has the test of S1-buy. */
function shopWithTests(): string {
  const dir = approvedEpic();
  const e2e = join(dirname(dir), 'e2e');
  mkdirSync(join(e2e, 'specs'), { recursive: true });
  writeFileSync(join(e2e, 'playwright.config.ts'), 'export default {};\n');
  writeFileSync(join(e2e, 'specs', 'S1.spec.ts'), "test('S1-buy', async ({ page }) => {\n});\n");
  return dir;
}

describe('rehearse brief --tests (T47, box test-brief)', async () => {
  it('without --scenario: the approved scenarios of the story that have no test, exit 0', async () => {
    const r = await cli(['brief', shopWithTests(), 'S1', '--tests']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^# Test brief: e2e tests for S1-empty \(story S1 of the EPIC 2026-11-05-shop\)\n/);
    expect(r.out).toContain('- File: `e2e/specs/S1.spec.ts`');
    expect(r.out).toContain('from `e2e/specs/S1.spec.ts`');
    expect(r.out).toContain("`test('S1-empty', async ({ page }) => {`");
    expect(r.out).toContain('Write only tests');
  });

  it('--scenario names them; --json has the scenarios, the spec file, the hash and the markdown', async () => {
    const r = await cli(['brief', approvedEpic(), 'S1', '--tests', '--scenario', 'S1-buy', '--scenario', 'S1-empty', '--json']);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out);
    expect(j).toMatchObject({ ok: true, storyId: 'S1', scenarios: ['S1-buy', 'S1-empty'], specFile: 'e2e/tests/S1.spec.ts' });
    expect(j.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(j.markdown).toContain('## S1-buy:');
  });

  it('exit 1: a draft scenario (approve it first), no missing test, an unknown story or scenario', async () => {
    const draft = await cli(['brief', makeEpic(), 'S1', '--tests', '--scenario', 'S1-buy']);
    expect(draft).toMatchObject({ code: 1, out: '', err: 'rehearse brief: S1-buy (draft): approve this scenario first; an agent writes tests for approved scenarios only\n' });
    expect(JSON.parse((await cli(['brief', makeEpic(), 'S1', '--tests', '--scenario', 'S1-buy', '--json'])).out)).toMatchObject({ ok: false, notApproved: [{ id: 'S1-buy', status: 'draft' }] });
    // Every scenario is a draft: none is missing a test yet, and the drafts are named.
    expect(await cli(['brief', makeEpic(), 'S1', '--tests'])).toMatchObject({ code: 1, err: 'rehearse brief: no approved scenario of S1 is without an e2e test; not approved yet: S1-buy (draft), S1-empty (draft), approve them first; name one with --scenario <id>\n' });
    expect(await cli(['brief', approvedEpic(), 'S9', '--tests'])).toMatchObject({ code: 1, err: 'rehearse brief: no story S9 in prd.yaml\n' });
    expect((await cli(['brief', approvedEpic(), 'S1', '--tests', '--scenario', 'S2-out-of-stock'])).code).toBe(1);
  });

  it('usage errors exit 2: --scenario without --tests or a value, --tests with --allow-unsigned', async () => {
    const dir = approvedEpic();
    for (const args of [[dir, 'S1', '--scenario', 'S1-buy'], [dir, 'S1', '--tests', '--scenario'], [dir, 'S1', '--tests', '--allow-unsigned']]) {
      expect((await cli(['brief', ...args])).code, args.join(' ')).toBe(2);
    }
    expect(USAGE).toContain('brief <epic-dir-or-slug> <story> --tests [--scenario <id>]…');
  });
});

describe('rehearse brief', async () => {
  it('prints the build brief of a signed story, exit 0', async () => {
    const r = await cli(['brief', signedEpic(), 'S1']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^# Build brief: story S1 of the EPIC 2026-11-05-shop\n/);
    expect(r.out).toContain('This brief matches the signed story.');
    expect(r.out).toContain('## How to work in this repo');
  });

  it('--json has the hash, the sign state and the markdown', async () => {
    const r = await cli(['brief', signedEpic(), 'S2', '--json']);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out);
    expect(j).toMatchObject({ ok: true, storyId: 'S2', sign: { status: 'signed', buildable: true } });
    expect(j.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(j.markdown).toContain('story S2');
  });

  it('refuses an unsigned or stale story with exit 1, and --allow-unsigned prints it, saying so', async () => {
    const draft = makeEpic();
    const r = await cli(['brief', draft, 'S1']);
    expect(r).toMatchObject({ code: 1, out: '' });
    expect(r.err).toContain('not signed off');
    const allowed = await cli(['brief', draft, 'S1', '--allow-unsigned']);
    expect(allowed.code).toBe(0);
    expect(allowed.out).toContain('**The story is not signed off.**');
    const stale = signedEpic();
    editYaml(stale, 'prd.yaml', (doc) => doc.setIn(['requirements', 0, 'text'], 'The buyer pays for an order by card.'));
    expect((await cli(['brief', stale, 'S1'])).err).toContain('changed since it was signed off');
    expect(JSON.parse((await cli(['brief', stale, 'S1', '--json'])).out)).toMatchObject({ ok: false, sign: { status: 'stale' } });
    expect(await cli(['brief', stale, 'S99'])).toMatchObject({ code: 1, err: 'rehearse brief: no story S99 in prd.yaml\n' });
  });

  it('T49 --json has the code facts of each box, gathered from the graph of the repo', async () => {
    const r = await cli(['brief', signedEpic(), 'S1', '--json']);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.code.cli).toBe('rehearse');
    expect(j.code.code.map((c: { box: string }) => c.box)).toEqual(['cart', 'pay']);
    expect(j.code.code[0]).toMatchObject({ box: 'cart', functions: [], commits: [] });
    expect(j.markdown).toContain('## Code you start from');
    expect(j.markdown).toContain('### `cart`: no code yet');
  });

  it('T49 a graph that cannot open: the brief says so in one line and still builds', async () => {
    const dir = signedEpic();
    mkdirSync(join(dirname(dir), '.rehearse', 'graph.db'), { recursive: true });
    const r = await cli(['brief', dir, 'S1', '--json']);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.code.codeUnavailable).toEqual(expect.any(String));
    expect(j.markdown).toMatch(/## Code you start from\n\nThe code graph is not available \(.+\), so this brief lists no code; find it with `rehearse find <words>` once the graph opens\./);
    const tests = await cli(['brief', shopWithTests(), 'S1', '--tests', '--json']);
    expect(JSON.parse(tests.out).code.e2eHelpers).toEqual([]);
  });

  it('usage errors exit 2', async () => {
    for (const args of [[], ['x'], [signedEpic()], [signedEpic(), 'S1', '--nope'], ['no-such-epic', 'S1']]) {
      const r = await cli(['brief', ...args]);
      expect(r.code, args.join(' ')).toBe(2);
    }
    expect(USAGE).toContain('brief <epic-dir-or-slug> <story>');
    expect(USAGE).toContain('progress <epic-dir-or-slug> <story>');
  });
});

/** A git that knows one Flow-Box commit on a branch, and a repo top-level with no link file. */
function fakeGit(): { run: Runner; calls: string[][] } {
  const repo = mkdtempSync(join(tmpdir(), 'rehearse-repo-'));
  const calls: string[][] = [];
  const run: Runner = async (command, args) => {
    calls.push([command, ...args]);
    if (command !== 'git') return { code: 1, stdout: '', stderr: 'no bb in tests' };
    if (args[0] === 'rev-parse') return { code: 0, stdout: `${repo}\n`, stderr: '' };
    if (args[0] === 'log' && args.includes('--all')) {
      return { code: 0, stdout: ['a'.repeat(40), 'refs/heads/feature/pay', 'Pay', 'Pay\n\nFlow-Box: pay\n'].join('\x1f') + '\x1e', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

async function progress(args: string[], runner = fakeGit()) {
  let out = '';
  let err = '';
  const code = await runProgress(args, { cwd: tmpdir(), stdout: (t) => (out += t), stderr: (t) => (err += t) }, runner.run);
  return { code, out, err, calls: runner.calls };
}

describe('rehearse progress', () => {
  it('prints boxes with code, scenarios tested, the sign-off; no thread, so no bb call', async () => {
    const r = await progress([signedEpic(), 'S1']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Story S1 of 2026-11-05-shop: 1 of 2 boxes have code · 0 of 2 scenarios tested');
    expect(r.out).toContain('No thread works on this story yet.');
    expect(r.out).toMatch(/pay: built, 1 commit/);
    expect(r.out).toContain('cart: not yet');
    expect(r.calls.filter((c) => c[0] === 'bb')).toEqual([]);
  });

  it('--json is the progress the UI shows', async () => {
    const r = await progress([signedEpic(), 'S1', '--json']);
    const p = JSON.parse(r.out);
    expect(p).toMatchObject({ storyId: 'S1', counts: { boxes: 2, boxesWithCode: 1 }, signOff: { valid: true } });
    expect(p.boxes.find((b: { path: string }) => b.path === 'pay').branches).toEqual(['feature/pay']);
  });

  it('exit 1 for an unknown story, 2 for usage errors', async () => {
    expect(await progress([signedEpic(), 'S99'])).toMatchObject({ code: 1, err: 'rehearse progress: no story S99 in prd.yaml\n' });
    for (const args of [[], [signedEpic()], [signedEpic(), 'S1', '--x'], ['no-such-epic', 'S1'], [signedEpic(), '../S1']]) {
      expect((await progress(args)).code, args.join(' ')).toBe(2);
    }
  });

  it('main routes progress (async)', async () => {
    let err = '';
    expect(await main(['progress'], { cwd: tmpdir(), stdout: () => undefined, stderr: (t) => (err += t) })).toBe(2);
    expect(err).toContain('rehearse progress: expected');
  });
});
