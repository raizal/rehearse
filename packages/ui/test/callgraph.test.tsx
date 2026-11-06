// S9 (EPIC 2026-11-05-code-graph), T36: the call graph of the code drill-down drawn as a node graph
// (box drill-code). The graph is a fake through GraphApiContext; `near` answers what the serve
// route gives: the center at distance 0, its neighbours, and the edges with their trust.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AnswerEdge, AnswerNode, CodeIndex } from '@rehearse/server';
import { CodeApiContext, type CodeApi } from '../src/code-api.js';
import { StoryView } from '../src/components/StoryView.js';
import { GraphApiContext, type GraphApi, type GraphOutcome, type PanelAnswer } from '../src/graph-api.js';
import { flowElements } from '../src/components/CallGraphView.js';
import { callGraphModel, cgNodeTitle, FOLD_AT, layoutCallGraph } from '../src/model/callgraph.js';
import { boxAt } from '../src/model/diagram.js';
import { reviewEpic } from './fixture.js';

const ref = (c: string, subject: string) => ({ sha: c.repeat(40), short: c.repeat(7), subject, date: '2026-11-05T10:00:00+07:00' });
const INDEX: CodeIndex = { ok: true, head: ref('9', 'Head'), boxes: { cart: { commits: [ref('1', 'Cart (D7)')], files: ['src/pay.ts'] } } };
const codeApi: CodeApi = { index: async () => INDEX, box: async () => ({ ok: false, error: 'not in this test' }) };

const CHARGE = 'x/charge().';
const CHECKOUT = 'x/checkout().';
const node = (id: string, name: string, extra: Partial<AnswerNode> = {}): AnswerNode => ({
  id, kind: 'function', name, terms: name, language: 'typescript', targetOnly: false, rank: 0, file: 'src/pay.ts', range: '10-12', ...extra,
});
const edge = (from: string, fromName: string, to: string, toName: string, kind: AnswerEdge['kind'] = 'calls', trust: AnswerEdge['trust'] = 'exact'): AnswerEdge => ({
  from, to, fromName, toName, kind, trust, source: 'tree-sitter',
});
const answer = (verb: 'show' | 'near', nodes: AnswerNode[], edges: AnswerEdge[], extra: Partial<PanelAnswer> = {}): PanelAnswer => ({ verb, ok: true, exitCode: 0, nodes, edges, notes: [], ...extra });

const BOX_CART = answer('show', [node('box cart', 'cart', { kind: 'box', language: 'record', file: undefined, range: undefined })], [edge('box cart', 'cart', CHARGE, 'charge', 'builds')], {
  ends: { [CHARGE]: { kind: 'function', file: 'src/pay.ts', range: '10-12' } },
});
const SHOW_CHARGE = answer('show', [node(CHARGE, 'charge', { code: 'function charge() {}' })], []);
const SHOW_CHECKOUT = answer('show', [node(CHECKOUT, 'checkout', { code: 'function checkout() { charge(); }', range: '30-30' })], []);

/** charge: called by checkout (exact), tested by "charges a card", calls round (name-match), requests.get (outside) and an unresolved name, and POSTs a route. */
const NEAR_CHARGE = answer(
  'near',
  [
    node(CHARGE, 'charge', { distance: 0 }),
    node(CHECKOUT, 'checkout', { distance: 1, range: '30-30' }),
    node('x/round().', 'round', { distance: 1, range: '50-52' }),
    node('t/charges a card', 'charges a card', { kind: 'test', file: 'test/pay.test.ts', range: '3-9', distance: 1 }),
    node('pip requests get().', 'requests.get', { targetOnly: true, file: undefined, range: undefined, distance: 1 }),
    node('route POST /api/pay', 'POST /api/pay', { kind: 'route', file: 'api/pay.py', range: '4-20', language: 'python', distance: 1 }),
  ],
  [
    edge(CHECKOUT, 'checkout', CHARGE, 'charge'),
    edge(CHARGE, 'charge', 'x/round().', 'round', 'calls', 'name-match'),
    edge(CHARGE, 'charge', 'pip requests get().', 'requests.get', 'calls', 'unresolved'),
    edge(CHARGE, 'charge', 'x/gone().', 'gone', 'calls', 'unresolved'),
    edge('t/charges a card', 'charges a card', CHARGE, 'charge', 'tests'),
    edge(CHARGE, 'charge', 'route POST /api/pay', 'POST /api/pay', 'http-calls'),
    edge('file', 'pay.ts', CHARGE, 'charge', 'defines'),
  ],
);
const NEAR_CHECKOUT = answer('near', [node(CHECKOUT, 'checkout', { distance: 0 }), node(CHARGE, 'charge', { distance: 1 })], [edge(CHECKOUT, 'checkout', CHARGE, 'charge')]);
const NEAR_CHARGE_2 = answer('near', [...NEAR_CHARGE.nodes, node('x/main().', 'main', { distance: 2, file: 'src/main.ts', range: '1-5' })], [...NEAR_CHARGE.edges, edge('x/main().', 'main', CHECKOUT, 'checkout')]);

function fakeGraph(answers: Record<string, PanelAnswer>): GraphApi & { asked: string[] } {
  const asked: string[] = [];
  const out = (key: string): GraphOutcome => (answers[key] ? { ok: true, answer: answers[key]! } : { ok: false, notFound: true, error: 'not found' });
  return {
    asked,
    show: async (t) => (asked.push(t), out(t)),
    near: async (t, d = 1) => (asked.push(`near ${d} ${t}`), out(`near ${d} ${t}`)),
  };
}

const BASE = { 'box cart': BOX_CART, [CHARGE]: SHOW_CHARGE, [CHECKOUT]: SHOW_CHECKOUT, [`near 1 ${CHARGE}`]: NEAR_CHARGE, [`near 2 ${CHARGE}`]: NEAR_CHARGE_2, [`near 1 ${CHECKOUT}`]: NEAR_CHECKOUT };

async function openCart(answers: Record<string, PanelAnswer> = BASE) {
  const user = userEvent.setup();
  const graph = fakeGraph(answers);
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
  await user.click(await screen.findByTestId('code-box-cart'));
  return { user, graph };
}

const cg = (id: string) => screen.getByTestId(`cg-node-${id}`);

describe('S9-A1 the call graph is a node graph: the function in the center, callers left, callees right', () => {
  it('S9-A1 nodes and edges for a near answer: callers, callees, tests, HTTP calls and outside nodes', async () => {
    const { graph } = await openCart();
    const canvas = await screen.findByTestId('call-graph-canvas');
    await within(canvas).findByTestId(`cg-node-${CHARGE}`);
    expect(graph.asked).toContain(`near 1 ${CHARGE}`);
    expect(cg(CHARGE)).toHaveClass('is-center');
    expect(cg(CHARGE)).toHaveAttribute('aria-current', 'true');
    expect(cg(CHECKOUT)).toHaveAttribute('data-side', 'callers');
    expect(cg('x/round().')).toHaveAttribute('data-side', 'callees');
    expect(cg('t/charges a card')).toHaveAttribute('data-side', 'tests');
    expect(cg('t/charges a card')).toHaveClass('kind-test');
    expect(cg('route POST /api/pay')).toHaveClass('kind-route');
    expect(cg('pip requests get().')).toHaveClass('is-outside');
    expect(cg('pip requests get().')).toHaveTextContent('outside · function');
    // An unresolved end the graph has no node for is an outside node too, and cannot be the center.
    expect(cg('x/gone().')).toHaveClass('is-outside');
    expect(cg('x/gone().').tagName).toBe('DIV');
    // Defines edges are not calls.
    expect(screen.queryByTestId('cg-node-file')).toBeNull();
    // The tooltip says the kind, the place and the trust of the edge.
    expect(cg('x/round().')).toHaveAttribute('title', 'function round, src/pay.ts:50-52, calls edge, name-match');
    // Positions: callers left of the center, callees right.
    const x = (id: string) => Number(/translate\(([-\d.]+)px/.exec(cg(id).closest<HTMLElement>('.react-flow__node')!.style.transform)![1]);
    expect(x(CHECKOUT)).toBeLessThan(x(CHARGE));
    expect(x('t/charges a card')).toBeLessThan(x(CHARGE));
    expect(x('x/round().')).toBeGreaterThan(x(CHARGE));
    expect(x('route POST /api/pay')).toBeGreaterThan(x(CHARGE));
  });

  // jsdom does not measure handles, so React Flow draws no edge path there: the edges the view hands
  // React Flow are checked instead (the screenshots show them drawn).
  it('S9-A1 edge style by trust: exact solid, name-match dashed, unresolved faded; HTTP calls their own kind', async () => {
    const model = callGraphModel(NEAR_CHARGE, 1);
    const { nodes, edges } = flowElements(model, await layoutCallGraph(model));
    const cls = (id: string) => edges.find((e) => e.id === id)?.className;
    expect(cls(`calls:${CHECKOUT}->${CHARGE}`)).toBe('cg-edge kind-calls trust-exact');
    expect(cls(`calls:${CHARGE}->x/round().`)).toBe('cg-edge kind-calls trust-name-match');
    expect(cls(`calls:${CHARGE}->pip requests get().`)).toBe('cg-edge kind-calls trust-unresolved');
    expect(cls(`calls:${CHARGE}->x/gone().`)).toBe('cg-edge kind-calls trust-unresolved');
    expect(cls(`tests:t/charges a card->${CHARGE}`)).toBe('cg-edge kind-tests trust-exact');
    expect(cls(`http-calls:${CHARGE}->route POST /api/pay`)).toBe('cg-edge kind-http-calls trust-exact');
    expect(edges.every((e) => nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target))).toBe(true);
    const alone = callGraphModel(answer('near', [node(CHARGE, 'charge', { distance: 0 })], []), 1);
    expect(flowElements(alone, await layoutCallGraph(alone)).edges.map((e) => e.className)).toEqual(['cg-edge is-ghost', 'cg-edge is-ghost']);
  });

  it('S9-A1 a click on a node makes it the center: code, AST and graph follow it; Back returns to the box function', async () => {
    const { user, graph } = await openCart();
    await screen.findByTestId(`cg-node-${CHARGE}`);
    await user.click(cg(CHECKOUT));
    await waitFor(() => expect(screen.getByTestId('code-graph-code')).toHaveTextContent('function checkout() { charge(); }'));
    await waitFor(() => expect(cg(CHECKOUT)).toHaveClass('is-center'));
    expect(graph.asked).toEqual(expect.arrayContaining([CHECKOUT, `near 1 ${CHECKOUT}`]));
    expect(cg(CHARGE)).toHaveAttribute('data-side', 'callees');
    // The builds trust belongs to the box function only.
    expect(screen.getByTestId('code-graph-code')).not.toHaveTextContent('builds ·');
    await user.click(screen.getByTestId('code-graph-back'));
    await waitFor(() => expect(screen.getByTestId('code-graph-code')).toHaveTextContent('function charge() {}'));
    await waitFor(() => expect(cg(CHARGE)).toHaveClass('is-center'));
    expect(screen.queryByTestId('code-graph-back')).toBeNull();
  });

  it(`S9-A1 more than ${FOLD_AT} callers fold into one "+N more" node that opens on click`, async () => {
    const callers = Array.from({ length: FOLD_AT + 4 }, (_, i) => `c/caller${String(i).padStart(2, '0')}().`);
    const many = answer(
      'near',
      [node(CHARGE, 'charge', { distance: 0 }), ...callers.map((id) => node(id, id.slice(2, 10), { distance: 1 }))],
      callers.map((id) => edge(id, id.slice(2, 10), CHARGE, 'charge')),
    );
    const { user } = await openCart({ ...BASE, [`near 1 ${CHARGE}`]: many });
    const more = await screen.findByTestId('cg-node-more:1:callers');
    expect(more).toHaveTextContent('+5 more');
    expect(document.querySelectorAll('[data-side="callers"]')).toHaveLength(FOLD_AT);
    expect(screen.queryByTestId(`cg-node-${callers.at(-1)}`)).toBeNull();
    await user.click(more);
    await waitFor(() => expect(cg(callers.at(-1)!)).toBeInTheDocument());
    expect(screen.queryByTestId('cg-node-more:1:callers')).toBeNull();
    expect(document.querySelectorAll('[data-side="callers"]')).toHaveLength(FOLD_AT + 4);
  });

  it('S9-A1 the depth toggle asks near at depth 2 and shows the callers of the callers; depth stays when the center moves', async () => {
    const { user, graph } = await openCart();
    await screen.findByTestId(`cg-node-${CHARGE}`);
    expect(screen.getByTestId('call-graph-depth-1')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('cg-node-x/main().')).toBeNull();
    await user.click(screen.getByTestId('call-graph-depth-2'));
    expect(await screen.findByTestId('cg-node-x/main().')).toHaveAttribute('data-side', 'callers');
    expect(graph.asked).toContain(`near 2 ${CHARGE}`);
    expect(screen.getByTestId('call-graph-depth-2')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByTestId('call-graph-depth-1'));
    await waitFor(() => expect(screen.queryByTestId('cg-node-x/main().')).toBeNull());
  });

  it('S9-A1 empty sides say "no callers" and "no callees", in the graph and in the text list', async () => {
    const alone = answer('near', [node(CHARGE, 'charge', { distance: 0 })], []);
    await openCart({ ...BASE, [`near 1 ${CHARGE}`]: alone });
    expect(await screen.findByTestId('cg-node-empty:callers')).toHaveTextContent('no callers');
    expect(cg('empty:callees')).toHaveTextContent('no callees');
    expect(screen.getByTestId('call-graph-callers')).toHaveTextContent('no callers');
    expect(screen.getByTestId('call-graph-callees')).toHaveTextContent('no callees');
    expect(screen.queryByTestId('call-graph-tests')).toBeNull();
  });

  it('S9-A1 a visually hidden text list says the same for screen readers; nodes are buttons in the tab order; still read only', async () => {
    await openCart();
    await screen.findByTestId(`cg-node-${CHARGE}`);
    const text = screen.getByTestId('call-graph-text');
    expect(text).toHaveClass('sr-only');
    expect(within(text).getByTestId('call-graph-callers')).toHaveTextContent('checkout exact');
    expect(within(text).getByTestId('call-graph-callees')).toHaveTextContent('round name-match');
    expect(within(text).getByTestId('call-graph-callees')).toHaveTextContent('POST /api/pay exact');
    expect(within(text).getByTestId('call-graph-tests')).toHaveTextContent('charges a card');
    expect(screen.getByRole('button', { name: /^Show function checkout, src\/pay\.ts:30-30/ })).toBe(cg(CHECKOUT));
    const panel = screen.getByTestId('code-graph');
    expect(panel.querySelectorAll('input, textarea, select, [contenteditable="true"]')).toHaveLength(0);
  });

  it('a near error shows in the call graph pane', async () => {
    const { [`near 1 ${CHARGE}`]: _gone, ...rest } = BASE;
    await openCart(rest);
    expect(await screen.findByTestId('call-graph-error')).toHaveTextContent('Could not load the call graph of charge: not found');
  });
});

describe('S9-A1 callGraphModel', () => {
  it('sides, outside nodes, trust of the bringing edge, and edges only between drawn nodes', () => {
    const m = callGraphModel(NEAR_CHARGE, 1);
    expect(m.center).toBe(CHARGE);
    const by = Object.fromEntries(m.nodes.map((n) => [n.id, n]));
    expect([by[CHECKOUT]!.side, by['x/round().']!.side, by['t/charges a card']!.side]).toEqual(['callers', 'callees', 'tests']);
    expect([by['pip requests get().']!.outside, by['x/gone().']!.outside, by['x/gone().']!.known, by[CHECKOUT]!.outside]).toEqual([true, true, false, false]);
    expect(by['x/round().']!.via).toEqual({ kind: 'calls', trust: 'name-match' });
    expect(m.edges.every((e) => by[e.from] && by[e.to])).toBe(true);
    expect(m.edges.some((e) => e.kind === 'defines')).toBe(false);
    expect(cgNodeTitle(by['pip requests get().']!)).toBe('function requests.get, outside the repo, calls edge, unresolved');
  });

  it('folds at FOLD_AT per side and opens a group; depth 2 hangs off shown neighbours only', async () => {
    const ids = Array.from({ length: FOLD_AT + 1 }, (_, i) => `c/f${i}().`);
    const a = answer('near', [node(CHARGE, 'charge', { distance: 0 })], ids.map((id) => edge(CHARGE, 'charge', id, id)));
    const folded = callGraphModel(a, 1);
    expect(folded.nodes.filter((n) => n.side === 'callees')).toHaveLength(FOLD_AT);
    expect(folded.nodes.find((n) => n.type === 'more')!.more).toEqual({ group: '1:callees', count: 2 });
    expect(callGraphModel(a, 1, new Set(['1:callees'])).nodes.filter((n) => n.side === 'callees')).toHaveLength(FOLD_AT + 1);
    const two = callGraphModel(NEAR_CHARGE_2, 2);
    expect(two.nodes.find((n) => n.id === 'x/main().')).toMatchObject({ ring: 2, side: 'callers' });
    expect(callGraphModel(NEAR_CHARGE_2, 1).nodes.some((n) => n.id === 'x/main().')).toBe(false);
    const rects = (await layoutCallGraph(two)).nodes;
    expect(rects['x/main().']!.x).toBeLessThan(rects[CHECKOUT]!.x);
    expect(rects[CHECKOUT]!.x).toBeLessThan(rects[CHARGE]!.x);
  });
});
