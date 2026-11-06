// The stories view (S6-A1, S4-A5), as design pages 2, 3 and 12–15 draw it.
// The story page (page 2): on the left the review queue, one compact row per story; on the
// right the story (WHAT, HOW, OUTPUT) and its scenarios as cards, each with its status, a
// "select to approve" box and "Open storyboard". The other tabs of the story (Before / after,
// Code, Tests) put the story header card on top, with no queue; Code and Tests have the story
// thread rail. The storyboard of one scenario (page 3) is a page of its own: the path as a
// flowchart in role lanes (StoryFlowChart), the detail of the picked step beside it, playback
// (step through, Play), the expected end state and Approve. A step counts as seen when the panel
// shows its detail; Approve is on only after every step was seen. What was seen lives in the
// browser only and is never sent.

import { useEffect, useMemo, useRef, useState, useCallback, type KeyboardEvent } from 'react';
import { layoutStoryFlow, notTaken, storyFlow, type StoryFlow } from '../model/storyflow.js';
import { StoryFlowChart } from './StoryFlowChart.js';
import type { Id } from '@rehearse/core';
import type { ScenarioView } from '../api.js';
import type { ApproveOk, PostOutcome, ReviewEpicView } from '../contract.js';
import { boxAt, laneColor, roleName } from '../model/diagram.js';
import { stepCount, stepView } from '../model/playback.js';
import { seenSteps, allSeen as isAllSeen, type SeenState } from '../model/seen.js';
import { contextLabel } from '../model/storythread.js';
import { approvalState, criterionFor, nextToApprove, pathMap, progress, reviewQueue, type ApprovalKind } from '../model/storyboard.js';
import { queueRows, scenarioSummary, stepTitle, storyColor } from '../model/storypage.js';
import { ApproveBar, type ApproveControls } from './Approve.js';
import { PathMap } from './PathMap.js';
import { StoryThread } from './StoryThread.js';
import { BackButton, CrumbStart, isStoryPage, StoryView, type BackControl, type StoryTab } from './StoryView.js';
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
  /** The story to show; default: the story of the open scenario. */
  storyId?: Id;
  onPickStory?: (id: Id) => void;
  /** Open a box (the box drawer). */
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
            onOpenBox={props.onOpenBox}
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
  /** Open a box (its path) where the review shows boxes. */
  onOpenBox?: (path: string) => void;
  session?: SessionState;
  outcome?: PostOutcome<ApproveOk>;
  onBack?: () => void;
  onBigPicture?: () => void;
  onStories?: () => void;
  back?: BackControl;
}

/** How long Play shows each step before it moves on. */
export const PLAY_MS = 1800;

/** Scroll the storyboard page (not the chart) so `el` is in view. */
function reveal(el: HTMLElement) {
  const page = el.closest<HTMLElement>('.board-wrap');
  if (!page) return;
  const a = el.getBoundingClientRect();
  const b = page.getBoundingClientRect();
  if (a.top < b.top + 8) page.scrollTop -= b.top + 8 - a.top;
  else if (a.bottom > b.bottom - 8) page.scrollTop += a.bottom - b.bottom + 8;
}

export function StoryCard({ view, sv, seen, onSeen, approve, onOpenBox, session, outcome, onBack, onBigPicture, onStories, back }: StoryCardProps) {
  const { scenario } = sv;
  const { flow, prd } = view;
  const id = scenario.id;
  const total = stepCount(scenario);
  const seenSet = useMemo(() => seenSteps(seen, sv), [seen, sv]);
  const allSeen = isAllSeen(seen, sv);
  const { story, criterion } = criterionFor(prd, scenario);
  const maps = useMemo(() => pathMap(flow, scenario), [flow, scenario]);
  const sf = useMemo(() => storyFlow(flow, prd, scenario), [flow, prd, scenario]);
  const layout = useMemo(() => layoutStoryFlow(sf), [sf]);
  const state = approvalState(sv, approve.approvals);
  const reason = approve.reasonFor(sv);
  const critId = scenario.expect?.criterion;
  // The step shown in the detail panel: the first one when the page opens.
  const [cur, setCur] = useState(total > 0 ? 0 : -1);
  const [playing, setPlaying] = useState(false);
  const nodes = useRef(new Map<number, HTMLButtonElement>());
  const markRef = useRef((i: number) => onSeen(sv, i));
  markRef.current = (i: number) => onSeen(sv, i);

  // A step counts as seen when the panel shows its detail (example, contract, branches): the
  // chart node alone shows only the title. Marked again when a new seen state comes without it
  // (the tab's stored state loads after the page opened).
  const curSeen = cur >= 0 && seenSet.has(cur);
  useEffect(() => {
    if (cur >= 0 && !curSeen) markRef.current(cur);
  }, [cur, curSeen, seen]);

  const goTo = useCallback(
    (i: number, focus = false) => {
      if (i < 0 || i >= total) return;
      setCur(i);
      const el = nodes.current.get(i);
      if (focus && el) {
        el.focus({ preventScroll: true });
        reveal(el);
      }
    },
    [total],
  );
  const pick = useCallback(
    (i: number) => {
      setPlaying(false);
      goTo(i);
    },
    [goTo],
  );
  const onNodeKey = useCallback(
    (i: number, e: KeyboardEvent<HTMLButtonElement>) => {
      const to = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: total - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      setPlaying(false);
      goTo(to, true);
    },
    [goTo, total],
  );
  const refFn = useCallback((i: number, el: HTMLButtonElement | null) => {
    if (el) nodes.current.set(i, el);
    else nodes.current.delete(i);
  }, []);
  const stepBy = useCallback(
    (d: number) => {
      setPlaying(false);
      setCur((c) => Math.max(0, Math.min(total - 1, c + d)));
    },
    [total],
  );

  // Left and right arrows step anywhere on the page, as playback did in the flow view, but not
  // in a form field. A step node handles its own arrows (and up, down, Home, End).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      stepBy(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepBy]);

  // Play: one step every PLAY_MS, to the end of the path.
  useEffect(() => {
    if (!playing) return;
    if (cur >= total - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setCur((c) => Math.min(c + 1, total - 1)), PLAY_MS);
    return () => clearTimeout(t);
  }, [playing, cur, total]);
  const togglePlay = () => {
    if (playing) return setPlaying(false);
    if (cur >= total - 1) setCur(0);
    setPlaying(true);
  };
  const unseen = Array.from({ length: total }, (_, k) => (cur + 1 + k) % total).find((i) => !seenSet.has(i));
  const laneOf = (role: string) => sf.lanes.find((l) => l.role === role);

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
      </header>

      {total === 0 ? (
        <p className="warn">The scenario has no steps.</p>
      ) : (
        <div className="sf-board">
          <div className="sf-main">
            <StoryFlowChart
              sf={sf}
              layout={layout}
              current={cur}
              seen={seenSet}
              label={`Flowchart of ${id}: ${total} step${total === 1 ? '' : 's'} down the lanes ${sf.lanes.map((l) => l.label).join(', ')}. Pick a step to see it; the arrow keys move along the path.`}
              onPick={pick}
              onKey={onNodeKey}
              refFn={refFn}
            />
            <ol className="sr-only" data-testid="card-steps-text" aria-label={`Steps of ${id}`}>
              {sf.steps.map((s) => {
                const others = notTaken(sf, s.index);
                return (
                  <li key={s.id} data-testid={`card-steps-text-${s.index + 1}`}>
                    Step {s.index + 1}: {s.title}, lane {laneOf(s.lane)?.label ?? s.lane}
                    {s.decision ? ', a decision' : ''}
                    {s.branch !== undefined ? `, branch taken: ${s.branch}` : ''}
                    {others.length > 0 ? `; not taken: ${others.map((g) => `${g.label ?? 'other'} to ${g.title}`).join(', ')}` : ''}
                    {seenSet.has(s.index) ? ', seen' : ''}.
                  </li>
                );
              })}
            </ol>
          </div>
          <aside className="sf-detail" data-testid="card-detail" aria-label="Step detail">
            <div className="sf-controls" role="group" aria-label="Step through the path">
              <button type="button" className="action small" data-testid="card-prev-step" aria-label="Previous step" disabled={cur <= 0} onClick={() => stepBy(-1)}>
                ←
              </button>
              <span className="sf-count" data-testid="card-step-count">
                Step {cur + 1} of {total}
              </span>
              <button type="button" className="action small" data-testid="card-next-step" aria-label={`Next step: ${Math.min(cur + 2, total)} of ${total}`} disabled={cur >= total - 1} onClick={() => stepBy(1)}>
                Next step →
              </button>
              <button type="button" className="action small" data-testid="card-play" aria-pressed={playing} disabled={total < 2} onClick={togglePlay}>
                {playing ? '❚❚ Pause' : '▶ Play'}
              </button>
            </div>
            {cur >= 0 && <StepPanel view={view} sv={sv} sf={sf} index={cur} seen={seenSet.has(cur)} onOpenBox={onOpenBox} />}
          </aside>
        </div>
      )}

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
                {unseen !== undefined && (
                  <button type="button" className="action" data-testid="card-next-unseen" aria-label={`Show step ${unseen + 1}, not seen yet`} onClick={() => {
                      setPlaying(false);
                      goTo(unseen, true);
                    }}>
                    Step {unseen + 1}, not seen yet →
                  </button>
                )}
              </div>
              <p data-testid="card-approval-state" className="small">
                Approval: <span className={`badge ${MARK_CLASS[state.kind]}`}>{state.text}</span>
              </p>
              {reason !== undefined && !allSeen && (
                <p className="small muted" data-testid="card-approve-why">
                  See every step first: {seenSet.size} of {total} seen. Pick each step in the chart, or use “Next step” or “Play”.
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
function EndState({ values, testId = 'card-result-state' }: { values: Record<string, unknown> | undefined; testId?: string }) {
  const entries = values && typeof values === 'object' ? Object.entries(values) : [];
  if (entries.length === 0)
    return (
      <p className="muted" data-testid={testId}>
        No end state (expect.state).
      </p>
    );
  return (
    <ul className="end-state" data-testid={testId}>
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
  sf: StoryFlow;
  index: number;
  seen: boolean;
  onOpenBox?: (path: string) => void;
}

/** The detail of the current step: everything a step card showed, and the branches not taken. */
function StepPanel({ view, sv, sf, index, seen, onOpenBox }: StepPanelProps) {
  const total = stepCount(sv.scenario);
  const step = stepView(view.flow, sv.scenario, index);
  const node = sf.steps[index];
  const n = index + 1;
  const box = step?.box;
  const color = laneColor(view.flow, box?.lane);
  const example = step && (step.exampleId !== undefined || step.input !== undefined || step.output !== undefined || step.stateAfter !== undefined);
  const others = notTaken(sf, index);
  const path = step?.path ?? '';
  const parts = path.split('/');
  const boxLink = (p: string, text: string, testId?: string) =>
    onOpenBox ? (
      <button type="button" className="link" data-testid={testId} aria-label={`Open box ${text} (${p})`} onClick={() => onOpenBox(p)}>
        {text}
      </button>
    ) : (
      <span data-testid={testId}>{text}</span>
    );
  return (
    <section className={`sf-step${seen ? ' is-seen' : ''}`} data-testid={`card-detail-step-${n}`} style={{ ['--lane' as string]: color }} aria-labelledby="card-detail-title">
      <div className="step-panel-head">
        <span className="step-badge">{n}</span>
        <span className="step-lane" data-testid="card-detail-lane">
          <span className="sr-only">lane: </span>
          {roleName(view.prd, box?.lane)}
        </span>
        {node?.decision && <span className="sf-kind">decision</span>}
        {seen && <span className="seen-chip">seen</span>}
      </div>
      <h2 className="step-title" id="card-detail-title" data-testid="card-detail-title" aria-live="polite">
        <span className="sr-only">
          Step {n} of {total}:{' '}
        </span>
        {stepTitle(view.flow, path || '?')}
      </h2>
      <p className="sf-path small" data-testid="card-detail-path">
        {parts.map((id, k) => {
          const p = parts.slice(0, k + 1).join('/');
          const last = k === parts.length - 1;
          return (
            <span key={p}>
              {k > 0 && <span aria-hidden="true"> › </span>}
              {boxLink(p, last ? 'Open box' : (boxAt(view.flow, p)?.title ?? id), last ? 'card-detail-open-box' : undefined)}
            </span>
          );
        })}{' '}
        <code>{path}</code>
      </p>
      {!box && <p className="warn">No box at {path} in flow.yaml.</p>}
      {step?.branch !== undefined && (
        <span className="step-branch" data-testid="card-detail-branch">
          branch taken: {step.branch}
        </span>
      )}
      {others.length > 0 && (
        <div className="sf-not-taken small" data-testid="card-detail-not-taken">
          <span className="muted">Not taken:</span>
          <ul>
            {others.map((g) => (
              <li key={g.id}>
                <span className="sf-not-taken-label">{g.label ?? 'other branch'}</span> → {boxLink(g.path, g.title)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="step-example" data-testid="card-detail-example">
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
        <dl className="step-contract" data-testid="card-detail-contract">
          <dt>in</dt>
          <dd>{fields(box.inputs)}</dd>
          <dt>out</dt>
          <dd>{fields(box.outputs)}</dd>
          <dt>writes</dt>
          <dd>{box.writes?.length ? box.writes.join(', ') : '—'}</dd>
        </dl>
      )}
      {step?.expect && (
        <div className="sf-end small" data-testid="card-detail-expect">
          <div className="step-kv-label">THE PATH ENDS HERE · EXPECTED END STATE</div>
          <EndState values={step.expect} testId="card-detail-expect-state" />
        </div>
      )}
    </section>
  );
}

function fields(values: Record<string, string> | undefined): string {
  const entries = values && typeof values === 'object' ? Object.entries(values) : [];
  return entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join(', ') : '—';
}
