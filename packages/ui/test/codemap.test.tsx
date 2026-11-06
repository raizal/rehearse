// T40: the Code map tab. The repo one level at a time (packages, a package, a file), the side
// panel, search, the path helper, the filters and the empty states. The map is a fake through
// CodeMapApiContext and the side panel's `near` a fake through GraphApiContext; the App runs
// against the mock server, so the URL and the box drawer are the real ones.

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnswerEdge, AnswerNode, CodeIndex, QueryAnswer } from '@rehearse/server';
import { App } from '../src/App.js';
import { CodeApiContext, type CodeApi } from '../src/code-api.js';
import { CodeMapApiContext, httpCodeMapApi, type CodeMap, type CodeMapApi, type MapBox, type MapNode, type MapOutcome, type MapRequest } from '../src/codemap-api.js';
import { GraphApiContext, type GraphApi, type PanelAnswer } from '../src/graph-api.js';
import { mapElements } from '../src/components/CodeMap.js';
import { layoutCodeMap, mapClick, mapNodeSize, mapNodeTitle, placeLoc, plainWords, upLoc } from '../src/model/codemap.js';
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
const IN_STOCK: MapBox = { id: `rehearse record ${SLUG} . box:in-stock`, path: 'in-stock', epic: SLUG };
const ELSEWHERE: MapBox = { id: `rehearse record ${OTHER} . box:ops/run`, path: 'ops/run', epic: OTHER };

const mn = (id: string, name: string, extra: Partial<MapNode> = {}): MapNode => ({ id, kind: 'function', name, rank: 0.01, outside: false, test: false, boxes: [], ...extra });
const TOTALS = { packages: 2, files: 4, functions: 5, tests: 1 };
const level = (l: CodeMap['level'], nodes: MapNode[], edges: CodeMap['edges'], extra: Partial<CodeMap> = {}): CodeMap => ({
  level: l, ok: true, name: 'the repo', nodes, edges, totals: TOTALS, epics: [OTHER, SLUG], notes: [], ...extra,
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
    mn(CHECKOUT, 'checkout', { file: 'src/cart.ts', range: '30-30', outside: true, unit: '@m/a' }),
    mn(TEST, 'charges a card', { kind: 'test', file: 'test/pay.test.ts', range: '3-9', outside: true, test: true, unit: '@m/b' }),
    mn(GET, 'get', { outside: true }),
  ],
  [
    { from: CHECKOUT, to: CHARGE, count: 1, exact: 1, trust: 'exact', kinds: ['calls'] },
    { from: CHARGE, to: ROUND, count: 1, exact: 0, trust: 'name-match', kinds: ['calls'] },
    { from: ROUND, to: GET, count: 1, exact: 0, trust: 'unresolved', kinds: ['calls'] },
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
    ae(TEST, 'charges a card', CHARGE, 'charge', 'tests'),
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
      // The filters, as the server applies them.
      const nodes = found.value.nodes.filter((n) => !(q.hideTests && n.test) && !(q.hideOutside && n.outside) && (!q.epic || n.boxes.some((b) => b.epic === q.epic)));
      const ids = new Set(nodes.map((n) => n.id));
      return ok({ ...found.value, nodes, edges: found.value.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) });
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

function fakeGraph(): GraphApi & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    show: async () => ({ ok: false, notFound: true, error: 'not found' }),
    near: async (t) => (asked.push(t), t === CHARGE ? { ok: true, answer: NEAR_CHARGE } : { ok: true, answer: { ...NEAR_CHARGE, nodes: [an(t, t.split('/').pop()!, { distance: 0 })], edges: [] } }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

async function start(hash = '#/code', api: CodeMapApi = fakeMap()) {
  window.history.replaceState(null, '', hash);
  mockServer({ epic: () => reviewEpic() });
  const user = userEvent.setup();
  const graph = fakeGraph();
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
    expect(await node('outside:lodash')).toHaveClass('is-outside');
    expect(screen.getByTestId('code-map-crumbs')).toHaveTextContent('Repo');
    expect(screen.queryByTestId('code-map-back')).toBeNull();
  });

  it('click a package: its files and stubs; click a stub: that package; the breadcrumb and Back walk up', async () => {
    const { user } = await start();
    await user.click(await node('@m/b'));
    await waitFor(() => expect(window.location.hash).toBe('#/code/package/%40m%2Fb'));
    expect(await canvas()).toHaveAttribute('data-level', 'package');
    expect(crumbs()).toEqual(['Repo', '@m/b']);
    expect(await node('test/pay.test.ts')).toHaveClass('is-test');
    expect(await node('unit:@m/a')).toHaveAttribute('data-kind', 'stub');
    await user.click(await node('src/pay.ts'));
    await waitFor(() => expect(window.location.hash).toBe('#/code/file/src%2Fpay.ts'));
    expect(crumbs()).toEqual(['Repo', '@m/b', 'src/pay.ts']);
    expect(await node(CHARGE)).toHaveTextContent('charge');
    expect(await node(CHECKOUT)).toHaveClass('is-outside');
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

  it('sizes by PageRank, the layout keeps every node, and edges carry their trust and count', async () => {
    const big = mapNodeSize(PACKAGES.nodes[1]!, 0.6);
    const small = mapNodeSize(PACKAGES.nodes[0]!, 0.6);
    expect(big.w).toBeGreaterThan(small.w);
    expect(big.h).toBeGreaterThan(small.h);
    expect(mapNodeSize(PACKAGES.nodes[2]!, 0.6)).toEqual({ w: 150, h: 44 });
    const { nodes, edges } = mapElements(FILE_PAY, await layoutCodeMap(FILE_PAY), CHARGE);
    expect(nodes.map((n) => n.id).sort()).toEqual(FILE_PAY.nodes.map((n) => n.id).sort());
    expect(nodes.find((n) => n.id === CHARGE)!.data.selected).toBe(true);
    // Edges to an outside caller or callee are faded; the file level has no count labels.
    expect(edges.map((e) => e.className)).toEqual(['cg-edge cm-edge trust-exact is-outside', 'cg-edge cm-edge trust-name-match', 'cg-edge cm-edge trust-unresolved is-outside']);
    expect(edges.every((e) => e.label === undefined)).toBe(true);
    const pkgEdges = mapElements(PACKAGES, await layoutCodeMap(PACKAGES), undefined).edges;
    expect(pkgEdges[0]).toMatchObject({ label: '4' });
    expect(pkgEdges[1]!.label).toBeUndefined();
  });

  it('what a click does, where a hit lives, the way up, the words', () => {
    expect(mapClick(PACKAGES, PACKAGES.nodes[0]!)).toEqual({ go: { tab: 'code', level: { kind: 'package', target: '@m/a' } } });
    expect(mapClick(PACKAGES, PACKAGES.nodes[2]!)).toBeUndefined();
    expect(mapClick(PACKAGE_B, PACKAGE_B.nodes[2]!)).toEqual({ go: { tab: 'code', level: { kind: 'package', target: '@m/a' } } });
    expect(mapClick(FILE_PAY, FILE_PAY.nodes[4]!)).toEqual({ select: GET });
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
    expect(within(panel).getByTestId('code-map-panel-tests')).toHaveTextContent('Tests (1)charges a card');
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
    await node(TEST);
    await user.click(screen.getByTestId('code-map-hide-tests'));
    expect(screen.getByTestId('code-map-hide-tests')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.queryByTestId(`code-map-node-${TEST}`)).toBeNull());
    expect(api.asked.at(-1)).toMatchObject({ level: 'file', target: 'src/pay.ts', hideTests: true, hideOutside: false });
    await user.click(screen.getByTestId('code-map-hide-outside'));
    await waitFor(() => expect(screen.queryByTestId(`code-map-node-${CHECKOUT}`)).toBeNull());
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
