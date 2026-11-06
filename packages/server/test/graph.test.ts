// S9 (EPIC 2026-11-05-code-graph): the graph route of `rehearse serve` (box serve-query) and the
// file watcher (box watch). The graph is the real @rehearse/graph on a copy of its shop fixture.
// The builds edges come from T30's linker; until it lands, a test linker adds the box nodes and
// a `builds` edge, so the route answers what S9's examples show.

import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { GraphNode, Linker } from '@rehearse/graph';
import { SHOP } from '../../core/test/helpers.js';
import {
  createGraphService,
  newToken,
  repoRoot,
  startServer,
  watchedPath,
  watchFiles,
  type Clock,
  type GraphService,
  type RunningServer,
  type ServerSession,
  type WatchFiles,
} from '../src/index.js';

const GRAPH_SHOP = fileURLToPath(new URL('../../graph/test/fixtures/shop', import.meta.url));

function shopCopy(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'rehearse-serve-graph-')), 'shop');
  cpSync(GRAPH_SHOP, root, { recursive: true });
  return root;
}

const boxNode = (path: string, id = `box ${path}`): GraphNode => ({
  id, kind: 'box', name: path, terms: path.replace(/[/-]/g, ' '), language: 'record', targetOnly: false, rank: 0,
});

/** Stands in for T30's builds linker: box checkout/pay builds charge; box checkout/refund builds nothing. */
const buildsLinker = (payId = 'box checkout/pay'): Linker => ({
  name: 'test-builds',
  source: 'git',
  async link({ graph }) {
    const charge = graph.nodesNamed('charge')[0]!;
    return {
      nodes: [boxNode('checkout/pay', payId), boxNode('checkout/refund')],
      edges: [{ from: payId, to: charge.id, kind: 'builds', trust: 'exact', source: 'git' }],
    };
  },
});

/** A watcher the test drives, and a clock whose timers run only when the test says. */
function fakes() {
  const listeners: ((path: string) => void)[] = [];
  let closed = 0;
  const watch: WatchFiles = (_root, onChange) => {
    listeners.push(onChange);
    return { close: () => void closed++ };
  };
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let next = 0;
  const clock: Clock = {
    set: (fn, ms) => (timers.set(++next, { fn, ms }), next),
    clear: (h) => void timers.delete(h as number),
  };
  return {
    watch,
    clock,
    save: (path: string) => listeners.forEach((l) => l(path)),
    watching: () => listeners.length,
    closed: () => closed,
    timers: () => [...timers.values()],
    tick: () => {
      const due = [...timers.values()];
      timers.clear();
      due.forEach((t) => t.fn());
    },
  };
}

const session = (): ServerSession => ({ token: newToken(), identity: { by: 'me@example.com' }, signer: { ok: false, reason: 'off' } });

let running: RunningServer | undefined;
let service: GraphService | undefined;
afterEach(async () => {
  await running?.close();
  await service?.close();
  running = undefined;
  service = undefined;
});

async function serve(root: string, payId?: string) {
  const s = session();
  const f = fakes();
  service = createGraphService({ root, graph: { linkers: [buildsLinker(payId)] }, watch: f.watch, clock: f.clock });
  running = await startServer({ epicDir: SHOP, uiDir: mkdtempSync(join(tmpdir(), 'rehearse-ui-')), port: 0, session: s, graph: service });
  const get = (query: string, headers: Record<string, string> = { 'x-rehearse-token': s.token }) =>
    fetch(new URL(`api/graph?${query}`, running!.url), { headers });
  return { s, f, get };
}

describe('S9 serve-query: GET /api/graph', () => {
  it('S9-A1 show "box checkout/pay" gives the builds edge to charge, exact, with the session token and same Origin', async () => {
    const { s, get } = await serve(shopCopy());
    const res = await get(`verb=show&target=${encodeURIComponent('box checkout/pay')}`, { 'x-rehearse-token': s.token, origin: running!.url.replace(/\/$/, '') });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ verb: 'show', ok: true, exitCode: 0 });
    expect(body.nodes[0]).toMatchObject({ kind: 'box', name: 'checkout/pay' });
    expect(body.edges).toEqual([expect.objectContaining({ kind: 'builds', toName: 'charge', trust: 'exact' })]);
    expect(body.ends[body.edges[0].to]).toEqual({ kind: 'function', file: 'src/pay.ts', range: '10-30' });
  });

  it('S9-A1 show charge gives its code, its call edges and its AST outline', async () => {
    const { get } = await serve(shopCopy());
    const body = await (await get('verb=show&target=charge')).json();
    expect(body.nodes[0]).toMatchObject({ name: 'charge', file: 'src/pay.ts', range: '10-30' });
    expect(body.nodes[0].code).toContain('export function charge(orderId: string, amount: number): Charge {');
    expect(body.edges.some((e: { kind: string; fromName: string }) => e.kind === 'builds' && e.fromName === 'checkout/pay')).toBe(true);
    expect(body.outline.root).toMatchObject({ type: 'function_declaration', name: 'charge' });
  });

  it('S9-A1 near gives the call graph around a node, to the depth asked', async () => {
    const { get } = await serve(shopCopy());
    const names = async (q: string) => (await (await get(q)).json()).nodes.map((n: { name: string }) => n.name);
    const one = await names('verb=near&target=getOrderById');
    expect(one).toEqual(expect.arrayContaining(['loadRow', 'loadOrder', 'handle']));
    expect(one).not.toContain('getOrder');
    expect(await names('verb=near&target=getOrderById&depth=2')).toContain('getOrder');
    expect((await get('verb=near&target=loadOrder&depth=9')).status).toBe(400);
  });

  it('S9-A1 a box node with another ID is still found by "box <path>"', async () => {
    const { get } = await serve(shopCopy(), 'record box 2026-11-05-code-graph checkout/pay');
    const body = await (await get(`verb=show&target=${encodeURIComponent('box checkout/pay')}`)).json();
    expect(body.nodes[0].id).toBe('record box 2026-11-05-code-graph checkout/pay');
    expect(body.edges[0]).toMatchObject({ kind: 'builds', toName: 'charge' });
  });

  it('S9-A1 two EPICs with a box of the same path: "box <path>" is the served EPIC\'s box', async () => {
    const recordBox = (epic: string): GraphNode => ({ ...boxNode('checkout/pay', `rehearse record ${epic} . box:checkout/pay`), file: `docs/epics/${epic}/flow.yaml` });
    const twoEpics: Linker = {
      name: 'two-epics',
      source: 'record',
      async link() {
        return { nodes: [recordBox('2026-01-01-a'), recordBox('2026-02-02-b'), { ...boxNode('checkout/pay', 'rehearse git . . box:checkout/pay'), language: 'git' }], edges: [] };
      },
    };
    const root = shopCopy();
    for (const epic of ['2026-01-01-a', '2026-02-02-b', undefined]) {
      service = createGraphService({ root, graph: { linkers: [twoEpics] }, watch: false, ...(epic ? { epic: join('docs', 'epics', epic) } : {}) });
      const a = await service.answer({ verb: 'show', target: 'box checkout/pay' });
      expect(a.nodes[0]!.id).toBe(`rehearse record ${epic ?? '2026-01-01-a'} . box:checkout/pay`);
      await service.close();
    }
    service = undefined;
  });

  it('S9-A2 show "box checkout/refund" has no builds edge; an unknown box is 404 "not found"', async () => {
    const { get } = await serve(shopCopy());
    const refund = await (await get(`verb=show&target=${encodeURIComponent('box checkout/refund')}`)).json();
    expect(refund.ok).toBe(true);
    expect(refund.edges.filter((e: { kind: string }) => e.kind === 'builds')).toEqual([]);
    const missing = await get(`verb=show&target=${encodeURIComponent('box checkout/none')}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ ok: false, exitCode: 1, nodes: [], edges: [] });
  });

  it('S9-A4 no token, a wrong token or another Origin gets 403 and no graph data, and never opens the graph', async () => {
    const root = shopCopy();
    const { s, f, get } = await serve(root);
    for (const headers of [{} as Record<string, string>, { 'x-rehearse-token': 'nope' }, { 'x-rehearse-token': s.token, origin: 'http://evil.example' }]) {
      const res = await get('verb=show&target=charge', headers);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(Object.keys(body).sort()).toEqual(['error', 'ok']);
      expect(JSON.stringify(body)).not.toContain('charge');
    }
    expect(f.watching()).toBe(0);
  });

  it('S9 bad queries are 400: an unknown verb, no target', async () => {
    const { get } = await serve(shopCopy());
    expect((await get('verb=context&target=charge')).status).toBe(400);
    expect((await get('verb=path&target=charge')).status).toBe(400);
    expect((await get('verb=find')).status).toBe(400);
    expect((await get('verb=show')).status).toBe(400);
    expect((await get('verb=show&target=charge', { 'x-rehearse-token': 'x' })).status).toBe(403);
    expect((await fetch(new URL('api/graph?verb=show&target=charge', running!.url), { method: 'POST' })).status).toBe(405);
  });
});

describe('T40 the code map: GET /api/graph?verb=map|find|path|status', () => {
  it('map level packages gives the totals, the packages and the boxes the code serves', async () => {
    const { get } = await serve(shopCopy());
    const res = await get('verb=map&level=packages');
    expect(res.status).toBe(200);
    const map = await res.json();
    expect(map).toMatchObject({ ok: true, level: 'packages', name: 'the repo' });
    expect(map.totals.files).toBeGreaterThan(3);
    expect(map.totals.functions).toBeGreaterThan(3);
    const all = map.nodes.flatMap((n: { boxes: { path: string }[] }) => n.boxes.map((b) => b.path));
    expect(all).toContain('checkout/pay');
  });

  it('map level file gives the functions of a file, charge serving box checkout/pay; tests=hide leaves the tests out', async () => {
    const { get } = await serve(shopCopy());
    const map = await (await get(`verb=map&level=file&target=${encodeURIComponent('src/pay.ts')}`)).json();
    const charge = map.nodes.find((n: { name: string; outside: boolean }) => n.name === 'charge' && !n.outside);
    expect(charge.boxes).toEqual([expect.objectContaining({ path: 'checkout/pay' })]);
    const orders = await (await get(`verb=map&level=file&target=${encodeURIComponent('src/orders.ts')}`)).json();
    expect(orders.nodes.some((n: { kind: string }) => n.kind === 'test')).toBe(true);
    const hidden = await (await get(`verb=map&level=file&target=${encodeURIComponent('src/orders.ts')}&tests=hide`)).json();
    expect(hidden.nodes.some((n: { kind: string }) => n.kind === 'test')).toBe(false);
  });

  it('map: a bad level, no target or a bad epic is 400; an unknown package is 404', async () => {
    const { get } = await serve(shopCopy());
    expect((await get('verb=map')).status).toBe(400);
    expect((await get('verb=map&level=everything')).status).toBe(400);
    expect((await get('verb=map&level=file')).status).toBe(400);
    expect((await get('verb=map&level=packages&epic=..%2Fx')).status).toBe(400);
    const missing = await get('verb=map&level=package&target=nope');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ ok: false, notes: ['not found'] });
  });

  it('find gives each hit its place on the map; path gives the chain of calls', async () => {
    const { get } = await serve(shopCopy());
    const found = await (await get('verb=find&target=charge')).json();
    const hit = found.nodes.find((n: { name: string }) => n.name === 'charge');
    expect(found.places[hit.id]).toMatchObject({ file: 'src/pay.ts' });
    const chain = await (await get('verb=path&target=handle&to=loadRow')).json();
    expect(chain.ok).toBe(true);
    expect(chain.nodes[0].name).toBe('handle');
    expect(chain.nodes.at(-1).name).toBe('loadRow');
    expect((await get('verb=path&target=loadRow&to=handle')).status).toBe(200);
    expect((await get('verb=path&target=nope&to=handle')).status).toBe(404);
  });

  it('status answers at once: not indexed before the first query, indexed after', async () => {
    const { get } = await serve(shopCopy());
    expect(await (await get('verb=status')).json()).toMatchObject({ ok: true, indexed: false, busy: false });
    await get('verb=map&level=packages');
    expect(await (await get('verb=status')).json()).toMatchObject({ ok: true, indexed: true, busy: false, lastRun: { mode: 'cold' } });
  });

  it('every new verb gets 403 without the token or from another Origin, and never opens the graph', async () => {
    const { s, f, get } = await serve(shopCopy());
    for (const q of ['verb=map&level=packages', 'verb=find&target=charge', 'verb=path&target=handle&to=loadRow', 'verb=status']) {
      for (const headers of [{} as Record<string, string>, { 'x-rehearse-token': s.token, origin: 'http://evil.example' }]) {
        const res = await get(q, headers);
        expect(res.status).toBe(403);
        expect(Object.keys(await res.json()).sort()).toEqual(['error', 'ok']);
      }
    }
    expect(f.watching()).toBe(0);
  });
});

describe('S9 watch: the watcher updates the graph on save', () => {
  it('S9-A3 a save of src/pay.ts makes an update with trigger watch, not a cold index, and the next show has the saved code', async () => {
    const root = shopCopy();
    const { f, get } = await serve(root);
    await get('verb=show&target=charge');
    expect(f.watching()).toBe(1);

    const pay = join(root, 'src/pay.ts');
    writeFileSync(pay, "// Payments.\n\nexport function charge(orderId: string, amount: number) {\n  return { orderId, amount, ok: amount >= 0 };\n}\n");
    f.save('src/pay.ts');
    f.save('src/pay.ts');
    expect(f.timers()).toHaveLength(1);
    f.tick();
    await service!.idle();
    expect(service!.lastWatch()).toMatchObject({ changed: ['src/pay.ts'], run: { mode: 'update', trigger: 'watch', changedFiles: 1, status: 'written' } });

    const body = await (await get('verb=show&target=charge')).json();
    expect(body.nodes[0].code).toContain('ok: amount >= 0');
    expect(body.nodes[0].range).toBe('3-5');
  });

  it('S9-A3 the saves are debounced: many saves, one update after the quiet time', async () => {
    const root = shopCopy();
    const f = fakes();
    service = createGraphService({ root, watch: f.watch, clock: f.clock, debounceMs: 200 });
    await service.answer({ verb: 'show', target: 'charge' });
    writeFileSync(join(root, 'src/pay.ts'), 'export function charge() { return 1; }\n');
    writeFileSync(join(root, 'src/orders.ts'), 'export function getOrderById() { return 2; }\n');
    f.save('src/pay.ts');
    f.save('src/orders.ts');
    f.save('src/pay.ts');
    expect(f.timers()).toEqual([expect.objectContaining({ ms: 200 })]);
    f.tick();
    await service.idle();
    expect(service.lastWatch()).toMatchObject({ changed: ['src/orders.ts', 'src/pay.ts'], run: { mode: 'update', trigger: 'watch', changedFiles: 2 } });
  });

  it('S9-A3 files that cannot change the graph start no update; before the first query nothing is watched', async () => {
    const root = shopCopy();
    const f = fakes();
    service = createGraphService({ root, watch: f.watch, clock: f.clock });
    expect(f.watching()).toBe(0);
    await service.answer({ verb: 'show', target: 'charge' });
    for (const p of ['README.md', 'node_modules/x/index.ts', '.rehearse/graph.db', '.git/index', 'dist/pay.js', 'src/types.d.ts']) f.save(p);
    expect(f.timers()).toEqual([]);
    expect(['src/pay.ts', 'api/orders.py', 'tsconfig.json', 'pyproject.toml'].every(watchedPath)).toBe(true);
    await service.close();
    expect(f.closed()).toBe(1);
    f.save('src/pay.ts');
    expect(f.timers()).toEqual([]);
    service = undefined;
  });

  it('S9-A3 the real watcher starts and closes on a repo, and on a folder that is gone, without a throw', async () => {
    const root = shopCopy();
    const seen: string[] = [];
    const w = watchFiles(root, (p) => seen.push(p));
    writeFileSync(join(root, 'src/pay.ts'), 'export const n = 1;\n');
    await new Promise((r) => setTimeout(r, 100));
    w.close();
    // Where the OS gives events (not in every sandbox), they are repo paths.
    expect(seen.every((p) => !p.startsWith('/'))).toBe(true);
    expect(() => watchFiles(join(root, 'no-such-folder'), () => undefined).close()).not.toThrow();
  });

  it('S9 the graph is on the repo of the EPIC: the git top level above the EPIC folder', () => {
    const root = shopCopy();
    writeFileSync(join(root, '.git'), 'gitdir: /elsewhere\n');
    expect(repoRoot(join(root, 'docs/epics/x'))).toBe(root);
    expect(repoRoot(fileURLToPath(new URL('.', import.meta.url)))).toBe(fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, ''));
  });
});
