// Pure models of the big picture diagrams generated from the record (D42, design pages 5–7):
// user flow, data flow (level 1) and system flowchart, and their layout. Exact graphs on the
// shop fixture; the real EPIC checks that every box appears once and the layout is readable.

import { describe, expect, it } from 'vitest';
import type { Box, Flow } from '@rehearse/core';
import { dataFlow, parseAccess } from '../src/model/dataflow.js';
import { boxAt } from '../src/model/diagram.js';
import { flowPaths } from '../src/model/features.js';
import { dotLabel, layoutColumns, layoutGraph, type DGraph, type GraphLayout, type Rect } from '../src/model/graph.js';
import { OUTSIDE, systemFlowchart } from '../src/model/sysflow.js';
import { userFlow } from '../src/model/userflow.js';
import { realEpic, reviewEpic } from './fixture.js';

const edgeRows = (g: DGraph) => g.edges.map((e) => [e.from, e.to, e.label, e.kind]);
const rootIds = (flow: Flow | undefined) => (flow?.root.boxes ?? []).map((b) => b.id);
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** No two nodes overlap; nothing stands in the text under a start or end dot; every node is placed. */
function expectReadable(graph: DGraph, lay: GraphLayout) {
  for (const n of graph.nodes) expect(lay.nodes[n.id], n.id).toBeDefined();
  const rects = graph.nodes.map((n) => ({ id: n.id, r: lay.nodes[n.id]! }));
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i]!.r, rects[j]!.r), `${rects[i]!.id} overlaps ${rects[j]!.id}`).toBe(false);
  for (const n of graph.nodes) {
    const below = dotLabel(n);
    if (!below) continue;
    const r = lay.nodes[n.id]!;
    const text = { x: r.x + r.w / 2 - below.w / 2, y: r.y + r.h, w: below.w, h: below.h };
    for (const o of rects) if (o.id !== n.id) expect(overlap(text, o.r), `${o.id} stands in the label of ${n.id}`).toBe(false);
  }
  for (const r of Object.values(lay.nodes)) {
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(lay.width);
    expect(r.y + r.h).toBeLessThanOrEqual(lay.height);
  }
  for (const e of graph.edges) expect(lay.edges.find((l) => l.id === e.id)?.points.length ?? 0, `edge ${e.from} → ${e.to}`).toBeGreaterThanOrEqual(2);
}

describe('user flow (design page 5)', () => {
  it('T14 2: human boxes as screens and actions, decisions, dots; other lanes fold into one step per run', () => {
    const view = reviewEpic();
    const uf = userFlow(view.flow, view.prd);
    expect(uf.humanLanes.map((l) => l.role)).toEqual(['builder']);
    expect(uf.nodes.map((n) => [n.id, n.shape, n.title, n.tag, n.rows?.map((r) => r.path)])).toEqual([
      ['start', 'start', 'Buyer opens the cart', undefined, undefined],
      ['cart', 'action', 'Check out the cart', undefined, undefined],
      ['fold:pay', 'fold', 'System', '1 step', ['pay']],
      ['in-stock', 'decision', 'Item in stock?', 'System', undefined],
      ['fold:ship', 'fold', 'System', '2 steps', ['ship', 'notify']],
      ['failed', 'end', 'No order', undefined, undefined],
      ['done', 'end', 'Order shipped', 'System', undefined],
    ]);
    expect(edgeRows(uf)).toEqual([
      ['start', 'cart', undefined, 'normal'],
      ['cart', 'fold:pay', undefined, 'normal'],
      ['cart', 'failed', 'empty-cart', 'error'],
      ['fold:pay', 'in-stock', undefined, 'normal'],
      ['in-stock', 'fold:ship', 'yes', 'branch'],
      ['in-stock', 'failed', 'no', 'branch'],
      // ship → done and notify → done become one edge out of the folded step.
      ['fold:ship', 'done', undefined, 'normal'],
    ]);
    expect(uf.offPath).toEqual([]);
  });

  it('T14 2: an output box in a human lane is a screen; boxes no human box connects to are off the path', () => {
    const view = reviewEpic();
    boxAt(view.flow, 'notify')!.lane = 'builder';
    view.flow!.root.boxes.push({ id: 'audit', kind: 'process', lane: 'system', title: 'Nightly audit' } as Box);
    const uf = userFlow(view.flow, view.prd);
    expect(uf.nodes.find((n) => n.id === 'notify')?.shape).toBe('screen');
    expect(uf.nodes.find((n) => n.id === 'fold:ship')?.rows?.map((r) => r.path)).toEqual(['ship']);
    expect(uf.offPath).toEqual([{ path: 'audit', title: 'Nightly audit', lane: 'System' }]);
  });

  it('T14 2: with no human lane there is no path', () => {
    const view = reviewEpic();
    view.prd!.roles[0]!.kind = 'agent';
    const uf = userFlow(view.flow, view.prd);
    expect(uf.humanLanes).toEqual([]);
    expect(uf.nodes).toEqual([]);
    expect(uf.offPath.map((r) => r.path).sort()).toEqual(rootIds(view.flow).sort());
  });

  it('T14 2: the real EPIC: every root box appears once; loops back and branch labels stay', () => {
    const view = realEpic();
    const uf = userFlow(view.flow, view.prd);
    const shown = [...uf.nodes.flatMap((n) => (n.rows ? n.rows.map((r) => r.path) : [n.path!])), ...uf.offPath.map((r) => r.path)];
    expect([...shown].sort()).toEqual(rootIds(view.flow).sort());
    const ids = new Set(uf.nodes.map((n) => n.id));
    for (const e of uf.edges) expect(ids.has(e.from) && ids.has(e.to), `${e.from} → ${e.to}`).toBe(true);
    expect(edgeRows(uf)).toContainEqual(['gate-ok', 'review', 'no', 'branch']);
    expect(edgeRows(uf)).toContainEqual(['happy', 'signing-key', 'approve', 'branch']);
    expect(edgeRows(uf)).toContainEqual(['more-scenarios', 'review', 'yes', 'branch']);
    expect(edgeRows(uf)).toContainEqual(['new-epic', 'rejected', 'epic-exists, bad-slug', 'error']);
    // CI never meets a human box.
    expect(uf.offPath.every((r) => r.lane === 'CI')).toBe(true);
  });
});

describe('data flow (design page 6)', () => {
  it('T14 3: an access names its entity and its field or change in words', () => {
    expect(parseAccess('Story.status:draft->signed')).toEqual({ entity: 'Story', words: 'status: draft→signed' });
    expect(parseAccess('Epic.status:->draft')).toEqual({ entity: 'Epic', words: 'status: →draft' });
    expect(parseAccess('Box.*')).toEqual({ entity: 'Box', words: 'all fields' });
    expect(parseAccess('nonsense')).toBeUndefined();
  });

  it('T14 3: entities, numbered processes and stores, and the flows between them', () => {
    const view = reviewEpic();
    const df = dataFlow(view.flow, view.prd, view.entities);
    expect(df.processes).toEqual([
      { path: 'cart', number: '1.0', title: 'Check out the cart' },
      { path: 'pay', number: '2.0', title: 'Charge the buyer' },
      { path: 'ship', number: '3.0', title: 'Ship the order' },
    ]);
    expect(df.stores).toEqual([{ entity: 'Order', number: 'D1', known: true }]);
    expect(df.nodes.map((n) => [n.id, n.shape, n.tag])).toEqual([
      ['x:builder', 'entity', 'human'],
      ['p:cart', 'process', '1.0'],
      ['p:pay', 'process', '2.0'],
      ['p:ship', 'process', '3.0'],
      ['d:Order', 'store', 'D1'],
    ]);
    expect(edgeRows(df)).toEqual([
      ['x:builder', 'p:cart', 'items', 'data'],
      ['p:cart', 'd:Order', 'id, status: →draft', 'write'],
      ['d:Order', 'p:pay', 'status', 'read'],
      ['p:pay', 'd:Order', 'status: draft→paid', 'write'],
      ['p:ship', 'd:Order', 'status: paid→shipped', 'write'],
      // orderId goes from cart to pay, and from pay through the in-stock check to ship.
      ['p:cart', 'p:pay', 'orderId', 'data'],
      ['p:pay', 'p:ship', 'orderId', 'data'],
    ]);
    // Three processes write Order: none is the only writer. notify has no data.
    expect(df.onlyWriters).toEqual([]);
    expect(df.noData).toEqual([{ path: 'notify', title: 'Email the receipt', lane: 'System' }]);
  });

  it('T14 3: the note lists the process that alone writes an entity; context fields are not drawn', () => {
    const view = reviewEpic();
    boxAt(view.flow, 'ship')!.writes = ['Parcel.label'];
    view.flow!.context = { orderId: 'string' };
    const df = dataFlow(view.flow, view.prd, view.entities);
    expect(df.stores).toEqual([
      { entity: 'Order', number: 'D1', known: true },
      { entity: 'Parcel', number: 'D2', known: false },
    ]);
    expect(df.onlyWriters.map((w) => [w.entity, w.store, w.process.number])).toEqual([['Parcel', 'D2', '3.0']]);
    expect(df.edges.some((e) => e.label === 'orderId')).toBe(false);
  });

  it('T14 3: the real EPIC: every root box is a process once or listed once as having no data', () => {
    const view = realEpic();
    const df = dataFlow(view.flow, view.prd, view.entities);
    const main = (view.flow?.root.boxes ?? []).filter((b) => !['start', 'end', 'decision'].includes(b.kind)).map((b) => b.id);
    expect([...df.processes.map((p) => p.path), ...df.noData.map((r) => r.path)].sort()).toEqual(main.sort());
    expect(df.processes.map((p) => p.number)).toEqual(df.processes.map((_, i) => `${i + 1}.0`));
    expect(df.stores.map((s) => s.number)).toEqual(df.stores.map((_, i) => `D${i + 1}`));
    // CI is an external entity: ci-run reads the record (C36).
    expect(df.nodes.filter((n) => n.shape === 'entity').map((n) => n.id)).toEqual(['x:builder', 'x:agent', 'x:ci']);
    const ids = new Set(df.nodes.map((n) => n.id));
    for (const e of df.edges) expect(ids.has(e.from) && ids.has(e.to), `${e.from} → ${e.to}`).toBe(true);
    expect(df.onlyWriters.map((w) => w.entity)).toContain('Approval');
  });
});

describe('system flowchart (design page 7)', () => {
  it('T14 4: one column per system lane, nested steps in a frame, checks, documents, other lanes last', () => {
    const view = reviewEpic();
    const sf = systemFlowchart(view.flow, view.prd);
    expect(sf.columns).toEqual(['col:system', OUTSIDE]);
    expect(sf.groups.map((g) => [g.id, g.kind, g.parent, g.path])).toEqual([
      ['col:system', 'column', undefined, undefined],
      ['c:ship', 'cluster', 'col:system', 'ship'],
      [OUTSIDE, 'column', undefined, undefined],
    ]);
    expect(sf.nodes.map((n) => [n.id, n.shape, n.group])).toEqual([
      ['pay', 'step', 'col:system'],
      ['in-stock', 'decision', 'col:system'],
      ['ship/pack', 'step', 'c:ship'],
      ['ship/send', 'document', 'c:ship'],
      ['notify', 'document', 'col:system'],
      ['done', 'terminal', 'col:system'],
      ['o:cart', 'connector', OUTSIDE],
      ['o:failed', 'connector', OUTSIDE],
    ]);
    expect(edgeRows(sf)).toEqual([
      ['ship/pack', 'ship/send', undefined, 'normal'],
      ['o:cart', 'pay', undefined, 'normal'],
      ['pay', 'in-stock', undefined, 'normal'],
      // Into ship means into its first step; out of ship means out of its last step.
      ['in-stock', 'ship/pack', 'yes', 'branch'],
      ['in-stock', 'o:failed', 'no', 'branch'],
      ['ship/send', 'done', undefined, 'normal'],
      ['ship/send', 'notify', undefined, 'normal'],
      ['notify', 'done', undefined, 'normal'],
    ]);
  });

  it('T14 4: the real EPIC: every system box appears once, as a step or a frame', () => {
    const view = realEpic();
    const sf = systemFlowchart(view.flow, view.prd);
    expect(sf.columns).toEqual(['col:rehearse', 'col:ci', OUTSIDE]);
    const system = new Set(sf.systemLanes.map((l) => l.role));
    const paths = flowPaths(view.flow).filter((p) => system.has(boxAt(view.flow, p)!.lane) && system.has(boxAt(view.flow, p.split('/')[0]!)!.lane));
    const shown = [...sf.nodes.filter((n) => n.shape !== 'connector').map((n) => n.path!), ...sf.groups.flatMap((g) => (g.path ? [g.path] : []))];
    expect([...shown].sort()).toEqual([...paths].sort());
    const connectors = sf.nodes.filter((n) => n.shape === 'connector').map((n) => n.path);
    expect(new Set(connectors).size).toBe(connectors.length);
    const ids = new Set(sf.nodes.map((n) => n.id));
    for (const e of sf.edges) expect(ids.has(e.from) && ids.has(e.to), `${e.from} → ${e.to}`).toBe(true);
    expect(edgeRows(sf)).toContainEqual(['valid', 'simulate/load', 'yes', 'branch']);
    expect(edgeRows(sf)).toContainEqual(['valid', 'o:draft-record', 'no', 'branch']);
  });
});

describe('layout (T14 5)', () => {
  it('T14 5: the shop user flow and data flow are readable: every node placed, none overlap', async () => {
    const view = reviewEpic();
    const uf = userFlow(view.flow, view.prd);
    expectReadable(uf, await layoutGraph(uf, 'RIGHT'));
    const df = dataFlow(view.flow, view.prd, view.entities);
    expectReadable(df, await layoutGraph(df, 'DOWN'));
  });

  it('T14 5: system flowchart columns stand side by side and hold their own steps', async () => {
    const view = reviewEpic();
    const sf = systemFlowchart(view.flow, view.prd);
    const lay = await layoutColumns(sf, sf.columns, new Set([OUTSIDE]));
    expectReadable(sf, lay);
    const sys = lay.groups['col:system']!;
    const out = lay.groups[OUTSIDE]!;
    expect(sys.x + sys.w).toBeLessThan(out.x);
    const inside = (r: Rect, g: Rect) => r.x >= g.x && r.y >= g.y && r.x + r.w <= g.x + g.w && r.y + r.h <= g.y + g.h;
    for (const n of sf.nodes) expect(inside(lay.nodes[n.id]!, n.group === OUTSIDE ? out : sys), n.id).toBe(true);
    expect(inside(lay.nodes['ship/pack']!, lay.groups['c:ship']!)).toBe(true);
    // A connector stands at the height of the box it links to.
    const cart = lay.nodes['o:cart']!;
    const pay = lay.nodes['pay']!;
    expect(cart.y + cart.h / 2).toBeCloseTo(pay.y + pay.h / 2, 0);
  });

  it('T14 5: the real EPIC lays out all three diagrams with no error and no overlap', async () => {
    const view = realEpic();
    const uf = userFlow(view.flow, view.prd);
    expectReadable(uf, await layoutGraph(uf, 'RIGHT'));
    const df = dataFlow(view.flow, view.prd, view.entities);
    expectReadable(df, await layoutGraph(df, 'DOWN'));
    const sf = systemFlowchart(view.flow, view.prd);
    expectReadable(sf, await layoutColumns(sf, sf.columns, new Set([OUTSIDE])));
  });
});
