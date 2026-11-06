// The code graph verbs on the CLI (code-graph EPIC S1, S2, S3, S5): find, show, near, path,
// their exit codes and --json. The repo is a git copy of packages/graph/test/fixtures/shop.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { main, run, USAGE } from '../src/index.js';

const SHOP = fileURLToPath(new URL('../../graph/test/fixtures/shop', import.meta.url));

async function cli(args: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(args, { cwd, stdout: (t) => (out += t), stderr: (t) => (err += t) });
  return { code, out, err };
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });

/** A git repo with the shop fixture committed, and the .gitignore that `rehearse new` makes. */
function shopRepo(): string {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'rehearse-cli-graph-'))), 'shop');
  cpSync(SHOP, dir, { recursive: true });
  git(dir, 'init', '-q');
  expect(run(['new', '2026-11-06-shop', '--title', 'Shop'], { cwd: dir, stdout: () => {}, stderr: () => {} })).toBe(0);
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'shop');
  return dir;
}

let repo: string;
beforeAll(() => {
  repo = shopRepo();
});

describe('code graph verbs', () => {
  it('S5-A2 the first find makes .rehearse/graph.db by a cold index, answers, and git status stays clean', async () => {
    const fresh = shopRepo();
    expect(existsSync(join(fresh, '.rehearse/graph.db'))).toBe(false);
    const res = await cli(['find', 'order', 'by', 'id', '--json'], join(fresh, 'src'));
    expect(res.code).toBe(0);
    expect(existsSync(join(fresh, '.rehearse/graph.db'))).toBe(true);
    expect(JSON.parse(res.out).nodes[0].name).toBe('getOrderById');
    expect(git(fresh, 'status', '--porcelain')).toBe('');
  });

  it('S1-A1 find --json gives getOrderById first with id, kind, file, range and score', async () => {
    const res = await cli(['find', 'order by id', '--json'], repo);
    expect(res).toMatchObject({ code: 0, err: '' });
    const answer = JSON.parse(res.out);
    expect(answer).toMatchObject({ verb: 'find', ok: true, exitCode: 0 });
    expect(answer.nodes[0]).toMatchObject({ name: 'getOrderById', kind: 'function', file: 'src/orders.ts', range: '12-20' });
    expect(Object.keys(answer.nodes[0])).toEqual(expect.arrayContaining(['id', 'kind', 'file', 'range', 'score']));
    expect(answer.nodes[1].name).toBe('get_order_by_id');
  });

  it('S2-A1 show prints the code and each edge with its trust mark; --json has the SCIP ID', async () => {
    const text = await cli(['show', 'getOrderById'], repo);
    expect(text.code).toBe(0);
    expect(text.out).toContain('const row = loadRow(id);');
    expect(text.out).toContain('getOrderById -calls-> loadRow  (name-match, tree-sitter)');
    const json = JSON.parse((await cli(['show', 'getOrderById', '--json'], repo)).out);
    expect(json.nodes[0].id).toBe('scip-typescript npm app 1.0 src/orders.ts/getOrderById().');
  });

  it('S2-A3 show of an unknown target exits 1 with "not found" and changes no file', async () => {
    const res = await cli(['show', 'noSuchThing'], repo);
    expect(res).toEqual({ code: 1, out: '', err: 'rehearse show: not found: noSuchThing\n' });
    const json = await cli(['near', 'noSuchThing', '--json'], repo);
    expect(json.code).toBe(1);
    expect(JSON.parse(json.out)).toEqual({ verb: 'near', ok: false, exitCode: 1, nodes: [], edges: [], notes: ['not found'] });
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('S2-A4 near --depth 2 reaches getOrder', async () => {
    const one = JSON.parse((await cli(['near', 'getOrderById', '--json'], repo)).out);
    expect(one.nodes.map((n: { name: string }) => n.name)).not.toContain('getOrder');
    const two = JSON.parse((await cli(['near', 'getOrderById', '--depth', '2', '--json'], repo)).out);
    expect(two.nodes.find((n: { name: string }) => n.name === 'getOrder')).toMatchObject({ distance: 2 });
  });

  it('S3-A1 path prints the chain of calls', async () => {
    const res = await cli(['path', 'getOrder', 'getOrderById'], repo);
    expect(res).toEqual({
      code: 0,
      out: 'getOrder -calls-> loadOrder  (name-match, tree-sitter)\nloadOrder -calls-> getOrderById  (name-match, tree-sitter)\n',
      err: '',
    });
  });

  it('S3-A2 path with no path exits 1 with "no path" and changes no file', async () => {
    const res = await cli(['path', 'getOrderById', 'charge', '--json'], repo);
    expect(res.code).toBe(1);
    expect(JSON.parse(res.out)).toEqual({ verb: 'path', ok: false, exitCode: 1, nodes: [], edges: [], notes: ['no path'] });
    expect(res.err).toBe('rehearse path: no path: getOrderById -> charge\n');
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('S5-A1 after an edit, show answers with the new code', async () => {
    const fresh = shopRepo();
    await cli(['find', 'order'], fresh);
    const file = join(fresh, 'src/orders.ts');
    writeFileSync(file, readFileSync(file, 'utf8').replace('loadRow(id);', 'loadRow(id.trim());'));
    expect((await cli(['show', 'getOrderById'], fresh)).out).toContain('loadRow(id.trim());');
  });

  it('S5-A3 --rebuild answers the same', async () => {
    const before = await cli(['find', 'order by id', '--json'], repo);
    const after = await cli(['find', 'order by id', '--json', '--rebuild'], repo);
    expect(after).toEqual(before);
  });

  it('usage errors exit 2: missing target, extra target, bad --depth, unknown option', async () => {
    for (const args of [['show'], ['find'], ['path', 'a'], ['show', 'a', 'b'], ['near', 'a', '--depth', '0'], ['show', 'a', '--depth', '2'], ['find', 'x', '--bogus']]) {
      const res = await cli(args, repo);
      expect(res.code, args.join(' ')).toBe(2);
      expect(res.out).toBe('');
    }
  });

  it('USAGE lists the four verbs; main still runs the other commands', async () => {
    for (const verb of ['find <words>', 'show <target>', 'near <target> [--depth n]', 'path <from> <to>']) expect(USAGE).toContain(verb);
    expect(USAGE).not.toMatch(/approve|sign-?off/i);
    expect((await cli(['--help'], repo)).code).toBe(0);
    expect((await cli(['bogus'], repo)).code).toBe(2);
  });
});
