// vitest globalSetup (Node): a small EPIC loaded the same way `rehearse serve` loads it.
// Lanes builder and system (S4-A1), a box with children (S4-A2), and scenarios
// that are approved (S5-A1), draft and stale.

import type { TestProject } from 'vitest/node';
import { makeEpic, scenario } from '../../core/test/helpers.js';
import { buildEpicView, type EpicView } from '@rehearse/server';
import './fixture.js';

/** A well-formed hash that matches no content: the approval is stale until set right. */
const ZERO_HASH = `sha256:${'0'.repeat(64)}`;

export function setup(project: TestProject): void {
  project.provide('reviewEpic', buildReviewEpic());
}

function buildReviewEpic(): EpicView {
  const dir = makeEpic({
    edit: (d) => {
      const prd = d['prd.yaml'];
      prd.roles = [
        { id: 'builder', name: 'Builder', kind: 'human' },
        { id: 'system', name: 'System', kind: 'system' },
      ];
      prd.stories[0].role = 'builder';
      prd.stories[1].role = 'system';
      const flow = d['flow.yaml'];
      flow.lanes = [
        { role: 'builder', order: 1 },
        { role: 'system', order: 2 },
      ];
      const walk = (boxes: any[]) => {
        for (const b of boxes) {
          b.lane = b.lane === 'buyer' ? 'builder' : 'system';
          if (b.children) walk(b.children.boxes);
        }
      };
      walk(flow.root.boxes);
      for (const t of d['entities.yaml'].entities[0].lifecycle.transitions) t.by = t.by === 'buyer' ? 'builder' : 'system';
      const pay = flow.root.boxes.find((b: any) => b.id === 'pay');
      pay.sideEffects = ['charges the card'];
      pay.examples = undefined;

      const s = scenario(d, 'S1-buy');
      s.title = 'Buyer pays, then the order is packed';
      s.status = 'approved';
      s.approval = { by: 'builder@example.com', at: '2026-11-05T00:00:00Z', hash: ZERO_HASH };
      s.steps = [
        { name: 'cart', example: { id: 'cart-ok', given: { items: ['a'] }, then: { orderId: 'o1' } } },
        { name: 'pay', example: { id: 'pay-ok', given: { orderId: 'o1' }, then: { orderId: 'o1' }, stateAfter: { 'Order.status': 'paid' } } },
        { name: 'in-stock', branch: 'yes' },
        { name: 'ship/pack' },
      ];
      s.expect = { criterion: 'S1-A1', state: { 'Order.status': 'shipped' } };
      const stale = scenario(d, 'S2-out-of-stock');
      stale.status = 'approved';
      stale.approval = { by: 'builder@example.com', at: '2026-11-05T00:00:00Z', hash: ZERO_HASH };
    },
  });
  const view = buildEpicView(dir);
  // Approve S1-buy with its real hash, as the approve button (wave 2) will.
  const buy = view.scenarios.find((v) => v.scenario.id === 'S1-buy')!;
  buy.scenario.approval!.hash = buy.hash;
  buy.status = 'approved';
  return view;
}
