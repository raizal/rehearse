// The approve bar above the scenario list: who signs, "approve the selected ones", and the last result (S6-A1, D41).

import type { Id } from '@rehearse/core';
import type { ApproveOk, PostOutcome } from '../contract.js';
import { OutcomeMessage, SignerInfo, type SessionState } from './Review.js';

export interface ApproveBarProps {
  session: SessionState;
  selected: ReadonlySet<Id>;
  disabled: boolean;
  busy: boolean;
  outcome?: PostOutcome<ApproveOk>;
  onApprove: (ids: Id[]) => void;
}

export function ApproveBar({ session, selected, disabled, busy, outcome, onApprove }: ApproveBarProps) {
  const ids = [...selected].sort();
  return (
    <section className="approve-bar" data-testid="approve-bar" aria-label="Approve scenarios">
      <SignerInfo state={session} testId="approve-signer" />
      <button
        type="button"
        className="action"
        data-testid="approve-selected"
        disabled={disabled || ids.length === 0}
        onClick={() => onApprove(ids)}
        aria-label={ids.length === 0 ? 'Approve the selected scenarios (none selected)' : `Approve the selected scenarios: ${ids.join(', ')}`}
      >
        {busy ? 'Approving…' : `Approve selected (${ids.length})`}
      </button>
      <OutcomeMessage
        outcome={outcome}
        okText={outcome?.kind === 'ok' ? `Approved ${outcome.body.approved.join(', ')}.` : ''}
        testId="approve-outcome"
      />
    </section>
  );
}
