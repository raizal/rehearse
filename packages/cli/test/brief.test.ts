// `rehearse brief` and `rehearse progress` (T44): the build brief a thread gets, and what rehearse
// sees of the work on a story. Progress reads git through a fake runner: no real repo, no bb.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Runner } from '@rehearse/server';
import { makeEpic } from '../../core/test/helpers.js';
import { editYaml, signedEpic } from '../../core/test/trust/helpers.js';
import { runProgress } from '../src/commands/progress.js';
import { main, run, USAGE } from '../src/index.js';

function cli(args: string[], cwd = tmpdir()): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const code = run(args, { cwd, stdout: (t) => (out += t), stderr: (t) => (err += t) });
  return { code, out, err };
}

describe('rehearse brief', () => {
  it('prints the build brief of a signed story, exit 0', () => {
    const r = cli(['brief', signedEpic(), 'S1']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^# Build brief: story S1 of the EPIC 2026-11-05-shop\n/);
    expect(r.out).toContain('This brief matches the signed story.');
    expect(r.out).toContain('## How to work in this repo');
  });

  it('--json has the hash, the sign state and the markdown', () => {
    const r = cli(['brief', signedEpic(), 'S2', '--json']);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out);
    expect(j).toMatchObject({ ok: true, storyId: 'S2', sign: { status: 'signed', buildable: true } });
    expect(j.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(j.markdown).toContain('story S2');
  });

  it('refuses an unsigned or stale story with exit 1, and --allow-unsigned prints it, saying so', () => {
    const draft = makeEpic();
    const r = cli(['brief', draft, 'S1']);
    expect(r).toMatchObject({ code: 1, out: '' });
    expect(r.err).toContain('not signed off');
    const allowed = cli(['brief', draft, 'S1', '--allow-unsigned']);
    expect(allowed.code).toBe(0);
    expect(allowed.out).toContain('**The story is not signed off.**');
    const stale = signedEpic();
    editYaml(stale, 'prd.yaml', (doc) => doc.setIn(['requirements', 0, 'text'], 'The buyer pays for an order by card.'));
    expect(cli(['brief', stale, 'S1']).err).toContain('changed since it was signed off');
    expect(JSON.parse(cli(['brief', stale, 'S1', '--json']).out)).toMatchObject({ ok: false, sign: { status: 'stale' } });
    expect(cli(['brief', stale, 'S99'])).toMatchObject({ code: 1, err: 'rehearse brief: no story S99 in prd.yaml\n' });
  });

  it('usage errors exit 2', () => {
    for (const args of [[], ['x'], [signedEpic()], [signedEpic(), 'S1', '--nope'], ['no-such-epic', 'S1']]) {
      const r = cli(['brief', ...args]);
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
