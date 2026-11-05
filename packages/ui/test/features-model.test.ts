// Pure models of the review from big to small (D42): the big picture of the EPIC (S4-A4),
// the story view (S4-A5) and the use case diagram (S7-A1). Exact layouts on the shop fixture;
// the real EPIC checks that every story, process and role appears.

import { describe, expect, it } from 'vitest';
import type { Box } from '@rehearse/core';
import type { ReviewEpicView } from '../src/contract.js';
import { boxAt } from '../src/model/diagram.js';
import { bigPicture, bigPictureLayout, BIG, flowOrder, flowPaths, servedStories, STORY_COLORS, storyStyle } from '../src/model/features.js';
import { howLayout, storyDetail, writeChange } from '../src/model/storyview.js';
import { useCaseDiagram, useCaseLayout, writeTag } from '../src/model/usecases.js';
import { realEpic, reviewEpic } from './fixture.js';

/** The shop fixture, with box ship/pack also serving S1: ship is then shared by S1 and S2. */
function sharedShop(): ReviewEpicView {
  const view = reviewEpic();
  boxAt(view.flow, 'ship/pack')!.stories = ['S1'];
  return view;
}

describe('flow order', () => {
  it('S4-A4: a topological order of the root diagram, ties broken by flow.yaml order', () => {
    expect(flowOrder(reviewEpic().flow!.root)).toEqual(['start', 'cart', 'pay', 'in-stock', 'ship', 'failed', 'notify', 'done']);
  });

  it('S4-A4: a loop does not stop the order; the edge that closes it is ignored', () => {
    const root = {
      boxes: ['a', 'b', 'c', 'd'].map((id) => ({ id }) as Box),
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'b', label: 'again' },
        { from: 'c', to: 'd' },
      ],
    };
    expect(flowOrder(root)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('S4-A5: flowPaths lists every box, a parent before its children', () => {
    expect(flowPaths(reviewEpic().flow)).toEqual(['start', 'cart', 'pay', 'in-stock', 'ship', 'ship/pack', 'ship/send', 'failed', 'notify', 'done']);
  });

  it('S4-A4: a box serves the stories it or any descendant lists', () => {
    const flow = sharedShop().flow!;
    expect(servedStories(boxAt(flow, 'ship'))).toEqual(['S2', 'S1']);
    expect(servedStories(boxAt(flow, 'notify'))).toEqual([]);
  });
});

describe('big picture (S4-A4)', () => {
  it('S4-A4: every role, the main processes in flow order, one line per story; a shared process names its stories', () => {
    const view = sharedShop();
    const bp = bigPicture(view.flow, view.prd);
    expect(bp.lanes.map((l) => [l.role, l.kind])).toEqual([
      ['builder', 'human'],
      ['system', 'system'],
    ]);
    expect(bp.processes.map((p) => [p.id, p.lane, p.column, p.stories, p.shared])).toEqual([
      ['cart', 'builder', 0, ['S1'], false],
      ['pay', 'system', 1, ['S1'], false],
      ['ship', 'system', 2, ['S1', 'S2'], true],
      ['notify', 'system', 3, [], false],
    ]);
    expect(bp.stories.map((s) => [s.id, s.want, s.processes, s.style.color])).toEqual([
      ['S1', 'to pay for my cart', ['cart', 'pay', 'ship'], STORY_COLORS[0]],
      ['S2', 'to ship paid orders', ['ship'], STORY_COLORS[1]],
    ]);
  });

  it('S4-A4: exact layout: one column per process, one row per role, one track per story', () => {
    const view = sharedShop();
    const lay = bigPictureLayout(bigPicture(view.flow, view.prd));
    const rowH = BIG.pad * 2 + BIG.titleH + 2 * BIG.track;
    expect(rowH).toBe(96);
    expect(lay.rows.map((r) => [r.role, r.y, r.height])).toEqual([
      ['builder', 0, 96],
      ['system', 96, 96],
    ]);
    expect(lay.width).toBe(BIG.header + 4 * BIG.colW);
    expect(lay.height).toBe(192);
    expect(lay.boxes.find((b) => b.id === 'cart')).toEqual({ id: 'cart', x: 153, y: 12, w: 124, h: 72 });
    expect(lay.boxes.find((b) => b.id === 'ship')).toEqual({ id: 'ship', x: 453, y: 108, w: 124, h: 72 });
    const s1 = lay.lines.find((l) => l.storyId === 'S1')!;
    expect(s1.points).toEqual([
      { x: 215, y: 69 },
      { x: 365, y: 165 },
      { x: 515, y: 165 },
    ]);
    // A story with one process is a dot.
    expect(lay.lines.find((l) => l.storyId === 'S2')!.points).toEqual([{ x: 515, y: 175 }]);
  });

  it('S4-A4: stories after the eighth keep a colour and get a dashed line, so colour is not the only cue', () => {
    expect(storyStyle(0)).toEqual({ color: STORY_COLORS[0] });
    expect(storyStyle(8)).toEqual({ color: STORY_COLORS[0], dash: '7 4' });
  });

  it('S4-A4: real EPIC: 4 roles, every main process in a row of its lane, every story', () => {
    const view = realEpic();
    const bp = bigPicture(view.flow, view.prd);
    expect(bp.lanes.map((l) => l.role)).toEqual(['builder', 'agent', 'rehearse', 'ci']);
    const main = view.flow!.root.boxes.filter((b) => ['process', 'input', 'output', 'external'].includes(b.kind)).map((b) => b.id);
    expect(bp.processes.map((p) => p.id).sort()).toEqual([...main].sort());
    expect(bp.processes.slice(0, 3).map((p) => p.id)).toEqual(['new-epic', 'draft-record', 'validate']);
    expect(bp.stories.map((s) => s.id)).toEqual(view.prd!.stories.map((s) => s.id));
    for (const s of bp.stories) expect(s.processes.length, s.id).toBeGreaterThan(0);
    expect(bp.processes.find((p) => p.id === 'review')).toMatchObject({ shared: true, stories: ['S4', 'S5', 'S7', 'S8'] });
    const lay = bigPictureLayout(bp);
    expect(lay.boxes).toHaveLength(main.length);
    expect(lay.lines).toHaveLength(10);
  });
});

describe('story view (S4-A5)', () => {
  it('S4-A5: WHAT: the role, want and so that, criteria checked by signed scenarios', () => {
    const d = storyDetail(reviewEpic(), 'S1');
    expect(d.roleLabel).toBe('Builder');
    expect(d.story?.want).toBe('to pay for my cart');
    expect(d.criteria.map((c) => [c.criterion.id, c.checked, c.scenarios])).toEqual([['S1-A1', true, ['S1-buy']]]);
    // S2-out-of-stock is stale: not evidence.
    expect(storyDetail(reviewEpic(), 'S2').criteria.map((c) => [c.criterion.id, c.checked])).toEqual([['S2-A1', false]]);
  });

  it('S4-A5: HOW: only the boxes of the story, in flow order, with the edges between them', () => {
    const d = storyDetail(reviewEpic(), 'S1');
    expect(d.how.boxes.map((b) => [b.path, b.column, b.depth])).toEqual([
      ['cart', 0, 0],
      ['pay', 1, 0],
    ]);
    expect(d.how.lanes.map((l) => l.role)).toEqual(['builder', 'system']);
    expect(d.how.edges).toEqual([{ from: 'cart', to: 'pay', kind: 'normal', via: [] }]);
  });

  it('S4-A5: HOW: a nested box comes with its parent; an edge through boxes of other stories says which', () => {
    const view = sharedShop();
    boxAt(view.flow, 'notify')!.stories = ['S1'];
    const d = storyDetail(view, 'S1');
    expect(d.how.boxes.map((b) => [b.path, b.depth, b.parent])).toEqual([
      ['cart', 0, undefined],
      ['pay', 0, undefined],
      ['ship', 0, undefined],
      ['ship/pack', 1, 'ship'],
      ['notify', 0, undefined],
    ]);
    expect(d.how.edges).toEqual([
      { from: 'cart', to: 'pay', kind: 'normal', via: [] },
      { from: 'pay', to: 'ship', label: 'yes', kind: 'branch', via: ['Item in stock?'] },
      { from: 'ship', to: 'notify', kind: 'normal', via: [] },
    ]);
    const lay = howLayout(d.how);
    expect(lay.boxes.map((b) => [b.path, b.x, b.y])).toEqual([
      ['cart', 132, 16],
      ['pay', 312, 104],
      ['ship', 492, 104],
      ['ship/pack', 672, 104],
      ['notify', 852, 104],
    ]);
    expect(lay.edges[0]).toMatchObject({ from: 'cart', to: 'pay', x1: 282, y1: 44, x2: 312, y2: 132, back: false });
  });

  it('S4-A5: OUTPUT: each data change as before → after, writes, side effects and the end states', () => {
    const d = storyDetail(reviewEpic(), 'S1');
    expect(d.output.changes.map((c) => [c.path, c.text])).toEqual([
      ['cart', 'Order.id: written'],
      ['cart', 'Order.status: new → draft'],
      ['pay', 'Order.status: draft → paid'],
    ]);
    expect(d.output.sideEffects).toEqual([{ path: 'pay', boxTitle: 'Charge the buyer', text: 'charges the card' }]);
    expect(d.output.states).toEqual([{ scenarioId: 'S1-buy', key: 'Order.status', value: 'shipped' }]);
    expect(d.scenarios.map((s) => s.scenario.id)).toEqual(['S1-buy', 'S1-empty']);
    expect(storyDetail(reviewEpic(), 'S2').output.screens).toEqual([]);
  });

  it('S4-A5: OUTPUT: what the user sees lists output boxes', () => {
    const view = reviewEpic();
    boxAt(view.flow, 'notify')!.stories = ['S2'];
    expect(storyDetail(view, 'S2').output.screens).toEqual([{ path: 'notify', title: 'Email the receipt' }]);
  });

  it('S4-A5: a write as Entity.field: from → to', () => {
    expect(writeChange('Story.status:draft->signed').text).toBe('Story.status: draft → signed');
    expect(writeChange('Order.status:->draft').text).toBe('Order.status: new → draft');
    expect(writeChange('Approval.*').text).toBe('Approval.*: written');
  });

  it('S4-A5: real EPIC: S9 shows Story.status draft → signed; every story renders a detail', () => {
    const view = realEpic();
    expect(storyDetail(view, 'S9').output.changes.map((c) => c.text)).toContain('Story.status: draft → signed');
    for (const s of view.prd!.stories) {
      const d = storyDetail(view, s.id);
      expect(d.how.boxes.length, s.id).toBeGreaterThan(0);
      expect(d.criteria.length, s.id).toBe(s.acceptance.length);
      expect(howLayout(d.how).boxes).toHaveLength(d.how.boxes.length);
    }
  });
});

describe('use case diagram (S7-A1)', () => {
  it('S7-A1: one use case per box that writes, grouped by story, with tags; actors link to the use cases of their lane', () => {
    const view = reviewEpic();
    const ucd = useCaseDiagram(view.simulation, view.flow, view.prd);
    expect(ucd.groups.map((g) => [g.storyId, g.useCases.map((u) => [u.path, u.lane, u.tags])])).toEqual([
      [
        'S1',
        [
          ['cart', 'builder', ['writes Order.id', 'Order.status new → draft']],
          ['pay', 'system', ['Order.status draft → paid']],
        ],
      ],
      ['S2', [['ship', 'system', ['Order.status paid → shipped']]]],
    ]);
    expect(ucd.actors.map((a) => [a.role, a.kind, a.readOnly, a.useCases])).toEqual([
      ['builder', 'human', false, ['cart']],
      ['system', 'system', false, ['pay', 'ship']],
    ]);
    expect(ucd.links).toEqual([
      { role: 'builder', path: 'cart' },
      { role: 'system', path: 'pay' },
      { role: 'system', path: 'ship' },
    ]);
  });

  it('S7-A1: a box in the buyer lane that writes Order.status is tagged "writes Order.status"', () => {
    const view = reviewEpic();
    boxAt(view.flow, 'cart')!.writes = ['Order.status'];
    const ucd = useCaseDiagram(view.simulation, view.flow, view.prd);
    expect(ucd.groups[0]!.useCases[0]).toMatchObject({ path: 'cart', lane: 'builder', tags: ['writes Order.status'] });
    expect(writeTag('Story.status:draft->signed')).toBe('Story.status draft → signed');
  });

  it('S7-A1: a role with no writes is read only', () => {
    const view = reviewEpic();
    const sim = structuredClone(view.simulation)!;
    sim.permissionMatrix.auditor = { Order: ['read'] };
    sim.permissionBoxes.auditor = { Order: { read: ['pay'] } };
    const ucd = useCaseDiagram(sim, view.flow, view.prd);
    expect(ucd.actors.at(-1)).toMatchObject({ role: 'auditor', readOnly: true, reads: ['Order'], useCases: [] });
  });

  it('S7-A1: exact layout: actors on the left, ovals inside the boundary, a line per link', () => {
    const view = reviewEpic();
    const lay = useCaseLayout(useCaseDiagram(view.simulation, view.flow, view.prd));
    expect(lay.boundary).toEqual({ x: 200, y: 16, w: 600, h: 352 });
    expect(lay.groups.map((g) => [g.storyId, g.y, g.h])).toEqual([
      ['S1', 56, 176],
      ['S2', 248, 104],
    ]);
    expect(lay.ovals.map((o) => [o.path, o.cx, o.cy])).toEqual([
      ['cart', 360, 124],
      ['pay', 360, 196],
      ['ship', 360, 316],
    ]);
    expect(lay.actors.map((a) => [a.role, a.x, a.y])).toEqual([
      ['builder', 80, 124],
      ['system', 80, 256],
    ]);
    expect(lay.links[0]).toEqual({ role: 'builder', path: 'cart', x1: 116, y1: 124, x2: 240, y2: 124 });
  });

  it('S7-A1: real EPIC: every role is an actor and every writing box is a use case', () => {
    const view = realEpic();
    const ucd = useCaseDiagram(view.simulation, view.flow, view.prd);
    expect(ucd.actors.map((a) => a.role)).toEqual(['builder', 'agent', 'rehearse', 'ci']);
    const writers = new Set<string>();
    for (const byEntity of Object.values(view.simulation!.permissionBoxes))
      for (const byAction of Object.values(byEntity)) for (const p of [...(byAction.write ?? []), ...(byAction.transition ?? [])]) writers.add(p);
    expect(ucd.groups.flatMap((g) => g.useCases.map((u) => u.path)).sort()).toEqual([...writers].sort());
    expect(ucd.actors.find((a) => a.role === 'ci')).toMatchObject({ readOnly: true });
    expect(useCaseLayout(ucd).ovals).toHaveLength(writers.size);
  });
});
