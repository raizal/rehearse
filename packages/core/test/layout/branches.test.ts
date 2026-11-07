// T57 (S22): a story's scenarios as branches of one main path, on the shop fixture's flow. The main
// path takes no error edge; the others are compared with it step by step (name, branch, example).

import { describe, expect, it } from 'vitest';
import { loadEpic, type Scenario, type ScenarioStep } from '../../src/index.js';
import { branchHeader, branchLabel, compareWithMain, layoutStoryMap, sameStep, storyBranches, storyMap } from '../../src/layout/index.js';
import { makeEpic } from '../helpers.js';

const { flow, prd } = loadEpic(makeEpic()).record;

const sc = (id: string, steps: ScenarioStep[]): Scenario => ({ id, story: 'S1', title: id, status: 'draft', steps, expect: { criterion: 'S1-A1', state: {} } }) as Scenario;
const BUY: ScenarioStep[] = [{ name: 'start' }, { name: 'cart' }, { name: 'pay' }, { name: 'in-stock', branch: 'yes' }, { name: 'ship/pack' }, { name: 'ship/send' }, { name: 'done' }];
const EMPTY: ScenarioStep[] = [{ name: 'start' }, { name: 'cart', branch: 'empty-cart' }, { name: 'failed' }];
const NO_STOCK: ScenarioStep[] = [{ name: 'start' }, { name: 'cart' }, { name: 'pay' }, { name: 'in-stock', branch: 'no' }, { name: 'failed' }];

describe('the main path (S22)', () => {
  it('is the scenario with no error edge, even when an error scenario comes first in the file', () => {
    const b = storyBranches(flow, 'S1', [sc('empty', EMPTY), sc('buy', BUY)]);
    expect([b.mainId, b.source]).toEqual(['buy', 'derived']);
    expect(b.branches.map((x) => [x.scenarioId, x.kind])).toEqual([['buy', 'main'], ['empty', 'branch']]);
  });

  it('on a tie, the first in file order', () => {
    const a = sc('a', BUY);
    const b = sc('b', BUY.map((s, i) => (i === 1 ? { ...s, example: { id: 'other' } } : s)));
    expect(storyBranches(flow, 'S1', [a, b]).mainId).toBe('a');
    expect(storyBranches(flow, 'S1', [b, a]).mainId).toBe('b');
  });

  it('prefers the path the others go the same way as the furthest, then the most story boxes', () => {
    // "short" walks fewer boxes but the two others share its whole way; "buy" shares only 3 steps with them.
    const short = sc('short', [{ name: 'start' }, { name: 'cart' }, { name: 'pay' }, { name: 'in-stock', branch: 'no' }, { name: 'failed' }]);
    const twin = sc('twin', [{ name: 'start' }, { name: 'cart' }, { name: 'pay' }, { name: 'in-stock', branch: 'no' }, { name: 'failed' }]);
    expect(storyBranches(flow, 'S1', [sc('buy', BUY), short, twin]).mainId).toBe('short');
    expect(storyBranches(flow, 'S1', [sc('buy', BUY), short]).mainId).toBe('buy');
  });

  it('a story with one scenario: that scenario, even when it takes an error edge', () => {
    const b = storyBranches(flow, 'S1', [sc('empty', EMPTY)]);
    expect([b.mainId, b.source, b.branches[0]!.kind]).toEqual(['empty', 'only', 'main']);
  });

  it('every scenario takes an error edge: the first, and it says so', () => {
    const b = storyBranches(flow, 'S1', [sc('e1', EMPTY), sc('e2', EMPTY.map((s, i) => (i === 0 ? { ...s, example: { id: 'x' } } : s)))]);
    expect([b.mainId, b.source]).toEqual(['e1', 'fallback']);
    expect(b.note).toBe('Every scenario of this story takes an error edge: the first one is shown as the main path.');
  });

  it("the owner's pick wins; a pick that names no scenario of the story is ignored", () => {
    const all = [sc('buy', BUY), sc('empty', EMPTY), sc('nostock', NO_STOCK)];
    expect(storyBranches(flow, 'S1', all, 'nostock')).toMatchObject({ mainId: 'nostock', source: 'owner' });
    expect(storyBranches(flow, 'S1', all, 'S9-nope')).toMatchObject({ mainId: 'buy', source: 'derived' });
  });
});

describe('branch point and rejoin (S22)', () => {
  const main = sc('buy', BUY);

  it('steps with equal names but other examples are different steps', () => {
    const a = { name: 'cart', example: { id: 'cart-ok', given: { items: ['a'] } } };
    expect(sameStep(a, { ...a })).toBe(true);
    expect(sameStep(a, { name: 'cart', example: { id: 'cart-ok', given: { items: ['b'] } } })).toBe(false);
    expect(sameStep(a, { name: 'cart' })).toBe(false);
    const other = compareWithMain(flow, main, sc('data', BUY.map((s, i) => (i === 1 ? { ...s, example: { id: 'big-cart' } } : s))));
    expect(other).toMatchObject({ kind: 'branch', shared: 1, at: 1, atTitle: 'Check out the cart', dataOnly: true });
    expect(other.condition).toBe('the example is "big-cart"');
    expect(other.rejoin).toBeUndefined();
  });

  it('leaves at a decision on another branch, in plain words; no rejoin when it ends elsewhere', () => {
    const b = compareWithMain(flow, main, sc('nostock', NO_STOCK));
    expect(b).toMatchObject({ kind: 'branch', shared: 3, at: 3, atPath: 'in-stock', condition: 'the answer to "Item in stock?" is no' });
    expect(b.rejoin).toBeUndefined();
    expect(branchLabel(b)).toBe('Branch at Item in stock?: the answer to "Item in stock?" is no');
    expect(branchHeader(b)).toBe('Branch of the main path at Item in stock?: when the answer to "Item in stock?" is no');
  });

  it('an error exit: the edge label is the condition', () => {
    expect(compareWithMain(flow, main, sc('empty', EMPTY))).toMatchObject({ shared: 1, at: 1, condition: 'empty-cart' });
  });

  it('branches at the first step', () => {
    const m = sc('m', [{ name: 'in-stock', branch: 'yes' }, { name: 'ship/pack' }, { name: 'ship/send' }, { name: 'done' }]);
    const b = compareWithMain(flow, m, sc('n', [{ name: 'in-stock', branch: 'no' }, { name: 'failed' }]));
    expect(b).toMatchObject({ kind: 'branch', shared: 0, at: 0, atPath: 'in-stock' });
  });

  it('no shared step: it starts apart, and joins the main path where it reaches a main path box', () => {
    const b = compareWithMain(flow, main, sc('late', [{ name: 'pay' }, { name: 'in-stock', branch: 'yes' }, { name: 'ship/pack' }]));
    expect(b).toMatchObject({ kind: 'apart', shared: 0, at: 0, condition: 'it starts at Charge the buyer' });
    expect(b.rejoin).toMatchObject({ at: 1, mainAt: 3, path: 'in-stock' });
    expect(branchLabel(b)).toBe('Starts apart from the main path: it starts at Charge the buyer');
  });

  it('joins the main path again after a detour', () => {
    const b = compareWithMain(flow, main, sc('whole', [{ name: 'start' }, { name: 'cart' }, { name: 'pay' }, { name: 'in-stock', branch: 'yes' }, { name: 'ship' }, { name: 'done' }]));
    expect(b).toMatchObject({ kind: 'branch', shared: 4, at: 3, condition: 'the answer to "Item in stock?" is yes' });
    expect(b.rejoin).toEqual({ at: 5, mainAt: 6, path: 'done', title: 'Order shipped' });
  });

  it('the same steps as the main path: kind same, after every branch in the order', () => {
    const b = storyBranches(flow, 'S1', [sc('twin', BUY), sc('buy', BUY), sc('empty', EMPTY)]);
    expect(b.branches.map((x) => [x.scenarioId, x.kind])).toEqual([['twin', 'main'], ['empty', 'branch'], ['buy', 'same']]);
  });

  it('branches come in the order they leave the main path, file order on a tie', () => {
    const b = storyBranches(flow, 'S1', [sc('nostock', NO_STOCK), sc('late', [{ name: 'pay' }]), sc('buy', BUY), sc('empty', EMPTY)], 'buy');
    expect(b.branches.map((x) => x.scenarioId)).toEqual(['buy', 'empty', 'nostock', 'late']);
  });
});

describe('one map per story (S22)', () => {
  const all = [sc('buy', BUY), sc('empty', EMPTY), sc('nostock', NO_STOCK)];
  const map = storyMap(flow, prd, 'S1', all);

  it('draws a box many scenarios cross once, and every path is there', () => {
    expect(map.nodes.map((n) => n.path)).toEqual(['start', 'cart', 'pay', 'in-stock', 'ship/pack', 'ship/send', 'done', 'failed']);
    expect(map.nodes.find((n) => n.path === 'start')!.scenarios).toEqual(['buy', 'empty', 'nostock']);
    for (const s of all) {
      const ids = map.steps[s.id]!;
      expect(ids.map((id) => map.nodes.find((n) => n.id === id)!.path)).toEqual(s.steps.map((x) => x.name));
      for (let i = 0; i + 1 < ids.length; i++) expect(map.edges.some((e) => e.from === ids[i] && e.to === ids[i + 1] && e.scenarios.includes(s.id))).toBe(true);
    }
  });

  it('the main path is the spine; each branch line is its own, labelled at the decision', () => {
    expect(map.nodes.filter((n) => n.main).map((n) => n.path)).toEqual(BUY.map((s) => s.name));
    const no = map.edges.find((e) => e.label === 'no')!;
    expect([no.line, no.main, no.scenarios, no.taken]).toEqual(['nostock', false, ['nostock'], true]);
    const empty = map.edges.find((e) => e.label === 'empty-cart')!;
    expect([empty.line, empty.error]).toEqual(['empty', true]);
    const l = layoutStoryMap(map);
    const main = map.nodes.filter((n) => n.main).map((n) => l.nodes[n.id]!);
    for (let i = 1; i < main.length; i++) expect(main[i]!.y).toBeGreaterThan(main[i - 1]!.y);
    // The lanes are the story's lanes, in flow.yaml order; every node sits inside its lane.
    for (const n of map.nodes) {
      const lane = l.lanes.find((x) => x.role === n.lane)!;
      const r = l.nodes[n.id]!;
      expect(r.x).toBeGreaterThanOrEqual(lane.x);
      expect(r.x + r.w).toBeLessThanOrEqual(lane.x + lane.w);
    }
    // No two boxes overlap.
    const rects = Object.values(l.nodes);
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
      }
  });
});
