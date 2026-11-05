// Box `gate`: traced, sim-clean, no-stale, report (R14, S9-A1).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gateEpic, gateRecord, loadEpic, reportToJson, type Finding } from '../../src/index.js';
import { BOOTSTRAP_EPIC, makeEpic, REAL_EPIC } from '../helpers.js';
import { approvedEpic, SHOP_SCENARIOS } from './helpers.js';
import { KEY } from './keys.js';

const CONTRACT: Finding = { kind: 'contract', file: 'flow.yaml', path: 'pay', message: 'orderId: string → number', refs: ['S1'] };

describe('gate check', () => {
  it('passes on an approved, valid record', () => {
    const report = gateEpic(approvedEpic());
    expect(report).toEqual({
      command: 'gate',
      ok: true,
      findings: [],
      simulation: 'validate-only',
      signers: [{ by: 'a@b.c', fingerprint: KEY.signer.keyFingerprint, approvals: SHOP_SCENARIOS, signOffs: [] }],
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
    ]);
  });

  it('S9-A1 sim-clean: a simulator finding fails the gate and is listed', () => {
    const { record } = loadEpic(approvedEpic());
    const report = gateRecord(record, [CONTRACT]);
    expect(report).toEqual({ command: 'gate', ok: false, findings: [CONTRACT] });
  });

  it('C22 gate findings have kind gate; simulation findings keep their own kind', () => {
    const dir = makeEpic({ edit: (d) => d['prd.yaml'].requirements.push({ id: 'R3', kind: 'functional', text: 'Refunds.' }) });
    const report = gateRecord(loadEpic(dir).record, [CONTRACT]);
    expect(report.findings.map((f) => f.kind).sort()).toEqual(['contract', 'gate', 'gate', 'gate']);
  });

  it('uses the simulator when one is given', () => {
    const report = gateEpic(approvedEpic(), () => ({ command: 'simulate', ok: false, findings: [CONTRACT] }));
    expect(report.simulation).toBe('simulate');
    expect(report.findings).toEqual([CONTRACT]);
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

  it('dogfood: the live first EPIC is not clean and the gate writes nothing', () => {
    const before = readFileSync(join(REAL_EPIC, 'signoff.yaml'), 'utf8');
    const report = gateEpic(REAL_EPIC);
    expect(report.ok).toBe(false);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(new Set(report.findings.map((f) => f.kind))).toEqual(new Set(['gate']));
    expect(readFileSync(join(REAL_EPIC, 'signoff.yaml'), 'utf8')).toBe(before);
  });
});
