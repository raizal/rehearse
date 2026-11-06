// `rehearse context` on the CLI (code-graph EPIC S4): --budget, --json, the "no venv found" note, the
// same bytes on a second run, and the usage errors. The repos are git copies of the graph fixtures.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { main, run, USAGE } from '../src/index.js';

const FIXTURES = fileURLToPath(new URL('../../graph/test/fixtures', import.meta.url));

async function cli(args: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(args, { cwd, stdout: (t) => (out += t), stderr: (t) => (err += t) });
  return { code, out, err };
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });

/** A git repo with one graph fixture committed, and the .gitignore that `rehearse new` makes. */
function repoOf(fixture: string): string {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'rehearse-cli-context-'))), fixture);
  cpSync(join(FIXTURES, fixture), dir, { recursive: true });
  git(dir, 'init', '-q');
  expect(run(['new', '2026-11-06-shop', '--title', 'Shop'], { cwd: dir, stdout: () => {}, stderr: () => {} })).toBe(0);
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'shop');
  return dir;
}

let repo: string;
let shop: string;
beforeAll(() => {
  repo = repoOf('context');
  shop = repoOf('shop');
});

describe('rehearse context', () => {
  it('S4-A1 context getOrderById --budget 2000 --json: at most 2,000 tokens, the target first, then by distance and PageRank', async () => {
    const res = await cli(['context', 'getOrderById', '--budget', '2000', '--json'], join(repo, 'src'));
    expect(res.code).toBe(0);
    const answer = JSON.parse(res.out);
    expect(answer).toMatchObject({ verb: 'context', ok: true, exitCode: 0, bundle: { budget: 2000, target: { name: 'getOrderById' } } });
    expect(answer.bundle.tokens).toBeLessThanOrEqual(2000);
    expect(answer.bundle.items.map((i: { node: { name: string }; distance: number }) => [i.node.name, i.distance])).toEqual([
      ['getOrderById', 0], ['loadRow', 1], ['loadOrder', 1], ['orders > reads one order by its id, with the total of its lines in cents', 1],
    ]);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('S4-A1 without --budget the budget is 2000; the text form has a head line and the code of each item', async () => {
    const res = await cli(['context', 'getOrderById'], repo);
    expect(res.code).toBe(0);
    expect(res.out.split('\n')[0]).toBe('context getOrderById: 1988 of 2000 tokens, 4 items');
    expect(res.out).toContain('== 0 target: function getOrderById  src/orders.ts:12-49\nexport function getOrderById(id: string): Order {');
  });

  it('S4-A2 context get_order_by_id --budget 2000 in a Python repo with no venv exits 0 and says "no venv found"', async () => {
    const res = await cli(['context', 'get_order_by_id', '--budget', '2000'], shop);
    expect(res.code).toBe(0);
    expect(res.out).toContain('note: no venv found');
    const json = JSON.parse((await cli(['context', 'get_order_by_id', '--budget=2000', '--json'], shop)).out);
    expect(json.notes).toEqual(['no venv found']);
    expect(json.bundle.notes).toEqual(['no venv found']);
  });

  it('S4-A3 the same context command two times gives byte-identical output', async () => {
    const one = await cli(['context', 'getOrderById', '--budget', '2000', '--json'], repo);
    const two = await cli(['context', 'getOrderById', '--budget', '2000', '--json'], repo);
    expect(two.out).toBe(one.out);
    const rebuilt = await cli(['context', 'getOrderById', '--budget', '2000', '--json', '--rebuild'], repo);
    expect(rebuilt.out).toBe(one.out);
  });

  it('G27 an unknown target exits 1 with "not found"', async () => {
    const res = await cli(['context', 'noSuchThing'], repo);
    expect(res.code).toBe(1);
    expect(res.err).toBe('rehearse context: not found: noSuchThing\n');
  });

  it('usage errors exit 2: no target, two targets, a bad --budget, --depth', async () => {
    for (const args of [['context'], ['context', 'a', 'b'], ['context', 'a', '--budget', '0'], ['context', 'a', '--budget', 'x'], ['context', 'a', '--budget'], ['context', 'a', '--depth', '2']]) {
      const res = await cli(args, repo);
      expect(res.code, args.join(' ')).toBe(2);
      expect(res.err).toContain(USAGE);
    }
  });

  it('the help lists context', () => {
    expect(USAGE).toContain('context <target> [--budget tokens] [--json] [--rebuild]');
  });
});
