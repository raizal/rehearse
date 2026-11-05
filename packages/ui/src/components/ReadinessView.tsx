// Box `review/readiness` (R11, R16, S8-A1..A3): the chain requirement → stories → boxes →
// scenarios → status, requirements with no proof, boxes with no requirement, the
// correction counts, and the gate findings by story.

import type { GateReport, Readiness } from '@rehearse/core';
import type { ReviewEpicView } from '../contract.js';
import { groupByStory } from '../model/review.js';
import { FindingList } from './Review.js';

export interface ReadinessViewProps {
  view: ReviewEpicView;
  onOpenBox: (path: string) => void;
}

function BoxLink({ path, testId, onOpenBox }: { path: string; testId: string; onOpenBox: (path: string) => void }) {
  return (
    <button type="button" className="box-link" data-testid={testId} aria-label={`Open box ${path}`} onClick={() => onOpenBox(path)}>
      {path}
    </button>
  );
}

export function ReadinessView({ view, onOpenBox }: ReadinessViewProps) {
  const r = view.readiness;
  if (!r) {
    return (
      <section className="page" data-testid="readiness-view">
        <h2>Readiness</h2>
        <p className="muted" data-testid="readiness-missing">The server sent no readiness data. Update rehearse serve.</p>
      </section>
    );
  }
  return (
    <section className="page" data-testid="readiness-view">
      <h2>Readiness</h2>
      <p data-testid="readiness-summary">
        EPIC status: <strong>{r.epicStatus}</strong>
        {r.gateOk !== undefined && (
          <>
            {' '}· gate: <strong data-testid="readiness-gate-ok">{r.gateOk ? 'passes' : 'fails'}</strong>
          </>
        )}
      </p>

      <h3>Requirement → stories → boxes → scenarios</h3>
      <Chain readiness={r} onOpenBox={onOpenBox} />

      <div className="columns">
        <div>
          <h3 id="no-proof-h">Requirements with no proof</h3>
          {r.noProof.length === 0 ? (
            <p className="muted" data-testid="readiness-no-proof">Every requirement has proof.</p>
          ) : (
            <ul aria-labelledby="no-proof-h" data-testid="readiness-no-proof">
              {r.noProof.map((p) => (
                <li key={p.id} data-testid={`readiness-no-proof-${p.id}`}>
                  <strong>{p.id}</strong>: no proof — {p.message} <span className="muted small">({p.reason})</span>
                </li>
              ))}
            </ul>
          )}

          <h3 id="no-req-h">Boxes with no requirement</h3>
          {r.noRequirement.length === 0 ? (
            <p className="muted" data-testid="readiness-no-requirement">Every box serves a requirement.</p>
          ) : (
            <ul aria-labelledby="no-req-h" data-testid="readiness-no-requirement">
              {r.noRequirement.map((path) => (
                <li key={path}>
                  <BoxLink path={path} testId={`readiness-no-req-${path}`} onOpenBox={onOpenBox} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3>Corrections</h3>
          <dl className="counts" data-testid="readiness-corrections">
            <div>
              <dt>caught in simulation</dt>
              <dd data-testid="readiness-caught-in-simulation">{r.corrections['caught-in-simulation']}</dd>
            </div>
            <div>
              <dt>caught after build</dt>
              <dd data-testid="readiness-caught-after-build">{r.corrections['caught-after-build']}</dd>
            </div>
          </dl>
          {r.corrections.invalid.length > 0 && (
            <p className="warn" data-testid="readiness-corrections-invalid">
              Entries with an unknown tag: {r.corrections.invalid.map((e) => `${e.id} (${e.tag})`).join(', ')}
            </p>
          )}

          <h3>Gate findings by story</h3>
          <GateGroups view={view} gate={view.gate} />
        </div>
      </div>
    </section>
  );
}

function Chain({ readiness, onOpenBox }: { readiness: Readiness; onOpenBox: (path: string) => void }) {
  if (readiness.requirements.length === 0) return <p className="muted">No requirements.</p>;
  return (
    <div className="table-wrap">
      <table className="chain" data-testid="readiness-chain">
        <thead>
          <tr>
            <th scope="col">Requirement</th>
            <th scope="col">Proof</th>
            <th scope="col">Stories, boxes and scenarios</th>
          </tr>
        </thead>
        <tbody>
          {readiness.requirements.map((req) => (
            <tr key={req.id} data-testid={`readiness-req-${req.id}`} className={req.proven ? 'proven' : 'no-proof'}>
              <th scope="row">
                <strong>{req.id}</strong> <span className="req-text">{req.text}</span>
              </th>
              <td data-testid={`readiness-req-status-${req.id}`}>
                {req.proven ? <span className="badge status-approved">proven</span> : <span className="badge status-stale">no proof</span>}
                {req.message && <div className="small">{req.message}</div>}
              </td>
              <td>
                {req.stories.length === 0 && <span className="muted">no story</span>}
                <ul className="chain-stories">
                  {req.stories.map((s) => (
                    <li key={s.id} data-testid={`readiness-story-${req.id}-${s.id}`}>
                      <div>
                        <strong>{s.id}</strong> <span className={`badge status-${s.status === 'signed' ? 'approved' : s.status}`}>{s.status}</span>
                        {!s.trusted && <span className="badge status-stale">sign again</span>}
                        {s.gateFindings !== undefined && (
                          <span className="small muted">
                            {' '}
                            {s.gateFindings} gate finding{s.gateFindings === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                      <div className="small">
                        boxes:{' '}
                        {s.boxes.length === 0 ? (
                          <span className="muted">none</span>
                        ) : (
                          s.boxes.map((b) => <BoxLink key={b} path={b} testId={`readiness-box-${req.id}-${s.id}-${b}`} onOpenBox={onOpenBox} />)
                        )}
                      </div>
                      <div className="small">
                        scenarios:{' '}
                        {s.scenarios.length === 0 && <span className="muted">none</span>}
                        {s.scenarios.map((sc) => (
                          <span key={sc.id} className="chain-scenario" data-testid={`readiness-scenario-${req.id}-${sc.id}`}>
                            {sc.id} <span className={`badge status-${sc.status}`}>{sc.status}</span>
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GateGroups({ view, gate }: { view: ReviewEpicView; gate: GateReport | undefined }) {
  if (!gate) return <p className="muted" data-testid="readiness-gate">The server sent no gate report.</p>;
  if (gate.findings.length === 0) return <p className="ok" data-testid="readiness-gate">The gate has no findings.</p>;
  return (
    <div data-testid="readiness-gate">
      {groupByStory(view, gate.findings).map((g) => {
        const key = g.story ?? 'epic';
        return (
          <div key={key} className="finding-group" data-testid={`readiness-gate-${key}`}>
            <h4>{g.story ? `Story ${g.story}` : 'Whole EPIC'}</h4>
            <FindingList findings={g.findings} testId={`readiness-gate-${key}-list`} />
          </div>
        );
      })}
    </div>
  );
}
