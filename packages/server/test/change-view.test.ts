// T62 on the server: `GET /api/epic` sends the small changes of the EPIC and marks each item that a
// change added (criterion, scenario, box) with its change id, so the UI can show "New in C1".

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeEpic } from '../../core/test/helpers.js';
import { buildEpicView } from '../src/index.js';

describe('T62 the epic view shows the changes', () => {
  it('lists each change and marks its items', () => {
    const dir = makeEpic();
    mkdirSync(join(dir, 'changes'));
    writeFileSync(
      join(dir, 'changes', 'C1.yaml'),
      [
        'id: C1',
        'story: S1',
        'title: The buyer pays with a gift card.',
        'why: Buyers ask for gift cards.',
        'criteria:',
        '  - { id: S1-A2, given: a gift card, when: the buyer pays, then: the order is shipped }',
        'scenarios:',
        '  - id: S1-c1-gift',
        '    title: Buyer pays with a gift card',
        '    status: draft',
        '    steps: [{ name: start }, { name: cart }, { name: pay }, { name: in-stock, branch: "yes" }, { name: ship/pack }, { name: ship/send }, { name: done }]',
        '    expect: { criterion: S1-A2, state: { Order.status: shipped } }',
        '',
      ].join('\n'),
    );
    const view = buildEpicView(dir);
    expect(view.report.ok).toBe(true);
    expect(view.changes).toEqual([{ id: 'C1', story: 'S1', title: 'The buyer pays with a gift card.', why: 'Buyers ask for gift cards.', file: 'changes/C1.yaml' }]);
    expect(view.prd!.stories[0]!.acceptance.find((c) => c.id === 'S1-A2')?.change).toBe('C1');
    expect(view.scenarios.find((s) => s.scenario.id === 'S1-c1-gift')).toMatchObject({ file: 'changes/C1.yaml', status: 'draft', scenario: { change: 'C1', story: 'S1' } });
  });

  it('an EPIC without changes has no change list', () => {
    expect(buildEpicView(makeEpic()).changes).toBeUndefined();
  });
});
