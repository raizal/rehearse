// The Tech spec page (T15 feature 4, design page 10): box contracts, the entity model, lifecycles
// as state diagrams, non-functional requirements and how they are proved, the decision log and
// the corrections. The right panel shows the selected box: its contract, what it traces to, the
// scenarios that prove it, where rehearse shows it, and its change rule.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ReviewEpicView } from '../contract.js';
import { knownIds, type KnownIds } from '../model/links.js';
import { boxScenarios, openPlaces } from '../model/prd.js';
import { approvalState } from '../model/storyboard.js';
import {
  boxContracts,
  boxDecisions,
  boxRequirements,
  changeRule,
  entityCards,
  lifecycleGraphs,
  lifecycleLayout,
  nonFunctional,
  techContents,
  type ContractRow,
  type LifecycleGraph,
} from '../model/techspec.js';
import { BoxChip, ContentsRail, IdLink, LinkedText, LinkLegend, proofClass, type Go } from './IdLink.js';
import { stateClass } from './PrdView.js';

/** The id of the element a focus names, e.g. `entity:Order` → `ts-entity-Order`. */
function focusTarget(focus: string | undefined): string | undefined {
  const m = /^(entity|decision|correction|box):(.+)$/.exec(focus ?? '');
  return m ? `ts-${m[1]}-${m[2]}` : undefined;
}

export function TechSpecView({ view, focus, onGo }: { view: ReviewEpicView; focus?: string; onGo: Go }) {
  const known = useMemo(() => knownIds(view), [view]);
  const contracts = useMemo(() => boxContracts(view), [view]);
  const rowOf = useMemo(() => new Map(contracts.map((r) => [r.path, r])), [contracts]);
  const focusBox = /^box:(.+)$/.exec(focus ?? '')?.[1];
  const [selected, setSelected] = useState<string | undefined>(focusBox ?? contracts.find((r) => r.main)?.path ?? contracts[0]?.path);
  const [allBoxes, setAllBoxes] = useState(false);
  useEffect(() => {
    if (focusBox) setSelected(focusBox);
    // A box behind "show more" opens the full list.
    if (focusBox && rowOf.get(focusBox) && !rowOf.get(focusBox)!.main) setAllBoxes(true);
    const id = focusTarget(focus);
    if (id) document.getElementById(id)?.scrollIntoView?.({ block: 'center' });
  }, [focus, focusBox, rowOf]);
  const chip = (path: string) => <BoxChip key={path} path={path} row={rowOf.get(path)} onGo={onGo} />;
  const hidden = contracts.filter((r) => !r.main).length;
  const shown = allBoxes ? contracts : contracts.filter((r) => r.main);
  const focused = focusTarget(focus);

  return (
    <div className="doc-layout" data-testid="techspec-view">
      <ContentsRail items={techContents(view)} prefix="ts" label="Tech spec contents" />
      <article className="page doc-page">
        <h1 className="doc-title">Tech spec · {view.prd?.epic?.title ?? view.slug}</h1>
        <LinkLegend />
        <section id="ts-contracts" aria-labelledby="ts-contracts-h">
          <h2 id="ts-contracts-h">Box contracts</h2>
          <div className="table-wrap">
            <table className="doc-table" data-testid="ts-contracts-table">
              <thead>
                <tr>
                  <th scope="col">Box</th>
                  <th scope="col">Lane</th>
                  <th scope="col">In → out</th>
                  <th scope="col">Writes</th>
                  <th scope="col">Stories</th>
                  <th scope="col">Scenarios approved</th>
                  <th scope="col">
                    <span className="sr-only">Select</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.path} id={`ts-box-${r.path}`} className={r.path === selected ? 'is-selected' : undefined} data-testid={`ts-box-${r.path}`}>
                    <td style={{ paddingLeft: 8 + r.depth * 16 }}>
                      {chip(r.path)} <span className="muted">{r.box.kind}</span>
                    </td>
                    <td>{r.laneLabel}</td>
                    <td className="mono">
                      {r.ins.join(', ') || '–'} → {r.outs.join(', ') || '–'}
                    </td>
                    <td className="mono">{r.writes.map((w) => w.text).join('; ') || '–'}</td>
                    <td>{r.stories.length === 0 ? <span className="muted">none</span> : r.stories.map((s) => <IdLink key={s} link={{ kind: 'story', id: s }} onGo={onGo} />)}</td>
                    <td>
                      <span className={`badge ${proofClass(r.proof.proved, r.proof.approved)}`}>{r.proof.text}</span>
                    </td>
                    <td>
                      <button type="button" className="link select-btn" aria-label={`Select box ${r.path}`} aria-pressed={r.path === selected} onClick={() => setSelected(r.path)}>
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hidden > 0 && (
            <button type="button" className="link show-more" onClick={() => setAllBoxes(!allBoxes)}>
              {allBoxes ? 'Show only the jobs' : `Show ${hidden} more (decisions, start and end boxes)`}
            </button>
          )}
        </section>
        <section id="ts-entities" aria-labelledby="ts-entities-h">
          <h2 id="ts-entities-h">Entity model</h2>
          <div className="story-cards">
            {entityCards(view).map((c) => (
              <div key={c.entity.id} id={`ts-entity-${c.entity.id}`} className={focused === `ts-entity-${c.entity.id}` ? 'doc-card is-selected' : 'doc-card'} data-testid={`ts-entity-${c.entity.id}`}>
                <div className="doc-card-head">
                  <IdLink link={{ kind: 'entity', id: c.entity.id }} onGo={onGo} />
                </div>
                <table className="doc-table compact">
                  <thead>
                    <tr>
                      <th scope="col">Field</th>
                      <th scope="col">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.fields.map((f) => (
                      <tr key={f.name}>
                        <td className="mono">{f.name}</td>
                        <td className="mono">
                          {f.type}
                          {f.refs.map((r) => (
                            <IdLink key={r} link={{ kind: 'entity', id: r }} onGo={onGo} />
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="doc-line">
                  <span className="muted">Written by: </span>
                  {c.writtenBy.length === 0 ? 'no box' : c.writtenBy.map(chip)}
                </p>
              </div>
            ))}
          </div>
        </section>
        <section id="ts-lifecycles" aria-labelledby="ts-lifecycles-h">
          <h2 id="ts-lifecycles-h">Lifecycles</h2>
          {lifecycleGraphs(view).length === 0 && <p className="muted">No entity has a lifecycle.</p>}
          {lifecycleGraphs(view).map((g) => (
            <Lifecycle key={g.entity} graph={g} chip={chip} onGo={onGo} />
          ))}
        </section>
        <section id="ts-non-functional" aria-labelledby="ts-nf-h">
          <h2 id="ts-nf-h">Non-functional</h2>
          {nonFunctional(view).length === 0 ? (
            <p className="muted">No non-functional requirements.</p>
          ) : (
            <table className="doc-table" data-testid="ts-non-functional">
              <thead>
                <tr>
                  <th scope="col">Id</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Text</th>
                  <th scope="col">Proved by</th>
                  <th scope="col">Stories</th>
                </tr>
              </thead>
              <tbody>
                {nonFunctional(view).map((r) => (
                  <tr key={r.requirement.id}>
                    <td>
                      <IdLink link={{ kind: 'requirement', id: r.requirement.id }} onGo={onGo} />
                    </td>
                    <td>{r.requirement.kind}</td>
                    <td>
                      <LinkedText text={r.requirement.text} known={known} onGo={onGo} />
                    </td>
                    <td>{r.provenBy ? <LinkedText text={r.provenBy} known={known} onGo={onGo} /> : <span className="badge status-stale">not stated: a gap (D22)</span>}</td>
                    <td>{r.stories.map((s) => <IdLink key={s} link={{ kind: 'story', id: s }} onGo={onGo} />)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <Decisions view={view} known={known} focused={focused} onGo={onGo} />
      </article>
      <aside className="doc-panel" data-testid="ts-panel" aria-label="Selected box">
        {selected && rowOf.get(selected) ? <BoxPanel view={view} row={rowOf.get(selected)!} known={known} onGo={onGo} /> : <p className="muted">Select a box to see its contract.</p>}
      </aside>
    </div>
  );
}

function Lifecycle({ graph, chip, onGo }: { graph: LifecycleGraph; chip: (path: string) => ReactNode; onGo: Go }) {
  const lay = lifecycleLayout(graph);
  const label = (from: string, to: string) => {
    const t = graph.transitions.find((x) => x.from === from && x.to === to);
    return t ? (t.boxes.length > 0 ? t.boxes.join(', ') : t.by) : '';
  };
  return (
    <div className="lifecycle" data-testid={`ts-lifecycle-${graph.entity}`}>
      <h3>
        <IdLink link={{ kind: 'entity', id: graph.entity }} onGo={onGo} />.{graph.field}
      </h3>
      <div className="lifecycle-svg">
        <svg width={lay.width} height={lay.height} viewBox={`0 0 ${lay.width} ${lay.height}`} role="img" aria-label={`Lifecycle of ${graph.entity}.${graph.field}: states ${graph.states.join(', ')}`}>
          <defs>
            <marker id={`arrow-${graph.entity}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          <circle cx={lay.start.x} cy={lay.start.y} r={5} className="lc-start" />
          <path d={lay.start.d} className="lc-arrow" markerEnd={`url(#arrow-${graph.entity})`} />
          {lay.states.map((s) => (
            <g key={s.id}>
              <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={8} className={s.initial ? 'lc-state is-initial' : 'lc-state'} />
              <text x={s.x + s.w / 2} y={s.y + s.h / 2 + 4} textAnchor="middle" className="lc-state-text">
                {s.id}
              </text>
            </g>
          ))}
          {lay.arrows.map((a) => (
            <g key={`${a.from}-${a.to}`}>
              <path d={a.d} className={a.forward ? 'lc-arrow' : 'lc-arrow is-back'} fill="none" markerEnd={`url(#arrow-${graph.entity})`} />
              <text x={a.labelX} y={a.labelY} textAnchor="middle" className="lc-label">
                {label(a.from, a.to)}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <ul className="lc-list" aria-label={`Transitions of ${graph.entity}`}>
        {graph.createdBy.length > 0 && (
          <li>
            created as <strong>{graph.initial}</strong> by {graph.createdBy.map(chip)}
          </li>
        )}
        {graph.transitions.map((t) => (
          <li key={`${t.from}-${t.to}`}>
            <strong>{t.from}</strong> → <strong>{t.to}</strong> by {t.by}
            {t.when && <span className="muted"> when {t.when}</span>}
            {' · '}
            {t.boxes.length === 0 ? <span className="badge status-stale">no box makes this transition</span> : t.boxes.map(chip)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Decisions({ view, known, focused, onGo }: { view: ReviewEpicView; known: KnownIds; focused: string | undefined; onGo: Go }) {
  const decisions = view.decisions ?? [];
  const corrections = view.corrections ?? [];
  return (
    <>
      <section id="ts-decisions" aria-labelledby="ts-decisions-h">
        <h2 id="ts-decisions-h">Decisions</h2>
        {decisions.length === 0 ? (
          <p className="muted">brainstorm.md has no decisions.</p>
        ) : (
          <dl className="decision-log" data-testid="ts-decision-log">
            {decisions.map((d) => (
              <div key={d.ids.join('/')} id={`ts-decision-${d.ids[0]}`} className={d.ids.some((id) => focused === `ts-decision-${id}`) ? 'is-selected' : undefined} data-testid={`ts-decision-${d.ids.join('/')}`}>
                <dt>
                  {d.ids.map((id) => (
                    <span key={id} id={id === d.ids[0] ? undefined : `ts-decision-${id}`} className="decision-id">
                      {id}
                    </span>
                  ))}{' '}
                  {d.title}
                </dt>
                <dd>
                  <LinkedText text={d.text} known={known} onGo={onGo} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <section id="ts-corrections" aria-labelledby="ts-corrections-h">
        <h2 id="ts-corrections-h">Corrections</h2>
        {corrections.length === 0 ? (
          <p className="muted">corrections.md has no entries.</p>
        ) : (
          <ul className="corrections" data-testid="ts-corrections">
            {corrections.map((c) => (
              <li key={c.id} id={`ts-correction-${c.id}`} className={focused === `ts-correction-${c.id}` ? 'is-selected' : undefined}>
                <strong>{c.id}</strong> <span className="pill">{c.tag}</span> <LinkedText text={c.about} known={known} onGo={onGo} />
                {c.status && <span className={`badge ${c.status.startsWith('DONE') ? 'status-approved' : 'status-stale'}`}>{c.status}</span>}
                {c.notes.length > 0 && (
                  <dl className="kv">
                    {c.notes.map((n, i) => (
                      <div key={i} className="kv-row">
                        <dt>{n.label}</dt>
                        <dd>
                          <LinkedText text={n.text} known={known} onGo={onGo} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function BoxPanel({ view, row, known, onGo }: { view: ReviewEpicView; row: ContractRow; known: KnownIds; onGo: Go }) {
  const reqs = boxRequirements(view, row.path);
  const decisions = boxDecisions(view, row.path, known);
  const scenarios = boxScenarios(view, row.path);
  return (
    <div data-testid={`ts-panel-${row.path}`}>
      <h2>
        <IdLink link={{ kind: 'box', id: row.path }} onGo={onGo} /> {row.box.title}
      </h2>
      <h3>Contract</h3>
      <dl className="kv">
        <div className="kv-row">
          <dt>kind</dt>
          <dd>{row.box.kind}</dd>
        </div>
        <div className="kv-row">
          <dt>lane</dt>
          <dd>{row.laneLabel}</dd>
        </div>
        <div className="kv-row">
          <dt>in → out</dt>
          <dd>
            {row.ins.join(', ') || 'nothing'} → {row.outs.join(', ') || 'nothing'}
          </dd>
        </div>
        <div className="kv-row">
          <dt>writes</dt>
          <dd>{row.writes.map((w) => w.text).join('; ') || 'nothing'}</dd>
        </div>
        <div className="kv-row">
          <dt>reads</dt>
          <dd>{row.reads.join(', ') || 'nothing'}</dd>
        </div>
      </dl>
      <h3>Traces to</h3>
      <p className="doc-line">
        <span className="muted">Requirements: </span>
        {reqs.length === 0 ? 'none' : reqs.map((r) => <IdLink key={r} link={{ kind: 'requirement', id: r }} onGo={onGo} />)}
      </p>
      <p className="doc-line">
        <span className="muted">Stories: </span>
        {row.stories.length === 0 ? 'none' : row.stories.map((s) => <IdLink key={s} link={{ kind: 'story', id: s }} onGo={onGo} />)}
      </p>
      <p className="doc-line">
        <span className="muted">Decisions: </span>
        {decisions.length === 0 ? 'none' : decisions.map((d) => <IdLink key={d} link={{ kind: 'decision', id: d }} onGo={onGo} />)}
      </p>
      <h3>Proved by</h3>
      <p>
        <span className={`badge ${proofClass(row.proof.proved, row.proof.approved)}`}>{row.proof.text}</span>
        {row.proof.signText && ` ${row.proof.signText}`}
      </p>
      {scenarios.length > 0 && (
        <ul className="open-places">
          {scenarios.map((sv) => {
            const state = approvalState(sv, view.approvals);
            return (
              <li key={sv.scenario.id}>
                <IdLink link={{ kind: 'scenario', id: sv.scenario.id }} onGo={onGo} /> <span className={`badge ${stateClass({ id: sv.scenario.id, state })}`}>{state.text}</span>
              </li>
            );
          })}
        </ul>
      )}
      <h3>Shown in</h3>
      <ul className="open-places">
        {openPlaces(view, { kind: 'box', id: row.path })
          .filter((p) => p.place.view !== 'techspec')
          .map((p, i) => (
            <li key={i}>
              <button type="button" className="link" onClick={() => onGo(p.place)}>
                Open in {p.label}
              </button>{' '}
              <span className="muted">{p.detail}</span>
            </li>
          ))}
      </ul>
      <h3>Change rule</h3>
      <p data-testid="change-rule">
        <LinkedText text={changeRule(row.stories)} known={known} onGo={onGo} />
      </p>
    </div>
  );
}
