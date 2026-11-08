// The approve bar above the scenario list: who signs, "approve the selected ones", and the last result (S6-A1, D41).

import type { Id } from '@rehearse/core';
import type { ScenarioView } from '../api.js';
import type { ApprovalView, ApproveOk, PostOutcome } from '../contract.js';
import { OutcomeMessage, SignerInfo, type SessionState } from './Review.js';

/** The ids of the scenarios that an approval that succeeded approved. */
export function approvedIds(ok: ApproveOk): Id[] {
  return ok.approved.map((a) => a.id);
}

/** Approve controls on the storyboard (S6-A1). */
export interface ApproveControls {
  /** Why the scenario can be approved (draft, stale, bad signature), or undefined. */
  reasonFor: (sv: ScenarioView) => string | undefined;
  approvals?: Record<Id, ApprovalView>;
  selected: ReadonlySet<Id>;
  onToggle: (id: Id) => void;
  onApprove: (ids: Id[]) => void;
  /** Signing is off, or a request is running. */
  disabled: boolean;
  /** Every step of the scenario was seen on the storyboard. Approve is off until then (S6-A1). */
  isSeen?: (sv: ScenarioView) => boolean;
}

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
        okText={outcome?.kind === 'ok' ? `Approved ${approvedIds(outcome.body).join(', ')}.` : ''}
        testId="approve-outcome"
      />
    </section>
  );
}
