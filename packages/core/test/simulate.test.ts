// Story S3 (simulate) and S7 (permission matrix), on the shop fixture and the real record.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkLifecycles, indexBoxes, loadEpic, loadScenarios, reportToJson, simulateEpic, simulateRecord, typeFits, valueFits } from '../src/index.js';
import { box, brief, makeEpic, REAL_EPIC, scenario } from './helpers.js';
import { makeApprovedEpic } from './simulate-helpers.js';

describe('simulate on a clean record', () => {
  it('the shop fixture with every scenario approved gives no findings', () => {
    const report = simulateEpic(makeApprovedEpic());
    expect(brief(report.findings)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.command).toBe('simulate');
    expect(report.stale).toEqual([]);
  });

  it('a record with validation findings is reported and not simulated', () => {
    const report = simulateEpic(makeApprovedEpic((d) => (box(d, 'pay').stories = ['S9'])));
    expect(report.command).toBe('simulate');
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.kind)).toEqual(['reference']);
    expect(report.permissionMatrix).toEqual({});
  });

  it('simulateRecord takes a LoadResult or an EpicRecord', () => {
    const loaded = loadEpic(makeApprovedEpic());
    expect(reportToJson(simulateRecord(loaded))).toBe(reportToJson(simulateRecord(loaded.record)));
  });
});

describe('simulate/load: approved, draft and stale scenarios', () => {
  it('draft scenarios are not evidence', () => {
    const report = simulateEpic(makeEpic());
    expect(report.stale).toEqual([]);
    // No approved scenario: every branch and error exit is uncovered, every criterion unchecked.
    expect(report.findings.filter((f) => f.kind === 'coverage')).toHaveLength(3);
    expect(report.findings.filter((f) => f.kind === 'acceptance')).toHaveLength(2);
  });

  it('S6-A3 an approved scenario whose content changed is stale, listed, and not evidence', () => {
    const dir = makeApprovedEpic(undefined, (d) => (scenario(d, 'S2-out-of-stock').title = 'Changed after approval'));
    const report = simulateEpic(dir);
    expect(report.stale).toHaveLength(1);
    expect(report.stale[0]).toMatchObject({ file: 'scenarios/S2.yaml', scenario: 'S2-out-of-stock', story: 'S2' });
    expect(report.stale[0]!.reason).toContain('content changed after approval');
    // Without it, the "no" branch is uncovered and S2-A1 is unchecked.
    expect(brief(report.findings)).toEqual([
      'coverage flow.yaml in-stock: branch no of decision in-stock (to failed): no approved scenario takes it',
      'acceptance prd.yaml S2: criterion S2-A1: no approved scenario checks it (expect.criterion)',
    ]);
  });

  it('S6-A3 a scenario with status stale is listed and not evidence', () => {
    const report = simulateEpic(makeApprovedEpic(undefined, (d) => (scenario(d, 'S1-empty').status = 'stale')));
    expect(report.stale.map((s) => `${s.scenario}: ${s.reason}`)).toEqual(['S1-empty: status is stale']);
    expect(brief(report.findings)).toEqual([
      'coverage flow.yaml cart: error exit empty-cart of cart (to failed): no approved scenario takes it',
    ]);
  });
});

describe('story S3: simulate lists design errors', () => {
  it('S3-A1 a box output that does not fit the next input names a → b and the field', () => {
    const dir = makeApprovedEpic((d) => (box(d, 'pay').inputs = { orderId: 'number' }));
    const report = simulateEpic(dir);
    expect(report.ok).toBe(false);
    expect(brief(report.findings)).toEqual([
      'contract flow.yaml cart: cart → pay: field orderId: cart gives string, pay needs number in scenario S1-buy',
      'contract scenarios/S1.yaml S1-buy/step-2: cart → pay: field orderId: example cart-ok gives "o1", pay needs number',
    ]);
    expect(report.findings[0]!.refs).toEqual(['S1']);
  });

  it('S3-A1 a missing input field names a → b and the field', () => {
    const dir = makeApprovedEpic((d) => {
      box(d, 'ship').children.boxes[1].inputs = { parcel: 'string', label: 'string', note: 'string?' };
    });
    expect(brief(simulateEpic(dir).findings)).toEqual([
      'contract flow.yaml ship/pack: ship/pack → ship/send: missing field label (ship/send needs label: string; ship/pack gives parcel) in scenario S1-buy',
    ]);
  });

  it('S3-A1 a decision passes its inputs on; an error exit, a start box and an input box are not chained', () => {
    // in-stock (decision, inputs orderId) → ship/pack (needs orderId): fits. start → cart, cart -error-> failed: skipped.
    expect(simulateEpic(makeApprovedEpic()).ok).toBe(true);
  });

  it('S3-A2 a decision branch that no approved scenario takes is a coverage error', () => {
    const dir = makeApprovedEpic(undefined, (d) => (scenario(d, 'S2-out-of-stock').status = 'draft'));
    const coverage = simulateEpic(dir).findings.filter((f) => f.kind === 'coverage');
    expect(brief(coverage)).toEqual([
      'coverage flow.yaml in-stock: branch no of decision in-stock (to failed): no approved scenario takes it',
    ]);
  });

  it('S3-A2 an error exit in a nested diagram that no approved scenario takes is a coverage error', () => {
    const dir = makeApprovedEpic((d) => {
      const ship = box(d, 'ship');
      ship.children.boxes[0].errorExits = ['no-box'];
      ship.children.boxes.push({ id: 'lost', kind: 'output', lane: 'shop', title: 'Report a lost parcel', inputs: { orderId: 'string' }, outputs: { note: 'string' } });
      ship.children.edges.push({ from: 'pack', to: 'lost', label: 'no-box', kind: 'error' });
    });
    expect(brief(simulateEpic(dir).findings)).toContain(
      'coverage flow.yaml ship/pack: error exit no-box of ship/pack (to ship/lost): no approved scenario takes it',
    );
  });

  it('S3-A3 a scenario that changes Order from draft to shipped names the scenario, the box and the transition', () => {
    // pay no longer pays: ship (paid -> shipped) then runs on a draft order.
    const dir = makeApprovedEpic((d) => (box(d, 'pay').writes = []));
    const lifecycle = simulateEpic(dir).findings.filter((f) => f.kind === 'lifecycle');
    expect(brief(lifecycle)).toEqual([
      // With no box into paid, paid and shipped are unreachable too.
      'lifecycle entities.yaml Order: Order.status state paid: no box can reach it (no box writes a transition into it from a reachable state)',
      'lifecycle entities.yaml Order: Order.status state shipped: no box can reach it (no box writes a transition into it from a reachable state)',
      'lifecycle scenarios/S1.yaml S1-buy/step-5: S1-buy: box ship writes Order.status:paid->shipped, but Order.status is draft here, so the step changes Order.status draft -> shipped, which the Order lifecycle does not permit (from draft it permits: paid)',
    ]);
  });

  it('S3-A3 a box that declares a transition the lifecycle does not permit', () => {
    const dir = makeApprovedEpic((d) => (box(d, 'pay').writes = ['Order.status:draft->shipped']));
    const lifecycle = simulateEpic(dir).findings.filter((f) => f.kind === 'lifecycle');
    expect(brief(lifecycle)).toEqual([
      'lifecycle entities.yaml Order: Order.status state paid: no box can reach it (no box writes a transition into it from a reachable state)',
      'lifecycle flow.yaml pay: writes Order.status:draft->shipped: the Order lifecycle does not permit draft -> shipped (from draft it permits: paid)',
      'lifecycle scenarios/S1.yaml S1-buy/step-3: S1-buy: box pay changes Order.status draft -> shipped, which the Order lifecycle does not permit (from draft it permits: paid)',
      'lifecycle scenarios/S1.yaml S1-buy/step-5: S1-buy: box ship writes Order.status:paid->shipped, but Order.status is shipped here, so the step changes Order.status shipped -> shipped, which the Order lifecycle does not permit (no transition from shipped)',
      'lifecycle scenarios/S2.yaml S2-out-of-stock/step-1: S2-out-of-stock: box pay changes Order.status draft -> shipped, which the Order lifecycle does not permit (from draft it permits: paid)',
    ]);
  });

  it('S3-A3 a lifecycle state that no box can reach', () => {
    const dir = makeApprovedEpic((d) => {
      d['entities.yaml'].entities[0].fields.status = 'enum[draft, paid, shipped, refunded]';
      d['entities.yaml'].entities[0].lifecycle.transitions.push({ from: 'paid', to: 'refunded', by: 'shop' });
    });
    expect(brief(simulateEpic(dir).findings)).toEqual([
      'lifecycle entities.yaml Order: Order.status state refunded: no box can reach it (no box writes a transition into it from a reachable state)',
    ]);
  });

  it('C17 a box whose lane role is not the by role of its transition (R6)', () => {
    // pay is in lane shop; the lifecycle says draft -> paid is by buyer.
    const dir = makeApprovedEpic((d) => (d['entities.yaml'].entities[0].lifecycle.transitions[0].by = 'buyer'));
    expect(simulateEpic(dir).findings).toEqual([
      {
        kind: 'lifecycle',
        file: 'flow.yaml',
        path: 'pay',
        message: 'writes Order.status:draft->paid: the Order lifecycle says draft -> paid is by buyer, but box pay is in lane shop',
        refs: ['S1'],
      },
    ]);
  });

  it('C17 a new item (->draft) has no lifecycle by role and is not checked', () => {
    // cart (lane buyer) writes Order.status:->draft; moving it to lane shop changes nothing.
    const dir = makeApprovedEpic((d) => (box(d, 'cart').lane = 'shop'));
    expect(brief(simulateEpic(dir).findings).filter((f) => f.includes(' by '))).toEqual([]);
  });

  it('S3-A3 a step that leaves by an error exit changes no state', () => {
    // cart takes empty-cart: its write Order.status:->draft does not happen.
    const { record } = loadEpic(makeApprovedEpic());
    const { endStates } = checkLifecycles(record.entities, indexBoxes(record.flow), loadScenarios(record).approved);
    expect(endStates.get('S1-empty')).toEqual({});
    expect(endStates.get('S1-buy')).toEqual({ 'Order.status': 'shipped' });
  });

  it('S3-A4 an end state that differs from the criterion names the criterion ID', () => {
    const dir = makeApprovedEpic((d) => (d['prd.yaml'].stories[0].acceptance[0].expectedState = { 'Order.status': 'paid' }));
    const report = simulateEpic(dir);
    expect(brief(report.findings)).toEqual([
      'acceptance scenarios/S1.yaml S1-buy: criterion S1-A1 expects Order.status "paid", but the end state is "shipped"',
    ]);
    expect(report.findings[0]!.refs).toEqual(['S1', 'S1-A1']);
  });

  it('S3-A4 a scenario expectation that the end state contradicts, and a criterion key the scenario does not check', () => {
    const dir = makeApprovedEpic((d) => {
      scenario(d, 'S1-buy').expect.state = { 'Order.status': 'paid' };
      d['prd.yaml'].stories[1].acceptance[0].expectedState = { trackingId: 't1' };
    });
    expect(brief(simulateEpic(dir).findings)).toEqual([
      'acceptance scenarios/S1.yaml S1-buy: end state Order.status is "shipped", but the scenario expects "paid"',
      'acceptance scenarios/S2.yaml S2-out-of-stock: criterion S2-A1 expects trackingId "t1", but the scenario does not check trackingId',
    ]);
  });

  it('S3-A4 a criterion that no approved scenario checks', () => {
    const dir = makeApprovedEpic((d) => {
      d['prd.yaml'].stories[0].acceptance.push({ id: 'S1-A2', given: 'an empty cart', when: 'the buyer checks out', then: 'no order' });
    });
    expect(brief(simulateEpic(dir).findings)).toEqual([
      'acceptance prd.yaml S1: criterion S1-A2: no approved scenario checks it (expect.criterion)',
    ]);
  });

  it('S3-A5 two runs on the same record give byte-identical JSON', () => {
    const dir = makeApprovedEpic((d) => {
      box(d, 'pay').inputs = { orderId: 'number' };
      box(d, 'pay').writes = [];
      scenario(d, 'S2-out-of-stock').status = 'draft';
    });
    const a = reportToJson(simulateEpic(dir));
    const b = reportToJson(simulateEpic(dir));
    expect(a).toBe(b);
    expect(JSON.parse(a).findings.length).toBeGreaterThan(3);
  });

  it('S3-A5 the report does not depend on the order of boxes and scenarios in the files', () => {
    const edit = (d: any): void => {
      box(d, 'pay').inputs = { orderId: 'number' };
    };
    const a = reportToJson(simulateEpic(makeApprovedEpic(edit)));
    const b = reportToJson(
      simulateEpic(
        makeApprovedEpic((d) => {
          edit(d);
          d['flow.yaml'].root.boxes.reverse();
          d['flow.yaml'].root.edges.reverse();
          d['scenarios/S1.yaml'].scenarios.reverse();
        }),
      ),
    );
    expect(b).toBe(a);
  });
});

describe('story S7: permission matrix', () => {
  it('S7-A1 a box in the buyer lane that writes Order.status marks buyer × Order × write, with a link to the box', () => {
    const report = simulateEpic(makeApprovedEpic());
    expect(report.permissionMatrix).toEqual({
      buyer: { Order: ['write', 'transition'] },
      shop: { Order: ['read', 'write', 'transition'] },
    });
    expect(report.permissionBoxes.buyer!.Order!.write).toEqual(['cart']);
    expect(report.permissionBoxes.shop!.Order).toEqual({ read: ['pay'], write: ['pay', 'ship'], transition: ['pay', 'ship'] });
  });

  it('S7-A1 a plain write is write only, and nested boxes link by their path', () => {
    const dir = makeApprovedEpic((d) => {
      box(d, 'ship').children.boxes[0].writes = ['Order.id'];
      box(d, 'ship').children.boxes[0].lane = 'buyer';
    });
    const report = simulateEpic(dir);
    expect(report.permissionBoxes.buyer!.Order!.write).toEqual(['cart', 'ship/pack']);
    expect(report.permissionBoxes.buyer!.Order!.transition).toEqual(['cart']);
  });
});

describe('type rules', () => {
  it('declared types', () => {
    expect(typeFits('string', 'string?')).toBe(true);
    expect(typeFits('list ref Finding', 'list Finding')).toBe(true);
    expect(typeFits('enum[a, b]', 'enum[a,b,c]')).toBe(true);
    expect(typeFits('enum[a, d]', 'enum[a, b]')).toBe(false);
    expect(typeFits('enum[a]', 'string')).toBe(true);
    expect(typeFits('map string', 'map')).toBe(true);
    expect(typeFits('string', 'number')).toBe(false);
  });

  it('example values', () => {
    expect(valueFits('o1', 'string')).toBe(true);
    expect(valueFits('o1', 'number')).toBe(false);
    expect(valueFits(['a'], 'list string')).toBe(true);
    expect(valueFits([1], 'list string')).toBe(false);
    expect(valueFits({ ok: true }, 'Report')).toBe(true);
    expect(valueFits('shop-1', 'list Scenario')).toBe(false);
    expect(valueFits(undefined, 'string?')).toBe(true);
  });
});

describe('dogfood: simulate the rehearse record (D24)', () => {
  const report = simulateEpic(REAL_EPIC);

  // The live record is under review: new or changed scenarios wait for the owner's approval.
  // Only that kind of finding is allowed; the design itself must simulate clean.
  it('runs on the real record: a stale scenario is only one whose content the record changed for review', () => {
    expect(report.command).toBe('simulate');
    for (const s of report.stale) expect(s.reason, s.scenario).toMatch(/content changed after approval/);
  });

  it('C14 with the epicDir flow context the record gives no design findings, only criteria that wait for approval', () => {
    for (const f of report.findings) expect(f.message, f.path).toMatch(/no approved scenario checks it/);
  });

  it('the permission matrix shows that only the builder lane changes Scenario.status to approved', () => {
    expect(report.permissionBoxes.builder!.Scenario!.transition).toEqual(['approve']);
    expect(report.permissionBoxes.agent!.Scenario!.transition).toEqual(['draft-record']);
    expect(report.permissionMatrix.ci).toBeUndefined();
  });

  it('S3-A5 two runs on the real record are byte-identical', () => {
    expect(reportToJson(simulateEpic(REAL_EPIC))).toBe(reportToJson(report));
    expect(readFileSync(join(REAL_EPIC, 'flow.yaml'), 'utf8')).toContain('simulate');
  });
});

describe('simulate/contracts: flow context (C14)', () => {
  const needsShopId = (d: any) => (box(d, 'pay').inputs.shopId = 'string');

  it('C14 S3-A1 a box input that no box gives is missing without a flow context', () => {
    const report = simulateEpic(makeApprovedEpic(needsShopId));
    expect(brief(report.findings)).toEqual([
      'contract flow.yaml cart: cart → pay: missing field shopId (pay needs shopId: string; cart gives orderId) in scenario S1-buy',
    ]);
  });

  it('C14 a box input that is a context field is never missing', () => {
    const report = simulateEpic(makeApprovedEpic((d) => (needsShopId(d), (d['flow.yaml'].context = { shopId: 'string' }))));
    expect(brief(report.findings)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('C14 S3-A1 a box input whose type does not fit the context type is a contract finding', () => {
    const report = simulateEpic(makeApprovedEpic((d) => (needsShopId(d), (d['flow.yaml'].context = { shopId: 'number' }))));
    expect(report.findings).toEqual([
      { kind: 'contract', file: 'flow.yaml', path: 'pay', message: 'field shopId: the flow context gives number, pay needs string', refs: ['S1'] },
    ]);
  });

  it('C14 validate checks the context type strings like box inputs', () => {
    const report = simulateEpic(makeApprovedEpic((d) => (d['flow.yaml'].context = { shopId: '' })));
    expect(report.findings.map((f) => `${f.kind} ${f.file}`)).toEqual(['schema flow.yaml']);
  });
});
