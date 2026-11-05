// vitest globalSetup (Node): a small EPIC loaded the same way `rehearse serve` loads it.
// Lanes builder and system (S4-A1), a box with children (S4-A2), and scenarios
// that are approved (S5-A1), draft and stale. The review fields of the HTTP contract
// (gate, readiness, simulation, approvals, sign-offs) come from @rehearse/core, as the server builds them.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { gateRecord, loadEpic, readiness, simulateRecord, simulationFindings } from '@rehearse/core';
import { makeEpic, REAL_EPIC, scenario } from '../../core/test/helpers.js';
import { buildEpicView, buildTrustedEpicView } from '@rehearse/server';
import type { ApprovalView, ReviewEpicView } from '../src/contract.js';
import { FIXTURE_KEY } from './fixture.js';

/** A well-formed hash that matches no content: the approval is stale until set right. */
const ZERO_HASH = `sha256:${'0'.repeat(64)}`;

export function setup(project: TestProject): void {
  project.provide('reviewEpic', buildReviewEpic());
  // The real EPIC record of rehearse as serve sends it; its bootstrap approvals are not signed.
  project.provide('realEpic', buildTrustedEpicView(REAL_EPIC, { verify: () => ({ status: 'missing' }) }) as ReviewEpicView);
}

/** Three caught in simulation, one caught after build (S8-A3). */
const CORRECTIONS = `# Corrections

- **C1** \`caught-in-simulation\` pay reads a field cart never writes.
- **C2** \`caught-in-simulation\` ship had no error exit.
- **C3** \`caught-after-build\` the receipt went out before payment.
- **C4** \`caught-in-simulation\` out-of-stock path ended nowhere.
`;

/** The decision log of the shop (T15): two decisions, one of them on a heading. */
const BRAINSTORM = `# Shop — brainstorm

## Decisions
- **D1 Card only**: The shop takes cards, not cash.

## Version 1 scope (D2)

Cart, pay and ship.
`;

function buildReviewEpic(): ReviewEpicView {
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

      // Readiness: R3 has no story (S8-A1); box notify serves no requirement (S8-A2).
      prd.requirements.push({ id: 'R3', kind: 'functional', text: 'The shop emails a receipt.' });
      flow.root.boxes.push({ id: 'notify', kind: 'output', lane: 'system', title: 'Email the receipt', inputs: { orderId: 'string' }, outputs: { sent: 'boolean' } });
      flow.root.edges.push({ from: 'ship', to: 'notify' }, { from: 'notify', to: 'done' });
    },
  });
  writeFileSync(join(dir, 'corrections.md'), CORRECTIONS);
  writeFileSync(join(dir, 'brainstorm.md'), BRAINSTORM);
  // Approve S1-buy with its real hash on disk, as the approve endpoint does.
  const view: ReviewEpicView = buildEpicView(dir);
  const buy = view.scenarios.find((v) => v.scenario.id === 'S1-buy')!;
  buy.scenario.approval!.hash = buy.hash;
  buy.status = 'approved';

  const loaded = loadEpic(dir);
  const raw = loaded.record.scenarioFiles.flatMap((f) => f.scenarios).find((s) => s.id === 'S1-buy')!;
  raw.approval!.hash = buy.hash;
  const simulation = simulateRecord(loaded);
  const gate = gateRecord(loaded.record, simulationFindings(loaded, () => simulation));
  view.gate = { command: 'gate', ok: gate.ok, findings: gate.findings, simulation: 'simulate' };
  view.readiness = readiness(loaded.record, view.gate);
  view.simulation = { permissionMatrix: simulation.permissionMatrix, permissionBoxes: simulation.permissionBoxes };
  const approvals: Record<string, ApprovalView> = {};
  for (const sv of view.scenarios) {
    const a = sv.scenario.approval;
    if (a) approvals[sv.scenario.id] = { by: a.by, at: a.at, signer: FIXTURE_KEY, sigStatus: 'valid' };
  }
  view.approvals = approvals;
  view.signOffs = [];
  return view;
}
