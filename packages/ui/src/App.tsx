// The rehearse review shell. One UI for the bb panel and a full-screen browser tab (R12, D31).
// Storyboard (the default view for approval), flow view (swimlanes, drill-down, playback,
// approve), permission matrix, readiness and sign-off. Approve and sign-off are UI buttons only, signed by the serve process (R13, R14, D41).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { Id, Scenario } from '@rehearse/core';
import { fetchEpic, fetchSession, postApprove, postSignOff } from './api.js';
import type { ScenarioView } from './api.js';
import type { ApproveOk, PostOutcome, ReviewEpicView, Session, SignOffOk } from './contract.js';
import { ApproveBar } from './components/Approve.js';
import { BoxContract } from './components/DetailPane.js';
import { FlowView } from './components/FlowView.js';
import { MatrixView } from './components/MatrixView.js';
import { Playback, StepDetail, type ApproveControls } from './components/Playback.js';
import { ReadinessView } from './components/ReadinessView.js';
import { signingBlocked, type SessionState } from './components/Review.js';
import { SignOffView } from './components/SignOffView.js';
import { Storyboard } from './components/Storyboard.js';
import { boxAt, diagramAt, parentPath } from './model/diagram.js';
import { stepCount, stepView } from './model/playback.js';
import { approveReason } from './model/review.js';
import { allSeen, browserStorage, loadSeen, markSeen, saveSeen, type SeenState } from './model/seen.js';
import { nextToApprove, reviewQueue } from './model/storyboard.js';

const TABS = [
  { id: 'storyboard', label: 'Storyboard' },
  { id: 'flow', label: 'Flow' },
  { id: 'matrix', label: 'Permission matrix' },
  { id: 'readiness', label: 'Readiness' },
  { id: 'signoff', label: 'Sign-off' },
] as const;
type Tab = (typeof TABS)[number]['id'];

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
  const [tab, setTab] = useState<Tab>('storyboard');
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

  // A box link in the matrix or readiness view opens the box in the flow view.
  const openBox = useCallback(
    (path: string) => {
      const parent = parentPath(path);
      setDiagramPath(diagramAt(flow, parent) ? parent : '');
      setSelected(path);
      setTab('flow');
    },
    [flow],
  );

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
          <span className="epic-title" data-testid="epic-title">{view?.prd?.epic?.title ?? view?.slug ?? ''}</span>
          {view && <span className="epic-slug">{view.slug}</span>}
        </div>
        <nav className="tabs" data-testid="nav" aria-label="Views">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={t.id === tab ? 'tab is-active' : 'tab'}
              data-testid={`nav-${t.id}`}
              aria-current={t.id === tab ? 'page' : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
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
      {view && approveControls && tab === 'storyboard' && (
        <Storyboard
          view={view}
          session={session}
          scenarioId={card?.scenario.id}
          onPick={setCardId}
          seen={seenState}
          onSeen={markStep}
          approve={approveControls}
          onSelectMany={(ids) => setPicked((old) => new Set([...old, ...ids]))}
          busy={busy === 'approve'}
          outcome={approveOutcome}
          onOpenFlow={openInFlow}
        />
      )}
      {view && tab === 'matrix' && (
        <main className="page-wrap">
          <MatrixView simulation={view.simulation} flow={flow} prd={view.prd} entities={view.entities} onOpenBox={openBox} />
        </main>
      )}
      {view && tab === 'readiness' && (
        <main className="page-wrap">
          <ReadinessView view={view} onOpenBox={openBox} />
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
