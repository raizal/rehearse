// Pure models of the PRD and Tech spec pages (T15): links and their colours, proof counts, the
// trace tree, the places that show an id, box contracts, entity links and the lifecycle graph.
// Exact values on the shop fixture; the real EPIC checks that every requirement, story, box and
// entity appears.

import { describe, expect, it } from 'vitest';
import type { Box, Diagram } from '@rehearse/core';
import type { ReviewEpicView } from '../src/contract.js';
import { citedDecisions, knownIds, linkName, placeOf, textParts } from '../src/model/links.js';
import { boxScenarios, gateNote, openPlaces, prdDoc, requirementProof, storyBoxes, traceOf } from '../src/model/prd.js';
import {
  boxContracts,
  boxDecisions,
  boxRequirements,
  changeRule,
  entityCards,
  lifecycleGraph,
  lifecycleGraphs,
  lifecycleLayout,
  nonFunctional,
  techContents,
} from '../src/model/techspec.js';
import { realEpic, reviewEpic } from './fixture.js';

const ids = (xs: { scenario: { id: string } }[]) => xs.map((x) => x.scenario.id);

function allPaths(d: Diagram | undefined, prefix = ''): string[] {
  return (d?.boxes ?? []).flatMap((b: Box) => {
    const path = prefix === '' ? b.id : `${prefix}/${b.id}`;
    return [path, ...allPaths(b.children, path)];
  });
}

describe('T15 feature 2: links', () => {
  it('T15 2 each kind opens its place: requirement → Readiness row, story → Story view, box → Flow, scenario → Storyboard, entity and decision → Tech spec', () => {
    expect(placeOf({ kind: 'requirement', id: 'R1' })).toEqual({ view: 'readiness', requirement: 'R1' });
    expect(placeOf({ kind: 'story', id: 'S1' })).toEqual({ view: 'story', story: 'S1' });
    expect(placeOf({ kind: 'story', id: 'S1-A1' })).toEqual({ view: 'story', story: 'S1' });
    expect(placeOf({ kind: 'box', id: 'ship/pack' })).toEqual({ view: 'flow', box: 'ship/pack' });
    expect(placeOf({ kind: 'scenario', id: 'S1-buy' })).toEqual({ view: 'storyboard', scenario: 'S1-buy' });
    expect(placeOf({ kind: 'entity', id: 'Order' })).toEqual({ view: 'techspec', focus: 'entity:Order' });
    expect(placeOf({ kind: 'decision', id: 'D1' })).toEqual({ view: 'techspec', focus: 'decision:D1' });
    expect(placeOf({ kind: 'decision', id: 'C2' })).toEqual({ view: 'techspec', focus: 'correction:C2' });
  });

  it('T15 2 every link has a name for screen readers that says what the id is and where it goes', () => {
    expect(linkName({ kind: 'requirement', id: 'R13' })).toBe('Requirement R13: open its Readiness row');
    expect(linkName({ kind: 'box', id: 'approve' })).toBe('Box approve: open it in Flow');
    expect(linkName({ kind: 'story', id: 'S6-A1' })).toBe('Acceptance criterion S6-A1: open story S6 in the Story view');
    expect(linkName({ kind: 'decision', id: 'C27' })).toBe('Correction C27: open it in the corrections');
  });

  it('T15 2 text links only ids the record has: requirements, stories, criteria, decisions and corrections', () => {
    const known = knownIds(reviewEpic());
    expect(textParts('R1 and S1-A1 (D1, C3), not R9 or D7.', known)).toEqual([
      { kind: 'requirement', id: 'R1' },
      ' and ',
      { kind: 'story', id: 'S1-A1' },
      ' (',
      { kind: 'decision', id: 'D1' },
      ', ',
      { kind: 'decision', id: 'C3' },
      '), not R9 or D7.',
    ]);
    expect(citedDecisions('see D2, D1 and D2 again; C1', known)).toEqual(['D2', 'D1', 'C1']);
  });
});

describe('T15 feature 3: proof and trace (shop)', () => {
  it('T15 3 proof counts N/M scenarios approved and says whether the approvals are signed', () => {
    const view = reviewEpic();
    expect(requirementProof(view, 'R1')).toEqual({ total: 2, approved: 1, signed: 1, text: '1/2 scenarios approved', signText: 'all approvals signed', proved: true });
    expect(requirementProof(view, 'R2')).toEqual({ total: 1, approved: 0, signed: 0, text: '0/1 scenario approved', signText: '', proved: false, gap: 'none-approved' });
    expect(requirementProof(view, 'R3')).toMatchObject({ total: 0, text: 'no scenarios', proved: false, gap: 'no-story' });
    // Without a valid signature an approval is not proof (D41).
    view.approvals!['S1-buy']!.sigStatus = 'missing';
    expect(requirementProof(view, 'R1')).toMatchObject({ approved: 1, signed: 0, signText: 'approvals not signed yet', proved: false, gap: 'not-signed' });
    expect(gateNote('R1', requirementProof(view, 'R1'))).toBe('The scenario is approved, but the approvals have no valid SSH signature. Approve them again in the UI, then they count as evidence.');
    expect(gateNote('R3', requirementProof(view, 'R3'))).toBe('No story names R3, so no scenario can prove it. Add a story for it.');
    expect(gateNote('R1', requirementProof(reviewEpic(), 'R1'))).toBeUndefined();
    expect(gateNote('R2', requirementProof(reviewEpic(), 'R2'))).toBe('The scenario of R2 is not approved yet. Review it in the Storyboard and approve it.');
  });

  it('T15 3 the trace of a requirement: requirement → story → its boxes → scenarios with status', () => {
    const view = reviewEpic();
    const trace = traceOf(view, { kind: 'requirement', id: 'R1' });
    expect(trace.map((r) => r.id)).toEqual(['R1']);
    expect(trace[0]!.stories.map((s) => [s.id, s.boxes, s.scenarios.map((x) => `${x.id}: ${x.state.text}`)])).toEqual([
      ['S1', ['cart', 'pay'], ['S1-buy: approved, signature valid', 'S1-empty: draft, not approved']],
    ]);
    expect(traceOf(view, { kind: 'requirement', id: 'R3' })).toEqual([{ id: 'R3', stories: [] }]);
  });

  it('T15 3 the trace of a story, a box and a scenario goes up to their requirements', () => {
    const view = reviewEpic();
    expect(traceOf(view, { kind: 'story', id: 'S2' }).map((r) => [r.id, r.stories.map((s) => s.id)])).toEqual([['R2', ['S2']]]);
    expect(traceOf(view, { kind: 'box', id: 'ship/pack' })).toEqual([]);
    expect(traceOf(view, { kind: 'box', id: 'ship' }).map((r) => [r.id, r.stories.map((s) => [s.id, s.scenarios.map((x) => x.state.kind)])])).toEqual([['R2', [['S2', ['stale']]]]]);
    const one = traceOf(view, { kind: 'scenario', id: 'S1-empty' });
    expect(one[0]!.stories[0]!.scenarios.map((x) => x.id)).toEqual(['S1-empty']);
    expect(traceOf(view, { kind: 'entity', id: 'Order' })).toEqual([]);
  });

  it('T15 3 a box is proved by the scenarios whose path goes through it (a step in a child counts)', () => {
    const view = reviewEpic();
    expect(ids(boxScenarios(view, 'pay'))).toEqual(['S1-buy', 'S2-out-of-stock']);
    expect(ids(boxScenarios(view, 'ship'))).toEqual(['S1-buy']);
    expect(ids(boxScenarios(view, 'notify'))).toEqual([]);
    expect(storyBoxes(view, 'S2')).toEqual(['ship']);
  });

  it('T15 3 open in rehearse lists every view that shows the id', () => {
    const view = reviewEpic();
    expect(openPlaces(view, { kind: 'requirement', id: 'R1' }).map((p) => `${p.label}: ${p.detail}`)).toEqual([
      'Story view: S1 · WHAT · HOW · OUTPUT',
      'Storyboard: S1-buy · one card per step',
      'Flow: box cart in the Builder lane',
      'Readiness: row R1: requirement → story → box → scenario',
    ]);
    expect(openPlaces(view, { kind: 'box', id: 'pay' }).map((p) => p.label)).toEqual(['Big picture', 'Story view', 'Storyboard', 'Use cases', 'Flow', 'Tech spec']);
    expect(openPlaces(view, { kind: 'box', id: 'pay' }).at(-1)!.place).toEqual({ view: 'techspec', focus: 'box:pay' });
    expect(openPlaces(view, { kind: 'scenario', id: 'S1-buy' }).map((p) => p.label)).toEqual(['Storyboard', 'Story view']);
  });

  it('T15 3 the PRD document: title, roles, requirements with kinds and proof, stories with the scenario that proves each criterion, contents with counts', () => {
    const view = reviewEpic();
    view.prd!.requirements[0]!.text = 'The buyer pays for an order. (D1, C2)';
    view.prd!.epic.outOfScope = ['Refunds'];
    const doc = prdDoc(view);
    expect(doc.title).toBe('Shop checkout');
    expect(doc.roles.map((r) => `${r.name} · ${r.kind}`)).toEqual(['Builder · human', 'System · system']);
    expect(doc.requirements.map((r) => [r.requirement.id, r.stories, r.proof.text, r.cites])).toEqual([
      ['R1', ['S1'], '1/2 scenarios approved', ['D1', 'C2']],
      ['R2', ['S2'], '0/1 scenario approved', []],
      ['R3', [], 'no scenarios', []],
    ]);
    expect(doc.kinds).toEqual([{ kind: 'functional', count: 3 }]);
    expect(doc.stories.map((s) => [s.story.id, s.roleLabel, s.boxes, s.criteria.map((c) => [c.criterion.id, c.provedBy.map((p) => p.id)])])).toEqual([
      ['S1', 'Builder', ['cart', 'pay'], [['S1-A1', ['S1-buy']]]],
      ['S2', 'System', ['ship'], [['S2-A1', ['S2-out-of-stock']]]],
    ]);
    expect(doc.contents.map((c) => `${c.label} ${c.count ?? ''}`.trim())).toEqual(['Goal', 'Roles 2', 'Requirements 3', 'Stories 2', 'Out of scope 1', 'Resolved questions 0']);
  });
});

describe('T15 feature 4: Tech spec (shop)', () => {
  it('T15 4 box contracts: every box in flow order with lane, in → out, writes, stories and scenarios approved', () => {
    const rows = boxContracts(reviewEpic());
    expect(rows.map((r) => r.path)).toEqual(['start', 'cart', 'pay', 'in-stock', 'ship', 'ship/pack', 'ship/send', 'failed', 'notify', 'done']);
    const pay = rows.find((r) => r.path === 'pay')!;
    expect([pay.laneLabel, pay.ins, pay.outs, pay.writes.map((w) => w.text), pay.stories, pay.proof.text, pay.main]).toEqual([
      'System',
      ['orderId'],
      ['orderId'],
      ['Order.status: draft → paid'],
      ['S1'],
      '1/2 scenarios approved',
      true,
    ]);
    expect(rows.filter((r) => !r.main).map((r) => r.path)).toEqual(['start', 'in-stock', 'failed', 'done']);
    expect(rows.find((r) => r.path === 'ship/pack')!.depth).toBe(1);
  });

  it('T15 4 a box traces to the requirements of its stories, the decisions they cite and the corrections about it', () => {
    const view = reviewEpic();
    view.prd!.requirements[0]!.text = 'The buyer pays. (D1)';
    view.corrections = [{ id: 'C9', tag: 'caught-in-simulation', about: 'boxes `pay`, `ship/{pack,send}`', section: 's', notes: [] }];
    expect(boxRequirements(view, 'pay')).toEqual(['R1']);
    expect(boxDecisions(view, 'pay')).toEqual(['D1', 'C9']);
    expect(boxDecisions(view, 'ship/send')).toEqual(['C9']);
    expect(changeRule(['S6'])).toBe('A change to this contract goes in corrections.md with a reason, and makes S6 and its scenarios stale (D7, D23).');
    expect(changeRule([])).toBe('A change to this contract goes in corrections.md with a reason (D7). No story uses the box yet.');
  });

  it('T15 4 entity cards list fields with types, links to other entities, and the boxes that write them', () => {
    const view = reviewEpic();
    view.entities!.entities.push({ id: 'Parcel', fields: { order: 'ref Order', items: 'list string', orders: 'list ref Order?' } });
    const cards = entityCards(view);
    expect(cards.map((c) => [c.entity.id, c.writtenBy])).toEqual([
      ['Order', ['cart', 'pay', 'ship']],
      ['Parcel', []],
    ]);
    expect(cards[1]!.fields).toEqual([
      { name: 'order', type: 'ref Order', plain: '', refs: ['Order'] },
      { name: 'items', type: 'list string', plain: 'list string', refs: [] },
      { name: 'orders', type: 'list ref Order?', plain: 'list, optional', refs: ['Order'] },
    ]);
  });

  it('T15 4 the lifecycle graph: states in enum order, each transition with the box that makes it, and the box that creates the item', () => {
    const view = reviewEpic();
    const g = lifecycleGraph(view.entities!.entities[0]!, view.flow)!;
    expect(g).toEqual({
      entity: 'Order',
      field: 'status',
      initial: 'draft',
      states: ['draft', 'paid', 'shipped'],
      transitions: [
        { from: 'draft', to: 'paid', by: 'system', boxes: ['pay'] },
        { from: 'paid', to: 'shipped', by: 'system', boxes: ['ship'] },
      ],
      createdBy: ['cart'],
    });
    expect(lifecycleGraphs(view)).toHaveLength(1);
  });

  it('T15 4 lifecycle layout: one row; the next state is a straight arrow above the middle, the start dot points at the initial state', () => {
    const g = lifecycleGraph(reviewEpic().entities!.entities[0]!, reviewEpic().flow)!;
    const lay = lifecycleLayout(g);
    expect(lay.states.map((s) => [s.id, s.x, s.y, s.initial])).toEqual([
      ['draft', 40, 70, true],
      ['paid', 290, 70, false],
      ['shipped', 540, 70, false],
    ]);
    expect(lay.arrows.map((a) => [a.d, a.labelX, a.labelY, a.forward])).toEqual([
      ['M 160 82 L 290 82', 225, 74, true],
      ['M 410 82 L 540 82', 475, 74, true],
    ]);
    expect(lay.start).toEqual({ x: 14, y: 90, d: 'M 19 90 L 40 90' });
    expect([lay.width, lay.height]).toEqual([700, 160]);
  });

  it('T15 4 lifecycle layout: a back transition to the state before goes below; one that skips a state arcs above or below', () => {
    const lay = lifecycleLayout({
      entity: 'X',
      field: 's',
      initial: 'a',
      states: ['a', 'b', 'c'],
      transitions: [
        { from: 'a', to: 'c', by: 'r', boxes: [] },
        { from: 'c', to: 'a', by: 'r', boxes: [] },
        { from: 'b', to: 'a', by: 'r', boxes: [] },
      ],
      createdBy: [],
    });
    expect(lay.states[0]!.y).toBe(88);
    expect(lay.arrows.map((a) => [a.d, a.labelY, a.forward])).toEqual([
      ['M 100 88 Q 350 20 600 88', 48, true],
      ['M 600 128 Q 350 196 100 128', 176, false],
      ['M 290 116 L 160 116', 134, false],
    ]);
    expect(lay.height).toBe(216);
  });

  it('T15 4 non-functional requirements with how they are proved, and the contents with counts', () => {
    const view = reviewEpic();
    view.prd!.requirements.push({ id: 'R9', kind: 'performance', text: 'Fast.', provenBy: 'benchmark' }, { id: 'R10', kind: 'security', text: 'Safe.' });
    expect(nonFunctional(view).map((r) => [r.requirement.id, r.provenBy])).toEqual([
      ['R9', 'benchmark'],
      ['R10', undefined],
    ]);
    expect(techContents(view).map((c) => `${c.label} ${c.count}`)).toEqual([
      'Box contracts 10',
      'Entity model 1',
      'Lifecycles 1',
      'Non-functional 2',
      'Decisions 2',
      'Corrections 4',
    ]);
  });
});

describe('T15 the real EPIC', () => {
  const view: ReviewEpicView = realEpic();

  it('T15 3 the PRD has every requirement and story, each with its proof and trace', () => {
    const doc = prdDoc(view);
    expect(doc.requirements.map((r) => r.requirement.id)).toEqual(view.prd!.requirements.map((r) => r.id));
    expect(doc.stories.map((s) => s.story.id)).toEqual(view.prd!.stories.map((s) => s.id));
    expect(doc.roles.map((r) => r.id)).toEqual(['builder', 'agent', 'ci', 'rehearse']);
    for (const r of doc.requirements) {
      expect(r.proof.total, r.requirement.id).toBe(view.scenarios.filter((sv) => r.stories.includes(sv.scenario.story)).length);
      expect(gateNote(r.requirement.id, r.proof) === undefined, r.requirement.id).toBe(r.proof.proved);
      expect(traceOf(view, { kind: 'requirement', id: r.requirement.id })[0]!.stories.map((s) => s.id)).toEqual(r.stories);
    }
    // Every acceptance criterion of every story is listed.
    for (const s of doc.stories) expect(s.criteria.map((c) => c.criterion.id)).toEqual(s.story.acceptance.map((a) => a.id));
    // The bootstrap approvals of the record are not signed: R13 is approved but not proved.
    expect(doc.requirements.find((r) => r.requirement.id === 'R13')!.proof).toMatchObject({ proved: false });
  });

  it('T15 4 the Tech spec has every box, every entity, the three lifecycles with a box for each transition, and the decision log', () => {
    const rows = boxContracts(view);
    expect(new Set(rows.map((r) => r.path))).toEqual(new Set(allPaths(view.flow!.root)));
    expect(entityCards(view).map((c) => c.entity.id)).toEqual(view.entities!.entities.map((e) => e.id));
    const graphs = lifecycleGraphs(view);
    expect(graphs.map((g) => g.entity)).toEqual(['Epic', 'Story', 'Scenario']);
    for (const g of graphs) for (const t of g.transitions) expect(t.boxes.length, `${g.entity} ${t.from}→${t.to}`).toBeGreaterThan(0);
    expect(graphs.find((g) => g.entity === 'Scenario')!.transitions.find((t) => t.from === 'draft')!.boxes).toEqual(['approve']);
    expect(nonFunctional(view).map((r) => r.requirement.id)).toEqual(view.prd!.requirements.filter((r) => r.kind !== 'functional').map((r) => r.id));
    expect(boxDecisions(view, 'approve')).toEqual(expect.arrayContaining(['D41', 'C2']));
    // Every decision the record cites is known, so it is a link.
    const known = knownIds(view);
    for (const r of view.prd!.requirements) for (const d of r.text.match(/\bD\d+\b/g) ?? []) expect(known.decisions.has(d), d).toBe(true);
  });
});
