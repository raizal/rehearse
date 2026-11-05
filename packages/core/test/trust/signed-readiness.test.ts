// Readiness with signature checks (C28, D41, S8-A1): only an approval with a valid signature is proof.

import { describe, expect, it } from 'vitest';
import { checkSignatures, gateEpic, loadEpic, readiness, signedReadiness, withSignatures, type RecordSignatures } from '../../src/index.js';
import { makeEpic, REAL_EPIC } from '../helpers.js';
import { VERIFIER } from './keys.js';
import { approvedEpic } from './helpers.js';

const sigsOf = (dir: string): RecordSignatures => checkSignatures(loadEpic(dir).record, VERIFIER);

describe('signed readiness (C28)', () => {
  it('S8-A1: a requirement whose approvals are all signed is proven, and each scenario carries its sigStatus', () => {
    const dir = approvedEpic();
    const view = signedReadiness(loadEpic(dir).record, sigsOf(dir), gateEpic(dir));
    expect(view.noProof).toEqual([]);
    expect(view.requirements[1]).toMatchObject({
      id: 'R2',
      proven: true,
      stories: [{ id: 'S2', scenarios: [{ id: 'S2-out-of-stock', status: 'approved', sigStatus: 'valid' }] }],
    });
  });

  it('S8-A1: an approved scenario with no valid signature is not proof, and the reason says "approval not signed"', () => {
    const dir = approvedEpic();
    const sigs = sigsOf(dir);
    for (const a of sigs.approvals) if (a.story === 'S2') a.sigStatus = 'missing';
    const view = signedReadiness(loadEpic(dir).record, sigs);
    expect(view.requirements.find((r) => r.id === 'R1')).toMatchObject({ proven: true });
    expect(view.requirements.find((r) => r.id === 'R2')).toMatchObject({ proven: false, reason: 'approval-not-signed' });
    expect(view.noProof).toEqual([
      { id: 'R2', reason: 'approval-not-signed', message: 'approval not signed: S2-out-of-stock (signature missing)' },
    ]);
  });

  it('S8-A1: invalid and unknown-signer approvals are not proof either', () => {
    const dir = approvedEpic();
    const sigs = sigsOf(dir);
    for (const a of sigs.approvals) a.sigStatus = a.story === 'S1' ? 'invalid' : 'unknown-signer';
    const view = signedReadiness(loadEpic(dir).record, sigs);
    expect(view.noProof.map((p) => [p.id, p.reason, p.message])).toEqual([
      ['R1', 'approval-not-signed', 'approval not signed: S1-buy (signature invalid), S1-empty (signature invalid)'],
      ['R2', 'approval-not-signed', 'approval not signed: S2-out-of-stock (signature unknown-signer)'],
    ]);
  });

  it('keeps the reasons of plain readiness: no story, and no approved scenario', () => {
    const dir = makeEpic({ edit: (d) => (d['prd.yaml'].stories[1].requirements = ['R1']) });
    const record = loadEpic(dir).record;
    const view = withSignatures(readiness(record), []);
    expect(view.noProof).toEqual([
      { id: 'R1', reason: 'no-approved-scenario', message: 'no approved scenario that is not stale for S1, S2' },
      { id: 'R2', reason: 'no-story', message: 'no story links R2' },
    ]);
  });

  it('the live first EPIC: its bootstrap approvals have no signature, so no requirement is proven yet', () => {
    const record = loadEpic(REAL_EPIC).record;
    const view = signedReadiness(record, checkSignatures(record, VERIFIER));
    expect(view.requirements.length).toBeGreaterThan(0);
    expect(view.requirements.every((r) => !r.proven)).toBe(true);
    expect(new Set(view.noProof.map((p) => p.reason))).toEqual(new Set(['approval-not-signed']));
  });
});
