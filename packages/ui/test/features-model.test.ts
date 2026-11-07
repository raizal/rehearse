// Pure models of the review from big to small (D42): the big picture of the EPIC (S4-A4),
// the story view (S4-A5) and the use case diagram (S7-A1). Exact layouts on the shop fixture;
// the real EPIC checks that every story, process and role appears.

import { describe, expect, it } from 'vitest';
import type { Box } from '@rehearse/core';
import type { ReviewEpicView } from '../src/contract.js';
import { boxAt } from '../src/model/diagram.js';
import {
  bigPicture,
  bigPictureStats,
  boxTitleLines,
  chipWidth,
  featureColumns,
  featureMapLayout,
  flowOrder,
  flowPaths,
  FM,
  laneTint,
  mainEdges,
  servedStories,
  STORY_COLORS,
  storyStyle,
} from '../src/model/features.js';
import { howLayout, storyDetail, writeChange } from '../src/model/storyview.js';
import { permissionChecks, systemName, UCD, useCaseDiagram, useCaseLayout, writeEntity, writeTag } from '../src/model/usecases.js';
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

  it('T18a: the arrows join main processes, skipping the decisions between them', () => {
    const view = sharedShop();
    const bp = bigPicture(view.flow, view.prd);
    expect(bp.edges).toEqual([
      { from: 'cart', to: 'pay', back: false },
      { from: 'pay', to: 'ship', back: false },
      { from: 'ship', to: 'notify', back: false },
    ]);
    expect([...featureColumns(bp)]).toEqual([
      ['cart', 0],
      ['pay', 1],
      ['ship', 2],
      ['notify', 3],
    ]);
  });

  it('T18a: a loop back is kept only when it joins two processes directly', () => {
    const root = {
      boxes: [
        { id: 'a', kind: 'process' },
        { id: 'b', kind: 'process' },
        { id: 'ok', kind: 'decision' },
        { id: 'c', kind: 'process' },
      ] as Box[],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'ok' },
        { from: 'ok', to: 'c', label: 'yes' },
        { from: 'ok', to: 'a', label: 'no' },
        { from: 'c', to: 'b', label: 'again' },
      ],
    };
    const processes = ['a', 'b', 'c'].map((id, column) => ({ id, column }) as never);
    expect(mainEdges(root, processes)).toEqual([
      { from: 'a', to: 'b', back: false },
      { from: 'b', to: 'c', back: false },
      { from: 'c', to: 'b', back: true },
    ]);
  });

  it('T18a: exact feature map layout: lanes as rows, boxes in columns, story chips under each box, orthogonal arrows', () => {
    const view = sharedShop();
    const lay = featureMapLayout(bigPicture(view.flow, view.prd));
    expect(lay.width).toBe(FM.minWidth);
    expect(lay.rows.map((r) => [r.role, r.y, r.height, r.tint])).toEqual([
      ['builder', 0, 188, laneTint(lay.rows[0]!.color)],
      ['system', 200, 188, laneTint(lay.rows[1]!.color)],
    ]);
    expect(lay.height).toBe(388);
    expect(lay.boxes.find((b) => b.id === 'cart')).toEqual({ id: 'cart', column: 0, x: 116, y: 30, w: 128, h: 84 });
    expect(lay.boxes.find((b) => b.id === 'ship')).toEqual({ id: 'ship', column: 2, x: 408, y: 230, w: 128, h: 84 });
    // A shared box gets one chip per story, side by side.
    expect(lay.chips.filter((c) => c.process === 'ship')).toEqual([
      { storyId: 'S1', process: 'ship', x: 408, y: 322, w: chipWidth('S1') },
      { storyId: 'S2', process: 'ship', x: 440, y: 322, w: chipWidth('S2') },
    ]);
    // Across lanes: an elbow in the gap after the source; in a lane: a straight line.
    expect(lay.edges.map((e) => [e.from, e.to, e.points])).toEqual([
      [
        'cart',
        'pay',
        [
          { x: 244, y: 72 },
          { x: 253, y: 72 },
          { x: 253, y: 272 },
          { x: 262, y: 272 },
        ],
      ],
      [
        'pay',
        'ship',
        [
          { x: 390, y: 272 },
          { x: 408, y: 272 },
        ],
      ],
      [
        'ship',
        'notify',
        [
          { x: 536, y: 272 },
          { x: 554, y: 272 },
        ],
      ],
    ]);
    for (const e of lay.edges) for (let i = 1; i < e.points.length; i++) expect(e.points[i]!.x === e.points[i - 1]!.x || e.points[i]!.y === e.points[i - 1]!.y).toBe(true);
  });

  it('T18a: a box title wraps in at most three lines and says when it is cut', () => {
    expect(boxTitleLines('Ship the order')).toEqual(['Ship the order']);
    expect(boxTitleLines('Detect changed signed content')).toEqual(['Detect changed', 'signed content']);
    expect(boxTitleLines('Log correction (caught-in-simulation)').length).toBeLessThanOrEqual(3);
    for (const l of boxTitleLines('Log correction (caught-in-simulation)')) expect(l.length).toBeLessThanOrEqual(14);
    expect(boxTitleLines('one two three four five six seven eight nine', 9).at(-1)).toMatch(/…$/);
  });

  it('T18a: the stat chips count roles, stories, processes, scenarios and signed stories', () => {
    const view = sharedShop();
    expect(bigPictureStats(bigPicture(view.flow, view.prd), view)).toEqual({ roles: 2, stories: 2, processes: 4, scenarios: 3, signed: 0 });
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
    expect(bp.processes.find((p) => p.id === 'review')).toMatchObject({ shared: true, stories: ['S4', 'S5', 'S6', 'S7', 'S8'] });
    const lay = featureMapLayout(bp);
    expect(lay.boxes).toHaveLength(main.length);
    // No two boxes share a cell, and every lane, CI too, has its box.
    expect(new Set(lay.boxes.map((b) => `${b.x} ${b.y}`)).size).toBe(main.length);
    expect(lay.rows.map((r) => lay.boxes.some((b) => b.y >= r.y && b.y < r.y + r.height))).toEqual([true, true, true, true]);
    expect(Math.max(...lay.boxes.map((b) => b.x + b.w))).toBeLessThanOrEqual(lay.width);
    // T44 (S11): the refusal goes back to review, and a started build comes back to its panel.
    expect(bp.edges.filter((e) => e.back)).toEqual([
      { from: 'log-correction', to: 'draft-record', back: true },
      { from: 'watch-build', to: 'review', back: true },
      // T50 (S16): a bad link goes back to the record; the hosted FigCraft and a save or refusal come back to the Design tab.
      { from: 'design-links', to: 'draft-record', back: true },
      { from: 'host-figcraft', to: 'design-tab', back: true },
      { from: 'save-design', to: 'design-tab', back: true },
      // T51 (S17): the index, a suggestion, a link and a frame tag come back to the Design tab; a bad tag goes back to the record.
      { from: 'design-index', to: 'design-tab', back: true },
      { from: 'suggest-design', to: 'design-tab', back: true },
      { from: 'link-design', to: 'design-tab', back: true },
      { from: 'frame-tag-links', to: 'design-tab', back: true },
      { from: 'frame-tag-links', to: 'draft-record', back: true },
      { from: 'build-brief', to: 'watch-build', back: true },
      // T45 (S12): the Tests tab goes back to review; a play or a switch comes back to the tab.
      { from: 'story-playlist', to: 'review', back: true },
      { from: 'play-story', to: 'story-playlist', back: true },
      { from: 'use-project', to: 'story-playlist', back: true },
      // T47 (S13): the test rows go back to the Tests tab; a started or refused thread and its brief come back to the rows.
      { from: 'test-rows', to: 'story-playlist', back: true },
      // T48 (S14): the merge panel sits after the build panel, so the Tests tab reaches it going back.
      { from: 'test-rows', to: 'merge-panel', back: true },
      { from: 'start-test-thread', to: 'test-rows', back: true },
      // T48 (S14): the branch summary and a merge or refusal come back to the panel.
      { from: 'thread-branch', to: 'merge-panel', back: true },
      { from: 'merge-thread', to: 'merge-panel', back: true },
      // T49 (S15): the code section feeds both briefs; the test thread reaches it after the build
      // brief stands, so the section goes back to the build brief, and the test brief stands after it.
      { from: 'code-start-section', to: 'build-brief', back: true },
      { from: 'test-brief', to: 'test-rows', back: true },
      // T48 (S14): the test brief's work rules come back to the panel.
      { from: 'test-brief', to: 'work-rules', back: true },
      // T51 (S17): refreshed pictures come back to the Design tab.
      { from: 'refresh-design-pictures', to: 'design-tab', back: true },
      // T52 (S18): the deck comes back to the preview.
      { from: 'deck-file', to: 'present-view', back: true },
      // T53 (S19): the zip download asks the server for the deck's facts again, with the recordings.
      { from: 'download-with-recordings', to: 'gather-deck-facts', back: true },
      // T55 (S21): Next scenario, Next story, both finish panels and a failed approval go back to review.
      { from: 'after-approve', to: 'review', back: true },
      { from: 'next-scenario', to: 'review', back: true },
      { from: 'story-all-approved', to: 'review', back: true },
      { from: 'next-story', to: 'review', back: true },
      { from: 'epic-all-approved', to: 'review', back: true },
    ]);
    expect(bigPictureStats(bp, view)).toMatchObject({ roles: 4, stories: 20, processes: main.length });
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
  it('S7-A1: one use case per box that writes, ordered by lane then flow, with tags, stories and the data it changes', () => {
    const view = reviewEpic();
    const ucd = useCaseDiagram(view.simulation, view.flow, view.prd);
    expect(ucd.useCases.map((u) => [u.path, u.lane, u.tags, u.entities, u.stories])).toEqual([
      ['cart', 'builder', ['writes Order.id', 'Order.status new → draft'], ['Order'], ['S1']],
      ['pay', 'system', ['Order.status draft → paid'], ['Order'], ['S1']],
      ['ship', 'system', ['Order.status paid → shipped'], ['Order'], ['S2']],
    ]);
    expect(ucd.entities).toEqual(['Order']);
    expect(ucd.dataLinks).toEqual([
      { path: 'cart', entity: 'Order', tags: ['writes Order.id', 'Order.status new → draft'] },
      { path: 'pay', entity: 'Order', tags: ['Order.status draft → paid'] },
      { path: 'ship', entity: 'Order', tags: ['Order.status paid → shipped'] },
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
    expect(ucd.useCases[0]).toMatchObject({ path: 'cart', lane: 'builder', tags: ['writes Order.status'], entities: ['Order'] });
    expect(writeTag('Story.status:draft->signed')).toBe('Story.status draft → signed');
    expect(writeEntity('Story.status:draft->signed')).toBe('Story');
  });

  it('S7-A1: a role with no writes is read only', () => {
    const view = reviewEpic();
    const sim = structuredClone(view.simulation)!;
    sim.permissionMatrix.auditor = { Order: ['read'] };
    sim.permissionBoxes.auditor = { Order: { read: ['pay'] } };
    const ucd = useCaseDiagram(sim, view.flow, view.prd);
    expect(ucd.actors.at(-1)).toMatchObject({ role: 'auditor', readOnly: true, reads: ['Order'], useCases: [] });
    expect(permissionChecks(ucd).at(-1)).toEqual({ text: 'auditor changes no data.' });
  });

  it('T18a: exact layout: actors on the left, ovals stacked in the boundary, data boxes on the right', () => {
    const view = reviewEpic();
    const lay = useCaseLayout(useCaseDiagram(view.simulation, view.flow, view.prd));
    expect([lay.width, lay.height]).toEqual([UCD.width, UCD.minHeight]);
    expect(lay.boundary).toEqual({ x: 480, y: 0, w: 760, h: 900 });
    expect(lay.ovals.map((o) => [o.path, o.cx, o.cy, o.rx, o.ry])).toEqual([
      ['cart', 740, 352, 180, 38],
      ['pay', 740, 450, 180, 38],
      ['ship', 740, 548, 180, 38],
    ]);
    expect(lay.actors).toEqual([
      { role: 'builder', x: 120, y: 135 },
      { role: 'system', x: 120, y: 585 },
    ]);
    expect(lay.data).toEqual([{ entity: 'Order', x: 1340, y: 418, w: 260, h: 64 }]);
    expect(lay.links[0]).toEqual({ role: 'builder', path: 'cart', x1: 160, y1: 199, x2: 560, y2: 352 });
    expect(lay.dataLinks[0]).toEqual({ path: 'cart', entity: 'Order', x1: 920, y1: 352, x2: 1338, y2: 450 });
    // Everything fits inside the diagram.
    for (const d of lay.data) expect(d.x + d.w).toBeLessThanOrEqual(lay.width);
    for (const o of lay.ovals) expect(o.cx + o.rx).toBeLessThanOrEqual(lay.boundary.x + lay.boundary.w);
  });

  it('T18a: the boundary is named after the EPIC folder without its date', () => {
    expect(systemName('2026-11-05-rehearse', 'rehearse v1 — simulate')).toBe('rehearse record');
    expect(systemName(undefined, 'Shop')).toBe('Shop record');
    expect(systemName(undefined, undefined)).toBe('System record');
  });

  it('S7-A1: real EPIC: every role is an actor and every writing box is a use case', () => {
    const view = realEpic();
    const ucd = useCaseDiagram(view.simulation, view.flow, view.prd);
    expect(ucd.actors.map((a) => a.role)).toEqual(['builder', 'agent', 'rehearse', 'ci']);
    const writers = new Set<string>();
    for (const byEntity of Object.values(view.simulation!.permissionBoxes))
      for (const byAction of Object.values(byEntity)) for (const p of [...(byAction.write ?? []), ...(byAction.transition ?? [])]) writers.add(p);
    expect(ucd.useCases.map((u) => u.path).sort()).toEqual([...writers].sort());
    expect(ucd.actors.find((a) => a.role === 'ci')).toMatchObject({ readOnly: true });
    expect(useCaseLayout(ucd).ovals).toHaveLength(writers.size);
    // The data are ordered so that the dashed lines cross as little as possible.
    expect(ucd.entities.slice(0, 2)).toEqual(['Approval', 'SignOff']);
  });

  it('T18a: real EPIC: the Check note says in words who never and who alone changes which data', () => {
    const view = realEpic();
    expect(permissionChecks(useCaseDiagram(view.simulation, view.flow, view.prd))).toEqual([
      { text: 'Agent never changes Approval or SignOff.', ok: true },
      { text: 'Only Builder changes Approval and SignOff.' },
      { text: 'Only Agent changes Requirement, Box, Example and Correction.' },
      { text: 'CI changes no data.' },
    ]);
  });
});
