// The extended read model of `GET /api/epic`: the EpicView plus the gate report (with simulate
// and signature checks), readiness, the permission matrix, and the signature state of each
// approval and sign-off (R11, R13, R14, D41).

import {
  checkSignatures,
  gateRecord,
  gateSigners,
  loadEpic,
  makeReport,
  readiness,
  simulateRecord,
  simulationFindings,
  type Id,
  type PermissionBoxes,
  type PermissionMatrix,
  type Readiness,
  type RecordSignatures,
  type SignedGateReport,
  type SignedSignOff,
  type SigStatus,
  type SimulationReport,
  type Verifier,
} from '@rehearse/core';
import { buildEpicView, type EpicView } from './view.js';

export interface ApprovalView {
  by: string;
  at: string;
  /** Key fingerprint, when the signature can be read. */
  signer?: string;
  sigStatus: SigStatus;
}

export type SignOffView = SignedSignOff & { sigStatus: SigStatus; signer?: string };

export interface TrustedEpicView extends EpicView {
  /** Gate report, computed with simulate and signature checks. */
  gate: SignedGateReport;
  readiness: Readiness;
  /** Empty when the record has schema errors (simulate does not run then). */
  simulation: { permissionMatrix: PermissionMatrix; permissionBoxes: PermissionBoxes };
  /** Each scenario that has an approval, by scenario id. */
  approvals: Record<Id, ApprovalView>;
  /** The sign-offs in signoff.yaml order, each with its signature state. */
  signOffs: SignOffView[];
}

/** Load the EPIC folder and build the extended view. Signatures are checked once. */
export function buildTrustedEpicView(dir: string, verifier: Verifier): TrustedEpicView {
  const base = buildEpicView(dir);
  const loaded = loadEpic(dir);
  const { record } = loaded;
  let sim: SimulationReport | undefined;
  const findings = simulationFindings(loaded, (l) => (sim = simulateRecord(l)));
  const schemaBad = findings.some((f) => f.kind === 'schema');
  const sigs: RecordSignatures = schemaBad ? { approvals: [], signOffs: [] } : checkSignatures(record, verifier);
  const report = schemaBad ? makeReport('gate', findings) : gateRecord(record, findings, sigs);
  const gate: SignedGateReport = { command: 'gate', ok: report.ok, findings: report.findings, simulation: 'simulate', signers: gateSigners(sigs) };

  const approvals: Record<Id, ApprovalView> = {};
  for (const a of sigs.approvals) approvals[a.scenario] = { by: a.by, at: a.at, ...(a.signer ? { signer: a.signer } : {}), sigStatus: a.sigStatus };
  const entries = (record.signoff?.signOffs ?? []) as SignedSignOff[];
  const signOffs: SignOffView[] = sigs.signOffs.map((s) => ({ ...entries[s.index]!, sigStatus: s.sigStatus, ...(s.signer ? { signer: s.signer } : {}) }));

  return {
    ...base,
    gate,
    readiness: readiness(record, gate),
    simulation: { permissionMatrix: sim?.permissionMatrix ?? {}, permissionBoxes: sim?.permissionBoxes ?? {} },
    approvals,
    signOffs,
  };
}
