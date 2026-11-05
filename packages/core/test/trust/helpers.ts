// Shop fixtures in trust states: approved and signed under rule 2, with throwaway keys,
// in a temp git repo whose .rehearse/allowed_signers lists the test key (D41).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { approveScenarios, signOff, type Identity } from '../../src/index.js';
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
