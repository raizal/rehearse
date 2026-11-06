// Box `gate`: traced, sim-clean, no-stale, signed-off, report (R14, S9-A1, D17).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectStale, gateEpic, gateRecord, loadEpic, reportToJson, signOff, type Finding } from '../../src/index.js';
import { BOOTSTRAP_EPIC, CODE_GRAPH_SIGNED_EPIC, hashDir, liveAllowedSigners, makeEpic, PRESIGNOFF_EPIC, REAL_EPIC, unsignedApprovals } from '../helpers.js';
import { approvedEpic, ME, NOW, SHOP_SCENARIOS, SIGNED, signedEpic } from './helpers.js';
import { KEY } from './keys.js';

/** `<email> <SHA256 fingerprint>` of each key line of an allowed_signers file. */
function listedFingerprints(text: string): string[] {
  return text
    .split('\n')
    .map((l) => /^(\S+)\s.*?\b(?:ssh|ecdsa|sk)-\S+\s+([A-Za-z0-9+/=]+)/.exec(l))
    .filter((m) => m !== null)
    .map((m) => `${m[1]} SHA256:${createHash('sha256').update(Buffer.from(m[2]!, 'base64')).digest('base64').replace(/=+$/, '')}`);
}

const CONTRACT: Finding = { kind: 'contract', file: 'flow.yaml', path: 'pay', message: 'orderId: string → number', refs: ['S1'] };

describe('gate check', () => {
  it('passes on a signed, approved, valid record', () => {
    const report = gateEpic(signedEpic());
    expect(report).toEqual({
      command: 'gate',
      ok: true,
      findings: [],
      simulation: 'validate-only',
      signers: [{ by: 'a@b.c', fingerprint: KEY.signer.keyFingerprint, approvals: SHOP_SCENARIOS, signOffs: [0] }],
    });
  });

  it('traced: a requirement with no story and a story with no approved scenario', () => {
    const dir = makeEpic({ edit: (d) => d['prd.yaml'].requirements.push({ id: 'R3', kind: 'functional', text: 'Refunds.' }) });
    const report = gateEpic(dir);
    expect(report.ok).toBe(false);
    expect(report.findings).toEqual([
      { kind: 'gate', file: 'prd.yaml', path: 'S1', message: 'S1 has no approved scenario that is not stale', refs: ['S1'] },
      { kind: 'gate', file: 'prd.yaml', path: 'S2', message: 'S2 has no approved scenario that is not stale', refs: ['S2'] },
      { kind: 'gate', file: 'prd.yaml', path: 'requirements[2]', message: 'R3 has no story', refs: ['R3'] },
      { kind: 'gate', file: 'signoff.yaml', path: 'S1', message: 'S1 is not signed off; the owner signs it off in the UI', refs: ['S1'] },
      { kind: 'gate', file: 'signoff.yaml', path: 'S2', message: 'S2 is not signed off; the owner signs it off in the UI', refs: ['S2'] },
    ]);
  });

  it('S9-A1 sim-clean: a simulator finding fails the gate and is listed', () => {
    const { record } = loadEpic(signedEpic());
    const report = gateRecord(record, [CONTRACT]);
    expect(report).toEqual({ command: 'gate', ok: false, findings: [CONTRACT] });
  });

  it('C22 gate findings have kind gate; simulation findings keep their own kind', () => {
    const dir = makeEpic({ edit: (d) => d['prd.yaml'].requirements.push({ id: 'R3', kind: 'functional', text: 'Refunds.' }) });
    const report = gateRecord(loadEpic(dir).record, [CONTRACT]);
    expect(report.findings.map((f) => f.kind).sort()).toEqual(['contract', 'gate', 'gate', 'gate', 'gate', 'gate']);
  });

  it('uses the simulator when one is given', () => {
    const report = gateEpic(signedEpic(), () => ({ command: 'simulate', ok: false, findings: [CONTRACT] }));
    expect(report.simulation).toBe('simulate');
    expect(report.findings).toEqual([CONTRACT]);
  });

  it('D17 signed-off: approvals with no signoff.yaml fail with one finding per story', () => {
    const dir = approvedEpic();
    const report = gateEpic(dir);
    expect(report.ok).toBe(false);
    expect(report.findings).toEqual([
      { kind: 'gate', file: 'signoff.yaml', path: 'S1', message: 'S1 is not signed off; the owner signs it off in the UI', refs: ['S1'] },
      { kind: 'gate', file: 'signoff.yaml', path: 'S2', message: 'S2 is not signed off; the owner signs it off in the UI', refs: ['S2'] },
    ]);
  });

  it('D17 signed-off: a partial sign-off fails for the other stories only', () => {
    const dir = approvedEpic();
    const r = signOff(dir, ['S1'], ME, { now: NOW, ...SIGNED });
    expect(r.ok).toBe(true);
    const report = gateEpic(dir);
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => `${f.file} ${f.path}: ${f.message}`)).toEqual(['signoff.yaml S2: S2 is not signed off; the owner signs it off in the UI']);
  });

  it('a schema finding stops the trust checks and the simulator', () => {
    let called = false;
    const dir = makeEpic({ edit: (d) => delete d['prd.yaml'].roles });
    const report = gateEpic(dir, () => ((called = true), { command: 'simulate', ok: true, findings: [] }));
    expect(called).toBe(false);
    expect(report.ok).toBe(false);
    expect(report.findings.every((f) => f.kind === 'schema' || f.kind === 'reference')).toBe(true);
  });

  it('dogfood: the frozen first EPIC is not clean, each rule-1 story must be signed again', () => {
    const before = readFileSync(join(BOOTSTRAP_EPIC, 'signoff.yaml'), 'utf8');
    const report = gateEpic(BOOTSTRAP_EPIC);
    expect(report.ok).toBe(false);
    const signoffFindings = report.findings.filter((f) => f.file === 'signoff.yaml');
    expect(signoffFindings.map((f) => `${f.kind} ${f.path}`)).toEqual(
      ['S1', 'S10', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'].map((s) => `gate ${s}`),
    );
    // Unsigned rule-1 entries stay "must be signed again", with no second finding per story.
    expect(signoffFindings[0]!.message).toBe('signed under hash rule 1, which does not cover boxes and lane roles (C11); must be signed again');
    // The bootstrap approvals have no signature, so none is evidence (D41).
    const unsigned = report.findings.filter((f) => f.file.startsWith('scenarios/'));
    expect(unsigned).toHaveLength(28);
    expect(unsigned.every((f) => f.kind === 'gate' && f.message.includes('sigStatus missing'))).toBe(true);
    expect(report.signers).toEqual([]);
    expect(reportToJson(gateEpic(BOOTSTRAP_EPIC))).toBe(reportToJson(report));
    expect(readFileSync(join(BOOTSTRAP_EPIC, 'signoff.yaml'), 'utf8')).toBe(before);
  });

  it('dogfood: the first EPIC before its sign-off is not clean, and the gate writes nothing', () => {
    // A frozen copy from before the owner signed, so the test does not depend on what the owner signed.
    const before = hashDir(PRESIGNOFF_EPIC);
    const report = gateEpic(PRESIGNOFF_EPIC);
    expect(report.ok).toBe(false);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(new Set(report.findings.map((f) => f.kind))).toEqual(new Set(['gate']));
    expect(hashDir(PRESIGNOFF_EPIC)).toBe(before);
  });

  it('the gate writes nothing on a clean EPIC either', () => {
    const dir = signedEpic();
    const before = hashDir(dir);
    expect(gateEpic(dir).ok).toBe(true);
    expect(hashDir(dir)).toBe(before);
  });

  it('dogfood: the live first EPIC passes the gate, every approval and sign-off signed by a listed key; nothing is written', () => {
    const before = hashDir(REAL_EPIC);
    const { record } = loadEpic(REAL_EPIC);
    const report = gateEpic(REAL_EPIC);
    expect(hashDir(REAL_EPIC)).toBe(before);
    // True without the key list: nothing is stale, each story is signed under rule 2, each approval carries a signature.
    const stale = detectStale(record);
    expect(stale).toMatchObject({ staleStories: [], staleScenarios: [], epicStatus: 'signed' });
    expect(stale.stories.every((s) => s.status === 'signed' && s.hashRule === 2 && s.trusted)).toBe(true);
    expect(unsignedApprovals(REAL_EPIC)).toEqual([]);
    const approved = stale.scenarios.filter((s) => s.status === 'approved').map((s) => s.id);
    expect(approved.length).toBeGreaterThan(0);
    const allowed = liveAllowedSigners();
    if (allowed) {
      // The owner's checkout: each signature is good and made by a key that allowed_signers lists.
      expect(report.findings).toEqual([]);
      expect(report.ok).toBe(true);
      expect(report.signers.flatMap((s) => s.approvals).sort()).toEqual([...approved].sort());
      const listed = listedFingerprints(readFileSync(allowed, 'utf8'));
      for (const s of report.signers) expect(listed, s.by).toContain(`${s.by} ${s.fingerprint}`);
    } else {
      // No key list (a clean worktree): each signature is good, only its key is not listed (unknown-signer).
      expect(report.findings.length).toBeGreaterThan(0);
      for (const f of report.findings) expect(f.message, f.path).toMatch(/sigStatus unknown-signer/);
      expect(report.findings.filter((f) => f.file.startsWith('scenarios/')).map((f) => f.path).sort()).toEqual([...approved].sort());
    }
  });

  // A frozen copy of the signed EPIC: T35's record corrections made the live one stale until the owner signs again.
  it('dogfood: the signed code-graph EPIC fails only for the stories the owner has not signed off (D17); nothing is written', () => {
    const before = hashDir(CODE_GRAPH_SIGNED_EPIC);
    const { record } = loadEpic(CODE_GRAPH_SIGNED_EPIC);
    const report = gateEpic(CODE_GRAPH_SIGNED_EPIC);
    expect(hashDir(CODE_GRAPH_SIGNED_EPIC)).toBe(before);
    // Robust to the owner's signing state: one signed-off finding per story with no sign-off, and no other kind.
    const notSignedOff = detectStale(record).stories.filter((s) => s.status === 'draft').map((s) => s.id).sort();
    const signedOff = report.findings.filter((f) => f.message.endsWith('is not signed off; the owner signs it off in the UI'));
    expect(signedOff.map((f) => `${f.file} ${f.path}`)).toEqual(notSignedOff.map((s) => `signoff.yaml ${s}`));
    const others = report.findings.filter((f) => !signedOff.includes(f));
    if (liveAllowedSigners()) {
      expect(others).toEqual([]);
      expect(report.ok).toBe(notSignedOff.length === 0);
    } else {
      for (const f of others) expect(f.message, f.path).toMatch(/sigStatus unknown-signer/);
    }
  });
});
