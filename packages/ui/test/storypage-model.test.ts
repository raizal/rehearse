// Pure model of the story pages as the design draws them (design pages 2, 3, 12–15): the compact
// queue rows, the story state chip, HOW as a vertical flow and the scenario card summary.

import { describe, expect, it } from 'vitest';
import { boxAt, LANE_COLORS } from '../src/model/diagram.js';
import { storyDetail } from '../src/model/storyview.js';
import { approvalsNote, howFlow, statusMachine, queueRows, scenarioSummary, shorten, stepTitle, storyState } from '../src/model/storypage.js';
import { codeGraphEpic, realEpic, reviewEpic } from './fixture.js';

describe('review queue rows (design page 2)', () => {
  it('cuts the want to one line with an ellipsis', () => {
    expect(shorten('to pay', 30)).toBe('to pay');
    expect(shorten('to approve the scenarios that agents drafted', 30)).toBe('to approve the scenarios that…');
  });

  it('says how many scenarios and how many approvals are signed, in words', () => {
    expect(approvalsNote(0, 3)).toBe('3 scenarios · approvals not signed');
    expect(approvalsNote(1, 1)).toBe('1 scenario · all approvals signed');
    expect(approvalsNote(1, 2)).toBe('2 scenarios · 1 of 2 approvals signed');
    expect(approvalsNote(0, 0)).toBe('no scenarios yet');
  });

  it('one row per story in prd.yaml order, with the scenarios of each', () => {
    const rows = queueRows(reviewEpic());
    expect(rows.map((r) => [r.storyId, r.scenarios, r.done, r.note])).toEqual([
      ['S1', 2, 1, '2 scenarios · 1 of 2 approvals signed'],
      ['S2', 1, 0, '1 scenario · approvals not signed'],
    ]);
    expect(LANE_COLORS).toContain(rows[0]!.color);
  });

  it('lists a story that has no scenarios yet (code-graph EPIC)', () => {
    const rows = queueRows(codeGraphEpic());
    expect(rows[0]).toMatchObject({ storyId: 'S1', scenarios: 0, note: 'no scenarios yet' });
  });

  it('the real EPIC: S1 to S20, none signed', () => {
    const rows = queueRows(realEpic());
    expect(rows.map((r) => r.storyId)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12', 'S13', 'S14', 'S15', 'S16', 'S17', 'S18', 'S19', 'S20']);
    for (const r of rows) expect(r.want.length).toBeLessThanOrEqual(31);
    expect(rows.every((r) => r.done === 0)).toBe(true);
  });
});

describe('story state chip', () => {
  it('says signed, partly signed, not signed or no scenarios', () => {
    const view = reviewEpic();
    expect(storyState(view, 'S1')).toEqual({ kind: 'partial', text: '1 of 2 signed' });
    expect(storyState(view, 'S2')).toEqual({ kind: 'unsigned', text: 'Not signed' });
    expect(storyState(view, 'S9')).toEqual({ kind: 'none', text: 'No scenarios yet' });
    view.scenarios = view.scenarios.filter((sv) => sv.scenario.id === 'S1-buy');
    expect(storyState(view, 'S1')).toEqual({ kind: 'signed', text: 'Signed' });
  });
});

describe('HOW as a vertical flow (design page 2)', () => {
  it('the boxes top to bottom, the edge between neighbours, lane and colour of each box', () => {
    const view = reviewEpic();
    boxAt(view.flow, 'ship/pack')!.stories = ['S1'];
    const f = howFlow(view, storyDetail(view, 'S1'));
    expect(f.steps.map((s) => s.path)).toEqual(['cart', 'pay', 'ship', 'ship/pack']);
    expect(f.links).toHaveLength(f.steps.length - 1);
    expect(f.links[0]).toMatchObject({ from: 'cart', to: 'pay' });
    expect(f.links[1]).toMatchObject({ from: 'pay', to: 'ship', label: 'yes', via: ['Item in stock?'] });
    for (const s of f.steps) {
      expect(s.lane).not.toBe('');
      expect(s.color).toMatch(/^#/);
    }
    expect(f.steps.find((s) => s.path === 'ship/pack')?.parent).toBe('Ship the order');
    // A nested box follows its parent with no edge between them.
    expect(f.links[2]).toBeUndefined();
  });

  it('marks a box that other stories use as shared, and a decision as a decision', () => {
    const view = realEpic();
    const f = howFlow(view, storyDetail(view, 'S6'));
    expect(f.steps.length).toBeGreaterThan(0);
    for (const s of f.steps) expect(s.also).not.toContain('S6');
    const all = view.prd!.stories.flatMap((s) => howFlow(view, storyDetail(view, s.id)).steps);
    expect(all.some((s) => s.also.length > 0)).toBe(true);
  });

  it('an edge that does not join neighbours is a jump', () => {
    const view = reviewEpic();
    const d = storyDetail(view, 'S1');
    d.how.edges.push({ from: d.how.boxes.at(-1)!.path, to: d.how.boxes[0]!.path, kind: 'error', via: [] });
    const f = howFlow(view, d);
    expect(f.jumps).toEqual([{ from: d.how.boxes.at(-1)!.path, to: 'cart', kind: 'error', via: [] }]);
  });
});

describe('scenario card summary (design page 2)', () => {
  it('steps, criterion and one dot per step in the colour of its lane', () => {
    const view = reviewEpic();
    const s = scenarioSummary(view, view.scenarios.find((sv) => sv.scenario.id === 'S1-buy')!);
    expect(s).toMatchObject({ id: 'S1-buy', steps: 4, criterion: 'S1-A1' });
    expect(s.dots).toHaveLength(4);
    expect(s.dots[0]!.lane).toBe('Builder');
    expect(s.dots[1]!.lane).toBe('System');
    expect(s.dots[0]!.color).not.toBe(s.dots[1]!.color);
  });
});

describe('OUTPUT: the status state machine (design page 2)', () => {
  it('the field with the most states, its states in order and each move with the box that makes it', () => {
    const m = statusMachine(storyDetail(reviewEpic(), 'S1'));
    expect(m).toEqual({
      target: 'Order.status',
      states: ['new', 'draft', 'paid'],
      moves: [
        { from: 'new', to: 'draft', by: expect.any(String) },
        { from: 'draft', to: 'paid', by: 'Charge the buyer' },
      ],
    });
  });

  it('the real EPIC: S6 moves Scenario.status to approved; a story that writes no state has none', () => {
    const view = realEpic();
    const m = statusMachine(storyDetail(view, 'S6'))!;
    expect(m.states).toContain('approved');
    const d = storyDetail(view, 'S6');
    d.output.changes = [];
    expect(statusMachine(d)).toBeUndefined();
  });
});

describe('storyboard step title (design page 3)', () => {
  it('a nested box reads "Parent → Box"; a root box is its own title; an unknown path says so', () => {
    const view = reviewEpic();
    expect(stepTitle(view.flow, 'ship/pack')).toBe('Ship the order → Pack');
    expect(stepTitle(view.flow, 'pay')).toBe('Charge the buyer');
    expect(stepTitle(view.flow, 'nowhere')).toBe('No box at nowhere');
  });
});
