// The rehearse review shell. One UI for the bb panel and a full-screen browser tab (R12, D31).
// Wave 1 has the flow view (swimlanes, drill-down, playback). The other tabs are
// placeholders for wave 2: permission matrix, readiness, approve and sign-off.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { Scenario } from '@rehearse/core';
import { fetchEpic, type EpicView } from './api.js';
import { BoxContract } from './components/DetailPane.js';
import { FlowView } from './components/FlowView.js';
import { Playback, StepDetail } from './components/Playback.js';
import { boxAt, diagramAt } from './model/diagram.js';
import { stepCount, stepView } from './model/playback.js';

const TABS = [
  { id: 'flow', label: 'Flow', ready: true },
  { id: 'matrix', label: 'Permission matrix', ready: false },
  { id: 'readiness', label: 'Readiness', ready: false },
  { id: 'signoff', label: 'Sign-off', ready: false },
] as const;

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; view: EpicView };

export function App({ load = fetchEpic }: { load?: () => Promise<EpicView> }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [diagramPath, setDiagramPath] = useState('');
  const [selected, setSelected] = useState<string | undefined>();
  const [scenarioId, setScenarioId] = useState<string | undefined>();
  const [step, setStep] = useState(0);

  const reload = useCallback(() => {
    load().then(
      (view) => setState({ kind: 'ready', view }),
      (e: unknown) => setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
  }, [load]);
  useEffect(reload, [reload]);

  const view = state.kind === 'ready' ? state.view : undefined;
  const flow = view?.flow;
  const active = view?.scenarios.find((s) => s.scenario.id === scenarioId);
  const current = useMemo(() => (active ? stepView(flow, active.scenario, step) : undefined), [active, flow, step]);

  // Playback opens the diagram that holds the current leaf box (R21) and selects it.
  const showStep = useCallback(
    (scenario: Scenario, index: number) => {
      const n = Math.max(0, Math.min(index, stepCount(scenario) - 1));
      setStep(n);
      const sv = stepView(flow, scenario, n);
      if (!sv) return;
      if (diagramAt(flow, sv.diagramPath)) setDiagramPath(sv.diagramPath);
      setSelected(sv.path);
    },
    [flow],
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
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
      if (e.key === 'ArrowRight') goToStep(step + 1);
      if (e.key === 'ArrowLeft') goToStep(step - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, goToStep, step]);

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
              className={t.id === 'flow' ? 'tab is-active' : 'tab'}
              data-testid={`nav-${t.id}`}
              disabled={!t.ready}
              aria-current={t.id === 'flow' ? 'page' : undefined}
              title={t.ready ? t.label : `${t.label} (coming in wave 2)`}
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
      {view && (
        <main className="workspace">
          <aside className="left">
            <Playback scenarios={view.scenarios} scenarioId={scenarioId} step={step} onPick={pick} onStep={goToStep} />
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
