// Shared parts of the review actions: who signs, signature badges, findings and POST outcomes (S6, S9, D41).

import type { Finding } from '@rehearse/core';
import { SIGNING_DOC, type ApprovalView, type PostOutcome, type Session, type SigStatus } from '../contract.js';
import { findingText, sigText } from '../model/review.js';

/** Session as the app holds it: loading, failed, or loaded. */
export type SessionState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; session: Session };

/** Why the approve and sign-off buttons are off, or undefined when they can be used. */
export function signingBlocked(state: SessionState): string | undefined {
  if (state.kind === 'loading') return 'Loading the session…';
  if (state.kind === 'error') return `Could not load the session: ${state.message}`;
  return state.session.signing.ok ? undefined : state.session.signing.reason;
}

/** Who signs and with which key; or why signing is off, with a link to the setup guide. */
export function SignerInfo({ state, testId }: { state: SessionState; testId: string }) {
  const blocked = signingBlocked(state);
  const session = state.kind === 'ready' ? state.session : undefined;
  return (
    <div className="signer" data-testid={testId}>
      {session && (
        <div>
          Signing as <strong data-testid={`${testId}-by`}>{session.identity.by}</strong>
          {session.identity.threadId && <span className="muted"> (thread {session.identity.threadId})</span>}
          {session.signing.ok && (
            <>
              {' '}with key <code data-testid={`${testId}-key`}>{session.signing.keyFingerprint}</code>
            </>
          )}
        </div>
      )}
      {blocked && (
        <p className="warn" role="status" data-testid={`${testId}-blocked`}>
          Signing is not available: {blocked}.{' '}
          <a href={SIGNING_DOC} data-testid={`${testId}-doc`} target="_blank" rel="noreferrer">
            How to set up signing ({SIGNING_DOC})
          </a>
        </p>
      )}
    </div>
  );
}

const SIG_CLASS: Record<SigStatus, string> = { valid: 'status-approved', missing: 'status-draft', invalid: 'status-stale', 'unknown-signer': 'status-stale' };

/** Signature status in words, with the signer key in the title. */
export function SigBadge({ status, signer, testId }: { status: SigStatus; signer?: string; testId: string }) {
  return (
    <span className={`badge sig ${SIG_CLASS[status] ?? 'status-stale'}`} data-testid={testId} title={signer ? `signer key ${signer}` : 'no signer key'}>
      {sigText(status)}
    </span>
  );
}

export function ApprovalSig({ id, approval }: { id: string; approval: ApprovalView | undefined }) {
  if (!approval) return null;
  return <SigBadge status={approval.sigStatus} signer={approval.signer} testId={`sig-status-${id}`} />;
}

export function FindingList({ findings, testId }: { findings: Finding[]; testId: string }) {
  if (findings.length === 0) return <p className="muted" data-testid={testId}>No findings.</p>;
  return (
    <ul className="findings" data-testid={testId}>
      {findings.map((f, i) => (
        <li key={`${i}-${f.file}-${f.path}`}>
          <span className="pill">{f.kind}</span> {findingText(f)}
        </li>
      ))}
    </ul>
  );
}

/** The result of the last POST, read out by screen readers. `okText` says what worked. */
export function OutcomeMessage({ outcome, okText, testId }: { outcome: PostOutcome<unknown> | undefined; okText: string; testId: string }) {
  return (
    <div className="outcome" role="status" aria-live="polite" data-testid={testId}>
      {outcome?.kind === 'ok' && <p className="ok">{okText}</p>}
      {outcome?.kind === 'findings' && (
        <>
          <p className="warn">Refused: {outcome.findings.length} finding{outcome.findings.length === 1 ? '' : 's'}.</p>
          <FindingList findings={outcome.findings} testId={`${testId}-findings`} />
        </>
      )}
      {outcome?.kind === 'unavailable' && (
        <p className="warn">
          Signing is not available: {outcome.reason}.{' '}
          <a href={SIGNING_DOC} target="_blank" rel="noreferrer">
            How to set up signing
          </a>
        </p>
      )}
      {outcome?.kind === 'forbidden' && <p className="warn">Forbidden: {outcome.message}</p>}
      {outcome?.kind === 'error' && <p className="warn">Error: {outcome.message}</p>}
    </div>
  );
}
