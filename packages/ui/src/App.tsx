// The rehearse review shell. One UI for the bb panel and a full-screen browser tab (R12, D31).
// Review from big to small (D42): the big picture (the default view: roles, main processes and
// one line per story), stories (the queue, the story view and its storyboard cards), use cases
// (who may change what; the permission matrix behind a toggle), readiness, sign-off, and the
// flow view (swimlanes, drill-down, playback, approve). Approve and sign-off are UI buttons only, signed by the serve process (R13, R14, D41).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { Id, Scenario } from '@rehearse/core';
import { fetchEpic, fetchSession, postApprove, postSignOff } from './api.js';
import type { ScenarioView } from './api.js';
import type { ApproveOk, PostOutcome, ReviewEpicView, Session, SignOffOk } from './contract.js';
import { ApproveBar } from './components/Approve.js';
import { BigPictureViews } from './components/BigPictureViews.js';
import { BoxContract } from './components/DetailPane.js';
import { FlowView } from './components/FlowView.js';
import { PrdView } from './components/PrdView.js';
import { Playback, StepDetail, type ApproveControls } from './components/Playback.js';
import { ReadinessView } from './components/ReadinessView.js';
import { signingBlocked, type SessionState } from './components/Review.js';
import { SignOffView } from './components/SignOffView.js';
import { Storyboard } from './components/Storyboard.js';
import type { StoryTab } from './components/StoryView.js';
import { TechSpecView } from './components/TechSpecView.js';
import { UseCaseView } from './components/UseCaseView.js';
import { boxAt, diagramAt, parentPath } from './model/diagram.js';
import type { Place } from './model/links.js';
import { DEFAULT_BIG_VIEW, depthOf, depthState, fromHash, toHash, type Loc, type Tab } from './model/nav.js';
import { stepCount, stepView } from './model/playback.js';
import { approveReason, storiesOf } from './model/review.js';
import { allSeen, browserStorage, loadSeen, markSeen, saveSeen, type SeenState } from './model/seen.js';
import { nextToApprove, reviewQueue } from './model/storyboard.js';
import { shortKey } from './model/text.js';

const TABS = [
  { id: 'prd', label: 'PRD' },
  { id: 'techspec', label: 'Tech spec' },
  { id: 'bigpicture', label: 'Big picture' },
  { id: 'stories', label: 'Stories' },
  { id: 'usecases', label: 'Use cases' },
  { id: 'readiness', label: 'Readiness' },
  { id: 'signoff', label: 'Sign off' },
  { id: 'flow', label: 'Flow' },
] as const satisfies readonly { id: Tab; label: string }[];

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; view: ReviewEpicView };

/** The write side of `rehearse serve`. Tests replace `fetch`, not this. */
export interface ReviewApi {
  session: () => Promise<Session>;
  approve: (token: string, scenarioIds: Id[]) => Promise<PostOutcome<ApproveOk>>;
  signOff: (token: string, storyIds: Id[]) => Promise<PostOutcome<SignOffOk>>;
}

const HTTP_API: ReviewApi = { session: fetchSession, approve: postApprove, signOff: postSignOff };

export function App({ load = fetchEpic, api = HTTP_API }: { load?: () => Promise<ReviewEpicView>; api?: ReviewApi }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [tab, setTab] = useState<Tab>('bigpicture');
  const [bigView, setBigView] = useState(DEFAULT_BIG_VIEW);
  const [session, setSession] = useState<SessionState>({ kind: 'loading' });
  const [picked, setPicked] = useState<ReadonlySet<Id>>(new Set());
  const [busy, setBusy] = useState<'approve' | 'signoff' | undefined>();
  const [approveOutcome, setApproveOutcome] = useState<PostOutcome<ApproveOk> | undefined>();
  const [signOffOutcome, setSignOffOutcome] = useState<PostOutcome<SignOffOk> | undefined>();
  const [diagramPath, setDiagramPath] = useState('');
  const [selected, setSelected] = useState<string | undefined>();
  const [scenarioId, setScenarioId] = useState<string | undefined>();
  const [step, setStep] = useState(0);
  const [cardId, setCardId] = useState<Id | undefined>();
  const [storyId, setStoryId] = useState<Id | undefined>();
  // The stories view shows the storyboard page of the open scenario (design page 3), else its story.
  const [board, setBoard] = useState(false);
  // The "Stories" crumb shows the story list (T23); the story's open tab lives here so history keeps it.
  const [list, setList] = useState(false);
  const [storyTab, setStoryTab] = useState<StoryTab>('what');
  // Where an id link on the PRD or Tech spec page went (T15): an item on those pages, or a readiness row.
  const [docFocus, setDocFocus] = useState<string | undefined>();
  const [readinessRow, setReadinessRow] = useState<Id | undefined>();
  // Steps seen per scenario: browser only (sessionStorage), not evidence, never sent (S6-A1).
  const [seen, setSeen] = useState<{ slug: string | undefined; state: SeenState }>({ slug: undefined, state: {} });

  const reload = useCallback(() => {
    load().then(
      (view) => setState({ kind: 'ready', view }),
      (e: unknown) => setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
  }, [load]);
  useEffect(reload, [reload]);
  useEffect(() => {
    api.session().then(
      (s) => setSession({ kind: 'ready', session: s }),
      (e: unknown) => setSession({ kind: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
  }, [api]);

  const view = state.kind === 'ready' ? state.view : undefined;
  const flow = view?.flow;
  const slug = view?.slug;
  useEffect(() => {
    if (slug !== undefined) setSeen((old) => (old.slug === slug ? old : { slug, state: loadSeen(browserStorage(), slug) }));
  }, [slug]);
  useEffect(() => {
    if (seen.slug !== undefined) saveSeen(browserStorage(), seen.slug, seen.state);
  }, [seen]);
  const seenState = seen.slug === slug ? seen.state : {};
  const markStep = useCallback(
    (sv: ScenarioView, index: number) =>
      setSeen((old) => {
        const next = markSeen(old.state, sv, index);
        return next === old.state ? old : { slug: old.slug, state: next };
      }),
    [],
  );
  // The storyboard opens on the first scenario with no valid signed approval.
  const queue = useMemo(() => (view ? reviewQueue(view.prd, view.scenarios).flatMap((g) => g.scenarios) : []), [view]);
  const card = queue.find((sv) => sv.scenario.id === cardId) ?? queue.find((sv) => sv.scenario.id === nextToApprove(queue, undefined, view?.approvals)) ?? queue[0];
  // A picked story opens on its first scenario to approve, else its first scenario.
  const firstCard = useCallback(
    (id: Id) => {
      const own = queue.filter((sv) => sv.scenario.story === id);
      return own.find((sv) => sv.scenario.id === nextToApprove(own, undefined, view?.approvals))?.scenario.id ?? own[0]?.scenario.id;
    },
    [queue, view],
  );
  /** Open a story's page; `onTab` also picks its tab (a story link opens on WHAT). */
  const pickStory = useCallback(
    (id: Id, onTab?: StoryTab) => {
      setStoryId(id);
      setBoard(false);
      setList(false);
      if (onTab) setStoryTab(onTab);
      setCardId(firstCard(id));
    },
    [firstCard],
  );
  const openStory = useCallback(
    (id: Id) => {
      pickStory(id, 'what');
      setTab('stories');
    },
    [pickStory],
  );
  const pickCard = useCallback(
    (id: Id) => {
      setCardId(id);
      setBoard(true);
      setList(false);
      setStoryId(queue.find((sv) => sv.scenario.id === id)?.scenario.story);
    },
    [queue],
  );
  const active = view?.scenarios.find((s) => s.scenario.id === scenarioId);
  const current = useMemo(() => (active ? stepView(flow, active.scenario, step) : undefined), [active, flow, step]);

  // Playback opens the diagram that holds the current leaf box (R21) and selects it.
  const showStep = useCallback(
    (scenario: Scenario, index: number) => {
      const n = Math.max(0, Math.min(index, stepCount(scenario) - 1));
      setStep(n);
      // Stepping through playback counts as seeing the step.
      const playing = view?.scenarios.find((s) => s.scenario === scenario);
      if (playing) markStep(playing, n);
      const sv = stepView(flow, scenario, n);
      if (!sv) return;
      if (diagramAt(flow, sv.diagramPath)) setDiagramPath(sv.diagramPath);
      setSelected(sv.path);
    },
    [flow, view, markStep],
  );
  const goToStep = useCallback((index: number) => active && showStep(active.scenario, index), [active, showStep]);
  const pick = useCallback(
    (id: string | undefined) => {
      setScenarioId(id);
      const picked = view?.scenarios.find((s) => s.scenario.id === id);
      if (picked) showStep(picked.scenario, 0);
    },
    [view, showStep],
  );

  useEffect(() => {
    if (!active || tab !== 'flow') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
      if (e.key === 'ArrowRight') goToStep(step + 1);
      if (e.key === 'ArrowLeft') goToStep(step - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, goToStep, step, tab]);

  // A box link in the big picture, story, use case or readiness view opens the box in the flow view.
  const openBox = useCallback(
    (path: string) => {
      const parent = parentPath(path);
      setDiagramPath(diagramAt(flow, parent) ? parent : '');
      setSelected(path);
      setTab('flow');
    },
    [flow],
  );

  // An id link on the PRD or Tech spec page opens the place where the id lives (T15).
  const go = useCallback(
    (place: Place) => {
      if (place.view === 'story') openStory(place.story);
      else if (place.view === 'storyboard') {
        pickCard(place.scenario);
        setTab('stories');
      } else if (place.view === 'flow') openBox(place.box);
      else if (place.view === 'readiness') {
        setReadinessRow(place.requirement);
        setTab('readiness');
      } else if (place.view === 'prd' || place.view === 'techspec') {
        setDocFocus(place.focus);
        setTab(place.view);
      } else setTab(place.view);
    },
    [openStory, pickCard, openBox],
  );

  // ------------------------------------------------------------ history (T23)
  // Every place is a URL hash. A change of place pushes a history entry, so the browser's Back
  // and Forward (and the in-app "← Back") walk the places; a reload opens the same place.
  const storyShown = storyId ?? card?.scenario.story ?? (view ? storiesOf(view.prd)[0]?.id : undefined);
  const loc = useMemo((): Loc => {
    switch (tab) {
      case 'prd':
      case 'techspec':
        return { tab, focus: docFocus };
      case 'bigpicture':
        return { tab, view: bigView };
      case 'readiness':
        return { tab, requirement: readinessRow };
      case 'flow':
        return { tab, diagram: diagramPath };
      case 'stories':
        if (list || storyShown === undefined) return { tab, list: true };
        if (board && card && (storyId === undefined || card.scenario.story === storyId)) return { tab, story: card.scenario.story ?? storyShown, card: card.scenario.id };
        return { tab, story: storyShown, storyTab };
      default:
        return { tab };
    }
  }, [tab, docFocus, bigView, readinessRow, diagramPath, list, storyShown, board, card, storyId, storyTab]);
  const applyLoc = (l: Loc) => {
    setTab(l.tab);
    if (l.tab === 'prd' || l.tab === 'techspec') setDocFocus(l.focus);
    else if (l.tab === 'bigpicture') setBigView(l.view ?? DEFAULT_BIG_VIEW);
    else if (l.tab === 'readiness') setReadinessRow(l.requirement);
    else if (l.tab === 'flow') setDiagramPath(l.diagram ?? '');
    else if (l.tab === 'stories') {
      if ('list' in l) {
        setList(true);
        return;
      }
      setList(false);
      setStoryId(l.story);
      if (l.card !== undefined) {
        setCardId(l.card);
        setBoard(true);
      } else {
        setBoard(false);
        setStoryTab(l.storyTab);
        if (queue.length) setCardId(firstCard(l.story));
      }
    }
  };
  const applyRef = useRef(applyLoc);
  applyRef.current = applyLoc;
  const [depth, setDepth] = useState(() => depthOf(window.history.state));
  // The place in the URL when the page opened.
  useEffect(() => {
    const at = fromHash(window.location.hash);
    if (at) applyRef.current(at);
    const onPop = (e: PopStateEvent) => {
      setDepth(depthOf(e.state));
      const to = fromHash(window.location.hash);
      if (to) applyRef.current(to);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const here = view ? toHash(loc) : undefined;
  const synced = useRef(false);
  useEffect(() => {
    if (here === undefined) return;
    const h = window.history;
    if (!synced.current) {
      // The first place replaces the entry the page opened with: no new history entry.
      synced.current = true;
      if (here !== window.location.hash) h.replaceState(depthState(depthOf(h.state)), '', here);
      return;
    }
    if (here === window.location.hash) return;
    const next = depthOf(h.state) + 1;
    h.pushState(depthState(next), '', here);
    setDepth(next);
  }, [here]);
  const back = useMemo(() => ({ can: depth > 0, onBack: () => window.history.back() }), [depth]);
  useEffect(() => {
    if (tab === 'readiness' && readinessRow) document.querySelector(`[data-testid="readiness-req-${readinessRow}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [tab, readinessRow]);

  const token = session.kind === 'ready' ? session.session.token : undefined;
  const actionsOff = signingBlocked(session) !== undefined || busy !== undefined || token === undefined;

  const isSeen = useCallback((sv: ScenarioView) => allSeen(seenState, sv), [seenState]);
  const approve = useCallback(
    async (wanted: Id[]) => {
      // Only scenarios whose steps were all seen (S6-A1).
      const ids = wanted.filter((id) => {
        const sv = view?.scenarios.find((s) => s.scenario.id === id);
        return sv !== undefined && isSeen(sv);
      });
      if (!token || ids.length === 0) return;
      setBusy('approve');
      setApproveOutcome(undefined);
      const outcome = await api.approve(token, ids);
      setBusy(undefined);
      setApproveOutcome(outcome);
      if (outcome.kind === 'ok') {
        setPicked(new Set());
        reload();
      }
    },
    [api, token, reload, view, isSeen],
  );
  const signOff = useCallback(
    async (ids: Id[]) => {
      if (!token) return;
      setBusy('signoff');
      setSignOffOutcome(undefined);
      const outcome = await api.signOff(token, ids);
      setBusy(undefined);
      setSignOffOutcome(outcome);
      if (outcome.kind === 'ok') reload();
    },
    [api, token, reload],
  );
  const approveControls: ApproveControls | undefined = view && {
    reasonFor: (sv) => approveReason(sv, view.approvals),
    approvals: view.approvals,
    selected: picked,
    onToggle: (id) =>
      setPicked((old) => {
        const next = new Set(old);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    onApprove: (ids) => void approve(ids),
    disabled: actionsOff,
    isSeen,
  };
  const openInFlow = (id: Id) => {
    setTab('flow');
    pick(id);
  };

  const report = view?.report;
  return (
    <div className="app" data-testid="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">rehearse</span>
          <span className="epic-title sr-only" data-testid="epic-title">{view?.prd?.epic?.title ?? view?.slug ?? ''}</span>
          {view && (
            <span className="epic-slug" data-testid="epic-slug" title={view.prd?.epic?.title}>
              {view.slug}
              {view.prd?.epic?.status && ` · ${view.prd.epic.status}`}
            </span>
          )}
        </div>
        <nav className="tabs" data-testid="nav" aria-label="Views">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={t.id === tab ? 'tab is-active' : 'tab'}
              data-testid={`nav-${t.id}`}
              aria-current={t.id === tab ? 'page' : undefined}
              onClick={() => {
                // Stories opens on the story page, on WHAT (the list is the "Stories" crumb).
                if (t.id === 'stories' && tab !== 'stories') {
                  setStoryTab('what');
                  setList(false);
                }
                setTab(t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          {session.kind === 'ready' && (
            <span
              className={`badge signing-chip ${session.session.signing.ok ? 'status-approved' : 'status-unsigned'}`}
              data-testid="signing-chip"
              title={session.session.signing.ok ? `Signing with key ${session.session.signing.keyFingerprint}` : session.session.signing.reason}
            >
              {session.session.signing.ok ? `Signing: key ${shortKey(session.session.signing.keyFingerprint)}` : 'Signing: off'}
            </span>
          )}
          {report && (
            <span className={`badge ${report.ok ? 'status-approved' : 'status-stale'}`} data-testid="report-status" title={report.findings.map((f) => `${f.file}: ${f.path}: ${f.message}`).join('\n')}>
              validate: {report.ok ? 'OK' : `${report.findings.length} findings`}
            </span>
          )}
          <button type="button" className="link" data-testid="reload" onClick={reload} title="Read the record files again">
            Reload
          </button>
        </div>
      </header>

      {state.kind === 'loading' && <div className="status-msg" data-testid="loading">Loading the EPIC record…</div>}
      {state.kind === 'error' && (
        <div className="status-msg error" data-testid="load-error">
          Could not load the EPIC record: {state.message}
        </div>
      )}
      {view && tab === 'prd' && (
        <main className="page-wrap">
          <PrdView view={view} focus={docFocus} onGo={go} />
        </main>
      )}
      {view && tab === 'techspec' && (
        <main className="page-wrap">
          <TechSpecView view={view} focus={docFocus} onGo={go} />
        </main>
      )}
      {view && tab === 'bigpicture' && (
        <main className="page-wrap">
          <BigPictureViews
            active={bigView}
            onPick={setBigView}
            view={view}
            onOpenStory={openStory}
            onOpenBox={openBox}
          />
        </main>
      )}
      {view && approveControls && tab === 'stories' && (
        <Storyboard
          view={view}
          session={session}
          scenarioId={storyId === undefined || card?.scenario.story === storyId ? card?.scenario.id : undefined}
          storyId={storyId ?? card?.scenario.story ?? storiesOf(view.prd)[0]?.id}
          board={board}
          onBack={() => {
            setBoard(false);
            setStoryTab('what');
          }}
          onBigPicture={() => setTab('bigpicture')}
          onStories={() => setList(true)}
          onOpenStory={(id) => pickStory(id, 'what')}
          list={list || storyShown === undefined}
          storyTab={storyTab}
          onStoryTab={setStoryTab}
          back={back}
          onPick={pickCard}
          onPickStory={(id) => pickStory(id)}
          onOpenBox={openBox}
          seen={seenState}
          onSeen={markStep}
          approve={approveControls}
          onSelectMany={(ids) => setPicked((old) => new Set([...old, ...ids]))}
          busy={busy === 'approve'}
          outcome={approveOutcome}
          onOpenFlow={openInFlow}
        />
      )}
      {view && tab === 'usecases' && (
        <main className="page-wrap">
          <UseCaseView simulation={view.simulation} flow={flow} prd={view.prd} entities={view.entities} onOpenBox={openBox} />
        </main>
      )}
      {view && tab === 'readiness' && (
        <main className="page-wrap">
          <ReadinessView view={view} onOpenBox={openBox} onOpenStory={openStory} />
        </main>
      )}
      {view && tab === 'signoff' && (
        <main className="page-wrap">
          <SignOffView view={view} session={session} busy={busy !== undefined} outcome={signOffOutcome} onSignOff={(ids) => void signOff(ids)} />
        </main>
      )}
      {view && tab === 'flow' && (
        <main className="workspace">
          <aside className="left">
            <ApproveBar session={session} selected={picked} disabled={actionsOff} busy={busy === 'approve'} outcome={approveOutcome} onApprove={(ids) => void approve(ids)} />
            <Playback scenarios={view.scenarios} scenarioId={scenarioId} step={step} onPick={pick} onStep={goToStep} approve={approveControls} />
          </aside>
          <ReactFlowProvider>
            <FlowView
              flow={flow}
              prd={view.prd}
              diagramPath={diagramPath}
              current={current?.path}
              selected={selected}
              onOpen={setDiagramPath}
              onSelect={setSelected}
            />
          </ReactFlowProvider>
          <aside className="right detail-pane" data-testid="detail-pane">
            {current && active && (
              <>
                <h2>Playback</h2>
                <StepDetail view={current} total={stepCount(active.scenario)} />
              </>
            )}
            <h2>Box contract</h2>
            <BoxContract box={selected ? boxAt(flow, selected) : undefined} path={selected} />
          </aside>
        </main>
      )}
    </div>
  );
}
