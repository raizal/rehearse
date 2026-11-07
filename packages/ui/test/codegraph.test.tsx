// S9 (EPIC 2026-11-05-code-graph): the code drill-down below a leaf box in the story Code tab
// (boxes drill-code, code-view). The graph is a fake through GraphApiContext: it answers what the
// serve route gives once T30's builds linker runs (scenario S9 example show-box). The HTTP client is
// tested against the mock fetch: token header, 404 and the token retry.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnswerEdge, AnswerNode, CodeIndex } from '@rehearse/server';
import { CodeApiContext, type CodeApi } from '../src/code-api.js';
import { MAX_PICKS } from '../src/components/BoxCodeGraph.js';
import { StoryView } from '../src/components/StoryView.js';
import { GraphApiContext, httpGraphApi, type GraphApi, type GraphOutcome, type PanelAnswer } from '../src/graph-api.js';
import { boxTarget, builtNodes, callGraph, codeLines, definedNodes, isTestFile, nameWords, NO_CODE_YET, outlineRows } from '../src/model/codegraph.js';
import { createSessionClient, SERVER_RESTARTED, TOKEN_ERROR } from '../src/session-client.js';
import { boxAt } from '../src/model/diagram.js';
import { reviewEpic } from './fixture.js';

afterEach(() => vi.unstubAllGlobals());

const ref = (c: string, subject: string) => ({ sha: c.repeat(40), short: c.repeat(7), subject, date: '2026-11-05T10:00:00+07:00' });

const INDEX: CodeIndex = {
  ok: true,
  head: ref('9', 'Head'),
  boxes: {
    cart: { commits: [ref('1', 'Cart (D7)')], files: ['src/pay.ts', 'test/pay.test.ts'] },
    pay: { commits: [], files: [] },
    'in-stock': { commits: [], files: [] },
  },
};

const codeApi: CodeApi = {
  index: async () => INDEX,
  box: async () => ({ ok: false, error: 'not in this test' }),
};

const CHARGE = 'scip-typescript npm shop 1.0 src/pay.ts/charge().';
const node = (id: string, name: string, extra: Partial<AnswerNode> = {}): AnswerNode => ({
  id, kind: 'function', name, terms: name, language: 'typescript', targetOnly: false, rank: 0, file: 'src/pay.ts', range: '10-12', ...extra,
});
const edge = (from: string, fromName: string, to: string, toName: string, kind: AnswerEdge['kind'], trust: AnswerEdge['trust'] = 'exact'): AnswerEdge => ({
  from, to, fromName, toName, kind, trust, source: 'tree-sitter',
});
const answer = (nodes: AnswerNode[], edges: AnswerEdge[], extra: Partial<PanelAnswer> = {}): PanelAnswer => ({ verb: 'show', ok: true, exitCode: 0, nodes, edges, notes: [], ...extra });

const BOX_NODE = { ...node('box cart', 'cart', { kind: 'box', language: 'record' }), file: undefined, range: undefined };
const BOX_CART = answer([BOX_NODE], [edge('box cart', 'cart', CHARGE, 'charge', 'builds')], { ends: { [CHARGE]: { kind: 'function', file: 'src/pay.ts', range: '10-12' } } });
const SHOW_CHARGE = answer(
  [node(CHARGE, 'charge', { code: 'export function charge(id: string) {\n  return round(id);\n}' })],
  [
    edge('box cart', 'cart', CHARGE, 'charge', 'builds'),
    edge(CHARGE, 'charge', 'x/round().', 'round', 'calls', 'name-match'),
    edge('x/checkout().', 'checkout', CHARGE, 'charge', 'calls'),
    edge('x/test charge', 'charges a card', CHARGE, 'charge', 'tests'),
  ],
  {
    outline: {
      nodes: 3,
      cut: false,
      root: { type: 'function_declaration', name: 'charge', lines: '10-12', children: [{ type: 'formal_parameters', lines: '10-10', children: [] }, { type: 'statement_block', lines: '10-12', children: [] }] },
    },
  },
);
const SHOW_FILE = answer(
  [node('scip-typescript npm shop 1.0 src/pay.ts/', 'pay.ts', { kind: 'file', range: undefined })],
  [
    edge('scip-typescript npm shop 1.0 src/pay.ts/', 'pay.ts', CHARGE, 'charge', 'defines'),
    edge('scip-typescript npm shop 1.0 src/pay.ts/', 'pay.ts', 'scip-typescript npm shop 1.0 src/pay.ts/Charge#', 'Charge', 'defines'),
  ],
);

const NOT_FOUND: GraphOutcome = { ok: false, notFound: true, error: 'not found' };

function fakeGraph(answers: Record<string, PanelAnswer | GraphOutcome>): GraphApi & { asked: string[] } {
  const asked: string[] = [];
  const out = (t: string): GraphOutcome => {
    const a = answers[t];
    if (a === undefined) return NOT_FOUND;
    return 'verb' in a ? { ok: true, answer: a } : a;
  };
  return {
    asked,
    show: async (t) => (asked.push(t), out(t)),
    // A near answer is keyed `near <depth> <target>`; without one, near gives the show answer.
    near: async (t, d = 1) => (asked.push(`near ${d} ${t}`), answers[`near ${d} ${t}`] !== undefined ? out(`near ${d} ${t}`) : out(t)),
  };
}

async function openBox(graph: GraphApi, path: string) {
  const user = userEvent.setup();
  const view = reviewEpic();
  boxAt(view.flow, 'in-stock')!.stories = ['S1'];
  render(
    <CodeApiContext.Provider value={codeApi}>
      <GraphApiContext.Provider value={graph}>
        <StoryView view={view} storyId="S1" onOpenBox={() => undefined}>
          <p>cards</p>
        </StoryView>
      </GraphApiContext.Provider>
    </CodeApiContext.Provider>,
  );
  await user.click(screen.getByTestId('story-tab-code'));
  await waitFor(() => expect(screen.getByTestId(`code-box-${path}`)).toBeInTheDocument());
  await user.click(screen.getByTestId(`code-box-${path}`));
  return user;
}

describe('S9-A1 the Code view of a leaf box shows the code it builds, its AST and its call graph, read only', () => {
  it('S9-A1 opening box cart asks the graph for "box cart" and shows charge: code, AST outline, call graph', async () => {
    const graph = fakeGraph({ 'box cart': BOX_CART, [CHARGE]: SHOW_CHARGE });
    await openBox(graph, 'cart');
    const panes = await screen.findByTestId('code-graph-node');
    await waitFor(() => expect(graph.asked).toEqual(['box cart', CHARGE, `near 1 ${CHARGE}`]));
    expect(screen.getByTestId('code-graph-source')).toHaveTextContent('found by builds edges');

    const code = within(panes).getByTestId('code-graph-code');
    expect(code).toHaveTextContent('src/pay.ts:10-12');
    expect(code).toHaveTextContent('builds · exact');
    expect(code).toHaveTextContent('export function charge(id: string) {');
    expect(within(code).getByText('11')).toBeInTheDocument();

    const ast = within(panes).getByTestId('code-graph-ast');
    expect(within(ast).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['function_declarationcharge10-12', 'formal_parameters10-10', 'statement_block10-12']);

    expect(within(panes).getByTestId('call-graph-callers')).toHaveTextContent('checkout');
    expect(within(panes).getByTestId('call-graph-callees')).toHaveTextContent('round name-match');
    expect(within(panes).getByTestId('call-graph-tests')).toHaveTextContent('charges a card');
  });

  it('S9-A1 the drill-down is read only: no input, no textarea, no editable element', async () => {
    await openBox(fakeGraph({ 'box cart': BOX_CART, [CHARGE]: SHOW_CHARGE }), 'cart');
    const panel = await screen.findByTestId('code-graph');
    await within(panel).findByTestId('code-graph-node');
    expect(panel.querySelectorAll('input, textarea, select, [contenteditable="true"]')).toHaveLength(0);
    expect(within(panel).getByText('read only')).toBeInTheDocument();
    expect(panel.querySelector('pre')).toHaveAttribute('aria-readonly', 'true');
  });

  it('S9-A1 a box that builds two nodes lets the builder pick one; the other node is asked for on click', async () => {
    const two = answer([BOX_NODE], [...BOX_CART.edges, edge('box cart', 'cart', 'x/refund().', 'refund', 'builds', 'name-match')], {
      ends: { ...BOX_CART.ends, 'x/refund().': { kind: 'function', file: 'src/pay.ts', range: '40-44' } },
    });
    const graph = fakeGraph({ 'box cart': two, [CHARGE]: SHOW_CHARGE, 'x/refund().': answer([node('x/refund().', 'refund', { code: 'function refund() {}', range: '40-40' })], []) });
    const user = await openBox(graph, 'cart');
    await screen.findByTestId('code-graph-node');
    expect(screen.getByTestId('code-graph-pick-charge')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByTestId('code-graph-pick-refund'));
    await waitFor(() => expect(screen.getByTestId('code-graph-code')).toHaveTextContent('function refund() {}'));
    expect(screen.getByTestId('code-graph-code')).toHaveTextContent('builds · name-match');
  });

  it('S9-A1 a box that builds many nodes shows the first picks and a "Show all" button', async () => {
    const ids = Array.from({ length: MAX_PICKS + 3 }, (_, i) => `x/f${String(i).padStart(2, '0')}().`);
    const many = answer([BOX_NODE], [...BOX_CART.edges, ...ids.map((id) => edge('box cart', 'cart', id, id.slice(2, 5), 'builds'))], {
      ends: { ...BOX_CART.ends, ...Object.fromEntries(ids.map((id, i) => [id, { kind: 'function' as const, file: 'src/z.ts', range: `${i + 1}-${i + 1}` }])) },
    });
    const user = await openBox(fakeGraph({ 'box cart': many, [CHARGE]: SHOW_CHARGE }), 'cart');
    await screen.findByTestId('code-graph-node');
    const picks = screen.getByTestId('code-graph-picks');
    expect(within(picks).getAllByRole('button', { pressed: false }).length + 1).toBe(MAX_PICKS);
    await user.click(screen.getByTestId('code-graph-picks-all'));
    expect(screen.getByTestId('code-graph-picks-all')).toHaveTextContent('Show fewer');
    expect(within(picks).getAllByRole('button', { pressed: false }).length + 1).toBe(MAX_PICKS + 4);
  });

  it('S9-A1 with no builds edge yet, the code is found by the files of the Flow-Box commits, and says so', async () => {
    const graph = fakeGraph({ 'src/pay.ts': SHOW_FILE, [CHARGE]: SHOW_CHARGE });
    await openBox(graph, 'cart');
    await screen.findByTestId('code-graph-node');
    await waitFor(() => expect(graph.asked).toEqual(['box cart', 'src/pay.ts', CHARGE, `near 1 ${CHARGE}`]));
    expect(screen.getByTestId('code-graph-source')).toHaveTextContent('found by the files of Flow-Box commits (no builds edge yet)');
    expect(screen.getByTestId('code-graph-pick-Charge')).toBeInTheDocument();
  });
});

describe('S9-A2 a leaf box with no Flow-Box commit', () => {
  it('S9-A2 the panel says "This box has no code yet."', async () => {
    const graph = fakeGraph({ 'box pay': answer([node('box pay', 'pay', { kind: 'box', language: 'record' })], []) });
    await openBox(graph, 'pay');
    expect(await screen.findByTestId('code-graph-none')).toHaveTextContent(NO_CODE_YET);
    expect(graph.asked).toEqual(['box pay']);
  });

  it('S9-A2 a box the graph does not know has no code yet either', async () => {
    await openBox(fakeGraph({}), 'pay');
    expect(await screen.findByTestId('code-graph-none')).toHaveTextContent('This box has no code yet.');
  });

  it('a graph error is shown, and the server restart is the restart notice', async () => {
    await openBox(fakeGraph({ 'box pay': { ok: false, notFound: false, error: 'boom' } }), 'pay');
    expect(await screen.findByTestId('code-graph-error')).toHaveTextContent('Could not ask the code graph: boom');
  });
});

describe('S9 model', () => {
  it('builtNodes are the builds edges out of the box node; definedNodes the code a file defines', () => {
    expect(builtNodes(BOX_CART)).toEqual([{ id: CHARGE, name: 'charge', kind: 'function', file: 'src/pay.ts', range: '10-12', trust: 'exact' }]);
    expect(builtNodes(undefined)).toEqual([]);
    expect(definedNodes([SHOW_FILE, undefined]).map((n) => [n.name, n.kind])).toEqual([
      ['charge', 'function'],
      ['Charge', 'class'],
    ]);
    expect(boxTarget('checkout/pay')).toBe('box checkout/pay');
  });

  it('exact builds edges come first; the fallback leaves test files out', () => {
    const mixed = answer([BOX_NODE], [edge('box cart', 'cart', 'a/aaa().', 'aaa', 'builds', 'name-match'), ...BOX_CART.edges]);
    expect(builtNodes(mixed).map((n) => n.name)).toEqual(['charge', 'aaa']);
    const testFile = answer([node('t/', 'pay.test.ts', { kind: 'file', file: 'test/pay.test.ts', range: undefined })], [edge('t/', 'pay.test.ts', 't/x().', 'pays', 'defines')]);
    expect(definedNodes([testFile])).toEqual([]);
    expect(['src/pay.ts', 'test/pay.ts', 'src/pay.test.tsx', 'pkg/tests/x.py', 'app/test_pay.py', 'app/pay_test.py', 'src/testing.ts'].map(isTestFile)).toEqual([false, true, true, true, true, true, false]);
  });

  it('S9-A1 among exact builds edges, names that share words with the box path come first', () => {
    const box = { ...BOX_NODE, id: 'b', name: 'checkout/sign-off' };
    const a = answer([box], ['startServe', 'signOffPayload', 'signOff'].map((n) => edge('b', 'checkout/sign-off', `x/${n}().`, n, 'builds')), {
      ends: { 'x/startServe().': { kind: 'function', file: 'a.ts' }, 'x/signOffPayload().': { kind: 'function', file: 'b.ts' }, 'x/signOff().': { kind: 'function', file: 'c.ts' } },
    });
    expect(builtNodes(a).map((n) => n.name)).toEqual(['signOff', 'signOffPayload', 'startServe']);
    expect(nameWords('checkout/sign-off')).toEqual(['checkout', 'sign', 'off']);
    expect(nameWords('signOffPayload')).toEqual(['sign', 'off', 'payload']);
    expect(nameWords('load_row')).toEqual(['load', 'row']);
  });

  it('S9-A1 tests and files a Flow-Box commit touched are not the code the box builds', () => {
    const touched = answer(
      [BOX_NODE],
      [...BOX_CART.edges, edge('box cart', 'cart', 't/pays().', 'pays', 'builds'), edge('box cart', 'cart', 'f/', 'pay.ts', 'builds'), edge('box cart', 'cart', 'h/helper().', 'helper', 'builds')],
      {
        ends: { ...BOX_CART.ends, 't/pays().': { kind: 'test', file: 'test/pay.test.ts' }, 'f/': { kind: 'file', file: 'src/pay.ts' }, 'h/helper().': { kind: 'function', file: 'test/helpers.ts', range: '1-3' } },
      },
    );
    expect(builtNodes(touched).map((n) => n.name)).toEqual(['charge']);
    const onlyTests = answer([BOX_NODE], [edge('box cart', 'cart', 't/pays().', 'pays', 'builds')], { ends: { 't/pays().': { kind: 'test', file: 'test/pay.test.ts' } } });
    expect(builtNodes(onlyTests)).toEqual([]);
  });

  it('callGraph, outlineRows and codeLines', () => {
    expect(callGraph(SHOW_CHARGE)).toEqual({
      callers: [{ id: 'x/checkout().', name: 'checkout', trust: 'exact', kind: 'calls' }],
      callees: [{ id: 'x/round().', name: 'round', trust: 'name-match', kind: 'calls' }],
      tests: [{ id: 'x/test charge', name: 'charges a card', trust: 'exact', kind: 'tests' }],
    });
    expect(outlineRows(SHOW_CHARGE.outline!.root).map((r) => [r.depth, r.type])).toEqual([
      [0, 'function_declaration'],
      [1, 'formal_parameters'],
      [1, 'statement_block'],
    ]);
    expect(codeLines(SHOW_CHARGE.nodes[0]!).map((l) => l.n)).toEqual([10, 11, 12]);
  });
});

describe('S9 httpGraphApi: GET api/graph with the session token', () => {
  const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as Response;

  it('S9-A4 sends the token header; a 404 is not found; a second token 403 is the restart notice', async () => {
    const calls: { url: string; token: string | undefined }[] = [];
    let graph = (url: string): Response => reply(200, url.includes('verb=near') ? answer([], [], { verb: 'near' }) : BOX_CART);
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === 'api/session') return reply(200, { token: 'tok-1', identity: { by: 'a@b.c' }, signing: { ok: false, reason: 'off' } });
      calls.push({ url, token: (init?.headers as Record<string, string>)['x-rehearse-token'] });
      return graph(url);
    });
    const api = httpGraphApi(createSessionClient());
    expect(await api.show('box checkout/pay')).toEqual({ ok: true, answer: BOX_CART });
    expect(calls[0]).toEqual({ url: 'api/graph?verb=show&target=box+checkout%2Fpay', token: 'tok-1' });
    expect((await api.near('charge', 2)).ok).toBe(true);
    expect(calls[1]!.url).toBe('api/graph?verb=near&target=charge&depth=2');

    graph = () => reply(404, { ...answer([], []), ok: false, exitCode: 1, notes: ['not found'] });
    expect(await api.show('nope')).toEqual(NOT_FOUND);
    graph = () => reply(403, { ok: false, error: TOKEN_ERROR });
    expect(await api.show('charge')).toEqual({ ok: false, notFound: false, error: SERVER_RESTARTED });
    graph = () => reply(403, { ok: false, error: 'Origin does not match Host' });
    expect(await api.show('charge')).toEqual({ ok: false, notFound: false, error: 'Origin does not match Host' });
  });
});

describe('S12 unit test coverage in the function view under a leaf box', () => {
  const TEST_ID = 'x/test charge';
  const withCoverage = (stale: boolean): PanelAnswer => ({
    ...SHOW_CHARGE,
    coverageInfo: { found: true, reports: [{ path: 'coverage/lcov.info', mtimeMs: 1, files: 1 }] },
    coverage: {
      id: CHARGE, file: 'src/pay.ts', range: '10-12', uncovered: ['11'],
      stats: { lines: 2, covered: 1, branches: 2, branchesCovered: 1, percent: 50, tests: 1, stale },
      lines: [{ n: 10, state: 'run', hits: 3, branch: 'partial', branches: { found: 2, hit: 1 } }, { n: 11, state: 'missed' }, { n: 12, state: 'none' }],
      testedBy: [{ id: TEST_ID, name: 'charges a card', file: 'test/pay.test.ts', range: '3-9', trust: 'exact', direct: true }],
    },
  });

  it('S12-A2 each line has its mark: run green, not run red, not code none; a partly taken branch has ◐', async () => {
    await openBox(fakeGraph({ 'box cart': BOX_CART, [CHARGE]: withCoverage(false) }), 'cart');
    const code = await screen.findByTestId('code-graph-code');
    expect(within(code).getByTestId('code-coverage-badge')).toHaveTextContent('50% · 1 test');
    expect(within(code).getByTestId('code-coverage-badge')).toHaveAttribute('data-tone', 'fair');
    expect(screen.getByTestId('code-line-10')).toHaveClass('cov-run', 'cov-branch');
    expect(screen.getByTestId('code-line-10')).toHaveAttribute('title', 'run 3× · branches partly taken (1 of 2)');
    expect(screen.getByTestId('code-line-10')).toHaveTextContent('◐');
    expect(screen.getByTestId('code-line-11')).toHaveClass('cov-missed');
    expect(screen.getByTestId('code-line-11')).toHaveAttribute('title', 'not run');
    expect(screen.getByTestId('code-line-12')).not.toHaveClass('cov-run');
    expect(screen.getByTestId('code-line-12')).not.toHaveClass('cov-missed');
    expect(screen.queryByTestId('code-coverage-stale')).toBeNull();
  });

  it('S12-A3 tested by lists the test that calls it; a click opens the test code', async () => {
    const graph = fakeGraph({ 'box cart': BOX_CART, [CHARGE]: withCoverage(false), [TEST_ID]: answer([node(TEST_ID, 'charges a card', { kind: 'test', file: 'test/pay.test.ts', range: '3-9', code: "it('charges a card', () => {})" })], []) });
    const user = await openBox(graph, 'cart');
    const tested = await screen.findByTestId('tested-by');
    expect(tested).toHaveTextContent('charges a card');
    expect(tested).toHaveTextContent('test/pay.test.ts:3-9');
    expect(tested).toHaveTextContent('calls it');
    await user.click(within(tested).getByTestId('tested-by-charges a card'));
    await waitFor(() => expect(screen.getByTestId('code-graph-code')).toHaveTextContent("it('charges a card', () => {})"));
  });

  it('S12-A4 coverage older than the code says so on the function', async () => {
    await openBox(fakeGraph({ 'box cart': BOX_CART, [CHARGE]: withCoverage(true) }), 'cart');
    expect(await screen.findByTestId('code-coverage-stale')).toHaveTextContent('coverage is older than this code; run the tests again');
    expect(screen.getByTestId('code-coverage-badge')).toHaveTextContent('⟳');
  });

  it('S12-A5 no coverage file: one plain line, no marks', async () => {
    const none = { ...SHOW_CHARGE, coverageInfo: { found: false, reports: [], hint: 'No coverage file yet. Run `pnpm coverage` to write coverage/lcov.info in each package.' } };
    await openBox(fakeGraph({ 'box cart': BOX_CART, [CHARGE]: none }), 'cart');
    expect(await screen.findByTestId('code-coverage-hint')).toHaveTextContent('No coverage file yet.');
    expect(screen.queryByTestId('code-coverage-badge')).toBeNull();
    expect(screen.getByTestId('code-line-11').className).toBe('code-graph-line');
  });
});
