// Box `sign-off` (S9-A1, S9-A2): the gate findings, a checkbox per story, and a Sign off
// button that works only when no finding is about the selected stories. One confirmation
// step previews what the signer agrees to, per story (T39: the content that the sign-off
// fingerprints, and what changed since the last sign-off), and who signs. The server checks the
// gate again (409 lists findings).

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Id, SignOff } from '@rehearse/core';
import type { PostOutcome, ReviewEpicView, SignOffOk, SignOffView as SignOffEntry } from '../contract.js';
import { blockingFindings, findingStories, storiesOf } from '../model/review.js';
import { FindingList, OutcomeMessage, SigBadge, SignerInfo, signingBlocked, type SessionState } from './Review.js';
import { SignOffPreview } from './SignOffPreview.js';

export interface SignOffViewProps {
  view: ReviewEpicView;
  session: SessionState;
  busy: boolean;
  outcome?: PostOutcome<SignOffOk>;
  onSignOff: (storyIds: Id[]) => void;
  /** Open a box of the preview in the box drawer. */
  onOpenBox?: (path: string) => void;
}

export function SignOffView({ view, session, busy, outcome, onSignOff, onOpenBox }: SignOffViewProps) {
  const [selected, setSelected] = useState<ReadonlySet<Id>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const signButtonRef = useRef<HTMLButtonElement>(null);
  // Focus moves into the confirmation, and back to Sign off when it closes.
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (wasConfirming.current) signButtonRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
  useEffect(() => {
    if (outcome?.kind === 'ok') setSelected(new Set());
  }, [outcome]);

  const stories = storiesOf(view.prd);
  const gate = view.gate;
  const findings = gate?.findings ?? [];
  const blocking = useMemo(() => blockingFindings(view, findings, selected), [view, findings, selected]);
  const storyStatus = (id: Id) => view.readiness?.requirements.flatMap((r) => r.stories).find((s) => s.id === id)?.status ?? stories.find((s) => s.id === id)?.status ?? 'draft';
  const findingCount = (id: Id) => findings.filter((f) => findingStories(view, f).includes(id)).length;

  const blockedBy = signingBlocked(session);
  const ids = stories.map((s) => s.id).filter((id) => selected.has(id));
  const why =
    !gate ? 'the server sent no gate report'
    : ids.length === 0 ? 'select at least one story'
    : blocking.length > 0 ? `${blocking.length} gate finding${blocking.length === 1 ? '' : 's'} for the selected stories`
    : blockedBy ? 'signing is not available'
    : busy ? 'a request is running'
    : undefined;
  const identity = session.kind === 'ready' ? session.session : undefined;

  const toggle = (id: Id) =>
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="page" data-testid="signoff-view">
      <h2>Sign-off</h2>
      <SignerInfo state={session} testId="signoff-signer" />

      <h3>Gate findings</h3>
      {!gate ? (
        <p className="muted" data-testid="signoff-gate-findings">The server sent no gate report.</p>
      ) : (
        <FindingList findings={findings} testId="signoff-gate-findings" />
      )}

      <fieldset className="story-picker" data-testid="signoff-stories">
        <legend>Stories to sign off</legend>
        {stories.map((s) => {
          const n = findingCount(s.id);
          return (
            <label key={s.id} className="story-option">
              <input type="checkbox" data-testid={`signoff-story-${s.id}`} checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
              <strong>{s.id}</strong> <span>{s.want}</span> <span className="muted small">status: {storyStatus(s.id)}</span>{' '}
              <span className={n ? 'warn small' : 'ok small'} data-testid={`signoff-story-findings-${s.id}`}>
                {n === 0 ? 'no findings' : `${n} finding${n === 1 ? '' : 's'}`}
              </span>
            </label>
          );
        })}
      </fieldset>

      {ids.length > 0 && blocking.length > 0 && (
        <div data-testid="signoff-blocking">
          <p className="warn">These findings block a sign-off of {ids.join(', ')}:</p>
          <FindingList findings={blocking} testId="signoff-blocking-list" />
        </div>
      )}

      <button
        ref={signButtonRef}
        type="button"
        className="action primary"
        data-testid="signoff-button"
        disabled={why !== undefined || confirming}
        aria-describedby="signoff-why"
        onClick={() => setConfirming(true)}
      >
        Sign off
      </button>
      <span id="signoff-why" className="muted small" data-testid="signoff-why">
        {why ? ` Not available: ${why}.` : ` Ready to sign off ${ids.join(', ')}.`}
      </span>

      {confirming && (
        <div className="confirm signoff-confirm" role="dialog" aria-labelledby="signoff-confirm-title" data-testid="signoff-confirm-dialog">
          <h3 id="signoff-confirm-title">Confirm the sign-off</h3>
          <p className="muted small">
            Stories:{' '}
            <span data-testid="signoff-confirm-stories">{ids.join(', ')}</span>
          </p>
          <div className="signoff-confirm-scroll">
            <SignOffPreview view={view} storyIds={ids} me={identity?.identity.by} onOpenBox={onOpenBox} />
          </div>
          <p data-testid="signoff-confirm-identity">
            Signed by <strong>{identity?.identity.by}</strong>
            {identity?.signing.ok && (
              <>
                {' '}with key <code>{identity.signing.keyFingerprint}</code>
              </>
            )}
          </p>
          <button
            ref={confirmRef}
            type="button"
            className="action primary"
            data-testid="signoff-confirm"
            onClick={() => {
              setConfirming(false);
              onSignOff(ids);
            }}
          >
            I agree — sign off {ids.join(', ')}
          </button>{' '}
          <button
            type="button"
            className="action"
            data-testid="signoff-cancel"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </div>
      )}

      <OutcomeMessage
        outcome={outcome}
        okText={outcome?.kind === 'ok' ? `Signed off ${Object.keys(outcome.body.signOff.storyHashes ?? {}).join(', ')}.` : ''}
        testId="signoff-outcome"
      />

      <h3>Sign-offs</h3>
      <SignOffHistory view={view} />
    </section>
  );
}

function SignOffHistory({ view }: { view: ReviewEpicView }) {
  const list: (SignOff & Partial<Pick<SignOffEntry, 'signer' | 'sigStatus'>>)[] = view.signOffs ?? view.signoff?.signOffs ?? [];
  if (list.length === 0) return <p className="muted" data-testid="signoff-history">No sign-offs yet.</p>;
  return (
    <ol className="history" data-testid="signoff-history">
      {list.map((s, i) => (
        <li key={i} data-testid={`signoff-entry-${i}`}>
          <span>
            {s.by} at {s.at}
            {s.kind ? ` (${s.kind})` : ''}: {Object.keys(s.storyHashes ?? {}).join(', ')}
          </span>{' '}
          {s.sigStatus && <SigBadge status={s.sigStatus} signer={s.signer} testId={`signoff-sig-${i}`} />}
        </li>
      ))}
    </ol>
  );
}
