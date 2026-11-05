// Readiness with signature checks (C28, D41, S8-A1). An approval is proof only when its
// signature is valid; plain `readiness` counts any approval that is not stale. New file, so the
// types and the `readiness` export of wave 2 stay as they are.

import type { EpicRecord, Id, Report } from '../types.js';
import { readiness } from './readiness.js';
import type { RecordSignatures } from './evidence.js';
import type { SigStatus } from './signature.js';
import type { ProofReason, Readiness, ReadinessRequirement, ReadinessScenario, ReadinessStory } from './types.js';

/** `approval-not-signed`: a linked story has approved scenarios, but none with a valid signature. */
export type SignedProofReason = ProofReason | 'approval-not-signed';

export interface SignedReadinessScenario extends ReadinessScenario {
  /** Signature status of the approval. Undefined when the scenario has no approval. */
  sigStatus?: SigStatus;
}

export interface SignedReadinessStory extends Omit<ReadinessStory, 'scenarios'> {
  scenarios: SignedReadinessScenario[];
}

export interface SignedReadinessRequirement extends Omit<ReadinessRequirement, 'stories' | 'reason'> {
  stories: SignedReadinessStory[];
  reason?: SignedProofReason;
}

export interface SignedReadiness extends Omit<Readiness, 'requirements' | 'noProof'> {
  requirements: SignedReadinessRequirement[];
  noProof: { id: Id; reason: SignedProofReason; message: string }[];
}

/** The signature status of one approval, by scenario id. */
export interface ScenarioSig {
  scenario: Id;
  sigStatus: SigStatus;
}

/**
 * Readiness where only an approved scenario with a valid signature proves a requirement.
 * A requirement that plain readiness proves, but with unsigned approvals only, gets the reason
 * `approval-not-signed` and a message that names those scenarios and their sigStatus.
 */
export function withSignatures(base: Readiness, sigs: readonly ScenarioSig[]): SignedReadiness {
  const sigOf = new Map(sigs.map((s) => [s.scenario, s.sigStatus]));
  const requirements: SignedReadinessRequirement[] = base.requirements.map((req) => {
    const stories: SignedReadinessStory[] = req.stories.map((s) => ({
      ...s,
      scenarios: s.scenarios.map((sc) => {
        const sig = sigOf.get(sc.id);
        return sig === undefined ? { ...sc } : { ...sc, sigStatus: sig };
      }),
    }));
    const row: SignedReadinessRequirement = { ...req, stories };
    if (!req.proven) return row;
    const approved = stories.flatMap((s) => s.scenarios).filter((sc) => sc.status === 'approved');
    if (approved.some((sc) => sc.sigStatus === 'valid')) return row;
    const names = approved.map((sc) => `${sc.id} (signature ${sc.sigStatus ?? 'missing'})`).join(', ');
    return { ...row, proven: false, reason: 'approval-not-signed', message: `approval not signed: ${names}` };
  });
  return {
    ...base,
    requirements,
    noProof: requirements.filter((r) => !r.proven).map((r) => ({ id: r.id, reason: r.reason!, message: r.message! })),
  };
}

/** Readiness of a loaded record, with the signature checks of its approvals (`checkSignatures`). */
export function signedReadiness(record: EpicRecord, sigs: RecordSignatures, gateReport?: Report, corrections?: string): SignedReadiness {
  return withSignatures(readiness(record, gateReport, corrections), sigs.approvals);
}
