// T11 (story Code tab, design page 13): the code of a box from git Flow-Box trailers, and the
// routes GET /api/code-index and GET /api/box-code. Git is a fake runner over a scripted linear
// history; no test runs git on the real repo.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SHOP } from '../../core/test/helpers.js';
import { boxCode, codeIndex, EMPTY_TREE, epicBoxPaths, MAX_DIFF_LINES, newToken, startServer, type GitRunner, type RunningServer, type ServerSession } from '../src/index.js';
import { FS, RS, TS } from '../src/git-parse.js';

interface FakeCommit {
  sha: string;
  subject: string;
  body: string;
  boxes: string[];
  files: string[];
}

const sha = (c: string) => c.repeat(40);
/** Oldest first. `1` has no parent. */
const HISTORY: FakeCommit[] = [
  { sha: sha('1'), subject: 'Start the shop', body: '', boxes: ['pay'], files: ['src/pay.ts'] },
  { sha: sha('2'), subject: 'Cart without trailer', body: '', boxes: [], files: ['src/cart.ts'] },
  { sha: sha('3'), subject: 'Pay with a card (D7)', body: '- Pay takes a card.\n- A declined card stops.\n\nFlow-Box: pay\nFlow-Box: ship/pack', boxes: ['pay', 'ship/pack'], files: ['src/pay.ts', 'src/card.ts', 'src/pack.ts'] },
  { sha: sha('4'), subject: 'Pack faster (R2)', body: 'thread thr_abc123\n\nFlow-Box: ship/pack', boxes: ['ship/pack'], files: ['src/pack.ts'] },
];
const HEAD = HISTORY[HISTORY.length - 1]!;

const DIFF = ['diff --git a/src/pay.ts b/src/pay.ts', '--- a/src/pay.ts', '+++ b/src/pay.ts', '@@ -1 +1,2 @@', ' pay()', '+card()', ''].join('\n');

function fakeGit(opts: { repo?: boolean; diff?: string } = {}): { run: GitRunner; calls: { args: string[]; cwd: string }[] } {
  const calls: { args: string[]; cwd: string }[] = [];
  const find = (rev: string) => (rev === 'HEAD' ? HEAD : HISTORY.find((c) => c.sha.startsWith(rev)));
  const record = (c: FakeCommit, body: boolean) =>
    `${RS}${c.sha}${FS}${c.sha.slice(0, 7)}${FS}${c.subject}${FS}2026-11-05T10:00:00+07:00${FS}${c.boxes.join(TS)}` + (body ? `${FS}${c.body}\n` : '');
  const ok = (stdout: string) => ({ ok: true, stdout, stderr: '' });
  const fail = { ok: false, stdout: '', stderr: 'fatal' };
  const run: GitRunner = async (args, cwd) => {
    calls.push({ args, cwd });
    if (opts.repo === false) return fail;
    const a = args.filter((x) => x !== '--literal-pathspecs' && x !== '-c' && x !== 'core.quotePath=false');
    if (a[0] === 'rev-parse' && a[1] === '--show-toplevel') return ok('/repo\n');
    if (a[0] === 'rev-parse' && a[1] === '--verify') {
      const at = HISTORY.findIndex((c) => `${c.sha}^` === a[3]);
      return at > 0 ? ok(`${HISTORY[at - 1]!.sha}\n`) : fail;
    }
    if (a[0] === 'log' && a.includes('--name-only')) {
      return ok([...HISTORY].reverse().filter((c) => c.body.includes('Flow-Box:') || c.boxes.length > 0).map((c) => `${record(c, false)}\n\n${c.files.join('\n')}\n`).join(''));
    }
    if (a[0] === 'log' && a[1] === '-1') {
      const c = find(a[3]!);
      return c ? ok(record(c, false) + '\n') : fail;
    }
    if (a[0] === 'log') {
      const span = a[2]!;
      const [from, to] = span.includes('..') ? span.split('..') : [undefined, span];
      const end = HISTORY.findIndex((c) => c.sha === to);
      const start = from === undefined ? 0 : HISTORY.findIndex((c) => c.sha === from) + 1;
      return ok(HISTORY.slice(start, end + 1).reverse().map((c) => record(c, true)).join(''));
    }
    if (a[0] === 'diff' && a.includes('--numstat')) return ok(['1\t0\tsrc/pay.ts', '4\t2\tsrc/card.ts', ''].join('\0'));
    if (a[0] === 'diff') return ok(opts.diff ?? DIFF);
    return fail;
  };
  return { run, calls };
}

const BOXES = epicBoxPaths(SHOP);

describe('T11 1 codeIndex: which boxes have code', () => {
  it('lists the commits and files of each box; a parent box has the commits of its children', async () => {
    const idx = await codeIndex(fakeGit().run, SHOP, BOXES);
    if (!idx.ok) throw new Error(idx.reason);
    expect(idx.head.sha).toBe(HEAD.sha);
    expect(idx.boxes['pay']!.commits.map((c) => c.subject)).toEqual(['Start the shop', 'Pay with a card (D7)']);
    expect(idx.boxes['pay']!.files).toEqual(['src/card.ts', 'src/pack.ts', 'src/pay.ts']);
    expect(idx.boxes['ship/pack']!.commits.map((c) => c.short)).toEqual(['3333333', '4444444']);
    expect(idx.boxes['ship']!.commits.map((c) => c.short)).toEqual(['3333333', '4444444']);
    expect(idx.boxes['cart']).toEqual({ commits: [], files: [] });
    expect(idx.boxes['in-stock']).toEqual({ commits: [], files: [] });
  });

  it('says why there is no code outside a git repository', async () => {
    expect(await codeIndex(fakeGit({ repo: false }).run, SHOP, BOXES)).toEqual({ ok: false, reason: 'the EPIC folder is not in a git repository' });
  });

  it('runs git with argument arrays, literal pathspecs, in the top level of the repo that holds the EPIC', async () => {
    const { run, calls } = fakeGit();
    await boxCode(run, SHOP, BOXES, { box: 'pay' });
    expect(calls[0]).toEqual({ args: ['rev-parse', '--show-toplevel'], cwd: SHOP });
    for (const c of calls.slice(1)) {
      expect(c.cwd).toBe('/repo');
      expect(c.args.slice(0, 3)).toEqual(['--literal-pathspecs', '-c', 'core.quotePath=false']);
    }
    const diff = calls.find((c) => c.args.includes('--numstat'))!;
    expect(diff.args.slice(diff.args.indexOf('--'))).toEqual(['--', 'src/card.ts', 'src/pack.ts', 'src/pay.ts']);
  });
});

describe('T11 3 boxCode: the compare range of one box', () => {
  it('defaults to before = parent of the first commit (the empty tree for a root commit), after = the last commit', async () => {
    const v = await boxCode(fakeGit().run, SHOP, BOXES, { box: 'pay' });
    if (!v.ok) throw new Error(v.error);
    expect(v.before.sha).toBe(EMPTY_TREE);
    expect(v.before.subject).toContain('before the first commit');
    expect(v.after.sha).toBe(sha('3'));
    expect(v.head.sha).toBe(HEAD.sha);
    expect(v.range.map((c) => c.short)).toEqual(['1111111', '3333333']);
    expect(v.range[1]!.body).toContain('- Pay takes a card.');
    expect(v.changedBoxes).toEqual(['pay', 'ship', 'ship/pack']);

    const pack = await boxCode(fakeGit().run, SHOP, BOXES, { box: 'ship/pack' });
    if (!pack.ok) throw new Error(pack.error);
    expect([pack.before.short, pack.after.short]).toEqual(['2222222', '4444444']);
  });

  it('lists files with numstat, the box files not in the range, and the diff of the first file', async () => {
    const v = await boxCode(fakeGit().run, SHOP, BOXES, { box: 'pay' });
    if (!v.ok) throw new Error(v.error);
    expect(v.files).toEqual([
      { path: 'src/pay.ts', added: 1, removed: 0, binary: false },
      { path: 'src/card.ts', added: 4, removed: 2, binary: false },
    ]);
    expect(v.unchanged).toEqual(['src/pack.ts']);
    expect(v.file).toBe('src/pay.ts');
    expect(v.diff!.hunks[0]!.lines.map((l) => [l.kind, l.old, l.new])).toEqual([
      ['context', 1, 1],
      ['add', undefined, 2],
    ]);
    expect(v.diff!.more).toBe(0);
  });

  it('takes a before and an after commit, and only a file of the change', async () => {
    const { run, calls } = fakeGit();
    const v = await boxCode(run, SHOP, BOXES, { box: 'ship/pack', before: '3333333', after: 'HEAD', file: 'src/card.ts' });
    if (!v.ok) throw new Error(v.error);
    expect(v.range.map((c) => c.short)).toEqual(['4444444']);
    expect(v.changedBoxes).toEqual(['ship', 'ship/pack']);
    expect(v.file).toBe('src/card.ts');
    const diff = calls.filter((c) => c.args.includes('diff')).pop()!;
    expect(diff.args.slice(-5)).toEqual(['--find-renames', sha('3'), HEAD.sha, '--', 'src/card.ts']);
    expect(diff.args.slice(diff.args.indexOf('--'))).toEqual(['--', 'src/card.ts']);
    expect(await boxCode(run, SHOP, BOXES, { box: 'pay', file: 'src/other.ts' })).toEqual({ ok: false, status: 400, error: 'src/other.ts is not a file of this change' });
  });

  it('refuses a box that is not in flow.yaml and a before or after that is not a hash or HEAD, before running git', async () => {
    const { run, calls } = fakeGit();
    expect(await boxCode(run, SHOP, BOXES, { box: '../etc' })).toMatchObject({ ok: false, status: 400, error: 'no box ../etc in flow.yaml' });
    for (const bad of ['--output=/tmp/x', 'HEAD~1', 'main', 'abc', 'g'.repeat(7), `${'a'.repeat(41)}`]) {
      expect(await boxCode(run, SHOP, BOXES, { box: 'pay', before: bad })).toMatchObject({ ok: false, status: 400 });
      expect(await boxCode(run, SHOP, BOXES, { box: 'pay', after: bad })).toMatchObject({ ok: false, status: 400 });
    }
    expect(calls).toEqual([]);
  });

  it('a box with no commits compares HEAD with HEAD and has no files', async () => {
    const v = await boxCode(fakeGit().run, SHOP, BOXES, { box: 'cart' });
    if (!v.ok) throw new Error(v.error);
    expect([v.before.sha, v.after.sha]).toEqual([HEAD.sha, HEAD.sha]);
    expect(v.commits).toEqual([]);
    expect(v.files).toEqual([]);
    expect(v.diff).toBeUndefined();
  });

  it('T11 4: caps the diff at MAX_DIFF_LINES lines and counts the rest', async () => {
    const n = MAX_DIFF_LINES + 25;
    const big = ['diff --git a/src/pay.ts b/src/pay.ts', '--- a/src/pay.ts', '+++ b/src/pay.ts', `@@ -0,0 +1,${n} @@`, ...Array.from({ length: n }, (_, i) => `+line ${i}`), ''].join('\n');
    const v = await boxCode(fakeGit({ diff: big }).run, SHOP, BOXES, { box: 'pay' });
    if (!v.ok) throw new Error(v.error);
    expect(v.diff!.hunks[0]!.lines).toHaveLength(MAX_DIFF_LINES);
    expect(v.diff!.more).toBe(25);
  });
});

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe('T11 server routes: GET /api/code-index and GET /api/box-code', () => {
  const session = (): ServerSession => ({ token: newToken(), identity: { by: 'me@example.com' }, signer: { ok: false, reason: 'off' } });
  async function serve() {
    const s = session();
    running = await startServer({ epicDir: SHOP, uiDir: mkdtempSync(join(tmpdir(), 'rehearse-ui-')), port: 0, session: s, git: fakeGit().run });
    return { url: running.url, token: s.token };
  }

  it('need the session token and a same-origin Origin', async () => {
    const { url, token } = await serve();
    for (const path of ['api/code-index', 'api/box-code?box=pay']) {
      expect((await fetch(new URL(path, url))).status).toBe(403);
      expect((await fetch(new URL(path, url), { headers: { 'x-rehearse-token': 'wrong' } })).status).toBe(403);
      expect((await fetch(new URL(path, url), { headers: { 'x-rehearse-token': token, origin: 'http://evil.example' } })).status).toBe(403);
      expect((await fetch(new URL(path, url), { headers: { 'x-rehearse-token': token } })).status).toBe(200);
    }
  });

  it('answer JSON: the index, a box with its range, 400 for a bad box or sha, 405 for a POST', async () => {
    const { url, token } = await serve();
    const get = (path: string) => fetch(new URL(path, url), { headers: { 'x-rehearse-token': token } });
    const idx = await (await get('api/code-index')).json();
    expect(idx.ok).toBe(true);
    expect(idx.boxes.pay.commits).toHaveLength(2);
    const box = await (await get('api/box-code?box=ship%2Fpack&before=3333333&after=HEAD')).json();
    expect(box.range.map((c: { short: string }) => c.short)).toEqual(['4444444']);
    expect((await get('api/box-code')).status).toBe(400);
    expect((await get('api/box-code?box=nope')).status).toBe(400);
    expect((await get('api/box-code?box=pay&after=HEAD%5E')).status).toBe(400);
    expect((await fetch(new URL('api/box-code?box=pay', url), { method: 'POST', headers: { 'x-rehearse-token': token } })).status).toBe(405);
  });
});
