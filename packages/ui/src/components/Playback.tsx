// Scenario picker with status badges, step controls (S5-A1), and the step detail.
// With `approve`, each scenario that needs it gets an Approve button and a checkbox (S6-A1).

import type { Id } from '@rehearse/core';
import type { ScenarioView } from '../api.js';
import type { ApprovalView } from '../contract.js';
import type { StepView } from '../model/playback.js';
import { ApprovalSig } from './Review.js';
import { KeyValues, Tags } from './Values.js';

export function StatusBadge({ status, id }: { status: string; id: string }) {
  return (
    <span className={`badge status-${status}`} data-testid={`scenario-status-${id}`} title={status === 'stale' ? 'Approved content changed since approval, or marked stale' : status}>
      {status}
    </span>
  );
}

export interface PlaybackProps {
  scenarios: ScenarioView[];
  scenarioId?: string;
  step: number;
  onPick: (id: string | undefined) => void;
  onStep: (index: number) => void;
  approve?: ApproveControls;
}

/** Approve controls on the scenario list and in playback (S6-A1). */
export interface ApproveControls {
  /** Why the scenario can be approved (draft, stale, bad signature), or undefined. */
  reasonFor: (sv: ScenarioView) => string | undefined;
  approvals?: Record<Id, ApprovalView>;
  selected: ReadonlySet<Id>;
  onToggle: (id: Id) => void;
  onApprove: (ids: Id[]) => void;
  /** Signing is off, or a request is running. */
  disabled: boolean;
  /** Every step of the scenario was seen (storyboard or playback). Approve is off until then (S6-A1). */
  isSeen?: (sv: ScenarioView) => boolean;
}

export function Playback({ scenarios, scenarioId, step, onPick, onStep, approve }: PlaybackProps) {
  const active = scenarios.find((s) => s.scenario.id === scenarioId);
  const steps = active && Array.isArray(active.scenario.steps) ? active.scenario.steps : [];
  const activeReason = active && approve?.reasonFor(active);
  const activeUnseen = active && approve?.isSeen ? !approve.isSeen(active) : false;
  return (
    <section className="playback" data-testid="playback">
      <h2>Scenarios</h2>
      <ul className="scenario-list" data-testid="scenario-list">
        {scenarios.map((sv) => {
          const { scenario, status } = sv;
          const reason = approve?.reasonFor(sv);
          const unseen = approve?.isSeen ? !approve.isSeen(sv) : false;
          return (
          <li key={scenario.id} className="scenario-item">
            <button
              type="button"
              className={scenario.id === scenarioId ? 'scenario is-active' : 'scenario'}
              data-testid={`scenario-${scenario.id}`}
              aria-pressed={scenario.id === scenarioId}
              onClick={() => onPick(scenario.id === scenarioId ? undefined : scenario.id)}
            >
              <span className="scenario-head">
                <span className="scenario-id">{scenario.id}</span>
                <StatusBadge status={status} id={scenario.id} />
              </span>
              <span className="scenario-title">{scenario.title}</span>
            </button>
            {approve && (approve.approvals?.[scenario.id] || reason) && (
              <div className="scenario-review">
                <ApprovalSig id={scenario.id} approval={approve.approvals?.[scenario.id]} />
                {reason && (
                  <>
                    <label className="select">
                      <input
                        type="checkbox"
                        data-testid={`select-${scenario.id}`}
                        checked={approve.selected.has(scenario.id)}
                        disabled={approve.disabled || unseen}
                        onChange={() => approve.onToggle(scenario.id)}
                      />
                      <span className="sr-only">Select {scenario.id} to approve</span>
                    </label>
                    <button
                      type="button"
                      className="action"
                      data-testid={`approve-${scenario.id}`}
                      aria-label={`Approve ${scenario.id} (${unseen ? 'see every step first' : reason})`}
                      disabled={approve.disabled || unseen}
                      onClick={() => approve.onApprove([scenario.id])}
                    >
                      Approve
                    </button>
                    <span className="muted small" data-testid={`approve-reason-${scenario.id}`}>
                      {reason}
                      {unseen && ', see every step first'}
                    </span>
                  </>
                )}
              </div>
            )}
          </li>
          );
        })}
        {scenarios.length === 0 && <li className="muted">No scenarios.</li>}
      </ul>

      {active && (
        <div className="player" data-testid="player">
          <div className="controls">
            <button type="button" data-testid="playback-prev" disabled={step <= 0} onClick={() => onStep(step - 1)} aria-label="Previous step">
              ◀ Prev
            </button>
            <span className="step-count" data-testid="playback-step">
              Step {step + 1} of {steps.length}
            </span>
            <button type="button" data-testid="playback-next" disabled={step >= steps.length - 1} onClick={() => onStep(step + 1)} aria-label="Next step">
              Next ▶
            </button>
          </div>
          <ol className="steps" data-testid="playback-steps">
            {steps.map((s, i) => (
              <li key={i}>
                <button type="button" className={i === step ? 'is-current' : ''} data-testid={`playback-step-${i + 1}`} aria-current={i === step ? 'step' : undefined} onClick={() => onStep(i)}>
                  <span className="step-n">{i + 1}</span>
                  <span className="step-name">{s.name}</span>
                  {s.branch !== undefined && <span className="step-branch">→ {s.branch}</span>}
                </button>
              </li>
            ))}
          </ol>
          {approve && activeReason && (
            <button
              type="button"
              className="action"
              data-testid="playback-approve"
              aria-label={`Approve ${active.scenario.id} (${activeUnseen ? 'step through every step first' : activeReason})`}
              disabled={approve.disabled || activeUnseen}
              onClick={() => approve.onApprove([active.scenario.id])}
            >
              Approve this scenario
            </button>
          )}
          <button type="button" className="link" data-testid="playback-stop" onClick={() => onPick(undefined)}>
            Stop playback
          </button>
        </div>
      )}
    </section>
  );
}

export function StepDetail({ view, total }: { view: StepView; total: number }) {
  return (
    <div className="step-detail" data-testid="step-detail">
      <div className="step-detail-head">
        Step {view.index + 1} of {total}: <code data-testid="step-path">{view.path}</code>
        {view.branch !== undefined && <span className="pill">branch: {view.branch}</span>}
        {view.exampleId && <span className="pill">example: {view.exampleId}</span>}
      </div>
      {!view.box && <p className="warn">No box at {view.path} in flow.yaml.</p>}
      <h4>Input</h4>
      <KeyValues values={view.input} testId="step-input" empty={view.box?.inputs ? 'No example. Contract inputs below.' : '—'} />
      <h4>Output</h4>
      <KeyValues values={view.output} testId="step-output" empty={view.box?.outputs ? 'No example. Contract outputs below.' : '—'} />
      <h4>State change</h4>
      <div data-testid="step-state">
        {view.stateAfter && <KeyValues values={view.stateAfter} testId="step-state-after" />}
        <Tags items={view.writes} testId="step-writes" kind="writes" />
        {view.expect && (
          <>
            <div className="sub">Expected end state</div>
            <KeyValues values={view.expect} testId="step-expect" />
          </>
        )}
      </div>
    </div>
  );
}
