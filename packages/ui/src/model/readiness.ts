// Readiness proof with signatures (C28, S8-A1). Mirrors `withSignatures` in @rehearse/core,
// which the browser bundle cannot import (core reads files). The UI applies it to the readiness
// the server sends, so an older server that counts unsigned approvals is corrected too.

import type { Id, SignedProofReason, SignedReadiness, SignedReadinessRequirement } from '@rehearse/core';
import type { ApprovalView } from '../contract.js';

const REASON_TEXT: Record<SignedProofReason, string> = {
  'no-story': 'no story',
  'no-approved-scenario': 'no approved scenario',
  'approval-not-signed': 'approval not signed',
};

/** Why a requirement is not proven, in words. */
export function proofReasonText(reason: SignedProofReason | string | undefined): string {
  return reason === undefined ? '' : (REASON_TEXT[reason as SignedProofReason] ?? reason);
}

/**
 * Readiness where only an approved scenario with a valid signature proves a requirement.
 * Without `approvals` (an older server) the readiness is returned as it is.
 */
export function proofWithSignatures(r: SignedReadiness | undefined, approvals: Record<Id, ApprovalView> | undefined): SignedReadiness | undefined {
  if (!r || !approvals) return r;
  const requirements: SignedReadinessRequirement[] = r.requirements.map((req) => {
    const stories = req.stories.map((s) => ({
      ...s,
      scenarios: s.scenarios.map((sc) => {
        const sig = approvals[sc.id]?.sigStatus;
        return sig === undefined ? { ...sc } : { ...sc, sigStatus: sig };
      }),
    }));
    const row: SignedReadinessRequirement = { ...req, stories };
    // Keep the reasons that do not depend on signatures.
    if (!req.proven && req.reason !== 'approval-not-signed') return row;
    const approved = stories.flatMap((s) => s.scenarios).filter((sc) => sc.status === 'approved');
    if (approved.some((sc) => sc.sigStatus === 'valid')) {
      const { reason: _reason, message: _message, ...proven } = row;
      return { ...proven, proven: true };
    }
    const names = approved.map((sc) => `${sc.id} (signature ${sc.sigStatus ?? 'missing'})`).join(', ');
    return { ...row, proven: false, reason: 'approval-not-signed', message: `approval not signed: ${names}` };
  });
  return {
    ...r,
    requirements,
    noProof: requirements.filter((q) => !q.proven).map((q) => ({ id: q.id, reason: q.reason!, message: q.message ?? '' })),
  };
}
