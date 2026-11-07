// T62: a small change to a signed story (`changes/C<n>.yaml`). What went stale before, the change
// file and its limits, old approvals that stay valid, story hash rule 3, old rule-2 sign-offs that
// stay valid, the gate, the brief, the preview and the start file.

import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import {
  allScenarios,
  approveScenarios,
  CURRENT_HASH_RULE,
  detectStale,
  gateEpic,
  loadEpic,
  markChanges,
  NO_INPUTS,
  presentationDeck,
  newChange,
  previewContent,
  reportToText,
  scenarioHash,
  signOff,
  signOffPayload,
  storyBuildBrief,
  storyChanges,
  storyContentV2,
  storyHash,
  validateEpic,
  type EpicRecord,
} from '../src/index.js';
import { editYaml, ME, NOW, SIGNED, signedEpic } from './trust/helpers.js';
import { KEY } from './trust/keys.js';

const giftScenario = (id: string, criterion = 'S1-A2') => ({
  id,
  title: 'Buyer pays with a gift card and the order ships',
  status: 'draft',
  steps: [
    { name: 'start' },
    { name: 'cart', example: { id: `cart-${id}`, given: { items: ['g'] }, then: { orderId: 'o9' } } },
    { name: 'pay' },
    { name: 'in-stock', branch: 'yes' },
    { name: 'ship/pack' },
    { name: 'ship/send' },
    { name: 'done' },
  ],
  expect: { criterion, state: { 'Order.status': 'shipped' } },
});

const C1 = () => ({
  id: 'C1',
  story: 'S1',
  title: 'The buyer pays with a gift card.',
  why: 'Buyers ask for gift cards.',
  criteria: [{ id: 'S1-A2', given: 'a cart with items and a gift card', when: 'the buyer pays', then: 'the order is shipped' }],
  scenarios: [giftScenario('S1-c1-gift')],
});

function addChange(dir: string, doc: Record<string, unknown>, name = `${String(doc.id)}.yaml`): void {
  mkdirSync(join(dir, 'changes'), { recursive: true });
  writeFileSync(join(dir, 'changes', name), stringify(doc));
}

const approvalHashes = (dir: string): Record<string, string | undefined> =>
  Object.fromEntries(allScenarios(loadEpic(dir).record).map((s) => [s.id, s.approval?.hash]));

/** Make every sign-off of signoff.yaml a rule-2 sign-off, signed again with the test key. */
function asRule2(dir: string, slug = '2026-11-05-shop'): void {
  editYaml(dir, 'signoff.yaml', (doc) => {
    const log = doc.toJS() as { signOffs: Record<string, unknown>[] };
    log.signOffs.forEach((entry, i) => {
      const { sig: _sig, ...rest } = { ...entry, hashRule: 2 } as Record<string, unknown>;
      doc.setIn(['signOffs', i, 'hashRule'], 2);
      doc.setIn(['signOffs', i, 'sig'], KEY.signer.sign(signOffPayload(slug, rest as never)));
    });
  });
}

describe('T62 what goes stale today: a new scenario in a signed story', () => {
  it('keeps every old approval valid; only the story sign-off goes stale', () => {
    const dir = signedEpic();
    const before = approvalHashes(dir);
    editYaml(dir, 'scenarios/S1.yaml', (doc) => doc.addIn(['scenarios'], doc.createNode(giftScenario('S1-gift', 'S1-A1'))));
    const { record } = loadEpic(dir);
    const trust = detectStale(record);
    // Each approval holds the hash of its own scenario, so an added scenario changes none of them.
    for (const s of allScenarios(record).filter((x) => x.id !== 'S1-gift')) {
      expect(s.approval?.hash).toBe(before[s.id]);
      expect(s.approval?.hash).toBe(scenarioHash(s));
    }
    expect(trust.scenarios.filter((s) => s.status === 'stale')).toEqual([]);
    // The story hash covers all scenarios of the story, so the sign-off of S1 goes stale.
    expect(trust.staleStories).toEqual(['S1']);
    expect(trust.stories.find((s) => s.id === 'S1')?.newChanges).toBeUndefined();
    expect(gateEpic(dir).findings.map((f) => f.message)).toEqual([
      'story is stale: content changed since sign-off (hash rule 3); must be signed again',
    ]);
  });
});

describe('T62 the change file and its limits', () => {
  it('a valid change validates; the loader merges its items with a change mark', () => {
    const dir = signedEpic();
    addChange(dir, C1());
    expect(validateEpic(dir)).toEqual({ command: 'validate', ok: true, findings: [] });
    const { record } = loadEpic(dir);
    const s1 = record.prd!.stories.find((s) => s.id === 'S1')!;
    expect(s1.acceptance.map((c) => [c.id, c.change])).toEqual([
      ['S1-A1', undefined],
      ['S1-A2', 'C1'],
    ]);
    expect(allScenarios(record).find((s) => s.id === 'S1-c1-gift')).toMatchObject({ story: 'S1', change: 'C1' });
    expect(record.scenarioFiles.at(-1)?.file).toBe('changes/C1.yaml');
  });

  it('the schema needs the fields of a change', () => {
    const dir = signedEpic();
    const { why: _why, ...noWhy } = C1();
    addChange(dir, noWhy, 'C1.yaml');
    const r = validateEpic(dir);
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => `${f.kind} ${f.file} ${f.message}`)).toContain('schema changes/C1.yaml missing field why');
  });

  it('more than 5 scenarios is an error', () => {
    const dir = signedEpic();
    addChange(dir, { ...C1(), scenarios: [1, 2, 3, 4, 5, 6].map((n) => giftScenario(`S1-c1-${n}`)) });
    const r = validateEpic(dir);
    expect(r.ok).toBe(false);
    expect(reportToText(r)).toContain('the change has 6 scenarios. A change has 5 scenarios or fewer');
  });

  it('more than 3 criteria is an error', () => {
    const dir = signedEpic();
    const crit = (n: number) => ({ id: `S1-A${n}`, given: 'g', when: 'w', then: 't' });
    addChange(dir, { ...C1(), criteria: [2, 3, 4, 5].map(crit) });
    expect(validateEpic(dir).ok).toBe(false);
  });

  it('a change that edits an existing criterion, scenario or box is an error', () => {
    for (const edit of [
      (c: ReturnType<typeof C1>) => ({ ...c, criteria: [{ id: 'S1-A1', given: 'a', when: 'b', then: 'c' }] }),
      (c: ReturnType<typeof C1>) => ({ ...c, scenarios: [giftScenario('S1-buy')] }),
      (c: ReturnType<typeof C1>) => ({ ...c, boxes: [{ id: 'pay', kind: 'process', lane: 'buyer', title: 'Pay again', stories: ['S1'] }] }),
      (c: ReturnType<typeof C1>) => ({ ...c, edges: [{ from: 'cart', to: 'done' }] }),
    ]) {
      const dir = signedEpic();
      addChange(dir, edit(C1()));
      const r = validateEpic(dir);
      expect(r.ok).toBe(false);
      expect(reportToText(r)).toContain('the change edits an item of the record');
      expect(r.findings.every((f) => f.file === 'changes/C1.yaml')).toBe(true);
    }
  });

  it('a change may add a root box and edges between it and existing boxes', () => {
    const dir = signedEpic();
    addChange(dir, {
      ...C1(),
      boxes: [{ id: 'gift-card', kind: 'input', lane: 'buyer', title: 'Buyer enters a gift card', inputs: { code: 'string' }, outputs: { ok: 'boolean' } }],
      edges: [
        { from: 'cart', to: 'gift-card' },
        { from: 'gift-card', to: 'pay' },
      ],
    });
    expect(validateEpic(dir).ok).toBe(true);
    const { record } = loadEpic(dir);
    expect(record.flow!.root.boxes.find((b) => b.id === 'gift-card')).toMatchObject({ stories: ['S1'], change: 'C1', path: 'gift-card' });
  });

  it('a change scenario with the id of an existing scenario is not merged: the old scenario keeps no change mark', () => {
    const dir = signedEpic();
    addChange(dir, { ...C1(), scenarios: [giftScenario('S1-buy')] });
    const { record } = loadEpic(dir);
    const buys = allScenarios(record).filter((s) => s.id === 'S1-buy');
    expect(buys).toHaveLength(1);
    expect(buys[0]).not.toHaveProperty('change');
    expect(record.scenarioFiles.find((f) => f.file === 'changes/C1.yaml')?.scenarios).toEqual([]);
  });

  it('a later change may add an edge to a box of an earlier change', () => {
    const dir = signedEpic();
    const gift = { id: 'gift-card', kind: 'input', lane: 'buyer', title: 'Buyer enters a gift card', inputs: { code: 'string' }, outputs: { ok: 'boolean' } };
    addChange(dir, { ...C1(), boxes: [gift], edges: [{ from: 'cart', to: 'gift-card' }, { from: 'gift-card', to: 'pay' }] });
    const points = { id: 'points', kind: 'input', lane: 'buyer', title: 'Buyer uses points', inputs: { ok: 'boolean' }, outputs: { ok: 'boolean' } };
    addChange(dir, { ...C1(), id: 'C2', title: 'The buyer pays with points.', criteria: [{ id: 'S1-A3', given: 'g', when: 'w', then: 't' }], scenarios: [giftScenario('S1-c2-points', 'S1-A3')], boxes: [points], edges: [{ from: 'gift-card', to: 'points' }, { from: 'points', to: 'pay' }] });
    expect(reportToText(validateEpic(dir))).not.toContain('unknown');
    expect(validateEpic(dir).ok).toBe(true);
  });

  it('a broken link in changes/ does not stop the loader', () => {
    const dir = signedEpic();
    addChange(dir, C1());
    symlinkSync(join(dir, 'changes', 'missing.yaml'), join(dir, 'changes', 'C2.yaml'));
    expect(storyChanges(loadEpic(dir).record, 'S1').map((c) => c.doc.id)).toEqual(['C1']);
    expect(validateEpic(dir).ok).toBe(true);
  });

  it('more than 8 scenarios with its changes gives information, not an error', () => {
    const dir = signedEpic();
    addChange(dir, { ...C1(), scenarios: [1, 2, 3, 4, 5].map((n) => giftScenario(`S1-c1-${n}`)) });
    addChange(dir, { ...C1(), id: 'C2', criteria: [{ id: 'S1-A3', given: 'g', when: 'w', then: 't' }], scenarios: [1, 2].map((n) => giftScenario(`S1-c2-${n}`)) });
    const r = validateEpic(dir);
    expect(r.ok).toBe(true);
    expect(r.notes?.map((n) => n.message)).toEqual(['S1 has 9 scenarios with its changes (C1, C2); more than 8: think about a new story']);
    expect(reportToText(r)).toContain('info: ');
  });
});

describe('T62 trust: old approvals stay valid, the change needs approvals and a sign-off', () => {
  it('an unsigned change fails the gate: only the change approvals and a new sign-off are asked for', () => {
    const dir = signedEpic();
    const before = approvalHashes(dir);
    addChange(dir, C1());
    const { record } = loadEpic(dir);
    const trust = detectStale(record);
    for (const s of trust.scenarios.filter((x) => x.story === 'S1' && x.id !== 'S1-c1-gift')) expect(s.status).toBe('approved');
    expect(approvalHashes(dir)).toMatchObject(before);
    expect(trust.stories.find((s) => s.id === 'S1')).toMatchObject({ status: 'stale', changes: ['C1'], newChanges: ['C1'] });
    expect(trust.stories.find((s) => s.id === 'S2')).toMatchObject({ status: 'signed', trusted: true });
    const gate = gateEpic(dir);
    expect(gate.ok).toBe(false);
    expect(gate.findings.map((f) => `${f.file} ${f.path}: ${f.message}`)).toEqual([
      'changes/C1.yaml S1-c1-gift: scenario of change C1 is a draft; the owner approves it',
      'signoff.yaml S1: story has new change C1 that no sign-off covers; the rest is as signed (hash rule 3); the owner signs off the story again',
    ]);
  });

  it('a sign-off does not skip the change approvals', () => {
    const dir = signedEpic();
    addChange(dir, C1());
    const r = signOff(dir, ['S1'], ME, { now: NOW, ...SIGNED });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain('scenario of change C1 is a draft');
  });

  it('the owner approves the change scenarios and signs off again under rule 3: the gate passes', () => {
    const dir = signedEpic();
    addChange(dir, C1());
    expect(approveScenarios(dir, ['S1-c1-gift'], ME, { now: NOW, ...SIGNED }).ok).toBe(true);
    expect(parse(readFileSync(join(dir, 'changes/C1.yaml'), 'utf8')).scenarios[0].status).toBe('approved');
    expect(signOff(dir, ['S1'], ME, { now: NOW, ...SIGNED }).ok).toBe(true);
    const log = parse(readFileSync(join(dir, 'signoff.yaml'), 'utf8'));
    expect(log.signOffs.at(-1).hashRule).toBe(CURRENT_HASH_RULE);
    expect(CURRENT_HASH_RULE).toBe(3);
    expect(detectStale(loadEpic(dir).record)).toMatchObject({ epicStatus: 'signed', staleStories: [] });
    expect(gateEpic(dir).ok).toBe(true);
  });

  it('a hand-written change mark does not take a signed item out of the rule-3 hash', () => {
    const dir = signedEpic();
    addChange(dir, C1());
    approveScenarios(dir, ['S1-c1-gift'], ME, { now: NOW, ...SIGNED });
    signOff(dir, ['S1'], ME, { now: NOW, ...SIGNED });
    expect(detectStale(loadEpic(dir).record).stories.find((s) => s.id === 'S1')?.status).toBe('signed');
    editYaml(dir, 'prd.yaml', (doc) => {
      const i = (doc.toJS() as { stories: { id: string }[] }).stories.findIndex((s) => s.id === 'S1');
      doc.setIn(['stories', i, 'acceptance', 0, 'change'], 'C1');
      doc.setIn(['stories', i, 'acceptance', 0, 'then'], 'the order is free');
    });
    const { record } = loadEpic(dir);
    expect(record.prd!.stories.find((s) => s.id === 'S1')!.acceptance[0]).not.toHaveProperty('change');
    const s1 = detectStale(record).stories.find((s) => s.id === 'S1');
    expect(s1?.status).toBe('stale');
    expect(s1).not.toHaveProperty('newChanges');
    // The schema still reports the key in prd.yaml.
    expect(validateEpic(dir).ok).toBe(false);
  });

  it('a later change C2 after a rule-3 sign-off of C1 names only C2', () => {
    const dir = signedEpic();
    addChange(dir, C1());
    approveScenarios(dir, ['S1-c1-gift'], ME, { now: NOW, ...SIGNED });
    signOff(dir, ['S1'], ME, { now: NOW, ...SIGNED });
    addChange(dir, { ...C1(), id: 'C2', title: 'The buyer pays with points.', criteria: [{ id: 'S1-A3', given: 'g', when: 'w', then: 't' }], scenarios: [giftScenario('S1-c2-points')] });
    const s1 = detectStale(loadEpic(dir).record).stories.find((s) => s.id === 'S1');
    expect(s1).toMatchObject({ status: 'stale', changes: ['C1', 'C2'], newChanges: ['C2'] });
  });

  it('an edit to the story itself is not "only the change": no newChanges', () => {
    const dir = signedEpic();
    addChange(dir, C1());
    editYaml(dir, 'prd.yaml', (doc) => doc.setIn(['stories', 0, 'want'], 'to pay for my cart fast'));
    const s1 = detectStale(loadEpic(dir).record).stories.find((s) => s.id === 'S1');
    expect(s1?.status).toBe('stale');
    expect(s1?.newChanges).toBeUndefined();
  });
});

describe('T62 story hash rule 3 and old sign-offs', () => {
  it('for a story without changes rule 3 gives the rule-2 hash', () => {
    const { record } = loadEpic(signedEpic());
    const sc = allScenarios(record);
    for (const s of record.prd!.stories) expect(storyHash(3, s, record.prd!, record.flow, sc)).toBe(storyHash(2, s, record.prd!, record.flow, sc));
  });

  it('an approval of a change scenario does not change the rule-3 hash', () => {
    const dir = signedEpic();
    addChange(dir, C1());
    const hash = (r: EpicRecord) => {
      const s1 = r.prd!.stories.find((s) => s.id === 'S1')!;
      return storyHash(3, s1, r.prd!, r.flow, allScenarios(r), storyChanges(r, 'S1').map((c) => c.doc));
    };
    const before = hash(loadEpic(dir).record);
    approveScenarios(dir, ['S1-c1-gift'], ME, { now: NOW, ...SIGNED });
    expect(hash(loadEpic(dir).record)).toBe(before);
  });

  it('old rule-2 sign-offs keep their rule and stay valid and trusted', () => {
    const dir = signedEpic();
    asRule2(dir);
    const trust = detectStale(loadEpic(dir).record);
    expect(trust.stories.map((s) => [s.id, s.status, s.hashRule, s.trusted])).toEqual([
      ['S1', 'signed', 2, true],
      ['S2', 'signed', 2, true],
    ]);
    expect(validateEpic(dir).ok).toBe(true);
    expect(gateEpic(dir).ok).toBe(true);
  });

  it('a change to a story signed under rule 2 names only the change', () => {
    const dir = signedEpic();
    asRule2(dir);
    addChange(dir, C1());
    const trust = detectStale(loadEpic(dir).record);
    expect(trust.stories.find((s) => s.id === 'S1')).toMatchObject({ status: 'stale', hashRule: 2, newChanges: ['C1'] });
    expect(trust.stories.find((s) => s.id === 'S2')).toMatchObject({ status: 'signed', hashRule: 2, trusted: true });
  });
});

describe('T62 the preview and the brief show the change', () => {
  it('the sign-off preview marks the change items and lists the change', () => {
    const dir = signedEpic();
    addChange(dir, C1());
    const { record } = loadEpic(dir);
    const s1 = record.prd!.stories.find((s) => s.id === 'S1')!;
    const p = markChanges(previewContent(storyContentV2(s1, record.prd!, record.flow, allScenarios(record))), record, 'S1');
    expect(p.changes).toEqual([{ id: 'C1', title: 'The buyer pays with a gift card.', why: 'Buyers ask for gift cards.', file: 'changes/C1.yaml' }]);
    expect(p.criteria.map((c) => [c.id, c.change])).toEqual([
      ['S1-A1', undefined],
      ['S1-A2', 'C1'],
    ]);
    expect(p.scenarios.filter((s) => s.change === 'C1').map((s) => s.id)).toEqual(['S1-c1-gift']);
  });

  it('the build brief says what is new in the change', () => {
    const dir = signedEpic();
    addChange(dir, C1());
    approveScenarios(dir, ['S1-c1-gift'], ME, { now: NOW, ...SIGNED });
    signOff(dir, ['S1'], ME, { now: NOW, ...SIGNED });
    const r = storyBuildBrief(loadEpic(dir).record, 'S1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.markdown).toContain('## Small changes');
    expect(r.markdown).toContain('- S1-A2 (New in C1): given a cart with items and a gift card');
    expect(r.markdown).toContain('### New in C1: The buyer pays with a gift card.');
    expect(r.markdown).toContain('### S1-c1-gift (New in C1): Buyer pays with a gift card and the order ships');
  });

  it('the brief of a story with a new change that no sign-off covers is refused and names the change', () => {
    const dir = signedEpic();
    addChange(dir, C1());
    const r = storyBuildBrief(loadEpic(dir).record, 'S1');
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain('C1');
  });
});

describe('T62 newChange: the start file', () => {
  it('writes changes/C1.yaml that validates, and changes/C2.yaml next', () => {
    const dir = signedEpic();
    const r = newChange(dir, 'S1', 'The buyer pays with a gift card.');
    expect(r).toMatchObject({ ok: true, id: 'C1', file: 'changes/C1.yaml' });
    const doc = parse(readFileSync(join(dir, 'changes/C1.yaml'), 'utf8'));
    expect(doc.criteria.map((c: { id: string }) => c.id)).toEqual(['S1-A2']);
    expect(doc.scenarios[0].status).toBe('draft');
    expect(validateEpic(dir).ok).toBe(true);
    expect(newChange(dir, 'S1', 'A second change.')).toMatchObject({ ok: true, id: 'C2' });
  });

  it('the error exits write no file', () => {
    const dir = signedEpic();
    expect(newChange(dir, 'S9', 'A change.')).toMatchObject({ ok: false, exit: 'unknown-story' });
    expect(newChange(dir, 'S1', '  ')).toMatchObject({ ok: false, exit: 'empty-title' });
    expect(existsSync(join(dir, 'changes'))).toBe(false);
  });
});

describe('T62 the deck shows the change', () => {
  it('marks the change criterion and scenario "New in C1" and says only the change is new', () => {
    const dir = signedEpic();
    addChange(dir, C1());
    const record = loadEpic(dir).record;
    const deck = presentationDeck(record, { commit: { branch: 'main', sha: 'abc1234', date: '2026-11-07' }, uncommitted: false, owner: 'Ada', stories: {}, gate: { ok: true, items: [] }, testResults: true }, NO_INPUTS, { full: true });
    const text = JSON.stringify(deck.slides.filter((sl) => sl.key === 'S1' || sl.key.startsWith('S1-checks')));
    expect(text).toContain('New in C1: The order is shipped.');
    expect(text).toContain('New in C1: Buyer pays with a gift card and the order ships');
    expect(deck.slides.find((sl) => sl.key === 'S1')?.narration).toBe(
      'Pay for my cart. In progress: new in C1 after the sign-off: needs a new sign-off; signed off by a on 2026-11-05; C1 is new since then.',
    );
  });
});
