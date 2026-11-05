// Cross-file references and scenario step continuity (R3, R21).

import { describe, expect, it } from 'vitest';
import { box, brief, scenario, validateFixture } from './helpers.js';

describe('references (R3)', () => {
  it('story → requirement', () => {
    const r = validateFixture({ edit: (d) => d['prd.yaml'].stories[0].requirements.push('R9') });
    expect(r.findings).toEqual([
      { kind: 'reference', file: 'prd.yaml', path: 'S1', message: 'requirement R9 unknown', refs: ['R9', 'S1'] },
    ]);
  });

  it('story → role', () => {
    const r = validateFixture({ edit: (d) => (d['prd.yaml'].stories[1].role = 'robot') });
    expect(brief(r.findings)).toEqual(['reference prd.yaml S2: role robot unknown']);
  });

  it('box → story', () => {
    const r = validateFixture({ edit: (d) => (box(d, 'pay').stories = ['S1', 'S9']) });
    expect(r.findings).toEqual([
      { kind: 'reference', file: 'flow.yaml', path: 'pay', message: 'story S9 unknown', refs: ['S9'] },
    ]);
  });

  it('box → lane, and lane → role', () => {
    const r = validateFixture({
      edit: (d) => {
        box(d, 'pay').lane = 'bank';
        d['flow.yaml'].lanes.push({ role: 'warehouse', order: 3 });
      },
    });
    expect(brief(r.findings)).toEqual([
      'reference flow.yaml lanes[2]: lane warehouse: role warehouse unknown (prd.yaml roles)',
      'reference flow.yaml pay: lane bank unknown',
    ]);
  });

  it('lifecycle actor → role (C7)', () => {
    const r = validateFixture({ edit: (d) => (d['entities.yaml'].entities[0].lifecycle.transitions[1].by = 'system') });
    expect(brief(r.findings)).toEqual(['reference entities.yaml Order: lifecycle transition paid -> shipped: role system unknown']);
  });

  it('state access → entity field (Entity.field, Entity.*, Entity.status:from->to)', () => {
    const r = validateFixture({
      edit: (d) => {
        box(d, 'pay').reads = ['Order.*', 'Order.total', 'Invoice.id', 'order-status', 'Order.status:draft->paid'];
        box(d, 'pay').writes = ['Order.status:draft->refunded', 'Order.id:->x'];
      },
    });
    expect(brief(r.findings)).toEqual([
      'reference flow.yaml pay: reads Invoice.id: entity Invoice unknown',
      'reference flow.yaml pay: reads Order.status:draft->paid: a read cannot change state; move it to writes',
      'reference flow.yaml pay: reads Order.total: field total is not a field of Order',
      'reference flow.yaml pay: reads order-status: use Entity.field, Entity.* or Entity.field:from->to',
      'reference flow.yaml pay: writes Order.id:->x: Order.id is not an enum, so it has no states',
      'reference flow.yaml pay: writes Order.status:draft->refunded: refunded is not a value of Order.status (draft, paid, shipped)',
    ]);
  });

  it('edge → box in the same diagram', () => {
    const r = validateFixture({ edit: (d) => box(d, 'ship').children.edges.push({ from: 'send', to: 'deliver' }) });
    expect(brief(r.findings)).toEqual(['reference flow.yaml ship/send: edge send -> deliver: box deliver unknown']);
  });

  it('scenario → story, and expect.criterion → acceptance criterion of that story', () => {
    const r = validateFixture({
      edit: (d) => {
        d['scenarios/S2.yaml'].story = 'S7';
        scenario(d, 'S1-buy').expect.criterion = 'S2-A1';
      },
    });
    expect(brief(r.findings)).toEqual([
      'reference scenarios/S1.yaml S1-buy: criterion S2-A1 is not an acceptance criterion of story S1',
      'reference scenarios/S2.yaml story: story S7 unknown',
    ]);
  });

  it('duplicate ids', () => {
    const r = validateFixture({
      edit: (d) => {
        d['prd.yaml'].requirements.push({ id: 'R1', kind: 'functional', text: 'again' });
        scenario(d, 'S1-empty').id = 'S2-out-of-stock';
      },
    });
    expect(brief(r.findings)).toEqual([
      'reference prd.yaml R1: duplicate requirement id R1',
      'reference scenarios/S2.yaml S2-out-of-stock: duplicate scenario id S2-out-of-stock (first in scenarios/S1.yaml)',
    ]);
  });
});

describe('scenario steps (R3, R21)', () => {
  it('a step names a leaf box, not a parent', () => {
    const r = validateFixture({
      edit: (d) => {
        const s = scenario(d, 'S1-buy');
        s.steps.splice(4, 2, { name: 'ship' });
      },
    });
    expect(brief(r.findings)).toEqual([
      'reference scenarios/S1.yaml S1-buy/step-5: box path ship has children: name a leaf box, not a parent (ship/pack, ship/send)',
    ]);
  });

  it('consecutive steps are joined by an edge', () => {
    const r = validateFixture({ edit: (d) => scenario(d, 'S1-buy').steps.splice(2, 1) });
    expect(brief(r.findings)).toEqual([
      'structure scenarios/S1.yaml S1-buy/step-2: no edge from cart to in-stock (step 2 -> 3)',
    ]);
  });

  it('entering and leaving nested boxes follows the entry/exit rule', () => {
    const r = validateFixture({
      edit: (d) => {
        const steps = scenario(d, 'S1-buy').steps;
        steps.splice(4, 2, { name: 'ship/send' }, { name: 'ship/pack' });
      },
    });
    expect(brief(r.findings)).toEqual([
      'structure scenarios/S1.yaml S1-buy/step-4: no edge from in-stock to ship/send with label yes (step 4 -> 5)',
      'structure scenarios/S1.yaml S1-buy/step-5: no edge from ship/send to ship/pack (step 5 -> 6)',
      'structure scenarios/S1.yaml S1-buy/step-6: no edge from ship/pack to done (step 6 -> 7)',
    ]);
  });

  it('a branch label matches the edge label', () => {
    const r = validateFixture({ edit: (d) => (scenario(d, 'S1-buy').steps[3].branch = 'maybe') });
    expect(brief(r.findings)).toEqual([
      'structure scenarios/S1.yaml S1-buy/step-4: branch maybe is not a label of an edge from in-stock (labels: yes, no)',
    ]);
  });

  it('a branch label must lead to the next step', () => {
    const r = validateFixture({ edit: (d) => (scenario(d, 'S1-buy').steps[3].branch = 'no') });
    expect(brief(r.findings)).toEqual([
      'structure scenarios/S1.yaml S1-buy/step-4: no edge from in-stock to ship/pack with label no (step 4 -> 5)',
    ]);
  });

  it('a decision step needs a branch', () => {
    const r = validateFixture({ edit: (d) => delete scenario(d, 'S1-buy').steps[3].branch });
    expect(brief(r.findings)).toEqual(['structure scenarios/S1.yaml S1-buy/step-4: decision in-stock: the step needs a branch']);
  });
});
