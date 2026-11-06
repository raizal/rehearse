// The stories view (S6-A1, S4-A5), as design pages 2, 3 and 12–15 draw it.
// The story page (page 2): on the left the review queue, one compact row per story; on the
// right the story (WHAT, HOW, OUTPUT) and its scenarios as cards, each with its status, a
// "select to approve" box and "Open storyboard". The other tabs of the story (Before / after,
// Code, Tests) put the story header card on top, with no queue; Code and Tests have the story
// thread rail. The storyboard of one scenario (page 3) is a page of its own: one card per step,
// left to right, the expected end state and Approve. Approve is on only after every step card
// was seen (scrolled into view, focused or stepped through). What was seen lives in the browser
// only and is never sent.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Id } from '@rehearse/core';
import type { ScenarioView } from '../api.js';
import type { ApproveOk, PostOutcome, ReviewEpicView } from '../contract.js';
import { laneColor, roleName } from '../model/diagram.js';
import { stepCount, stepView } from '../model/playback.js';
import { seenSteps, allSeen as isAllSeen, type SeenState } from '../model/seen.js';
import { contextLabel } from '../model/storythread.js';
import { approvalState, criterionFor, nextToApprove, pathMap, progress, reviewQueue, type ApprovalKind } from '../model/storyboard.js';
import { queueRows, scenarioSummary, stepTitle, storyColor } from '../model/storypage.js';
import { ApproveBar } from './Approve.js';
import { PathMap } from './PathMap.js';
import { StoryThread } from './StoryThread.js';
import { BackButton, CrumbStart, isStoryPage, StoryView, type BackControl, type StoryTab } from './StoryView.js';
import type { ApproveControls } from './Playback.js';
import { OutcomeMessage, SignerInfo, type SessionState } from './Review.js';
import { KeyValues, show } from './Values.js';

const MARK: Record<ApprovalKind, string> = { signed: '✓', draft: '○', stale: '!', missing: '!', invalid: '!', 'unknown-signer': '!', unchecked: '?' };
const MARK_CLASS: Record<ApprovalKind, string> = {
  signed: 'status-approved',
  draft: 'status-draft',
  unchecked: 'status-draft',
  stale: 'status-stale',
  missing: 'status-unsigned',
  invalid: 'status-stale',
  'unknown-signer': 'status-stale',
};

export interface StoryboardProps {
  view: ReviewEpicView;
  session: SessionState;
  scenarioId: Id | undefined;
  /** Open the storyboard of a scenario. */
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
  /** Show the storyboard page of the open scenario (design page 3) instead of its story. */
  board?: boolean;
  /** Leave the storyboard page for the story page. */
  onBack?: () => void;
  /** The breadcrumb's "Big picture". */
  onBigPicture?: () => void;
  /** The breadcrumb's "Stories": the story list. */
  onStories?: () => void;
  /** Open a story's page on WHAT (a story crumb, or a story named on another story's page). */
  onOpenStory?: (id: Id) => void;
  /** Show the story list (one row per story) instead of a story. */
  list?: boolean;
  /** The open tab of the story, when the parent keeps it. */
  storyTab?: StoryTab;
  onStoryTab?: (tab: StoryTab) => void;
  /** The in-app "← Back" button. */
  back?: BackControl;
}

export function Storyboard(props: StoryboardProps) {
  const { view, scenarioId, seen } = props;
  const [ownTab, setOwnTab] = useState<StoryTab>('what');
  const storyTab = props.storyTab ?? ownTab;
  const setStoryTab = props.onStoryTab ?? setOwnTab;
  const active = view.scenarios.find((s) => s.scenario.id === scenarioId);
  const storyId = props.storyId ?? active?.scenario.story;

  if (props.list) return <StoryList {...props} />;

  if (props.board && active) {
    return (
      <main className="storyboard is-board" data-testid="storyboard">
        <div className="board-wrap">
          <StoryCard
            key={`${active.scenario.id} ${active.hash}`}
            view={view}
            sv={active}
            seen={seen}
            onSeen={props.onSeen}
            approve={props.approve}
            onOpenFlow={props.onOpenFlow}
            session={props.session}
            outcome={props.outcome}
            onBack={props.onBack}
            onBigPicture={props.onBigPicture}
            onStories={props.onStories}
            back={props.back}
          />
        </div>
      </main>
    );
  }

  const page = isStoryPage(storyTab);
  const rail = storyId !== undefined && (storyTab === 'code' || storyTab === 'tests');
  return (
    <main className={`storyboard${page ? ' is-page' : ' is-tab'}${rail ? ' has-rail' : ''}`} data-testid="storyboard">
      {page && (
        <aside className="left">
          <ReviewQueue {...props} storyId={storyId} />
        </aside>
      )}
      <div className="card-wrap">
        {storyId !== undefined ? (
          <StoryView view={view} storyId={storyId} onOpenBox={props.onOpenBox ?? (() => undefined)} tab={storyTab}
            onTab={setStoryTab}
            onBigPicture={props.onBigPicture}
            onStories={props.onStories}
            onOpenStory={props.onOpenStory}
            back={props.back}
          >
            <StoryScenarios {...props} storyId={storyId} />
          </StoryView>
        ) : (
          <p className="muted status-msg" data-testid="card-empty">
            This EPIC has no stories and no scenarios.
          </p>
        )}
      </div>
      {rail && <StoryThread storyId={storyId} context={contextLabel({ tab: storyTab, detail: active?.scenario.id })} />}
    </main>
  );
}

// ---------------------------------------------------------------- the story list (the "Stories" crumb)

function StoryList({ view, onOpenStory, onPickStory, onBigPicture, back }: StoryboardProps) {
  const rows = useMemo(() => queueRows(view), [view]);
  const open = onOpenStory ?? onPickStory;
  return (
    <main className="storyboard is-list" data-testid="story-list">
      <div className="card-wrap">
        <header className="story-head">
          <nav className="crumbs" aria-label="Breadcrumb">
            <BackButton back={back} />
            {onBigPicture ? (
              <button type="button" className="crumb" data-testid="crumb-bigpicture" onClick={onBigPicture}>
                Big picture
              </button>
            ) : (
              <span className="crumb">Big picture</span>
            )}
            <span aria-hidden="true">/</span>
            <span className="crumb is-current" aria-current="page">
              Stories
            </span>
          </nav>
          <h1 className="story-title">Stories</h1>
          <p className="story-so-that">One row per story: open one to review its scenarios.</p>
        </header>
        {rows.length === 0 ? (
          <p className="muted status-msg" data-testid="card-empty">
            This EPIC has no stories and no scenarios.
          </p>
        ) : (
          <ul className="queue-rows story-list-rows" aria-label="Stories">
            {rows.map((r) => (
              <li key={r.storyId}>
                <button
                  type="button"
                  className="queue-story"
                  style={{ ['--role' as string]: r.color }}
                  data-testid={`story-list-row-${r.storyId}`}
                  aria-label={`Open story ${r.storyId}: ${r.want}; ${r.note}`}
                  onClick={() => open?.(r.storyId)}
                >
                  <span className="queue-id">{r.storyId}</span>
                  <span className="queue-want">{r.want}</span>
                  <span className="queue-note">{r.note}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- review queue (page 2, left)

function ReviewQueue({ view, scenarioId, onPick, approve, storyId, onPickStory }: StoryboardProps) {
  const rows = useMemo(() => queueRows(view), [view]);
  const order = useMemo(() => reviewQueue(view.prd, view.scenarios).flatMap((g) => g.scenarios), [view]);
  const { done, total } = progress(view.scenarios, approve.approvals);
  const next = nextToApprove(order, scenarioId, approve.approvals);
  const items = useRef(new Map<Id, HTMLButtonElement>());

  // Up and down move through the stories and open the one they reach.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const at = rows.findIndex((r) => items.current.get(r.storyId) === e.target);
    if (at < 0) return;
    const to = rows[at + (e.key === 'ArrowDown' ? 1 : -1)];
    if (!to) return;
    e.preventDefault();
    onPickStory?.(to.storyId);
    items.current.get(to.storyId)?.focus();
  };

  return (
    <nav className="queue" data-testid="queue" aria-label="Review queue">
      <h2>Review queue</h2>
      <p className="queue-sub">Stories with scenarios to approve</p>
      <ul className="queue-rows" onKeyDown={onKeyDown}>
        {rows.map((r) => {
          const on = r.storyId === storyId;
          return (
            <li key={r.storyId} data-testid={`queue-group-${r.storyId}`}>
              <button
                type="button"
                ref={(el) => {
                  if (el) items.current.set(r.storyId, el);
                  else items.current.delete(r.storyId);
                }}
                className={on ? 'queue-story is-active' : 'queue-story'}
                style={{ ['--role' as string]: r.color }}
                data-testid={`queue-story-${r.storyId}`}
                aria-current={on ? 'true' : undefined}
                aria-label={`Open story ${r.storyId}: ${r.want}; ${r.note}`}
                onClick={() => onPickStory?.(r.storyId)}
              >
                <span className="queue-id">{r.storyId}</span>
                <span className="queue-want">{r.want}</span>
                <span className="queue-note">{r.note}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="queue-foot">
        <p className="queue-progress" data-testid="queue-progress" role="status">
          <strong>
            {done} / {total}
          </strong>{' '}
          approved with a valid signature
        </p>
        <progress max={Math.max(1, total)} value={done} aria-hidden="true" className="queue-bar" />
        <button type="button" className="action" data-testid="queue-next" disabled={next === undefined} onClick={() => next && onPick(next)}>
          {next === undefined ? 'Nothing left to approve' : `Next to approve: ${next}`}
        </button>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------- scenario cards (page 2, below the story)

function StoryScenarios({ view, storyId, seen, approve, onPick, onSelectMany, session, busy, outcome }: StoryboardProps & { storyId: Id }) {
  const ofStory = view.scenarios.filter((sv) => sv.scenario.story === storyId);
  const canSelect = (sv: ScenarioView) => !approve.disabled && approve.reasonFor(sv) !== undefined && isAllSeen(seen, sv);
  const toAdd = ofStory.filter(canSelect).map((sv) => sv.scenario.id).filter((id) => !approve.selected.has(id));
  const approvable = ofStory.some((sv) => approve.reasonFor(sv) !== undefined);
  return (
    <section className="story-scenarios" data-testid="story-scenarios" aria-labelledby="story-scenarios-h">
      <div className="scenarios-head">
        <h2 id="story-scenarios-h">
          Scenarios for this story <span className="sr-only">({ofStory.length})</span>
        </h2>
        <p className="muted">Open one to watch it step by step, then approve it.</p>
        {approvable && (
          <button
            type="button"
            className="link small"
            data-testid={`story-select-seen-${storyId}`}
            disabled={toAdd.length === 0}
            aria-label={`Select every scenario of ${storyId} that was seen in full (${toAdd.length})`}
            onClick={() => onSelectMany(toAdd)}
          >
            Select seen ({toAdd.length})
          </button>
        )}
      </div>
      <ApproveBar session={session} selected={approve.selected} disabled={approve.disabled} busy={busy} outcome={outcome} onApprove={approve.onApprove} />
      {ofStory.length === 0 ? (
        <p className="muted">This story has no scenarios yet.</p>
      ) : (
        <ul className="scenario-grid">
          {ofStory.map((sv) => {
            const s = scenarioSummary(view, sv);
            const state = approvalState(sv, approve.approvals);
            const reason = approve.reasonFor(sv);
            const seenN = seenSteps(seen, sv).size;
            return (
              <li key={s.id} className="scenario-card" data-testid={`story-scenario-${s.id}`} aria-labelledby={`scn-${s.id}`} style={{ ['--role' as string]: storyColor(view, storyId) }}>
                <span className="scenario-id">{s.id}</span>
                <h3 id={`scn-${s.id}`}>{s.title}</h3>
                <p className="scenario-meta">
                  {s.steps} step{s.steps === 1 ? '' : 's'} · checks {s.criterion ?? 'no criterion'}
                  {reason !== undefined && (
                    <span data-testid={`story-scenario-seen-${s.id}`}>
                      {' '}
                      · {seenN} of {s.steps} seen
                    </span>
                  )}
                </p>
                <ol className="step-dots" aria-label={`Steps by lane: ${s.dots.map((d) => d.lane).join(', ')}`}>
                  {s.dots.map((d, i) => (
                    <li key={i} style={{ background: d.color }} title={`Step ${i + 1}: ${d.lane}`} />
                  ))}
                </ol>
                <div className="scenario-foot">
                  <span className={`badge ${MARK_CLASS[state.kind]}`} data-testid={`story-scenario-status-${s.id}`}>
                    <span aria-hidden="true">{MARK[state.kind]} </span>
                    {state.text}
                  </span>
                  {reason !== undefined && (
                    <label className="select small">
                      <input
                        type="checkbox"
                        data-testid={`story-scenario-select-${s.id}`}
                        aria-label={`Select ${s.id} to approve`}
                        checked={approve.selected.has(s.id)}
                        disabled={!canSelect(sv)}
                        onChange={() => approve.onToggle(s.id)}
                      />
                      select
                    </label>
                  )}
                  <button type="button" className="action primary" data-testid={`story-scenario-open-${s.id}`} aria-label={`Open the storyboard of ${s.id}: ${s.title} (${state.text})`} onClick={() => onPick(s.id)}>
                    Open storyboard
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- the storyboard page (page 3)

interface StoryCardProps {
  view: ReviewEpicView;
  sv: ScenarioView;
  seen: SeenState;
  onSeen: (sv: ScenarioView, index: number) => void;
  approve: ApproveControls;
  onOpenFlow: (id: Id) => void;
  session?: SessionState;
  outcome?: PostOutcome<ApproveOk>;
  onBack?: () => void;
  onBigPicture?: () => void;
  onStories?: () => void;
  back?: BackControl;
}

export function StoryCard({ view, sv, seen, onSeen, approve, onOpenFlow, session, outcome, onBack, onBigPicture, onStories, back }: StoryCardProps) {
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
  const critId = scenario.expect?.criterion;

  // A step card counts as seen when at least half of it, or half of the viewport, shows it.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const half = Math.min(e.boundingClientRect.height, e.rootBounds?.height ?? Infinity) / 2;
          const halfW = Math.min(e.boundingClientRect.width, e.rootBounds?.width ?? Infinity) / 2;
          if (e.isIntersecting && e.intersectionRect.height >= half && e.intersectionRect.width >= halfW) markRef.current(Number((e.target as HTMLElement).dataset.step));
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
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  };
  const onPanelKey = (i: number) => (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.target !== e.currentTarget) return;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && i + 1 < total) {
      e.preventDefault();
      goTo(i + 1);
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') && i > 0) {
      e.preventDefault();
      goTo(i - 1);
    }
  };
  const nextStep = cur + 1 < total ? cur + 1 : 0;

  return (
    <article className="story-card" data-testid="story-card" aria-labelledby="card-title" style={{ ['--role' as string]: laneColor(flow, story?.role) }}>
      <nav className="crumbs" aria-label="Breadcrumb">
        <CrumbStart onBigPicture={onBigPicture} onStories={onStories} back={back} />
        {onBack ? (
          <button type="button" className="crumb" data-testid="card-back" aria-label={`Back to story ${scenario.story}`} onClick={onBack}>
            {scenario.story}
          </button>
        ) : (
          <span className="crumb">{scenario.story}</span>
        )}
        <span aria-hidden="true">/</span>
        <span className="crumb is-current" aria-current="page">
          {id}
        </span>
      </nav>
      <header className="card-head">
        <div>
          <h1 id="card-title">{scenario.title}</h1>
          <p className="card-proves" data-testid="card-proves">
            {critId ? (
              <>
                Proves {critId}
                {criterion ? `: ${criterion.then}` : ''}
              </>
            ) : (
              'The scenario names no criterion (expect.criterion).'
            )}
          </p>
        </div>
        <button type="button" className="action" data-testid="card-open-flow" aria-label={`Open ${id} in the flow view, in playback`} onClick={() => onOpenFlow(id)}>
          Open in flow
        </button>
      </header>

      {total === 0 && <p className="warn">The scenario has no steps.</p>}
      <ol className="card-steps" aria-label={`Steps of ${id}`}>
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

      <div className="card-bottom">
        <section className="card-box card-result" data-testid="card-result" aria-labelledby="card-result-h">
          <h2 id="card-result-h">Expected end state</h2>
          <p className="muted small">checked against {critId ?? '(no criterion)'}</p>
          <div className="card-result-body">
            <EndState values={scenario.expect?.state} />
            <p className="muted small">The simulator checks this state at the end of the path. If it differs, simulate reports a finding.</p>
          </div>
        </section>

        <section className="card-box card-approve" aria-labelledby="card-approve-h">
          <h2 id="card-approve-h">Approve this scenario</h2>
          <p className="small">
            <span data-testid="card-seen" role="status">
              {seenSet.size} of {total} steps seen.
            </span>{' '}
            {reason !== undefined && <span className="muted">Approve turns on when you saw every step.</span>}
          </p>
          <div className="card-approve-body">
            <div className="card-approve-main">
              <progress className="seen-bar" max={Math.max(1, total)} value={seenSet.size} aria-hidden="true" />
              <div className="card-approve-actions">
                {reason !== undefined && (
                  <button
                    type="button"
                    className="action primary"
                    data-testid="card-approve"
                    disabled={approve.disabled || !allSeen}
                    aria-label={allSeen ? `Approve ${id} (${reason})` : `Approve ${id} (see every step first)`}
                    onClick={() => approve.onApprove([id])}
                  >
                    Approve
                  </button>
                )}
                {total > 0 && (
                  <button type="button" className="action" data-testid="card-next-step" aria-label={cur < 0 ? 'Step through: step 1' : `Next step: ${nextStep + 1} of ${total}`} onClick={() => goTo(nextStep)}>
                    {cur < 0 ? 'Step through →' : 'Next step →'}
                  </button>
                )}
              </div>
              <p data-testid="card-approval-state" className="small">
                Approval: <span className={`badge ${MARK_CLASS[state.kind]}`}>{state.text}</span>
              </p>
              {reason !== undefined && !allSeen && (
                <p className="small muted" data-testid="card-approve-why">
                  See every step first: {seenSet.size} of {total} seen. Scroll through the steps or use “Step through”.
                </p>
              )}
            </div>
            {session && (
              <div className="card-approve-sign small muted">
                <SignerInfo state={session} testId="approve-signer" />
                <p>The approval counts as evidence only with a valid signature.</p>
              </div>
            )}
          </div>
          {session && <OutcomeMessage outcome={outcome} okText={outcome?.kind === 'ok' ? `Approved ${outcome.body.approved.join(', ')}.` : ''} testId="approve-outcome" />}
        </section>
      </div>

      <details className="card-more">
        <summary>Story, criterion and path map</summary>
        <div className="card-more-body">
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
            <h3>Criterion {critId ?? ''}</h3>
            {criterion ? (
              <dl className="gwt-rows">
                <dt>GIVEN</dt>
                <dd>{criterion.given}</dd>
                <dt>WHEN</dt>
                <dd>{criterion.when}</dd>
                <dt>THEN</dt>
                <dd>{criterion.then}</dd>
              </dl>
            ) : (
              <p className="muted">{critId ? `No criterion ${critId} in story ${scenario.story}.` : 'The scenario names no criterion (expect.criterion).'}</p>
            )}
          </section>
          <section className="card-section" aria-label="Path map">
            <h3>Path map</h3>
            <PathMap flow={flow} prd={prd} maps={maps} testId="card-map" />
          </section>
        </div>
      </details>
    </article>
  );
}

/** The expected end state as `key = value` rows. */
function EndState({ values }: { values: Record<string, unknown> | undefined }) {
  const entries = values && typeof values === 'object' ? Object.entries(values) : [];
  if (entries.length === 0)
    return (
      <p className="muted" data-testid="card-result-state">
        No end state (expect.state).
      </p>
    );
  return (
    <ul className="end-state" data-testid="card-result-state">
      {entries.map(([k, v]) => (
        <li key={k}>
          {k} = {show(v)}
        </li>
      ))}
    </ul>
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
      style={{ ['--lane' as string]: color }}
      aria-label={`Step ${n} of ${total}: ${box?.title ?? step?.path ?? ''}${seen ? ', seen' : ''}`}
      onFocus={(e) => e.target === e.currentTarget && onFocus()}
      onKeyDown={onKeyDown}
    >
      <div className="step-panel-head">
        <span className="step-badge">{n}</span>
        <span className="step-lane" data-testid={`card-step-lane-${n}`}>
          <span className="sr-only">lane: </span>
          {roleName(view.prd, box?.lane)}
        </span>
        {seen && <span className="seen-chip">seen</span>}
      </div>
      <strong className="step-title" data-testid={`card-step-title-${n}`}>
        {stepTitle(view.flow, step?.path ?? '?')}
      </strong>
      {step?.branch !== undefined && (
        <span className="step-branch" data-testid={`card-step-branch-${n}`}>
          branch taken: {step.branch}
        </span>
      )}
      <div className="step-example" data-testid={`card-step-example-${n}`}>
        {step && example ? (
          <>
            <div className="step-kv">
              <div className="step-kv-label">GIVEN{step.exampleId ? ` · ${step.exampleId}` : ''}</div>
              <KeyValues values={step.input} />
            </div>
            <div className="step-kv is-then">
              <div className="step-kv-label">THEN</div>
              <KeyValues values={step.output} />
              {step.stateAfter && (
                <>
                  <div className="step-kv-label">STATE AFTER</div>
                  <KeyValues values={step.stateAfter} />
                </>
              )}
            </div>
          </>
        ) : (
          <p className="muted">Passes through. No example on this step.</p>
        )}
      </div>
      {box && (
        <dl className="step-contract" data-testid={`card-step-contract-${n}`}>
          <dt>in</dt>
          <dd>{fields(box.inputs)}</dd>
          <dt>out</dt>
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
