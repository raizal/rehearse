// The Tech spec page (T15 feature 4, design page 10): box contracts, the entity model, lifecycles
// as state diagrams, non-functional requirements and how they are proved, the decision log and
// the corrections. The right panel shows the selected box: its contract, what it traces to, the
// scenarios that prove it, where rehearse shows it, and its change rule.
// T18: the frame of the design, as on the PRD page: a page header, then contents · document ·
// selected box as three full-height cards, each scrolling inside.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ReviewEpicView } from '../contract.js';
import { chipWidth, knownIds, legendSamples, type KnownIds } from '../model/links.js';
import { boxScenarios, openPlaces } from '../model/prd.js';
import { approvalState } from '../model/storyboard.js';
import {
  boxContracts,
  boxDecisions,
  boxRequirements,
  changeRule,
  entityCards,
  isFirstRow,
  lifecycleGraphs,
  lifecycleLayout,
  nonFunctional,
  TECH_SUMMARY,
  techContents,
  writtenEntities,
  type ContractRow,
  type LifecycleGraph,
} from '../model/techspec.js';
import { BoxChip, ContentsRail, DocHeader, Dot, IdLink, LinkedText, OpenRows, proofClass, SectionHead, useActiveSection, type Go } from './IdLink.js';
import { selectOnClick, stateClass } from './PrdView.js';

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
    if (focusBox && rowOf.get(focusBox) && !isFirstRow(rowOf.get(focusBox)!)) setAllBoxes(true);
    const id = focusTarget(focus);
    if (id) document.getElementById(id)?.scrollIntoView?.({ block: 'center' });
  }, [focus, focusBox, rowOf]);
  const chip = (path: string) => <BoxChip key={path} path={path} row={rowOf.get(path)} onGo={onGo} />;
  const hidden = contracts.filter((r) => !isFirstRow(r)).length;
  const roots = contracts.filter((r) => r.depth === 0).length;
  const shown = allBoxes ? contracts : contracts.filter(isFirstRow);
  const focused = focusTarget(focus);
  const contents = techContents(view);
  const rail = useActiveSection(
    'ts',
    contents.map((c) => c.id),
  );
  const samples = useMemo(() => legendSamples(known, selected ? { box: selected } : {}), [known, selected]);
  const writes = new Set(selected && rowOf.get(selected) ? writtenEntities(rowOf.get(selected)!) : []);
  const nf = nonFunctional(view);
  const lifecycles = lifecycleGraphs(view);

  return (
    <div className="doc-screen" data-testid="techspec-view">
      <DocHeader title="Tech spec" summary={TECH_SUMMARY} source="flow.yaml · entities.yaml" samples={samples} />
      <div className="doc-layout">
        <ContentsRail items={contents} prefix="ts" label="Tech spec contents" active={rail.active} onPick={rail.setActive} />
        <article className="doc-page" aria-label="Tech spec document" onScroll={rail.onScroll}>
          <section id="ts-contracts" aria-labelledby="ts-contracts-h">
            <SectionHead id="ts-contracts-h" title="Box contracts" count={`${roots} root boxes`}>
              <span className="doc-section-note">Each box declares its inputs, outputs, state writes and error exits (D10).</span>
            </SectionHead>
            <table className="doc-table contracts-table" data-testid="ts-contracts-table">
              <colgroup>
                <col style={{ width: 158 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 240 }} />
                <col />
                <col style={{ width: 120 }} />
                <col style={{ width: 110 }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Box</th>
                  <th scope="col">Lane</th>
                  <th scope="col">In → out</th>
                  <th scope="col">Writes</th>
                  <th scope="col">Stories</th>
                  <th scope="col">Scenarios</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const io = `${r.ins.join(', ') || '–'} → ${r.outs.join(', ') || '–'}`;
                  const ents = writtenEntities(r);
                  return (
                    <tr key={r.path} id={`ts-box-${r.path}`} className={r.path === selected ? 'is-selected' : undefined} data-testid={`ts-box-${r.path}`} onClick={selectOnClick(() => setSelected(r.path))}>
                      <td className="cell-box" style={{ paddingLeft: 8 + r.depth * 14 }}>
                        {chip(r.path)}
                        {!r.main && <span className="muted"> {r.box.kind}</span>}
                        <button type="button" className="select-btn" aria-label={`Select box ${r.path}`} aria-pressed={r.path === selected} onClick={() => setSelected(r.path)}>
                          Select
                        </button>
                      </td>
                      <td>
                        <span className={`chip role-${r.box.lane}`}>{r.laneLabel}</span>
                      </td>
                      <td>
                        <span className="cell-line" title={io}>
                          {io}
                        </span>
                      </td>
                      <td title={r.writes.map((w) => w.text).join('; ')}>
                        {ents.length === 0 ? (
                          <span className="muted">reads only</span>
                        ) : (
                          <span className="cell-chips">
                            {ents.map((e) => (known.entities.has(e) ? <IdLink key={e} link={{ kind: 'entity', id: e }} onGo={onGo} /> : <span key={e}>{e}</span>))}
                            <span className="sr-only">: {r.writes.map((w) => w.text).join('; ')}</span>
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="cell-chips">{r.stories.length === 0 ? <span className="muted">none</span> : r.stories.map((s) => <IdLink key={s} link={{ kind: 'story', id: s }} onGo={onGo} />)}</span>
                      </td>
                      <td>
                        {r.proof.total === 0 ? (
                          <span className="muted">none</span>
                        ) : (
                          <span className="proof-cell">
                            <Dot tone={proofClass(r.proof.proved, r.proof.approved)} label={r.proof.signText} />
                            {r.proof.approved}/{r.proof.total} approved
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {hidden > 0 && (
              <button type="button" className="link show-more" onClick={() => setAllBoxes(!allBoxes)}>
                {allBoxes ? 'Show only the root jobs' : `Show ${hidden} more boxes (decisions, start and end, inner boxes)`}
              </button>
            )}
          </section>
          <section id="ts-entities" aria-labelledby="ts-entities-h">
            <SectionHead id="ts-entities-h" title="Entity model" count={`${entityCards(view).length} entities`} />
            <div className="entity-cards">
              {entityCards(view).map((c) => (
                <div
                  key={c.entity.id}
                  id={`ts-entity-${c.entity.id}`}
                  className={`doc-card entity-card${focused === `ts-entity-${c.entity.id}` ? ' is-selected' : ''}${writes.has(c.entity.id) ? ' is-written' : ''}`}
                  data-testid={`ts-entity-${c.entity.id}`}
                >
                  <div className="doc-card-head">
                    <IdLink link={{ kind: 'entity', id: c.entity.id }} onGo={onGo} />
                    {writes.has(c.entity.id) && <span className="sr-only">written by the selected box</span>}
                  </div>
                  {c.entity.about && <p className="entity-about">{c.entity.about}</p>}
                  <dl className="entity-fields">
                    {c.fields.map((f) => (
                      <div key={f.name}>
                        <dt>{f.name}</dt>
                        <dd>
                          {f.plain}{' '}
                          {f.refs.map((r) => (
                            <IdLink key={r} link={{ kind: 'entity', id: r }} onGo={onGo} />
                          ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>
          <section id="ts-lifecycles" aria-labelledby="ts-lifecycles-h">
            <SectionHead id="ts-lifecycles-h" title="Lifecycles" count={lifecycles.length} />
            {lifecycles.length === 0 && <p className="muted">No entity has a lifecycle.</p>}
            {lifecycles.map((g) => (
              <Lifecycle key={g.entity} graph={g} chip={chip} onGo={onGo} />
            ))}
          </section>
          <section id="ts-non-functional" aria-labelledby="ts-nf-h">
            <SectionHead id="ts-nf-h" title="Non-functional requirements" count={nf.length} />
            {nf.length === 0 ? (
              <p className="muted">No non-functional requirements.</p>
            ) : (
              <table className="doc-table nf-table" data-testid="ts-non-functional">
                <colgroup>
                  <col style={{ width: 54 }} />
                  <col style={{ width: 110 }} />
                  <col />
                  <col style={{ width: 300 }} />
                </colgroup>
                <thead className="sr-only">
                  <tr>
                    <th scope="col">Id</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Text</th>
                    <th scope="col">Proved by</th>
                  </tr>
                </thead>
                <tbody>
                  {nf.map((r) => (
                    <tr key={r.requirement.id}>
                      <td>
                        <IdLink link={{ kind: 'requirement', id: r.requirement.id }} onGo={onGo} />
                      </td>
                      <td>
                        <span className="doc-tag">{r.requirement.kind}</span>
                      </td>
                      <td>
                        <span className="cell-line" title={r.requirement.text}>
                          <LinkedText text={r.requirement.text} known={known} onGo={onGo} />
                        </span>
                        {r.stories.map((s) => (
                          <IdLink key={s} link={{ kind: 'story', id: s }} onGo={onGo} />
                        ))}
                      </td>
                      <td>
                        {r.provenBy ? (
                          <span className="nf-proof">
                            proved by: <LinkedText text={r.provenBy} known={known} onGo={onGo} />
                          </span>
                        ) : (
                          <span className="badge status-stale">not stated: a gap (D22)</span>
                        )}
                      </td>
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
      <h3 className="lifecycle-head">
        <span>Lifecycle</span>
        <IdLink link={{ kind: 'entity', id: graph.entity }} onGo={onGo}>
          {graph.entity}.{graph.field}
        </IdLink>
        <span className="doc-section-note">Any other transition is an error. Each arrow is done by one box.</span>
      </h3>
      <div className="lifecycle-row">
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
                <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.h / 2} className={s.initial ? 'lc-state is-initial' : 'lc-state'} />
                <text x={s.x + s.w / 2} y={s.y + s.h / 2 + 4} textAnchor="middle" className="lc-state-text">
                  {s.id}
                </text>
              </g>
            ))}
            {lay.arrows.map((a) => {
              const text = label(a.from, a.to);
              const w = chipWidth(text) - 4;
              return (
                <g key={`${a.from}-${a.to}`}>
                  <path d={a.d} className={a.forward ? 'lc-arrow' : 'lc-arrow is-back'} fill="none" markerEnd={`url(#arrow-${graph.entity})`} />
                  <rect x={a.labelX - w / 2} y={a.labelY - 12} width={w} height={17} rx={4} className="lc-label-bg" />
                  <text x={a.labelX} y={a.labelY} textAnchor="middle" className="lc-label">
                    {text}
                  </text>
                </g>
              );
            })}
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
  const errors = Array.isArray(row.box.errorExits) ? row.box.errorExits : [];
  const entityChip = (target: string, text: string, key: string) => {
    const e = target.split('.')[0]!;
    return known.entities.has(e) ? (
      <IdLink key={key} link={{ kind: 'entity', id: e }} onGo={onGo}>
        {text}
      </IdLink>
    ) : (
      <span key={key} className="mono">
        {text}
      </span>
    );
  };
  return (
    <div className="panel-body" data-testid={`ts-panel-${row.path}`}>
      <p className="doc-eyebrow">Selected box · linked in rehearse</p>
      <h2 className="panel-id">
        <IdLink link={{ kind: 'box', id: row.path }} onGo={onGo} />
        <span className="doc-tag">{row.box.kind}</span>
        <span className={`chip role-${row.box.lane}`}>{row.laneLabel} lane</span>
      </h2>
      <p className="panel-title">{row.box.title}</p>
      <dl className="contract-card" role="group" aria-label="Contract">
        <div>
          <dt>inputs</dt>
          <dd>{row.ins.join(', ') || 'nothing'}</dd>
        </div>
        <div>
          <dt>outputs</dt>
          <dd>{row.outs.join(', ') || 'nothing'}</dd>
        </div>
        <div>
          <dt>writes</dt>
          <dd className="contract-chips">{row.writes.length === 0 ? 'nothing' : row.writes.map((w) => entityChip(w.target, w.text.replace(/: written$/, ''), w.text))}</dd>
        </div>
        {row.reads.length > 0 && (
          <div>
            <dt>reads</dt>
            <dd className="contract-chips">{row.reads.map((r) => entityChip(r, r, r))}</dd>
          </div>
        )}
        <div>
          <dt>errors</dt>
          <dd>{errors.join(', ') || 'none'}</dd>
        </div>
      </dl>
      <h3 className="doc-eyebrow">Traces to</h3>
      <p className="panel-chips">
        {row.stories.map((s) => (
          <IdLink key={s} link={{ kind: 'story', id: s }} onGo={onGo} />
        ))}
        {reqs.map((r) => (
          <IdLink key={r} link={{ kind: 'requirement', id: r }} onGo={onGo} />
        ))}
        {decisions.map((d) => (
          <IdLink key={d} link={{ kind: 'decision', id: d }} onGo={onGo} />
        ))}
        {row.stories.length + reqs.length + decisions.length === 0 && <span className="muted">No story, requirement or decision yet.</span>}
      </p>
      <h3 className="doc-eyebrow">Proved by</h3>
      {scenarios.length === 0 ? (
        <p className="muted">No scenario goes through this box.</p>
      ) : (
        <>
          <p className="panel-chips">
            {scenarios.map((sv) => {
              const state = approvalState(sv, view.approvals);
              const tone = stateClass({ id: sv.scenario.id, state });
              return (
                <span key={sv.scenario.id} className="proof-item">
                  <IdLink link={{ kind: 'scenario', id: sv.scenario.id }} onGo={onGo} />
                  <Dot tone={tone} label={state.text} />
                </span>
              );
            })}
          </p>
          <p className={`panel-proof ${proofClass(row.proof.proved, row.proof.approved)}`}>
            {row.proof.approved} approved{row.proof.signText && ` · ${row.proof.signText}`}
          </p>
        </>
      )}
      <h3 className="doc-eyebrow">Shown in the tool</h3>
      <OpenRows places={openPlaces(view, { kind: 'box', id: row.path }).filter((p) => p.place.view !== 'techspec')} onGo={onGo} label="Shown in the tool" />
      <div className="gate-note is-ok" role="note">
        <strong>Change rule</strong>
        <p data-testid="change-rule">
          <LinkedText text={changeRule(row.stories)} known={known} onGo={onGo} />
        </p>
      </div>
    </div>
  );
}
