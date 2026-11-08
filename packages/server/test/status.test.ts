// T58 (S23): GET /api/status (box status-view), read-only, from the deck's own facts; and the
// code graph's `builds` edges read straight from .rehearse/graph.db (box box-evidence, error exit
// "code graph not built yet").

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { NO_GRAPH, type StatusTable } from '@rehearse/core';
import { makeEpic } from '../../core/test/helpers.js';
import { approvedEpic, ME } from '../../core/test/trust/helpers.js';
import { inRepo, VERIFIER } from '../../core/test/trust/keys.js';
import { buildStatus, execGit, GRAPH_FILE, newToken, readGraphBuilds, repoFileReader, startServer, type RunningServer, type ServerSession } from '../src/index.js';

const UI = mkdtempSync(join(tmpdir(), 'rehearse-ui-'));
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=Ada', '-c', 'user.email=ada@x.y', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

/** The shop EPIC committed in a fresh repo (branch main); a commit builds the cart box. */
function committedShop(approved = true): { dir: string; top: string } {
  const dir = inRepo(approved ? approvedEpic() : makeEpic());
  const top = dirname(dir);
  git(top, 'checkout', '-q', '-b', 'main');
  git(top, 'add', '-A');
  git(top, 'commit', '-q', '-m', 'shop');
  git(top, 'commit', '-q', '--allow-empty', '-m', 'build cart\n\nFlow-Box: cart');
  return { dir, top };
}

async function serve(dir: string): Promise<{ url: string; token: string; origin: string }> {
  const session: ServerSession = { token: newToken(), identity: ME, signer: { ok: false, reason: 'no key in this test' } };
  // No Birdview data and no unit report: the page must say so, not guess.
  running = await startServer({ epicDir: dir, uiDir: UI, port: 0, session, verifier: VERIFIER, birdview: { port: 9 }, deckSources: async () => ({ birdviewData: null }) });
  return { url: running.url, token: session.token, origin: new URL(running.url).origin };
}

describe('GET /api/status', () => {
  it('needs the token and a same-origin Origin; only GET and HEAD', async () => {
    const { dir } = committedShop();
    const { url, token } = await serve(dir);
    expect((await fetch(new URL('api/status?epic=2026-11-05-shop', url))).status).toBe(403);
    expect((await fetch(new URL('api/status', url), { headers: { 'x-rehearse-token': 'wrong' } })).status).toBe(403);
    expect((await fetch(new URL('api/status', url), { headers: { 'x-rehearse-token': token, origin: 'http://evil.example' } })).status).toBe(403);
    const post = await fetch(new URL('api/status', url), { method: 'POST', headers: { 'x-rehearse-token': token } });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });

  it('returns one row per story, the header and the sources; no unit report and no Birdview results are said', async () => {
    const { dir, top } = committedShop();
    const { url, token, origin } = await serve(dir);
    const before = git(top, 'status', '--porcelain', '--ignored');
    const res = await fetch(new URL('api/status?epic=2026-11-05-shop', url), { headers: { 'x-rehearse-token': token, origin } });
    expect(res.status).toBe(200);
    const { ok, status } = (await res.json()) as { ok: boolean; status: StatusTable };
    expect(ok).toBe(true);
    expect(status.slug).toBe('2026-11-05-shop');
    expect(status.rows.map((r) => r.id).sort()).toEqual(['S1', 'S2']);
    expect(status.header).toMatch(/^\d+ of 2 stories done · \d+ seen working on the real screens · \d+ not done$/);
    const s1 = status.rows.find((r) => r.id === 'S1')!;
    expect(s1.built.evidence.find((e) => e.path === 'cart')).toMatchObject({ state: 'built', text: 'built: 1 Flow-Box commit' });
    expect(s1.built.evidence.find((e) => e.path === 'pay')?.state).toBe('not-built');
    expect(s1.unit.text).toBe('not run');
    expect(status.sources.unit).toMatch(/^no unit report: /);
    expect(status.sources.e2e).toMatch(/^Birdview results not found: /);
    expect(status.sources.graph).toBe(`code graph not built yet: "built" counts Flow-Box commits only (${NO_GRAPH})`);
    expect(status.sources.commit).toMatch(/^main @ [0-9a-f]{7}, \d{4}-\d{2}-\d{2}$/);
    // Read-only: nothing in the repo changed, and no graph was made.
    expect(git(top, 'status', '--porcelain', '--ignored')).toBe(before);
  });

  it('T71: the reads of the Status page (status, coverage) make no graph.db; the sources then say "code graph not built yet"', async () => {
    const { dir, top } = committedShop();
    const { url, token, origin } = await serve(dir);
    const headers = { 'x-rehearse-token': token, origin };
    expect(existsSync(join(top, GRAPH_FILE))).toBe(false);
    const coverage = await fetch(new URL('api/graph?verb=coverage', url), { headers });
    expect(coverage.status).toBe(200);
    expect(await coverage.json()).toEqual({ ok: false, indexed: false, error: 'code graph not built yet' });
    const graphStatus = await fetch(new URL('api/graph?verb=status', url), { headers });
    expect(await graphStatus.json()).toEqual({ ok: true, indexed: false, busy: false });
    const res = await fetch(new URL('api/status?epic=2026-11-05-shop', url), { headers });
    const { status } = (await res.json()) as { status: StatusTable };
    expect(status.sources.graph).toBe(`code graph not built yet: "built" counts Flow-Box commits only (${NO_GRAPH})`);
    expect(existsSync(join(top, GRAPH_FILE))).toBe(false);
  });

  it('another EPIC is a 404', async () => {
    const { dir } = committedShop();
    const { url, token, origin } = await serve(dir);
    const other = await fetch(new URL('api/status?epic=2026-11-05-other', url), { headers: { 'x-rehearse-token': token, origin } });
    expect(other.status).toBe(404);
    expect(((await other.json()) as { error: string }).error).toMatch(/shows the EPIC 2026-11-05-shop/);
  });
});

describe('buildStatus', () => {
  it('uses uncommitted record changes too, and the same facts as the deck', async () => {
    const { dir, top } = committedShop(false);
    const status = await buildStatus({ epicDir: dir, repoTop: top, git: (args) => execGit(args, dir), verifier: VERIFIER, birdviewData: null });
    expect(status.counts).toMatchObject({ stories: 2, done: 0, notDone: 2 });
    expect(status.rows.every((r) => r.missing.some((m) => m.who === 'you'))).toBe(true);
  });
});

/** A graph.db with the tables readGraphBuilds reads: one box with a `builds` edge to a function. */
function graphDb(top: string, indexed = true): void {
  mkdirSync(join(top, '.rehearse'), { recursive: true });
  const db = new DatabaseSync(join(top, GRAPH_FILE));
  db.exec(`CREATE TABLE meta (key TEXT, value TEXT); CREATE TABLE runs (id INTEGER PRIMARY KEY, started_at TEXT);
    CREATE TABLE nodes (id INTEGER PRIMARY KEY, kind TEXT, name TEXT, file TEXT, start_line INTEGER);
    CREATE TABLE edges (from_id INTEGER, to_id INTEGER, kind TEXT);`);
  if (indexed) db.exec(`INSERT INTO meta VALUES ('indexed', '1')`);
  db.exec(`INSERT INTO runs (started_at) VALUES ('2026-11-07T10:30:00Z');
    INSERT INTO nodes VALUES (1, 'box', 'cart', 'docs/epics/2026-11-05-shop/flow.yaml', NULL);
    INSERT INTO nodes VALUES (2, 'function', 'addToCart', 'src/cart.ts', 3);
    INSERT INTO nodes VALUES (3, 'file', 'src/cart.ts', 'src/cart.ts', NULL);
    INSERT INTO nodes VALUES (4, 'box', 'cart', 'docs/epics/2026-11-05-other/flow.yaml', NULL);
    INSERT INTO edges VALUES (1, 2, 'builds'); INSERT INTO edges VALUES (1, 3, 'builds'); INSERT INTO edges VALUES (4, 3, 'builds');
    INSERT INTO edges VALUES (1, 3, 'calls');`);
  db.close();
}

describe('readGraphBuilds', () => {
  it('maps each box of this EPIC to the code its builds edges reach, with the update date', () => {
    const top = mkdtempSync(join(tmpdir(), 'rehearse-graph-'));
    graphDb(top);
    expect(readGraphBuilds(top, '2026-11-05-shop')).toEqual({
      ok: true,
      at: '2026-11-07T10:30:00Z',
      builds: { cart: [{ file: 'src/cart.ts', symbol: 'addToCart', line: 3 }, { file: 'src/cart.ts' }] },
    });
  });

  it('no graph, or one never indexed: code graph not built yet', () => {
    const top = mkdtempSync(join(tmpdir(), 'rehearse-graph-'));
    expect(readGraphBuilds(top, '2026-11-05-shop')).toEqual({ ok: false, why: NO_GRAPH });
    graphDb(top, false);
    expect(readGraphBuilds(top, '2026-11-05-shop')).toEqual({ ok: false, why: NO_GRAPH });
  });

  it('an unreadable graph says why', () => {
    const top = mkdtempSync(join(tmpdir(), 'rehearse-graph-'));
    mkdirSync(join(top, '.rehearse'));
    writeFileSync(join(top, GRAPH_FILE), 'not a database');
    const g = readGraphBuilds(top, '2026-11-05-shop');
    expect(g.ok).toBe(false);
    expect(!g.ok && g.why).toMatch(/^the code graph could not be read \(.+\), so only Flow-Box commits were looked at$/);
  });
});

describe('repoFileReader', () => {
  it('reads a repo file, and undefined when missing or too big', () => {
    const top = mkdtempSync(join(tmpdir(), 'rehearse-files-'));
    writeFileSync(join(top, 'a.ts'), 'if (x) {}');
    writeFileSync(join(top, 'big.ts'), 'x'.repeat(100));
    const read = repoFileReader(top, 50);
    expect(read('a.ts')).toBe('if (x) {}');
    expect(read('none.ts')).toBeUndefined();
    expect(read('big.ts')).toBeUndefined();
  });
});
