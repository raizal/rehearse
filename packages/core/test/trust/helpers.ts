// Shop fixtures in trust states: approved and signed under rule 2, with throwaway keys,
// in a temp git repo whose .rehearse/allowed_signers lists the test key (D41).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { approveScenarios, scenarioHash, signOff, type EpicRecord, type Identity, type Scenario } from '../../src/index.js';
import { makeEpic, type FixtureOptions } from '../helpers.js';
import { inRepo, KEY, VERIFIER } from './keys.js';

export const ME: Identity = { by: 'a@b.c', threadId: 'thr_test' };
export const NOW = new Date('2026-11-05T10:00:00.123Z');
export const SHOP_SCENARIOS = ['S1-buy', 'S1-empty', 'S2-out-of-stock'];

/** Sign with the test key, verify against the test allowed_signers. */
export const SIGNED = { signer: KEY.signer, verifier: VERIFIER };

/** Shop in a git repo with allowed_signers, every scenario approved and signed. */
export function approvedEpic(opts: FixtureOptions = {}): string {
  const dir = inRepo(makeEpic(opts));
  const r = approveScenarios(dir, SHOP_SCENARIOS, ME, { now: NOW, ...SIGNED });
  if (!r.ok) throw new Error(JSON.stringify(r.findings));
  return dir;
}

/** Shop with every scenario approved and both stories signed under rule 2. */
export function signedEpic(): string {
  const dir = approvedEpic();
  const r = signOff(dir, ['S1', 'S2'], ME, { now: NOW, ...SIGNED });
  if (!r.ok) throw new Error(JSON.stringify(r.findings));
  return dir;
}

/** Edit one YAML file of an EPIC folder in place with the Document API (keeps comments). */
export function editYaml(dir: string, file: string, edit: (doc: ReturnType<typeof parseDocument>) => void): void {
  const full = join(dir, file);
  const doc = parseDocument(readFileSync(full, 'utf8'));
  edit(doc);
  writeFileSync(full, doc.toString());
}

export function read(dir: string, file: string): string {
  return readFileSync(join(dir, file), 'utf8');
}

/**
 * A copy of a record whose story S1 has `n` more approved scenarios (`S1-buy-1` …), each a copy of
 * S1-buy with its own long example: a brief over its budget, built on the small shop (T56).
 */
export function withManyScenarios(record: EpicRecord, n: number): EpicRecord {
  const copy = structuredClone(record);
  const file = copy.scenarioFiles.find((f) => f.story === 'S1')!;
  const buy = file.scenarios.find((s) => s.id === 'S1-buy')!;
  for (let i = 1; i <= n; i++) {
    const s: Scenario = structuredClone(buy);
    s.id = `S1-buy-${i}`;
    s.title = `Buyer ${i} pays for a cart of many items and the order ships`;
    s.status = 'approved';
    delete s.approval;
    s.steps[1]!.example = { id: `cart-${i}`, given: { items: Array.from({ length: 12 }, (_, k) => `item-${i}-${k}`) }, then: { orderId: `order-of-buyer-${i}` } };
    s.approval = { by: ME.by, at: '2026-11-05T10:00:00Z', hash: scenarioHash(s) };
    file.scenarios.push(s);
  }
  return copy;
}
