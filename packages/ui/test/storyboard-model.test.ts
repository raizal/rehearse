// Pure storyboard model: approval state in words, the review queue, "next", the path map,
// the seen store and the signed proof of readiness (S6-A1, S8-A1, C28).

import { describe, expect, it } from 'vitest';
import type { ScenarioView } from '../src/api.js';
import type { ApprovalView } from '../src/contract.js';
import { laneColor, LANE_COLORS, roleName, UNKNOWN_LANE_COLOR } from '../src/model/diagram.js';
import { proofWithSignatures, proofReasonText } from '../src/model/readiness.js';
import { allSeen, loadSeen, markSeen, saveSeen, seenSteps, type SeenState } from '../src/model/seen.js';
import { approvalState, criterionFor, nextToApprove, pathMap, progress, reviewQueue } from '../src/model/storyboard.js';
import { reviewEpic } from './fixture.js';

const view = reviewEpic();
const flow = view.flow!;
const prd = view.prd!;
const sv = (id: string): ScenarioView => view.scenarios.find((s) => s.scenario.id === id)!;
const VALID: ApprovalView = { by: 'b@x', at: 'now', sigStatus: 'valid' };

describe('approval state in words (S6-A1)', () => {
  it('S6-A1: approved with a valid signature is done; every other state says what it is', () => {
    const buy = sv('S1-buy');
    expect(approvalState(buy, { 'S1-buy': VALID })).toMatchObject({ kind: 'signed', done: true, text: 'approved, signature valid' });
    expect(approvalState(buy, { 'S1-buy': { ...VALID, sigStatus: 'missing' } })).toMatchObject({ done: false, text: 'approved, signature missing' });
    expect(approvalState(buy, { 'S1-buy': { ...VALID, sigStatus: 'invalid' } })).toMatchObject({ done: false, text: 'approved, signature invalid' });
    expect(approvalState(buy, { 'S1-buy': { ...VALID, sigStatus: 'unknown-signer' } })).toMatchObject({ done: false, text: 'approved, unknown signer' });
    expect(approvalState(buy, {})).toMatchObject({ done: false, text: 'approved, signature missing' });
    expect(approvalState(buy, undefined)).toMatchObject({ kind: 'unchecked', done: false });
    expect(approvalState(sv('S1-empty'), {})).toMatchObject({ kind: 'draft', done: false, text: 'draft, not approved' });
    expect(approvalState(sv('S2-out-of-stock'), { 'S2-out-of-stock': VALID })).toMatchObject({ kind: 'stale', done: false });
  });
});

describe('review queue', () => {
  it('groups scenarios by story in prd.yaml order', () => {
    const groups = reviewQueue(prd, view.scenarios);
    expect(groups.map((g) => [g.storyId, g.scenarios.map((s) => s.scenario.id)])).toEqual([
      ['S1', ['S1-buy', 'S1-empty']],
      ['S2', ['S2-out-of-stock']],
    ]);
    expect(groups[0]!.story?.want).toBe(prd.stories[0]!.want);
  });

  it('counts approvals with a valid signature as progress', () => {
    expect(progress(view.scenarios, { 'S1-buy': VALID })).toEqual({ done: 1, total: 3 });
    expect(progress(view.scenarios, { 'S1-buy': { ...VALID, sigStatus: 'missing' } })).toEqual({ done: 0, total: 3 });
  });

  it('"next" is the next scenario in queue order with no valid signed approval, wrapping round', () => {
    const order = reviewQueue(prd, structuredClone(view.scenarios)).flatMap((g) => g.scenarios);
    const approvals = { 'S1-buy': VALID };
    expect(nextToApprove(order, undefined, approvals)).toBe('S1-empty');
    expect(nextToApprove(order, 'S1-empty', approvals)).toBe('S2-out-of-stock');
    expect(nextToApprove(order, 'S2-out-of-stock', approvals)).toBe('S1-empty');
    const all = Object.fromEntries(order.map((s) => [s.scenario.id, VALID]));
    for (const s of order) s.status = 'approved';
    expect(nextToApprove(order, 'S1-buy', all)).toBeUndefined();
  });
});

describe('story card data', () => {
  it('finds the story and the acceptance criterion of expect.criterion', () => {
    const { story, criterion } = criterionFor(prd, sv('S1-buy').scenario);
    expect(story?.id).toBe('S1');
    expect(criterion?.id).toBe('S1-A1');
    expect(criterion?.given).toBeTruthy();
    expect(criterionFor(prd, sv('S1-empty').scenario).criterion).toBeUndefined();
  });

  it('lane colours follow flow.yaml lane order, and role names come from prd.yaml', () => {
    expect(laneColor(flow, 'builder')).toBe(LANE_COLORS[0]);
    expect(laneColor(flow, 'system')).toBe(LANE_COLORS[1]);
    expect(laneColor(flow, 'nobody')).toBe(UNKNOWN_LANE_COLOR);
    expect(roleName(prd, 'builder')).toBe('Builder');
    expect(roleName(prd, 'nobody')).toBe('nobody');
  });
});

describe('path map', () => {
  it('draws each diagram the path goes through, root first, with the path boxes marked by step number', () => {
    const maps = pathMap(flow, sv('S1-buy').scenario);
    expect(maps.map((m) => m.path)).toEqual(['', 'ship']);
    const root = maps[0]!;
    const steps = Object.fromEntries(root.boxes.map((b) => [b.id, b.steps]));
    expect(steps).toMatchObject({ cart: [1], pay: [2], 'in-stock': [3], ship: [4] });
    expect(root.boxes.filter((b) => !b.onPath).map((b) => b.id)).toContain('notify');
    const ship = maps[1]!;
    expect(ship.boxes.find((b) => b.id === 'pack')).toMatchObject({ path: 'ship/pack', onPath: true, steps: [4] });
    expect(ship.boxes.find((b) => b.id === 'send')).toMatchObject({ onPath: false, steps: [] });
  });

  it('marks the edges the path takes, with the branch label it takes', () => {
    const root = pathMap(flow, sv('S1-buy').scenario)[0]!;
    const taken = root.edges.filter((e) => e.taken).map((e) => [e.from, e.to, e.label ?? '']);
    expect(taken).toEqual([
      ['cart', 'pay', ''],
      ['pay', 'in-stock', ''],
      ['in-stock', 'ship', 'yes'],
    ]);
    // An edge the path does not take is not marked.
    expect(root.edges.some((e) => !e.taken && e.from === 'in-stock')).toBe(true);
  });

  it('a step on an unknown box path does not break the map', () => {
    const maps = pathMap(flow, { ...sv('S1-buy').scenario, steps: [{ name: 'nope/deeper' }, { name: 'cart' }] });
    expect(maps.map((m) => m.path)).toEqual(['']);
  });
});

describe('seen store (browser only, not evidence)', () => {
  function memory(): Storage {
    const data = new Map<string, string>();
    return {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
      clear: () => data.clear(),
      key: () => null,
      get length() {
        return data.size;
      },
    };
  }

  it('a scenario is all seen once every step was seen, and the state survives a reload of the store', () => {
    const buy = sv('S1-buy');
    let seen: SeenState = {};
    for (const i of [0, 1, 2]) seen = markSeen(seen, buy, i);
    expect(allSeen(seen, buy)).toBe(false);
    seen = markSeen(seen, buy, 3);
    expect(allSeen(seen, buy)).toBe(true);
    const storage = memory();
    saveSeen(storage, view.slug, seen);
    expect(allSeen(loadSeen(storage, view.slug), buy)).toBe(true);
    expect(loadSeen(storage, 'other-epic')).toEqual({});
  });

  it('a content change (new hash) clears what was seen', () => {
    const buy = sv('S1-buy');
    const seen = markSeen({}, buy, 0);
    expect(seenSteps(seen, { ...buy, hash: 'sha256:other' }).size).toBe(0);
  });

  it('a broken store gives an empty state', () => {
    const storage = memory();
    storage.setItem('rehearse:seen', '{not json');
    expect(loadSeen(storage, view.slug)).toEqual({});
  });
});

describe('readiness proof with signatures (S8-A1, C28)', () => {
  it('S8-A1: an approved scenario without a valid signature is not proof, and the reason says "approval not signed"', () => {
    const r = view.readiness!;
    const proven = r.requirements.filter((q) => q.proven).map((q) => q.id);
    expect(proven.length).toBeGreaterThan(0);
    const unsigned = proofWithSignatures(r, { 'S1-buy': { ...VALID, sigStatus: 'missing' } })!;
    const r1 = unsigned.requirements.find((q) => q.id === 'R1')!;
    expect(r1).toMatchObject({ proven: false, reason: 'approval-not-signed' });
    expect(r1.message).toContain('S1-buy (signature missing)');
    expect(unsigned.noProof.map((p) => p.id)).toContain('R1');
    expect(proofReasonText('approval-not-signed')).toBe('approval not signed');
    // With a valid signature it is proof again.
    expect(proofWithSignatures(unsigned, { 'S1-buy': VALID })!.requirements.find((q) => q.id === 'R1')!.proven).toBe(true);
  });

  it('without approvals from the server, readiness stays as the server sent it', () => {
    expect(proofWithSignatures(view.readiness!, undefined)).toBe(view.readiness);
  });
});
