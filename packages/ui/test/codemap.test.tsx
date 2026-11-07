// T40: the Code map tab. The repo one level at a time (packages, a package, a file), the side
// panel, search, the path helper, the filters and the empty states. The map is a fake through
// CodeMapApiContext and the side panel's `near` a fake through GraphApiContext; the App runs
// against the mock server, so the URL and the box drawer are the real ones.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnswerEdge, AnswerNode, CodeIndex, QueryAnswer } from '@rehearse/server';
import { App } from '../src/App.js';
import { CodeApiContext, type CodeApi } from '../src/code-api.js';
import { CodeMapApiContext, httpCodeMapApi, type CodeMap, type CodeMapApi, type MapBox, type MapNode, type MapOutcome, type MapRequest } from '../src/codemap-api.js';
import { GraphApiContext, type GraphApi, type PanelAnswer } from '../src/graph-api.js';
import { mapElements } from '../src/components/CodeMap.js';
import {
  focusNode, layoutCodeMap, MAX_FIT_ZOOM, mapClick, mapNodeLabel, mapNodeSize, mapNodeTitle, mapView, mapViewport, OUTSIDE_GROUP, placeLoc, plainWords, READABLE_ZOOM, shortTestName, upLoc,
} from '../src/model/codemap.js';
import { sessionClient } from '../src/session-client.js';
import { reviewEpic } from './fixture.js';
import { mockServer, SESSION } from './mock-server.js';

const SLUG = reviewEpic().slug;
const OTHER = '2026-01-01-other';
const codeApi: CodeApi = { index: async () => ({ ok: true, head: { sha: '9'.repeat(40), short: '9999999', subject: 'Head', date: '2026-11-05T10:00:00Z' }, boxes: {} }) as CodeIndex, box: async () => ({ ok: false, error: 'not in this test' }) };

const CHARGE = 'scip-typescript npm @m/b 1.0 src/pay.ts/charge().';
const CHECKOUT = 'scip-typescript npm @m/a 1.0 src/cart.ts/checkout().';
const ROUND = 'scip-typescript npm @m/b 1.0 src/pay.ts/round().';
const TEST = 'scip-typescript npm @m/b 1.0 test/pay.test.ts/charges a card';
const GET = 'scip-typescript npm lodash . lodash/get().';
const CART = 'group:src/cart.ts';
const PAY_TESTS = 'group:test/pay.test.ts';
const LODASH = 'group:outside:lodash';
const IN_STOCK: MapBox = { id: `rehearse record ${SLUG} . box:in-stock`, path: 'in-stock', epic: SLUG };
const ELSEWHERE: MapBox = { id: `rehearse record ${OTHER} . box:ops/run`, path: 'ops/run', epic: OTHER };

const mn = (id: string, name: string, extra: Partial<MapNode> = {}): MapNode => ({ id, kind: 'function', name, rank: 0.01, outside: false, test: false, boxes: [], ...extra });
const TOTALS = { packages: 2, files: 4, functions: 5, tests: 1 };
const level = (l: CodeMap['level'], nodes: MapNode[], edges: CodeMap['edges'], extra: Partial<CodeMap> = {}): CodeMap => ({
  level: l, ok: true, name: 'the repo', nodes, edges, totals: TOTALS, epics: [OTHER, SLUG], hiddenTests: 0, notes: [], ...extra,
});

const PACKAGES = level(
  'packages',
  [
    mn('@m/a', '@m/a', { kind: 'package', rank: 0.3, files: 2, functions: 3, tests: 0, unit: '@m/a' }),
    mn('@m/b', '@m/b', { kind: 'package', rank: 0.6, files: 2, functions: 2, tests: 1, unit: '@m/b', boxes: [IN_STOCK, ELSEWHERE] }),
    mn('outside:lodash', 'lodash', { kind: 'outside', outside: true, rank: 0.001, unit: 'outside:lodash' }),
  ],
  [
    { from: '@m/a', to: '@m/b', count: 4, exact: 3, trust: 'exact', kinds: ['calls', 'imports'] },
    { from: '@m/b', to: 'outside:lodash', count: 1, exact: 0, trust: 'name-match', kinds: ['calls'] },
  ],
);
const PACKAGE_B = level(
  'package',
  [
    mn('src/pay.ts', 'src/pay.ts', { kind: 'file', rank: 0.5, unit: '@m/b', boxes: [IN_STOCK] }),
    mn('test/pay.test.ts', 'test/pay.test.ts', { kind: 'file', test: true, unit: '@m/b' }),
    mn('unit:@m/a', '@m/a', { kind: 'stub', outside: true, rank: 0, unit: '@m/a' }),
  ],
  [
    { from: 'test/pay.test.ts', to: 'src/pay.ts', count: 1, exact: 1, trust: 'exact', kinds: ['calls'] },
    { from: 'unit:@m/a', to: 'src/pay.ts', count: 2, exact: 2, trust: 'exact', kinds: ['calls'] },
  ],
  { target: '@m/b', name: '@m/b', unit: { key: '@m/b', name: '@m/b' } },
);
const FILE_PAY = level(
  'file',
  [
    mn(CHARGE, 'charge', { file: 'src/pay.ts', range: '10-12', rank: 0.2, unit: '@m/b', boxes: [IN_STOCK, ELSEWHERE] }),
    mn(ROUND, 'round', { file: 'src/pay.ts', range: '20-22', unit: '@m/b' }),
    // The code elsewhere, one node per other file or outside package (as the server groups it).
    mn(CART, 'cart.ts', { kind: 'file', file: 'src/cart.ts', outside: true, rank: 0, unit: '@m/a', calls: 1, members: [{ id: CHECKOUT, name: 'checkout', kind: 'function', file: 'src/cart.ts', range: '30-30', to: 0, from: 1 }] }),
    mn(PAY_TESTS, 'pay.test.ts', {
      kind: 'file', file: 'test/pay.test.ts', outside: true, test: true, rank: 0, unit: '@m/b', calls: 1,
      members: [{ id: TEST, name: 'PayService > charge > charges a card', kind: 'test', file: 'test/pay.test.ts', range: '3-9', to: 0, from: 1 }],
    }),
    mn(LODASH, 'lodash', { kind: 'outside', outside: true, rank: 0, unit: 'outside:lodash', calls: 2, members: [{ id: GET, name: 'get', kind: 'function', to: 2, from: 0 }] }),
  ],
  [
    { from: CART, to: CHARGE, count: 1, exact: 1, trust: 'exact', kinds: ['calls'] },
    { from: PAY_TESTS, to: CHARGE, count: 1, exact: 1, trust: 'exact', kinds: ['calls'] },
    { from: CHARGE, to: ROUND, count: 1, exact: 0, trust: 'name-match', kinds: ['calls'] },
    { from: ROUND, to: LODASH, count: 2, exact: 0, trust: 'unresolved', kinds: ['calls'] },
  ],
  { target: 'src/pay.ts', name: 'src/pay.ts', unit: { key: '@m/b', name: '@m/b' } },
);

const an = (id: string, name: string, extra: Partial<AnswerNode> = {}): AnswerNode => ({ id, kind: 'function', name, terms: name, language: 'typescript', targetOnly: false, rank: 0, file: 'src/pay.ts', range: '10-12', ...extra });
const ae = (from: string, fromName: string, to: string, toName: string, kind: AnswerEdge['kind'] = 'calls', trust: AnswerEdge['trust'] = 'exact'): AnswerEdge => ({ from, to, fromName, toName, kind, trust, source: 'tree-sitter' });
const NEAR_CHARGE: PanelAnswer = {
  verb: 'near', ok: true, exitCode: 0, notes: [],
  nodes: [
    an(CHARGE, 'charge', { distance: 0 }),
    an(CHECKOUT, 'checkout', { distance: 1, file: 'src/cart.ts', range: '30-30' }),
    an(ROUND, 'round', { distance: 1, range: '20-22' }),
    an(TEST, 'charges a card', { kind: 'test', file: 'test/pay.test.ts', range: '3-9', distance: 1 }),
    an('route POST /api/pay', 'POST /api/pay', { kind: 'route', file: 'api/pay.py', range: '4-20', distance: 1 }),
  ],
  edges: [
    ae(CHECKOUT, 'checkout', CHARGE, 'charge'),
    ae(CHARGE, 'charge', ROUND, 'round', 'calls', 'name-match'),
    ae(TEST, 'PayService > charges a card', CHARGE, 'charge', 'tests'),
    ae(CHARGE, 'charge', 'route POST /api/pay', 'POST /api/pay', 'http-calls'),
  ],
};

type Answers = { [key: string]: MapOutcome<CodeMap> };
const ok = (map: CodeMap): MapOutcome<CodeMap> => ({ ok: true, value: map });
const BASE: Answers = { packages: ok(PACKAGES), 'package @m/b': ok(PACKAGE_B), 'package @m/a': ok(level('package', [], [], { target: '@m/a', name: '@m/a', unit: { key: '@m/a', name: '@m/a' } })), 'file src/pay.ts': ok(FILE_PAY) };

function fakeMap(answers: Answers = BASE, more: Partial<CodeMapApi> = {}): CodeMapApi & { asked: MapRequest[] } {
  const asked: MapRequest[] = [];
  return {
    asked,
    map: async (q) => {
      asked.push(q);
      const found = answers[q.level === 'packages' ? 'packages' : `${q.level} ${q.target}`] ?? { ok: false, notFound: true, error: 'not found' };
      if (!found.ok) return found;
      // The filters, as the server applies them; auto hides the tests unless nothing else is left.
      const all = found.value.nodes;
      const hide = q.hideTests === true || (q.hideTests === 'auto' && all.some((n) => !n.test && !n.outside));
      const nodes = all.filter((n) => !(hide && n.test) && !(q.hideOutside && n.outside) && (!q.epic || n.boxes.some((b) => b.epic === q.epic)));
      const ids = new Set(nodes.map((n) => n.id));
      const hiddenTests = hide ? all.filter((n) => n.test).length : 0;
      return ok({ ...found.value, nodes, edges: found.value.edges.filter((e) => ids.has(e.from) && ids.has(e.to)), hiddenTests });
    },
    find: async (words) => ({
      ok: true,
      value: {
        verb: 'find', ok: true, exitCode: 0, notes: [], edges: [],
        nodes: words === 'charge' ? [an(CHARGE, 'charge'), an(GET, 'get', { targetOnly: true, file: undefined, range: undefined })] : [],
        places: { [CHARGE]: { unit: '@m/b', file: 'src/pay.ts' } },
      },
    }),
    path: async (from, to): Promise<MapOutcome<QueryAnswer>> =>
      from === 'checkout' && to === 'round'
        ? { ok: true, value: { verb: 'path', ok: true, exitCode: 0, notes: [], nodes: [an(CHECKOUT, 'checkout', { file: 'src/cart.ts' }), an(CHARGE, 'charge'), an(ROUND, 'round')], edges: [] } }
        : { ok: true, value: { verb: 'path', ok: false, exitCode: 1, notes: ['no path'], nodes: [], edges: [] } },
    status: async () => ({ ok: true, value: { indexed: true, busy: false } }),
    ...more,
  };
}

function fakeGraph(nearCharge: PanelAnswer = NEAR_CHARGE): GraphApi & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    show: async () => ({ ok: false, notFound: true, error: 'not found' }),
    near: async (t) => (asked.push(t), t === CHARGE ? { ok: true, answer: nearCharge } : { ok: true, answer: { ...NEAR_CHARGE, nodes: [an(t, t.split('/').pop()!, { distance: 0 })], edges: [] } }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

async function start(hash = '#/code', api: CodeMapApi = fakeMap(), graph = fakeGraph()) {
  window.history.replaceState(null, '', hash);
  mockServer({ epic: () => reviewEpic() });
  const user = userEvent.setup();
  render(
    <CodeApiContext.Provider value={codeApi}>
      <CodeMapApiContext.Provider value={api}>
        <GraphApiContext.Provider value={graph}>
          <App />
        </GraphApiContext.Provider>
      </CodeMapApiContext.Provider>
    </CodeApiContext.Provider>,
  );
  await screen.findByTestId('epic-slug');
  return { user, graph };
}

const node = (id: string) => screen.findByTestId(`code-map-node-${id}`);
const crumbs = () => screen.getAllByTestId(/^code-map-crumb-\d/).map((c) => c.textContent);
const canvas = () => screen.findByTestId('code-map-canvas');

describe('T40 the Code map tab: levels, breadcrumb and Back', () => {
  it('a top tab after Big picture opens level 1: one node per package, the plain words line, and #/code', async () => {
    const { user } = await start('#/bigpicture');
    await user.click(screen.getByTestId('nav-code'));
    expect(window.location.hash).toBe('#/code');
    expect(await canvas()).toHaveAttribute('data-level', 'packages');
    expect(screen.getByTestId('code-map-plain')).toHaveTextContent('Your repo: 2 packages, 4 files, 5 functions. Bigger box = more of the code depends on it.');
    expect(await node('@m/a')).toHaveAttribute('data-kind', 'package');
    expect(await node(OUTSIDE_GROUP)).toHaveClass('is-outside');
    expect(screen.getByTestId('code-map-crumbs')).toHaveTextContent('Repo');
    expect(screen.queryByTestId('code-map-back')).toBeNull();
  });

  it('click a package: its files and stubs; click a stub: that package; the breadcrumb and Back walk up', async () => {
    const { user } = await start();
    await user.click(await node('@m/b'));
    await waitFor(() => expect(window.location.hash).toBe('#/code/package/%40m%2Fb'));
    expect(await canvas()).toHaveAttribute('data-level', 'package');
    expect(crumbs()).toEqual(['Repo', '@m/b']);
    expect(await node('unit:@m/a')).toHaveAttribute('data-kind', 'stub');
    // The tests are hidden at the package level by default; the chip says how many.
    expect(screen.queryByTestId('code-map-node-test/pay.test.ts')).toBeNull();
    expect(screen.getByTestId('code-map-hide-tests')).toHaveTextContent('Show 1 test file');
    await user.click(await node('src/pay.ts'));
    await waitFor(() => expect(window.location.hash).toBe('#/code/file/src%2Fpay.ts'));
    expect(crumbs()).toEqual(['Repo', '@m/b', 'src/pay.ts']);
    expect(await node(CHARGE)).toHaveTextContent('charge');
    expect(await node(CART)).toHaveClass('is-outside');
    // The crumb of the package goes up one level; Back goes up again.
    await user.click(screen.getByTestId('code-map-crumb-1'));
    await waitFor(() => expect(window.location.hash).toBe('#/code/package/%40m%2Fb'));
    await user.click(await node('unit:@m/a'));
    await waitFor(() => expect(window.location.hash).toBe('#/code/package/%40m%2Fa'));
    await user.click(screen.getByTestId('code-map-back'));
    await waitFor(() => expect(window.location.hash).toBe('#/code'));
    // The browser's Back walks the same places.
    act(() => window.history.back());
    await waitFor(() => expect(window.location.hash).toBe('#/code/package/%40m%2Fa'));
  });

  it('a deep link opens the level and the selected node', async () => {
    await start(`#/code/file/src%2Fpay.ts/node/${encodeURIComponent(CHARGE)}`);
    expect(await canvas()).toHaveAttribute('data-level', 'file');
    expect(await node(CHARGE)).toHaveClass('is-center');
    expect(await screen.findByTestId('code-map-panel-name')).toHaveTextContent('charge');
  });

  it('sizes by PageRank and fits the name; the layout keeps every node', async () => {
    const big = mapNodeSize(PACKAGES.nodes[1]!, 0.6);
    const small = mapNodeSize(PACKAGES.nodes[0]!, 0.6);
    expect(big.w).toBeGreaterThan(small.w);
    expect(big.h).toBeGreaterThan(small.h);
    expect(mapNodeSize(PACKAGES.nodes[2]!, 0.6)).toEqual({ w: 150, h: 50 });
    // A long name widens its box (up to a cap) so the title is never cut at the readable zoom.
    expect(mapNodeSize(mn('x', 'a-really-long-package-name-for-sure', { kind: 'package', rank: 0 }), 0.6).w).toBeGreaterThan(300);
    const view = mapView(FILE_PAY);
    const { nodes } = mapElements(view, await layoutCodeMap(view), CHARGE);
    expect(nodes.map((n) => n.id).sort()).toEqual(FILE_PAY.nodes.map((n) => n.id).sort());
    expect(nodes.find((n) => n.id === CHARGE)!.data).toMatchObject({ selected: true });
  });

  it('what a click does, where a hit lives, the way up, the words', () => {
    expect(mapClick(PACKAGES, PACKAGES.nodes[0]!)).toEqual({ go: { tab: 'code', level: { kind: 'package', target: '@m/a' } } });
    expect(mapClick(PACKAGES, PACKAGES.nodes[2]!)).toBeUndefined();
    expect(mapClick(PACKAGE_B, PACKAGE_B.nodes[2]!)).toEqual({ go: { tab: 'code', level: { kind: 'package', target: '@m/a' } } });
    expect(mapClick(FILE_PAY, FILE_PAY.nodes[4]!)).toEqual({ select: LODASH });
    expect(mapClick(FILE_PAY, FILE_PAY.nodes[2]!)).toEqual({ select: CART });
    expect(mapClick(PACKAGES, mn(OUTSIDE_GROUP, 'Outside packages (1)', { kind: 'outside', outside: true }))).toEqual({ toggle: 'outside' });
    expect(mapClick(PACKAGES, mn('more:packages', '+3 more', { kind: 'more', more: 3 }))).toBeUndefined();
    expect(placeLoc(CHARGE, { unit: '@m/b', file: 'src/pay.ts' })).toEqual({ tab: 'code', level: { kind: 'file', target: 'src/pay.ts' }, node: CHARGE });
    expect(placeLoc('x', { unit: '@m/b' })).toEqual({ tab: 'code', level: { kind: 'package', target: '@m/b' }, node: 'x' });
    expect(placeLoc(GET, undefined)).toBeUndefined();
    expect(upLoc(FILE_PAY, { tab: 'code', level: { kind: 'file', target: 'src/pay.ts' } })).toEqual({ tab: 'code', level: { kind: 'package', target: '@m/b' } });
    expect(upLoc(PACKAGE_B, { tab: 'code', level: { kind: 'package', target: '@m/b' } })).toEqual({ tab: 'code' });
    expect(plainWords(level('packages', [], [], { totals: { packages: 1, files: 1, functions: 1, tests: 0 } }))).toBe('Your repo: 1 package, 1 file, 1 function. Bigger box = more of the code depends on it.');
    expect(mapNodeTitle(PACKAGES.nodes[1]!)).toBe('@m/b (package) · 2 files, 2 functions, 1 tests · serves in-stock, ops/run');
  });
});

// The readability pass: faint edges lit on hover, the outside grouped, folders, readable zoom.
const MANY_OUT = level(
  'packages',
  [
    mn('@m/a', '@m/a', { kind: 'package', rank: 0.3, unit: '@m/a' }),
    mn('@m/b', '@m/b', { kind: 'package', rank: 0.6, unit: '@m/b' }),
    mn('outside:lodash', 'lodash', { kind: 'outside', outside: true, rank: 0.002 }),
    mn('outside:react', 'react', { kind: 'outside', outside: true, rank: 0.001 }),
    mn('more:outside', '+5 more', { kind: 'more', outside: true, more: 5 }),
  ],
  [
    { from: '@m/a', to: '@m/b', count: 4, exact: 4, trust: 'exact', kinds: ['calls'] },
    { from: '@m/a', to: 'outside:lodash', count: 3, exact: 0, trust: 'name-match', kinds: ['calls'] },
    { from: '@m/a', to: 'outside:react', count: 2, exact: 0, trust: 'name-match', kinds: ['imports'] },
    { from: '@m/b', to: 'outside:lodash', count: 1, exact: 1, trust: 'exact', kinds: ['calls'] },
  ],
);
const FOLDERS = level(
  'package',
  [
    mn('src/index.ts', 'src/index.ts', { kind: 'file', rank: 0.5, unit: '@m/b' }),
    mn('src/model/cart.ts', 'src/model/cart.ts', { kind: 'file', rank: 0.2, unit: '@m/b' }),
    mn('test/cart.test.ts', 'test/cart.test.ts', { kind: 'file', test: true, unit: '@m/b' }),
    mn('unit:@m/a', '@m/a', { kind: 'stub', outside: true, rank: 0, unit: '@m/a' }),
  ],
  [
    { from: 'src/index.ts', to: 'src/model/cart.ts', count: 2, exact: 2, trust: 'exact', kinds: ['calls'] },
    { from: 'test/cart.test.ts', to: 'src/model/cart.ts', count: 1, exact: 1, trust: 'exact', kinds: ['calls'] },
  ],
  { target: '@m/b', name: '@m/b', unit: { key: '@m/b', name: '@m/b' } },
);
const inside = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

describe('T40 readable map: edges', () => {
  it('every edge is faint and unlabelled until its node is hovered or selected; then lit, with its count and an arrow', async () => {
    const view = mapView(FILE_PAY);
    const layout = await layoutCodeMap(view);
    const none = mapElements(view, layout, undefined).edges;
    expect(none.every((e) => e.className!.includes('is-faint') && e.label === undefined && e.markerEnd === undefined)).toBe(true);
    // Selected: the edges of ROUND are lit; the hovered node wins over the selected one.
    const sel = mapElements(view, layout, ROUND).edges;
    expect(sel.filter((e) => e.className!.includes('is-lit')).map((e) => [e.source, e.target, e.label])).toEqual([[CHARGE, ROUND, '1'], [ROUND, LODASH, '2']]);
    const hov = mapElements(view, layout, ROUND, CART).edges;
    expect(hov.filter((e) => e.className!.includes('is-lit')).map((e) => e.source)).toEqual([CART]);
    expect(Number(hov.find((e) => e.source === CART)!.style!.strokeWidth)).toBeGreaterThan(Number(hov.find((e) => e.source === CHARGE)!.style!.strokeWidth));
  });

  it('the file level keeps the trust style per call; the packages and package levels are grey, thicker by count', async () => {
    const file = mapView(FILE_PAY);
    expect(mapElements(file, await layoutCodeMap(file), undefined).edges.map((e) => e.className)).toEqual([
      'cg-edge cm-edge trust-exact is-faint', 'cg-edge cm-edge trust-exact is-faint', 'cg-edge cm-edge trust-name-match is-faint', 'cg-edge cm-edge trust-unresolved is-faint',
    ]);
    const pkgs = mapView(MANY_OUT, true);
    const edges = mapElements(pkgs, await layoutCodeMap(pkgs), '@m/a').edges;
    expect(edges.every((e) => e.className!.includes('is-counted') && !e.className!.includes('trust-'))).toBe(true);
    const width = (to: string) => Number(edges.find((e) => e.source === '@m/a' && e.target === to)!.style!.strokeWidth);
    expect(width('@m/b')).toBeGreaterThan(width('outside:react'));
  });

  it('hovering a box on the canvas lights its edges; leaving it puts the selection back', async () => {
    await start(`#/code/file/src%2Fpay.ts/node/${encodeURIComponent(CHARGE)}`);
    const c = await canvas();
    expect(c).toHaveAttribute('data-focus', CHARGE);
    const wrap = (await node(ROUND)).closest('.react-flow__node')!;
    fireEvent.mouseEnter(wrap);
    await waitFor(() => expect(c).toHaveAttribute('data-focus', ROUND));
    fireEvent.mouseLeave(wrap);
    await waitFor(() => expect(c).toHaveAttribute('data-focus', CHARGE));
  });
});

describe('T40 readable map: the outside grouped', () => {
  it('level 1: the outside packages fold into one node "Outside packages (N)", their edges added up', () => {
    const view = mapView(MANY_OUT);
    expect(view.nodes.map((n) => n.id)).toEqual(['@m/a', '@m/b', OUTSIDE_GROUP]);
    expect(view.nodes[2]).toMatchObject({ name: 'Outside packages (7)', outside: true });
    expect(view.edges.filter((e) => e.to === OUTSIDE_GROUP).map((e) => [e.from, e.count])).toEqual([['@m/a', 5], ['@m/b', 1]]);
    expect(view.outside).toEqual({ count: 7, open: false, ids: ['outside:lodash', 'outside:react', 'more:outside'] });
    // Open: one per package again.
    expect(mapView(MANY_OUT, true).nodes.map((n) => n.id)).toEqual(MANY_OUT.nodes.map((n) => n.id));
  });

  it('the group stands in a column on the right; open, its packages sit in one framed column', async () => {
    const closed = await layoutCodeMap(mapView(MANY_OUT));
    const g = closed.nodes[OUTSIDE_GROUP]!;
    expect(g.x).toBeGreaterThan(Math.max(closed.nodes['@m/a']!.x, closed.nodes['@m/b']!.x));
    expect(closed.frames).toEqual([]);
    const open = await layoutCodeMap(mapView(MANY_OUT, true));
    const frame = open.frames.find((f) => f.id === 'frame:outside')!;
    expect(frame.title).toBe('Outside packages (7)');
    for (const id of ['outside:lodash', 'outside:react', 'more:outside']) expect(inside(open.nodes[id]!, frame.rect)).toBe(true);
    expect(new Set(['outside:lodash', 'outside:react', 'more:outside'].map((id) => open.nodes[id]!.x)).size).toBe(1);
  });

  it('clicking the group opens it on the canvas; "fold" closes it', async () => {
    const { user } = await start('#/code', fakeMap({ ...BASE, packages: ok(MANY_OUT) }));
    expect(await node(OUTSIDE_GROUP)).toHaveTextContent('Outside packages (7)');
    expect(screen.queryByTestId('code-map-node-outside:lodash')).toBeNull();
    await user.click(await node(OUTSIDE_GROUP));
    expect(await node('outside:lodash')).toBeInTheDocument();
    expect(screen.getByTestId('code-map-frame-Outside packages (7)')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/code');
    await user.click(screen.getByTestId('code-map-outside-close'));
    expect(await node(OUTSIDE_GROUP)).toBeInTheDocument();
    expect(screen.queryByTestId('code-map-node-outside:lodash')).toBeNull();
  });

  it('file level: the code elsewhere is one node per file or package with its calls; clicking it lists them in the panel', async () => {
    const { user } = await start('#/code/file/src%2Fpay.ts');
    expect(await node(LODASH)).toHaveTextContent('lodash · 2 calls');
    expect(await node(CART)).toHaveTextContent('cart.ts · 1 call');
    expect(screen.queryByTestId(`code-map-node-${CHECKOUT}`)).toBeNull();
    await user.click(await node(CART));
    await waitFor(() => expect(window.location.hash).toBe(`#/code/file/src%2Fpay.ts/node/${encodeURIComponent(CART)}`));
    const panel = await screen.findByTestId('code-map-panel');
    expect(within(panel).getByTestId('code-map-panel-place')).toHaveTextContent('other file · src/cart.ts · 1 call with pay.ts');
    expect(within(panel).getByTestId('code-map-panel-members-from')).toHaveTextContent('What in it uses pay.ts (1)checkout');
    expect(within(panel).getByTestId('code-map-panel-members-to')).toHaveTextContent('None.');
    await user.click(within(panel).getByRole('button', { name: 'checkout' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/code/file/src%2Fcart.ts/node/${encodeURIComponent(CHECKOUT)}`));
  });

  it('an outside package and a test file list their code too: × the count, the test by its short title', async () => {
    const { user } = await start('#/code/file/src%2Fpay.ts');
    await user.click(await node(LODASH));
    const panel = await screen.findByTestId('code-map-panel');
    expect(within(panel).getByTestId('code-map-panel-place')).toHaveTextContent('outside package · outside the repo · 2 calls with pay.ts');
    expect(within(panel).getByTestId('code-map-panel-members-to')).toHaveTextContent('What pay.ts uses in it (1)get × 2');
    await user.click(await node(PAY_TESTS));
    const tests = await screen.findByTestId('code-map-panel-members-from');
    expect(tests).toHaveTextContent('charges a card pay.test.ts');
    expect(within(tests).getByRole('button', { name: 'charges a card' })).toHaveAttribute('title', 'PayService > charge > charges a card');
  });
});

describe('T40 readable map: folders and tests at the package level', () => {
  it('files sit in one group per folder, nested; the box shows the file name only', async () => {
    const view = mapView(FOLDERS);
    expect(view.folders).toEqual([
      { id: 'folder:src', title: 'src/', kind: 'cluster' },
      { id: 'folder:src/model', title: 'model/', kind: 'cluster', parent: 'folder:src' },
      { id: 'folder:test', title: 'test/', kind: 'cluster' },
    ]);
    expect(view.folderOf).toEqual({ 'src/index.ts': 'folder:src', 'src/model/cart.ts': 'folder:src/model', 'test/cart.test.ts': 'folder:test' });
    expect(mapNodeLabel('package', FOLDERS.nodes[1]!)).toBe('cart.ts');
    const layout = await layoutCodeMap(view);
    const frame = (id: string) => layout.frames.find((f) => f.id === id)!.rect;
    expect(inside(layout.nodes['src/model/cart.ts']!, frame('folder:src/model'))).toBe(true);
    expect(inside(frame('folder:src/model'), frame('folder:src'))).toBe(true);
    expect(inside(layout.nodes['test/cart.test.ts']!, frame('folder:test'))).toBe(true);
    expect(inside(layout.nodes['test/cart.test.ts']!, frame('folder:src'))).toBe(false);
  });

  it('the tests are hidden by default; the chip says how many and shows them', async () => {
    const api = fakeMap({ ...BASE, 'package @m/b': ok(FOLDERS) });
    const { user } = await start('#/code/package/%40m%2Fb', api);
    expect(await node('src/index.ts')).toHaveTextContent('index.ts');
    expect(screen.getByTestId('code-map-frame-src/')).toBeInTheDocument();
    expect(api.asked.at(-1)).toMatchObject({ level: 'package', hideTests: 'auto' });
    expect(screen.queryByTestId('code-map-node-test/cart.test.ts')).toBeNull();
    const chip = screen.getByTestId('code-map-hide-tests');
    expect(chip).toHaveTextContent('Show 1 test file');
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip);
    expect(await node('test/cart.test.ts')).toHaveClass('is-test');
    expect(api.asked.at(-1)).toMatchObject({ hideTests: false });
    expect(screen.getByTestId('code-map-frame-test/')).toBeInTheDocument();
    expect(screen.getByTestId('code-map-hide-tests')).toHaveTextContent('Hide tests');
  });

  it('a test entry is its short title, the full describe chain on hover', () => {
    expect(shortTestName('MapIndex > packages > sizes by rank')).toBe('sizes by rank');
    expect(shortTestName('x'.repeat(80))).toHaveLength(60);
    expect(shortTestName('x'.repeat(80)).endsWith('…')).toBe(true);
  });
});

describe('T40 readable map: the first view', () => {
  it('a level that fits opens whole (at most 1.2×); a big one opens at the readable zoom on the focus, inside the map', () => {
    const screenSize = { w: 1000, h: 600 };
    const small = mapViewport({ width: 400, height: 200 }, undefined, screenSize);
    expect(small).toEqual({ zoom: MAX_FIT_ZOOM, x: (1000 - 400 * MAX_FIT_ZOOM) / 2, y: (600 - 200 * MAX_FIT_ZOOM) / 2 });
    const focus = { x: 2000, y: 1500, w: 200, h: 100 };
    const big = mapViewport({ width: 5000, height: 3000 }, focus, screenSize);
    expect(big.zoom).toBeCloseTo(READABLE_ZOOM);
    // The 15 px titles are 11 px on screen.
    expect(15 * big.zoom).toBeCloseTo(11);
    expect(big.x + (focus.x + focus.w / 2) * big.zoom).toBeCloseTo(500);
    expect(big.y + (focus.y + focus.h / 2) * big.zoom).toBeCloseTo(300);
    // Near the corner the view stays on the map instead of centring on empty space.
    const corner = mapViewport({ width: 5000, height: 3000 }, { x: 0, y: 0, w: 100, h: 50 }, screenSize);
    expect(corner).toMatchObject({ x: 24, y: 24 });
    // Between the two: the fit is kept down to the readable zoom.
    expect(mapViewport({ width: 1100, height: 500 }, undefined, screenSize).zoom).toBeCloseTo((1000 - 48) / 1100);
  });

  it('the view opens on the selected node, else the biggest one; the canvas says its zoom', async () => {
    const view = mapView(PACKAGES);
    expect(focusNode(view, undefined)).toBe('@m/b');
    expect(focusNode(view, '@m/a')).toBe('@m/a');
    expect(focusNode(view, 'gone')).toBe('@m/b');
    await start('#/code');
    await node('@m/a');
    const zoom = Number((await canvas()).getAttribute('data-zoom'));
    expect(zoom).toBeGreaterThanOrEqual(Number(READABLE_ZOOM.toFixed(2)));
    expect(zoom).toBeLessThanOrEqual(MAX_FIT_ZOOM);
  });
});

describe('T40 the side panel and the plan boxes', () => {
  it('a node that serves a box has a badge; selecting it shows its place, callers, callees, tests, HTTP calls and boxes', async () => {
    const { user, graph } = await start('#/code/file/src%2Fpay.ts');
    expect(await screen.findByTestId(`code-map-badge-${CHARGE}`)).toHaveTextContent('▣ 2');
    expect(screen.queryByTestId(`code-map-badge-${ROUND}`)).toBeNull();
    await user.click(await node(CHARGE));
    await waitFor(() => expect(window.location.hash).toBe(`#/code/file/src%2Fpay.ts/node/${encodeURIComponent(CHARGE)}`));
    const panel = await screen.findByTestId('code-map-panel');
    expect(graph.asked).toContain(CHARGE);
    expect(within(panel).getByTestId('code-map-panel-place')).toHaveTextContent('function · src/pay.ts:10-12');
    expect(await within(panel).findByTestId('code-map-panel-callers')).toHaveTextContent('Called by (1)checkout');
    expect(within(panel).getByTestId('code-map-panel-callees')).toHaveTextContent('Calls (1)round · name-match');
    expect(within(panel).getByTestId('code-map-panel-tests')).toHaveTextContent('Tests (1)charges a card pay.test.ts');
    // A test is its short title and its file; the describe chain is on hover.
    expect(within(panel).getByRole('button', { name: 'charges a card' })).toHaveAttribute('title', 'PayService > charges a card');
    expect(within(panel).getByTestId('code-map-panel-http')).toHaveTextContent('POST /api/pay');
    // A box of this EPIC opens the box drawer; a box of another EPIC is text.
    expect(within(panel).getByTestId('code-map-box-ops/run').tagName).toBe('SPAN');
    await user.click(within(panel).getByTestId('code-map-box-in-stock'));
    expect(await screen.findByTestId('box-drawer')).toBeInTheDocument();
    expect(window.location.hash).toBe(`#/code/file/src%2Fpay.ts/node/${encodeURIComponent(CHARGE)}?box=in-stock`);
  });

  it('a caller in the panel jumps to its file; the panel closes', async () => {
    const { user } = await start(`#/code/file/src%2Fpay.ts/node/${encodeURIComponent(CHARGE)}`);
    const panel = await screen.findByTestId('code-map-panel');
    await user.click(await within(panel).findByRole('button', { name: 'checkout' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/code/file/src%2Fcart.ts/node/${encodeURIComponent(CHECKOUT)}`));
    expect(await screen.findByTestId('code-map-not-found')).toBeInTheDocument();
    await user.click(screen.getByTestId('code-map-panel-close'));
    await waitFor(() => expect(window.location.hash).toBe('#/code/file/src%2Fcart.ts'));
    expect(screen.queryByTestId('code-map-panel')).toBeNull();
  });
});

describe('T40 search and the path from A to B', () => {
  it('find: a hit jumps to its level and selects it; a hit outside the repo is text', async () => {
    const { user } = await start();
    await user.type(screen.getByTestId('code-map-find'), 'charge');
    await user.click(screen.getByTestId('code-map-find-go'));
    const results = await screen.findByTestId('code-map-results');
    expect(within(results).getByTestId(`code-map-hit-${GET}`).tagName).toBe('SPAN');
    await user.click(within(results).getByTestId(`code-map-hit-${CHARGE}`));
    await waitFor(() => expect(window.location.hash).toBe(`#/code/file/src%2Fpay.ts/node/${encodeURIComponent(CHARGE)}`));
    expect(await node(CHARGE)).toHaveClass('is-center');
    expect(await screen.findByTestId('code-map-panel-name')).toHaveTextContent('charge');
    await user.clear(screen.getByTestId('code-map-find'));
    await user.type(screen.getByTestId('code-map-find'), 'nothing{Enter}');
    expect(await screen.findByTestId('code-map-results')).toHaveTextContent('Nothing found for “nothing”.');
  });

  it('path: the chain of nodes, each a link to its file; "no path" says so', async () => {
    const { user } = await start();
    await user.click(screen.getByTestId('code-map-path-toggle'));
    await user.type(screen.getByTestId('code-map-path-from'), 'checkout');
    await user.type(screen.getByTestId('code-map-path-to'), 'round');
    await user.click(screen.getByTestId('code-map-path-go'));
    const chain = await screen.findByTestId('code-map-path-result');
    expect(within(chain).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['checkout', 'charge', 'round']);
    await user.click(within(chain).getByTestId(`code-map-path-${ROUND}`));
    await waitFor(() => expect(window.location.hash).toBe(`#/code/file/src%2Fpay.ts/node/${encodeURIComponent(ROUND)}`));
    await user.clear(screen.getByTestId('code-map-path-to'));
    await user.type(screen.getByTestId('code-map-path-to'), 'nowhere{Enter}');
    expect(await screen.findByTestId('code-map-path-result')).toHaveTextContent('No path');
  });
});

describe('T40 filters', () => {
  it('hide tests, hide outside packages, and only code serving the boxes of one EPIC', async () => {
    const api = fakeMap();
    const { user } = await start('#/code/file/src%2Fpay.ts', api);
    await node(PAY_TESTS);
    expect(api.asked.at(-1)).toMatchObject({ level: 'file', hideTests: false });
    await user.click(screen.getByTestId('code-map-hide-tests'));
    expect(screen.getByTestId('code-map-hide-tests')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.queryByTestId(`code-map-node-${PAY_TESTS}`)).toBeNull());
    expect(screen.getByTestId('code-map-hide-tests')).toHaveTextContent('Show 1 test');
    expect(api.asked.at(-1)).toMatchObject({ level: 'file', target: 'src/pay.ts', hideTests: true, hideOutside: false });
    await user.click(screen.getByTestId('code-map-hide-outside'));
    await waitFor(() => expect(screen.queryByTestId(`code-map-node-${CART}`)).toBeNull());
    expect(await node(ROUND)).toBeInTheDocument();
    await user.selectOptions(screen.getByTestId('code-map-epic'), OTHER);
    await waitFor(() => expect(screen.queryByTestId(`code-map-node-${ROUND}`)).toBeNull());
    expect(api.asked.at(-1)).toMatchObject({ hideTests: true, hideOutside: true, epic: OTHER });
    expect(await node(CHARGE)).toBeInTheDocument();
    // The filters stay on when the level changes.
    await user.click(screen.getByTestId('code-map-crumb-0'));
    await waitFor(() => expect(api.asked.at(-1)).toMatchObject({ level: 'packages', hideTests: true, hideOutside: true, epic: OTHER }));
  });

  it('nothing left after the filters says so and clears them', async () => {
    const { user } = await start('#/code/package/%40m%2Fb');
    await node('src/pay.ts');
    await user.click(screen.getByTestId('code-map-hide-outside'));
    await user.selectOptions(screen.getByTestId('code-map-epic'), OTHER);
    expect(await screen.findByTestId('code-map-empty-filtered')).toHaveTextContent('Nothing here matches the filters.');
    await user.click(screen.getByTestId('code-map-clear-filters'));
    expect(await node('src/pay.ts')).toBeInTheDocument();
    expect(screen.getByTestId('code-map-hide-outside')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('T40 empty, not indexed and indexing', () => {
  it('indexing: the first map waits on the index and says so', async () => {
    let answer: (o: MapOutcome<CodeMap>) => void = () => undefined;
    const api = fakeMap(BASE, { status: async () => ({ ok: true, value: { indexed: false, busy: true } }), map: () => new Promise((r) => (answer = r)) });
    await start('#/code', api);
    expect(await screen.findByTestId('code-map-loading')).toHaveTextContent('Indexing your repo for the first time');
    await act(async () => answer(ok(PACKAGES)));
    expect(await node('@m/a')).toBeInTheDocument();
  });

  it('a repo with no code says what to do; an empty package says it has no code', async () => {
    await start('#/code', fakeMap({ packages: ok(level('packages', [], [], { totals: { packages: 0, files: 0, functions: 0, tests: 0 }, epics: [] })) }));
    expect(await screen.findByTestId('code-map-empty')).toHaveTextContent('No code yet: the code graph found no TypeScript or Python files in this repo.');
  });

  it('not indexed and the map failed: say how to index; a place that is gone: go back to the packages', async () => {
    const failing = fakeMap(BASE, { status: async () => ({ ok: true, value: { indexed: false, busy: false } }), map: async () => ({ ok: false, notFound: false, error: 'no git repo' }) });
    await start('#/code', failing);
    const err = await screen.findByTestId('code-map-error');
    expect(err).toHaveTextContent('Could not draw the code map: no git repo');
    expect(err).toHaveTextContent('The repo is not indexed yet. Run rehearse find main in the repo to index it');
  });

  it('a link to a package that is gone offers the packages', async () => {
    const { user } = await start('#/code/package/gone');
    expect(await screen.findByTestId('code-map-not-found')).toHaveTextContent('gone is not on the map');
    await user.click(within(screen.getByTestId('code-map-not-found')).getByRole('button'));
    await waitFor(() => expect(window.location.hash).toBe('#/code'));
  });
});

describe('T40 the code map client', () => {
  it('sends the token and the query; 404 is not found; find with no hits is still an answer', async () => {
    const seen: URLSearchParams[] = [];
    const server = mockServer({
      epic: () => reviewEpic(),
      graph: (q) => {
        seen.push(q);
        if (q.get('verb') === 'status') return { status: 200, body: { ok: true, indexed: true, busy: false } };
        if (q.get('target') === 'gone') return { status: 404, body: { ...PACKAGES, ok: false, nodes: [], notes: ['not found'] } };
        if (q.get('verb') === 'find') return { status: 200, body: { verb: 'find', ok: false, exitCode: 1, nodes: [], edges: [], notes: ['not found'], places: {} } };
        return { status: 200, body: PACKAGES };
      },
    });
    sessionClient.reset();
    const api = httpCodeMapApi();
    expect(await api.map({ level: 'file', target: 'src/a b.ts', hideTests: true, hideOutside: true, epic: SLUG })).toMatchObject({ ok: true });
    expect(Object.fromEntries(seen[0]!)).toEqual({ verb: 'map', level: 'file', target: 'src/a b.ts', tests: 'hide', outside: 'hide', epic: SLUG });
    expect(server.calls.find((c) => c.url.startsWith('api/graph'))!.headers['x-rehearse-token']).toBe(SESSION.token);
    expect(await api.map({ level: 'package', target: 'gone' })).toEqual({ ok: false, notFound: true, error: 'not found' });
    // find answers 200 even with no hits.
    expect(await api.find('zzz')).toMatchObject({ ok: true, value: { nodes: [] } });
    expect(await api.status()).toEqual({ ok: true, value: { ok: true, indexed: true, busy: false } });
  });
});

describe('S12 unit test coverage on the Code map', () => {
  const st = (covered: number, lines: number, tests: number, stale = false) => ({ lines, covered, branches: 0, branchesCovered: 0, percent: Math.floor((covered * 100) / lines), tests, stale });
  const FOUND = { found: true, reports: [{ path: 'packages/b/coverage/lcov.info', mtimeMs: 1, files: 2 }] };
  const COVERED: Answers = {
    ...BASE,
    packages: ok({ ...PACKAGES, coverage: FOUND, nodes: PACKAGES.nodes.map((n) => (n.id === '@m/b' ? { ...n, coverage: st(72, 100, 3) } : n)) }),
    'package @m/b': ok({
      ...FOLDERS,
      coverage: FOUND,
      nodes: FOLDERS.nodes.map((n) => (n.id === 'src/index.ts' ? { ...n, coverage: st(9, 10, 1) } : n.id === 'src/model/cart.ts' ? { ...n, coverage: st(1, 10, 0, true) } : n)),
    }),
    'file src/pay.ts': ok({ ...FILE_PAY, coverage: FOUND, nodes: FILE_PAY.nodes.map((n) => (n.id === CHARGE ? { ...n, coverage: st(2, 3, 1) } : n)) }),
  };

  it('S12-A1 a package and a file carry a badge "72% · 3 tests" in its colour; a folder adds up its files', async () => {
    await start('#/code', fakeMap(COVERED));
    const b = await screen.findByTestId('code-map-coverage-@m/b');
    expect(b).toHaveTextContent('72% · 3 tests');
    expect(b).toHaveAttribute('data-tone', 'fair');
    expect(screen.queryByTestId('code-map-coverage-@m/a')).toBeNull();
  });

  it('S12-A1 the folders of a package: src/ sums its files (10 of 20 lines), src/model/ is red and stale', async () => {
    await start('#/code/package/%40m%2Fb', fakeMap(COVERED));
    expect(await screen.findByTestId('code-map-coverage-src/index.ts')).toHaveTextContent('90% · 1 test');
    expect(screen.getByTestId('code-map-coverage-src/index.ts')).toHaveAttribute('data-tone', 'good');
    const model = screen.getByTestId('code-map-coverage-src/model/cart.ts');
    expect(model).toHaveAttribute('data-tone', 'poor');
    expect(model).toHaveTextContent('⟳');
    expect(model.getAttribute('title')).toContain('coverage is older than this code; run the tests again');
    expect(screen.getByTestId('code-map-frame-coverage-src/')).toHaveTextContent('50% · 1 test');
  });

  it('S12-A2 S12-A3 the side panel of a function: its badge, the lines not run and the tests that call it', async () => {
    const near: PanelAnswer = {
      ...NEAR_CHARGE,
      coverageInfo: FOUND,
      coverage: {
        id: CHARGE, file: 'src/pay.ts', range: '10-12', stats: st(2, 3, 1), uncovered: ['11'],
        lines: [{ n: 10, state: 'run', hits: 2 }, { n: 11, state: 'missed' }, { n: 12, state: 'run', hits: 2 }],
        testedBy: [{ id: TEST, name: 'charges a card', file: 'test/pay.test.ts', range: '3-9', trust: 'exact', direct: true }],
      },
    };
    const { user } = await start(`#/code/file/src%2Fpay.ts/node/${encodeURIComponent(CHARGE)}`, fakeMap(COVERED), fakeGraph(near));
    const panel = await screen.findByTestId('code-map-panel-coverage');
    expect(within(panel).getByTestId('code-map-panel-cov-badge')).toHaveTextContent('66% · 1 test');
    expect(within(panel).getByTestId('code-map-panel-uncovered')).toHaveTextContent('Lines not run: 11');
    const tests = within(panel).getByTestId('code-map-tested-by');
    expect(tests).toHaveTextContent('charges a card');
    expect(tests).toHaveTextContent('test/pay.test.ts:3-9');
    expect(tests).toHaveTextContent('calls it');
    await user.click(within(tests).getByTestId('code-map-tested-by-charges a card'));
    await waitFor(() => expect(window.location.hash).toContain(encodeURIComponent('test/pay.test.ts')));
  });

  it('S12-A5 no coverage file: one plain line on how to make one, and no badges', async () => {
    const none = { found: false, reports: [], hint: 'No coverage file yet. Run `pnpm coverage` to write coverage/lcov.info in each package.' };
    await start('#/code', fakeMap({ ...BASE, packages: ok({ ...PACKAGES, coverage: none }) }));
    expect(await screen.findByTestId('code-map-coverage-hint')).toHaveTextContent('No coverage file yet. Run `pnpm coverage`');
    expect(screen.queryByTestId('code-map-coverage-@m/b')).toBeNull();
  });
});
