// T22 `simulate --drafts`: the same checks with draft and stale scenarios counted as if approved.
// Findings only, never evidence: the gate never reads it, and it writes nothing.

import { describe, expect, it } from 'vitest';
import { gateEpic, reportToJson, simulateEpic, simulateRecord, simulationToText } from '../src/index.js';
import { box, brief, hashDir, makeEpic, PRESIGNOFF_EPIC, REAL_EPIC, scenario } from './helpers.js';
import { signedEpic } from './trust/helpers.js';
import { makeApprovedEpic } from './simulate-helpers.js';

describe('simulate --drafts (T22)', () => {
  it('a draft with a contract error gives a finding in drafts mode and none in plain simulate', () => {
    const dir = makeEpic({ edit: (d) => (box(d, 'pay').inputs = { orderId: 'number' }) });
    expect(simulateEpic(dir).findings.filter((f) => f.kind === 'contract')).toEqual([]);
    const drafts = simulateEpic(dir, { drafts: true });
    expect(brief(drafts.findings.filter((f) => f.kind === 'contract'))).toEqual([
      'contract flow.yaml cart: cart → pay: field orderId: cart gives string, pay needs number in scenario S1-buy (draft)',
      'contract scenarios/S1.yaml S1-buy/step-2: cart → pay: field orderId: example cart-ok gives "o1", pay needs number (scenario S1-buy, draft)',
    ]);
    expect(drafts.ok).toBe(false);
  });

  it('has no "no approved scenario" findings; what only drafts cover is listed as covered only by drafts', () => {
    const report = simulateEpic(makeEpic(), { drafts: true });
    expect(report.mode).toBe('drafts');
    expect(report.findings.filter((f) => /no approved scenario/.test(f.message))).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.draftOnly!.map((d) => `${d.kind} ${d.file} ${d.path}: ${d.message}`)).toEqual([
      'coverage flow.yaml cart: error exit empty-cart of cart (to failed): covered only by drafts (S1-empty: draft)',
      'coverage flow.yaml in-stock: branch no of decision in-stock (to failed): covered only by drafts (S2-out-of-stock: draft)',
      'coverage flow.yaml in-stock: branch yes of decision in-stock (to ship): covered only by drafts (S1-buy: draft)',
      'acceptance prd.yaml S1: criterion S1-A1: covered only by drafts (S1-buy: draft)',
      'acceptance prd.yaml S2: criterion S2-A1: covered only by drafts (S2-out-of-stock: draft)',
    ]);
    expect(report.counted!.map((c) => `${c.scenario}: ${c.status}`)).toEqual(['S1-buy: draft', 'S1-empty: draft', 'S2-out-of-stock: draft']);
  });

  it('an edge or criterion that an approved scenario covers is not listed as draft-only', () => {
    const dir = makeApprovedEpic(undefined, (d) => (scenario(d, 'S2-out-of-stock').status = 'draft'));
    const report = simulateEpic(dir, { drafts: true });
    expect(report.ok).toBe(true);
    expect(report.draftOnly!.map((d) => d.message)).toEqual([
      'branch no of decision in-stock (to failed): covered only by drafts (S2-out-of-stock: draft)',
      'criterion S2-A1: covered only by drafts (S2-out-of-stock: draft)',
    ]);
  });

  it('an edge that no scenario takes, draft or approved, is a finding', () => {
    const dir = makeEpic({ edit: (d) => (scenario(d, 'S1-empty').steps = [{ name: 'start' }, { name: 'cart' }, { name: 'pay' }]) });
    const report = simulateEpic(dir, { drafts: true });
    expect(brief(report.findings.filter((f) => f.kind === 'coverage'))).toEqual([
      'coverage flow.yaml cart: error exit empty-cart of cart (to failed): no scenario takes it, not even a draft',
    ]);
  });

  it('a stale scenario is counted and named stale; an approved one is named approved', () => {
    const dir = makeApprovedEpic((d) => (box(d, 'pay').inputs = { orderId: 'number' }), (d) => {
      scenario(d, 'S1-empty').title = 'Edited after approval';
      scenario(d, 'S2-out-of-stock').status = 'stale';
    });
    const report = simulateEpic(dir, { drafts: true });
    expect(report.counted!.map((c) => `${c.scenario}: ${c.status}`)).toEqual(['S1-buy: approved', 'S1-empty: stale', 'S2-out-of-stock: stale']);
    expect(report.findings.find((f) => f.kind === 'contract' && f.file === 'flow.yaml')!.message).toContain('in scenario S1-buy (approved)');
    expect(report.draftOnly!.map((d) => d.message)).toContain('error exit empty-cart of cart (to failed): covered only by drafts (S1-empty: stale)');
  });

  it('a lifecycle and an acceptance finding from a scenario name the scenario and its status', () => {
    const lifecycle = simulateEpic(makeEpic({ edit: (d) => (box(d, 'pay').writes = []) }), { drafts: true }).findings;
    expect(brief(lifecycle.filter((f) => f.kind === 'lifecycle' && f.file !== 'entities.yaml'))).toEqual([
      'lifecycle scenarios/S1.yaml S1-buy/step-5: S1-buy (draft): box ship writes Order.status:paid->shipped, but Order.status is draft here, so the step changes Order.status draft -> shipped, which the Order lifecycle does not permit (from draft it permits: paid)',
    ]);
    const dir = makeEpic({ edit: (d) => (scenario(d, 'S2-out-of-stock').expect.state = { 'Order.status': 'shipped' }) });
    const report = simulateEpic(dir, { drafts: true });
    expect(brief(report.findings.filter((f) => f.kind === 'acceptance'))).toEqual([
      'acceptance scenarios/S2.yaml S2-out-of-stock: end state Order.status is "paid", but the scenario expects "shipped" (scenario S2-out-of-stock, draft)',
    ]);
  });

  it('text starts with the notice line; JSON has mode "drafts"; plain simulate is unchanged', () => {
    const dir = makeEpic();
    const report = simulateEpic(dir, { drafts: true });
    const text = simulationToText(report);
    expect(text.split('\n')[0]).toBe('simulate --drafts: drafts counted for checks only; this is not evidence');
    expect(text).toContain('flow.yaml: in-stock: coverage: branch no of decision in-stock (to failed): covered only by drafts (S2-out-of-stock: draft)');
    expect(text).toMatch(/simulate --drafts: OK, no findings \(5 covered only by drafts\)\n$/);
    const json = JSON.parse(reportToJson(report));
    expect(json.mode).toBe('drafts');
    expect(json.notice).toBe('drafts counted for checks only; this is not evidence');
    expect(reportToJson(simulateEpic(dir, { drafts: true }))).toBe(reportToJson(report));
    const plain = simulateEpic(dir);
    expect(plain.mode).toBeUndefined();
    expect(Object.keys(JSON.parse(reportToJson(plain)))).toEqual(['command', 'ok', 'findings', 'permissionMatrix', 'permissionBoxes', 'stale']);
  });

  it('text keeps one line per stale scenario, now counted for checks', () => {
    const dir = makeApprovedEpic(undefined, (d) => (scenario(d, 'S2-out-of-stock').status = 'stale'));
    expect(simulationToText(simulateEpic(dir, { drafts: true }))).toContain(
      'scenarios/S2.yaml: S2-out-of-stock: stale, counted for checks only: status is stale\n',
    );
  });

  it('a record with validation findings gives the notice, mode and those findings only', () => {
    const report = simulateEpic(makeApprovedEpic((d) => (box(d, 'pay').stories = ['S9'])), { drafts: true });
    expect(report.mode).toBe('drafts');
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.kind)).toEqual(['reference']);
    expect(simulationToText(report).split('\n')[0]).toBe('simulate --drafts: drafts counted for checks only; this is not evidence');
  });

  it('never changes the gate result or any file', () => {
    // Not clean: a changed contract, and the first EPIC frozen before its sign-off. Clean: a signed, approved shop.
    // The live first EPIC is either, by the owner's signing state and key list; the claim holds for both.
    const cases: [string, boolean | undefined][] = [
      [makeEpic({ edit: (d) => (box(d, 'pay').inputs = { orderId: 'number' }) }), false],
      [PRESIGNOFF_EPIC, false],
      [signedEpic(), true],
      [REAL_EPIC, undefined],
    ];
    for (const [dir, ok] of cases) {
      const before = hashDir(dir);
      const gate = gateEpic(dir, simulateRecord);
      if (ok !== undefined) expect(gate.ok, dir).toBe(ok);
      simulateEpic(dir, { drafts: true });
      expect(JSON.stringify(gateEpic(dir, simulateRecord))).toBe(JSON.stringify(gate));
      expect(hashDir(dir)).toBe(before);
    }
  });
});
