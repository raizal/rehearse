// The storyboard flowchart model (S6-A1, T37): one node per step in its role lane, a decision as
// a diamond with the branch it takes, the branches not taken as faded boxes, and a layout that
// fits a typical scenario in the page width.

import { describe, expect, it } from 'vitest';
import type { ScenarioView } from '../src/api.js';
import { layoutStoryFlow, notTaken, SF, storyFlow } from '../src/model/storyflow.js';
import { realEpic, reviewEpic } from './fixture.js';

const view = reviewEpic();
const sv = (id: string): ScenarioView => view.scenarios.find((s) => s.scenario.id === id)!;
const sfOf = (id: string) => storyFlow(view.flow, view.prd, sv(id).scenario);

describe('the scenario path as a flowchart (S6-A1)', () => {
  it('S6-A1: one step node per step, in path order, with its box title and lane', () => {
    const sf = sfOf('S1-buy');
    expect(sf.steps.map((s) => [s.id, s.path, s.title, s.lane, s.decision])).toEqual([
      ['step-1', 'cart', 'Check out the cart', 'builder', false],
      ['step-2', 'pay', 'Charge the buyer', 'system', false],
      ['step-3', 'in-stock', 'Item in stock?', 'system', true],
      ['step-4', 'ship/pack', 'Pack', 'system', false],
    ]);
    expect(sf.steps[3]!.inside).toBe('Ship the order');
    expect(sf.lanes.map((l) => l.role)).toEqual(['builder', 'system']);
  });

  it('S6-A1: the taken edges chain the steps; the decision edge carries its branch label', () => {
    const sf = sfOf('S1-buy');
    const taken = sf.edges.filter((e) => e.taken);
    expect(taken.map((e) => [e.from, e.to, e.label])).toEqual([
      ['step-1', 'step-2', undefined],
      ['step-2', 'step-3', undefined],
      ['step-3', 'step-4', 'yes'],
    ]);
    expect(sf.steps[2]!.branch).toBe('yes');
  });

  it('S6-A1: each branch not taken leads to the box it would go to', () => {
    const sf = sfOf('S1-buy');
    const ghosts = notTaken(sf, 2);
    expect(ghosts.map((g) => [g.label, g.title])).toEqual([['no', 'No order']]);
    expect(sf.edges.find((e) => !e.taken)).toMatchObject({ from: 'step-3', to: ghosts[0]!.id, label: 'no' });
    expect(notTaken(sf, 0)).toEqual([]);
  });

  it('S6-A1: the decision a scenario takes by its next step (no branch field) still has its label', () => {
    const sf = sfOf('S2-out-of-stock');
    const decision = sf.steps.find((s) => s.decision)!;
    expect(decision.branch).toBeDefined();
    expect(notTaken(sf, decision.index).length).toBeGreaterThan(0);
  });
});

describe('the flowchart layout (S6-A1)', () => {
  it('S6-A1: lanes are columns side by side; each step has its own row, top to bottom', () => {
    const sf = sfOf('S1-buy');
    const layout = layoutStoryFlow(sf);
    const [builder, system] = layout.lanes;
    expect(builder!.x).toBe(0);
    expect(system!.x).toBe(builder!.w);
    expect(layout.width).toBe(builder!.w + system!.w);
    const ys = sf.steps.map((s) => layout.nodes[s.id]!.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(new Set(ys).size).toBe(ys.length);
    for (const s of sf.steps) {
      const r = layout.nodes[s.id]!;
      const lane = layout.lanes.find((l) => l.role === s.lane)!;
      expect(r.x, s.id).toBeGreaterThanOrEqual(lane.x);
      expect(r.x + r.w, s.id).toBeLessThanOrEqual(lane.x + lane.w);
    }
    expect(layout.nodes['step-3']).toMatchObject({ w: SF.diamondW, h: SF.diamondH });
  });

  it('S6-A1: a faded box sits in its lane, in the row of its decision, clear of the step nodes', () => {
    const sf = sfOf('S1-buy');
    const layout = layoutStoryFlow(sf);
    const ghost = notTaken(sf, 2)[0]!;
    const g = layout.nodes[ghost.id]!;
    const d = layout.nodes['step-3']!;
    expect(g.y).toBeGreaterThanOrEqual(d.y);
    expect(g.y + g.h).toBeLessThanOrEqual(d.y + d.h);
    for (const s of sf.steps) {
      const r = layout.nodes[s.id]!;
      const apart = g.x >= r.x + r.w || r.x >= g.x + g.w || g.y >= r.y + r.h || r.y >= g.y + g.h;
      expect(apart, s.id).toBe(true);
    }
  });

  it('S6-A1: every real scenario lays out, and most fit a 1100 px wide chart without scrolling', () => {
    const real = realEpic();
    const widths = real.scenarios.map((s) => {
      const sf = storyFlow(real.flow, real.prd, s.scenario);
      const layout = layoutStoryFlow(sf);
      for (const n of [...sf.steps, ...sf.ghosts]) expect(layout.nodes[n.id], `${s.scenario.id} ${n.id}`).toBeDefined();
      return layout.width;
    });
    const fit = widths.filter((w) => w <= 1100).length;
    expect(fit / widths.length).toBeGreaterThan(0.9);
  });
});
