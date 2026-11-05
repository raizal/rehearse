// The stories view (S6-A1, S4-A5): on the left the review queue, grouped by story, with progress
// and "next"; on the right the story view (WHAT, HOW, OUTPUT) of the selected story, then its
// scenarios, each as a storyboard card (one open at a time): story, criterion,
// path map, one panel per step, the end state, and Approve. Approve is on only after every
// step panel was seen (scrolled into view, focused or stepped through). What was seen lives in
// the browser only and is never sent.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Id } from '@rehearse/core';
import type { ScenarioView } from '../api.js';
import type { ApproveOk, PostOutcome, ReviewEpicView } from '../contract.js';
import { laneColor, roleName } from '../model/diagram.js';
import { stepCount, stepView } from '../model/playback.js';
import { seenSteps, allSeen as isAllSeen, type SeenState } from '../model/seen.js';
import { approvalState, criterionFor, nextToApprove, pathMap, progress, reviewQueue, type ApprovalKind } from '../model/storyboard.js';
import { ApproveBar } from './Approve.js';
import { PathMap } from './PathMap.js';
import { StoryView, type StoryTab } from './StoryView.js';
import type { ApproveControls } from './Playback.js';
import type { SessionState } from './Review.js';
import { KeyValues } from './Values.js';

const MARK: Record<ApprovalKind, string> = { signed: '✓', draft: '○', stale: '!', missing: '!', invalid: '!', 'unknown-signer': '!', unchecked: '?' };
const MARK_CLASS: Record<ApprovalKind, string> = {
  signed: 'status-approved',
  draft: 'status-draft',
  unchecked: 'status-draft',
  stale: 'status-stale',
  missing: 'status-stale',
  invalid: 'status-stale',
  'unknown-signer': 'status-stale',
};

export interface StoryboardProps {
  view: ReviewEpicView;
  session: SessionState;
  scenarioId: Id | undefined;
  onPick: (id: Id) => void;
  seen: SeenState;
  onSeen: (sv: ScenarioView, index: number) => void;
  approve: ApproveControls;
  /** Add these scenarios to the selection. */
  onSelectMany: (ids: Id[]) => void;
  busy: boolean;
  outcome?: PostOutcome<ApproveOk>;
  onOpenFlow: (id: Id) => void;
  /** The story to show; default: the story of the open scenario. */
  storyId?: Id;
  onPickStory?: (id: Id) => void;
  /** Open a box in the flow view. */
  onOpenBox?: (path: string) => void;
}

export function Storyboard(props: StoryboardProps) {
  const { view, scenarioId, seen } = props;
  const groups = useMemo(() => reviewQueue(view.prd, view.scenarios), [view]);
  const [storyTab, setStoryTab] = useState<StoryTab>('overview');
  const active = view.scenarios.find((s) => s.scenario.id === scenarioId);
  const storyId = props.storyId ?? active?.scenario.story;
  const ofStory = view.scenarios.filter((sv) => storyId !== undefined && sv.scenario.story === storyId);
  const card = (sv: ScenarioView) => (
    <StoryCard key={`${sv.scenario.id} ${sv.hash}`} view={view} sv={sv} seen={seen} onSeen={props.onSeen} approve={props.approve} onOpenFlow={props.onOpenFlow} />
  );
  return (
    <main className="storyboard" data-testid="storyboard">
      <aside className="left">
        <ApproveBar
          session={props.session}
          selected={props.approve.selected}
          disabled={props.approve.disabled}
          busy={props.busy}
          outcome={props.outcome}
          onApprove={props.approve.onApprove}
        />
        <ReviewQueue {...props} storyId={storyId} groups={groups} />
      </aside>
      <div className="card-wrap">
        {storyId !== undefined && <StoryView view={view} storyId={storyId} onOpenBox={props.onOpenBox ?? (() => undefined)} tab={storyTab} onTab={setStoryTab} />}
        {storyId !== undefined && storyTab === 'overview' && (
          <section className="story-scenarios" data-testid="story-scenarios" aria-labelledby="story-scenarios-h">
            <h3 id="story-scenarios-h">
              Scenarios of {storyId} ({ofStory.length})
            </h3>
            {ofStory.length === 0 && <p className="muted">This story has no scenarios.</p>}
            <ul className="story-scenario-list">
              {ofStory.map((sv) => {
                const id = sv.scenario.id;
                if (id === active?.scenario.id) return <li key={id}>{card(sv)}</li>;
                const state = approvalState(sv, props.approve.approvals);
                return (
                  <li key={id}>
                    <button type="button" className="scenario story-scenario" data-testid={`story-scenario-${id}`} aria-label={`Open the card of ${id}: ${sv.scenario.title} (${state.text})`} onClick={() => props.onPick(id)}>
                      <span className="scenario-head">
                        <span className="scenario-id">{id}</span>
                        <span className={`badge ${MARK_CLASS[state.kind]}`}>
                          <span aria-hidden="true">{MARK[state.kind]} </span>
                          {state.text}
                        </span>
                      </span>
                      <span className="scenario-title">{sv.scenario.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {storyId !== undefined ? null : active ? (
          card(active)
        ) : (
          <p className="muted status-msg" data-testid="card-empty">
            {view.scenarios.length === 0 ? 'This EPIC has no scenarios.' : 'Pick a scenario in the review queue.'}
          </p>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- review queue

function ReviewQueue({ view, scenarioId, onPick, seen, approve, onSelectMany, groups, storyId, onPickStory }: StoryboardProps & { groups: ReturnType<typeof reviewQueue> }) {
  const order = groups.flatMap((g) => g.scenarios);
  const { done, total } = progress(view.scenarios, approve.approvals);
  const next = nextToApprove(order, scenarioId, approve.approvals);
  const items = useRef(new Map<Id, HTMLButtonElement>());
  const canSelect = (sv: ScenarioView) => !approve.disabled && approve.reasonFor(sv) !== undefined && isAllSeen(seen, sv);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const at = order.findIndex((sv) => items.current.get(sv.scenario.id) === e.target);
    if (at < 0) return;
    const to = order[at + (e.key === 'ArrowDown' ? 1 : -1)];
    if (!to) return;
    e.preventDefault();
    onPick(to.scenario.id);
    items.current.get(to.scenario.id)?.focus();
  };

  return (
    <nav className="queue" data-testid="queue" aria-label="Review queue">
      <h2>Review queue</h2>
      <p className="queue-progress" data-testid="queue-progress" role="status">
        <strong>
          {done} / {total}
        </strong>{' '}
        approved with a valid signature
      </p>
      <progress max={Math.max(1, total)} value={done} aria-hidden="true" className="queue-bar" />
      <button type="button" className="action primary" data-testid="queue-next" disabled={next === undefined} onClick={() => next && onPick(next)}>
        {next === undefined ? 'Nothing left to approve' : `Next to approve: ${next}`}
      </button>
      <div onKeyDown={onKeyDown}>
        {groups.map((g) => {
          const selectable = g.scenarios.filter(canSelect).map((sv) => sv.scenario.id);
          const toAdd = selectable.filter((id) => !approve.selected.has(id));
          return (
            <section key={g.storyId} className="queue-group" data-testid={`queue-group-${g.storyId}`} aria-labelledby={`queue-h-${g.storyId}`}>
              <div className="queue-group-head">
                <h3 id={`queue-h-${g.storyId}`}>
                  <button
                    type="button"
                    className={g.storyId === storyId ? 'queue-story is-active' : 'queue-story'}
                    data-testid={`queue-story-${g.storyId}`}
                    aria-current={g.storyId === storyId ? 'true' : undefined}
                    aria-label={`Open story ${g.storyId}${g.story ? `: ${g.story.want}` : ''}`}
                    onClick={() => onPickStory?.(g.storyId)}
                  >
                    {g.storyId}
                    {g.story && <span className="queue-want">{g.story.want}</span>}
                  </button>
                </h3>
                {g.scenarios.some((sv) => approve.reasonFor(sv) !== undefined) && (
                  <button
                    type="button"
                    className="link small"
                    data-testid={`queue-select-seen-${g.storyId}`}
                    disabled={toAdd.length === 0}
                    aria-label={`Select every scenario of ${g.storyId} that was seen in full (${toAdd.length})`}
                    onClick={() => onSelectMany(toAdd)}
                  >
                    Select seen ({toAdd.length})
                  </button>
                )}
              </div>
              <ul className="queue-list">
                {g.scenarios.map((sv) => {
                  const id = sv.scenario.id;
                  const state = approvalState(sv, approve.approvals);
                  const reason = approve.reasonFor(sv);
                  const steps = stepCount(sv.scenario);
                  const seenN = seenSteps(seen, sv).size;
                  return (
                    <li key={id} className="queue-item">
                      <button
                        type="button"
                        ref={(el) => {
                          if (el) items.current.set(id, el);
                          else items.current.delete(id);
                        }}
                        className={id === scenarioId ? 'scenario is-active' : 'scenario'}
                        data-testid={`queue-item-${id}`}
                        aria-current={id === scenarioId ? 'true' : undefined}
                        onClick={() => onPick(id)}
                      >
                        <span className="scenario-head">
                          <span className="scenario-id">{id}</span>
                          <span className={`badge ${MARK_CLASS[state.kind]}`} data-testid={`queue-status-${id}`}>
                            <span aria-hidden="true">{MARK[state.kind]} </span>
                            {state.text}
                          </span>
                        </span>
                        <span className="scenario-title">{sv.scenario.title}</span>
                        {reason !== undefined && (
                          <span className="small muted" data-testid={`queue-seen-${id}`}>
                            {seenN} of {steps} steps seen
                          </span>
                        )}
                      </button>
                      {reason !== undefined && (
                        <label className="select small">
                          <input
                            type="checkbox"
                            data-testid={`queue-select-${id}`}
                            aria-label={`Select ${id} to approve`}
                            checked={approve.selected.has(id)}
                            disabled={!canSelect(sv)}
                            onChange={() => approve.onToggle(id)}
                          />
                          select to approve
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------- the card

interface StoryCardProps {
  view: ReviewEpicView;
  sv: ScenarioView;
  seen: SeenState;
  onSeen: (sv: ScenarioView, index: number) => void;
  approve: ApproveControls;
  onOpenFlow: (id: Id) => void;
}

export function StoryCard({ view, sv, seen, onSeen, approve, onOpenFlow }: StoryCardProps) {
  const { scenario } = sv;
  const { flow, prd } = view;
  const id = scenario.id;
  const total = stepCount(scenario);
  const seenSet = seenSteps(seen, sv);
  const allSeen = isAllSeen(seen, sv);
  const { story, criterion } = criterionFor(prd, scenario);
  const maps = useMemo(() => pathMap(flow, scenario), [flow, scenario]);
  const state = approvalState(sv, approve.approvals);
  const reason = approve.reasonFor(sv);
  const [cur, setCur] = useState(-1);
  const panels = useRef<(HTMLLIElement | null)[]>([]);
  const markRef = useRef((i: number) => onSeen(sv, i));
  markRef.current = (i: number) => onSeen(sv, i);

  // A panel counts as seen when at least half of it, or half of the viewport, shows it.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const half = Math.min(e.boundingClientRect.height, e.rootBounds?.height ?? Infinity) / 2;
          if (e.isIntersecting && e.intersectionRect.height >= half) markRef.current(Number((e.target as HTMLElement).dataset.step));
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const p of panels.current) if (p) io.observe(p);
    return () => io.disconnect();
  }, [total]);

  const goTo = (i: number) => {
    const el = panels.current[i];
    if (!el) return;
    el.focus();
    el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  };
  const onPanelKey = (i: number) => (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'ArrowDown' && i + 1 < total) {
      e.preventDefault();
      goTo(i + 1);
    }
    if (e.key === 'ArrowUp' && i > 0) {
      e.preventDefault();
      goTo(i - 1);
    }
  };
  const nextStep = cur + 1 < total ? cur + 1 : 0;

  return (
    <article className="story-card" data-testid="story-card" aria-labelledby="card-title">
      <header className="card-head">
        <h2 id="card-title">
          <code>{id}</code> {scenario.title}
        </h2>
        <button type="button" className="action" data-testid="card-open-flow" aria-label={`Open ${id} in the flow view, in playback`} onClick={() => onOpenFlow(id)}>
          Open in flow
        </button>
      </header>

      <section className="card-section" data-testid="card-story" aria-label="Story">
        <h3>Story {story?.id ?? scenario.story}</h3>
        {story ? (
          <p className="story-text">
            As <strong data-testid="card-role">{roleName(prd, story.role)}</strong>, I want <strong>{story.want}</strong>, so that {story.soThat}.
          </p>
        ) : (
          <p className="warn">No story {scenario.story} in prd.yaml.</p>
        )}
      </section>

      <section className="card-section" data-testid="card-criterion" aria-label="Acceptance criterion">
        <h3>Criterion {scenario.expect?.criterion ?? ''}</h3>
        {criterion ? (
          <dl className="gwt">
            <dt>Given</dt>
            <dd>{criterion.given}</dd>
            <dt>When</dt>
            <dd>{criterion.when}</dd>
            <dt>Then</dt>
            <dd>{criterion.then}</dd>
          </dl>
        ) : (
          <p className="muted">
            {scenario.expect?.criterion ? `No criterion ${scenario.expect.criterion} in story ${scenario.story}.` : 'The scenario names no criterion (expect.criterion).'}
          </p>
        )}
      </section>

      <section className="card-section" aria-label="Path map">
        <h3>Path map</h3>
        <PathMap flow={flow} prd={prd} maps={maps} testId="card-map" />
      </section>

      <section className="card-section" aria-label="Steps">
        <div className="steps-head">
          <h3>Steps</h3>
          <span className="small" data-testid="card-seen" role="status">
            {seenSet.size} of {total} steps seen
          </span>
          {total > 0 && (
            <button type="button" className="action" data-testid="card-next-step" onClick={() => goTo(nextStep)}>
              {cur < 0 ? 'Step through: step 1' : `Next step: ${nextStep + 1} of ${total}`}
            </button>
          )}
        </div>
        {total === 0 && <p className="warn">The scenario has no steps.</p>}
        <ol className="card-steps">
          {Array.from({ length: total }, (_, i) => (
            <StepPanel
              key={i}
              view={view}
              sv={sv}
              index={i}
              seen={seenSet.has(i)}
              current={i === cur}
              refFn={(el) => {
                panels.current[i] = el;
              }}
              onFocus={() => {
                setCur(i);
                markRef.current(i);
              }}
              onKeyDown={onPanelKey(i)}
            />
          ))}
        </ol>
      </section>

      <section className="card-section card-result" data-testid="card-result" aria-label="Result">
        <h3>Result</h3>
        <p className="small">
          <span aria-hidden="true">⚑ </span>
          End state for criterion <strong>{scenario.expect?.criterion ?? '(none)'}</strong>
        </p>
        <KeyValues values={scenario.expect?.state} testId="card-result-state" empty="No end state (expect.state)." />
      </section>

      <section className="card-section card-approve" aria-label="Approve">
        <p data-testid="card-approval-state">
          Approval: <span className={`badge ${MARK_CLASS[state.kind]}`}>{state.text}</span>
        </p>
        {reason !== undefined && (
          <>
            <button
              type="button"
              className="action primary"
              data-testid="card-approve"
              disabled={approve.disabled || !allSeen}
              aria-label={allSeen ? `Approve ${id} (${reason})` : `Approve ${id} (see every step first)`}
              onClick={() => approve.onApprove([id])}
            >
              Approve {id}
            </button>
            {!allSeen && (
              <p className="small muted" data-testid="card-approve-why">
                See every step first: {seenSet.size} of {total} seen. Scroll through the steps or use “Step through”.
              </p>
            )}
          </>
        )}
      </section>
    </article>
  );
}

interface StepPanelProps {
  view: ReviewEpicView;
  sv: ScenarioView;
  index: number;
  seen: boolean;
  current: boolean;
  refFn: (el: HTMLLIElement | null) => void;
  onFocus: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLLIElement>) => void;
}

function StepPanel({ view, sv, index, seen, current, refFn, onFocus, onKeyDown }: StepPanelProps) {
  const total = stepCount(sv.scenario);
  const step = stepView(view.flow, sv.scenario, index);
  const n = index + 1;
  const box = step?.box;
  const color = laneColor(view.flow, box?.lane);
  const example = step && (step.exampleId !== undefined || step.input !== undefined || step.output !== undefined || step.stateAfter !== undefined);
  return (
    <li
      ref={refFn}
      tabIndex={0}
      data-step={index}
      data-testid={`card-step-${n}`}
      className={`step-panel${current ? ' is-current' : ''}${seen ? ' is-seen' : ''}`}
      style={{ borderLeftColor: color }}
      aria-label={`Step ${n} of ${total}: ${box?.title ?? step?.path ?? ''}${seen ? ', seen' : ''}`}
      onFocus={(e) => e.target === e.currentTarget && onFocus()}
      onKeyDown={onKeyDown}
    >
      <div className="step-panel-head">
        <span className="step-badge" style={{ background: color }}>
          {n}
        </span>
        <strong data-testid={`card-step-title-${n}`}>{box?.title ?? `No box at ${step?.path ?? '?'}`}</strong>
        <code className="muted">{step?.path}</code>
        <span className="small muted">{seen ? 'seen' : 'not seen yet'}</span>
      </div>
      <div className="step-panel-meta small">
        <span data-testid={`card-step-lane-${n}`}>
          <span className="swatch" style={{ background: color }} aria-hidden="true" /> lane: {roleName(view.prd, box?.lane)}
        </span>
        {step?.branch !== undefined && (
          <span className="step-branch" data-testid={`card-step-branch-${n}`}>
            branch taken: <strong>{step.branch}</strong>
          </span>
        )}
      </div>
      <div className="step-example" data-testid={`card-step-example-${n}`}>
        {step && example ? (
          <>
            <div>
              <div className="sub">Given{step.exampleId ? ` (example ${step.exampleId})` : ''}</div>
              <KeyValues values={step.input} />
            </div>
            <span className="arrow" aria-label="then">
              →
            </span>
            <div>
              <div className="sub">Then</div>
              <KeyValues values={step.output} />
              {step.stateAfter && (
                <>
                  <div className="sub">State after</div>
                  <KeyValues values={step.stateAfter} />
                </>
              )}
            </div>
          </>
        ) : (
          <p className="muted">no example: passes through</p>
        )}
      </div>
      {box && (
        <dl className="step-contract small muted" data-testid={`card-step-contract-${n}`}>
          <dt>inputs</dt>
          <dd>{fields(box.inputs)}</dd>
          <dt>outputs</dt>
          <dd>{fields(box.outputs)}</dd>
          <dt>writes</dt>
          <dd>{box.writes?.length ? box.writes.join(', ') : '—'}</dd>
        </dl>
      )}
    </li>
  );
}

function fields(values: Record<string, string> | undefined): string {
  const entries = values && typeof values === 'object' ? Object.entries(values) : [];
  return entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join(', ') : '—';
}
