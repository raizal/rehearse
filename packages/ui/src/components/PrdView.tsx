// The PRD page (T15 feature 3, design page 9): the EPIC, its roles, requirements with their proof,
// stories with the scenario that proves each acceptance criterion, out of scope and resolved
// questions. Every id is a link (feature 2). The right panel shows the selected id: its text,
// the decisions it cites, its trace, every view that shows it and, when it is not proved, why.

import { useEffect, useMemo, useState } from 'react';
import type { Id, RequirementKind } from '@rehearse/core';
import type { ReviewEpicView } from '../contract.js';
import { knownIds, type KnownIds, type LinkRef } from '../model/links.js';
import { gateNote, openPlaces, prdDoc, traceOf, type PrdDoc, type TraceScenario } from '../model/prd.js';
import { boxContracts, type ContractRow } from '../model/techspec.js';
import { BoxChip, ContentsRail, IdLink, LinkedText, LinkLegend, proofClass, type Go } from './IdLink.js';

const FIRST_ROWS = 6;

export function stateClass(s: TraceScenario): string {
  if (s.state.done) return 'status-approved';
  if (s.state.kind === 'draft') return 'status-draft';
  if (s.state.kind === 'stale') return 'status-stale';
  return 'status-unsigned';
}

/** `requirement:R1`, `story:S1`, … to a link. */
function refOf(focus: string | undefined): LinkRef | undefined {
  const m = /^(requirement|story|box|scenario):(.+)$/.exec(focus ?? '');
  return m ? { kind: m[1] as LinkRef['kind'], id: m[2]! } : undefined;
}

export function PrdView({ view, focus, onGo }: { view: ReviewEpicView; focus?: string; onGo: Go }) {
  const known = useMemo(() => knownIds(view), [view]);
  const doc = useMemo(() => prdDoc(view, known), [view, known]);
  const rows = useMemo(() => new Map(boxContracts(view).map((r) => [r.path, r])), [view]);
  const first = doc.requirements[0] ? ({ kind: 'requirement', id: doc.requirements[0].requirement.id } as LinkRef) : undefined;
  const [selected, setSelected] = useState<LinkRef | undefined>(refOf(focus) ?? first);
  useEffect(() => {
    const ref = refOf(focus);
    if (ref) setSelected(ref);
  }, [focus]);
  const chip = (path: string) => <BoxChip key={path} path={path} row={rows.get(path)} onGo={onGo} />;

  return (
    <div className="doc-layout" data-testid="prd-view">
      <ContentsRail items={doc.contents} prefix="prd" label="PRD contents" />
      <article className="page doc-page">
        <h1 className="doc-title">PRD · {doc.title}</h1>
        <LinkLegend />
        <section id="prd-goal" aria-labelledby="prd-goal-h">
          <h2 id="prd-goal-h">Goal</h2>
          <p>
            <LinkedText text={doc.goal} known={known} onGo={onGo} />
          </p>
          {doc.successMeasure && (
            <p>
              <strong>Success measure: </strong>
              <LinkedText text={doc.successMeasure} known={known} onGo={onGo} />
            </p>
          )}
        </section>
        <section id="prd-roles" aria-labelledby="prd-roles-h">
          <h2 id="prd-roles-h">Roles</h2>
          <ul className="doc-roles">
            {doc.roles.map((r) => (
              <li key={r.id}>
                <strong>{r.name}</strong> <span className="pill">{r.kind}</span>
                {r.about && <span className="muted"> {r.about}</span>}
              </li>
            ))}
          </ul>
        </section>
        <Requirements doc={doc} known={known} onGo={onGo} onSelect={setSelected} selected={selected} />
        <section id="prd-stories" aria-labelledby="prd-stories-h">
          <h2 id="prd-stories-h">Stories</h2>
          <div className="story-cards">
            {doc.stories.map((c) => (
              <div key={c.story.id} className={selected?.kind === 'story' && selected.id === c.story.id ? 'doc-card is-selected' : 'doc-card'} data-testid={`prd-story-${c.story.id}`}>
                <div className="doc-card-head">
                  <IdLink link={{ kind: 'story', id: c.story.id }} onGo={onGo} />
                  <span className="pill">{c.roleLabel}</span>
                  <span className={`badge ${proofClass(c.proof.proved, c.proof.approved)}`}>{c.proof.text}</span>
                  <button type="button" className="link select-btn" aria-label={`Select ${c.story.id}`} aria-pressed={selected?.kind === 'story' && selected.id === c.story.id} onClick={() => setSelected({ kind: 'story', id: c.story.id })}>
                    Details
                  </button>
                </div>
                <p>
                  As {c.roleLabel}, I want <LinkedText text={c.story.want} known={known} onGo={onGo} />, so that <LinkedText text={c.story.soThat} known={known} onGo={onGo} />.
                </p>
                <p className="doc-line">
                  <span className="muted">Requirements: </span>
                  {(c.story.requirements ?? []).map((r) => (
                    <IdLink key={r} link={{ kind: 'requirement', id: r }} onGo={onGo} />
                  ))}
                </p>
                <p className="doc-line">
                  <span className="muted">Boxes: </span>
                  {c.boxes.length === 0 ? 'no box serves this story yet' : c.boxes.map(chip)}
                </p>
                <ul className="criteria">
                  {c.criteria.map((cr) => (
                    <li key={cr.criterion.id}>
                      <IdLink link={{ kind: 'story', id: cr.criterion.id }} onGo={onGo} /> Given {cr.criterion.given}, when {cr.criterion.when}, then {cr.criterion.then}.
                      <span className="doc-line">
                        <span className="muted"> Proved by: </span>
                        {cr.provedBy.length === 0
                          ? 'no scenario yet'
                          : cr.provedBy.map((s) => (
                              <span key={s.id} className="proof-item">
                                <IdLink link={{ kind: 'scenario', id: s.id }} onGo={onGo} />
                                <span className={`badge ${stateClass(s)}`}>{s.state.text}</span>
                              </span>
                            ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
        <section id="prd-out-of-scope" aria-labelledby="prd-oos-h">
          <h2 id="prd-oos-h">Out of scope</h2>
          {doc.outOfScope.length === 0 ? (
            <p className="muted">Nothing is listed as out of scope.</p>
          ) : (
            <ul>
              {doc.outOfScope.map((t, i) => (
                <li key={i}>
                  <LinkedText text={t} known={known} onGo={onGo} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section id="prd-resolved" aria-labelledby="prd-resolved-h">
          <h2 id="prd-resolved-h">Resolved questions</h2>
          {doc.resolved.length === 0 ? (
            <p className="muted">No resolved questions.</p>
          ) : (
            <dl className="resolved">
              {doc.resolved.map((q, i) => (
                <div key={i}>
                  <dt>{q.question}</dt>
                  <dd>
                    <LinkedText text={q.answer} known={known} onGo={onGo} /> <span className="muted">({q.at})</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </article>
      <aside className="doc-panel" data-testid="prd-panel" aria-label="Selected id">
        {selected ? <SelectedPanel view={view} doc={doc} known={known} rows={rows} selected={selected} onGo={onGo} /> : <p className="muted">Select an id to see its trace.</p>}
      </aside>
    </div>
  );
}

function Requirements({ doc, known, onGo, onSelect, selected }: { doc: PrdDoc; known: KnownIds; onGo: Go; onSelect: (r: LinkRef) => void; selected: LinkRef | undefined }) {
  const [kind, setKind] = useState<RequirementKind | 'all'>('all');
  const [all, setAll] = useState(false);
  const shown = doc.requirements.filter((r) => kind === 'all' || r.requirement.kind === kind);
  const rows = all ? shown : shown.slice(0, FIRST_ROWS);
  return (
    <section id="prd-requirements" aria-labelledby="prd-req-h">
      <h2 id="prd-req-h">Requirements</h2>
      <div className="filters" role="group" aria-label="Filter requirements by kind">
        <button type="button" className="pill" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>
          All {doc.requirements.length}
        </button>
        {doc.kinds.map((k) => (
          <button key={k.kind} type="button" className="pill" aria-pressed={kind === k.kind} onClick={() => setKind(k.kind)}>
            {k.kind} {k.count}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="doc-table" data-testid="prd-requirements">
          <thead>
            <tr>
              <th scope="col">Id</th>
              <th scope="col">Kind</th>
              <th scope="col">Text</th>
              <th scope="col">Stories</th>
              <th scope="col">Proof</th>
              <th scope="col">
                <span className="sr-only">Select</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const id = r.requirement.id;
              const on = selected?.kind === 'requirement' && selected.id === id;
              return (
                <tr key={id} className={on ? 'is-selected' : undefined} data-testid={`prd-req-${id}`}>
                  <td>
                    <IdLink link={{ kind: 'requirement', id }} onGo={onGo} />
                  </td>
                  <td>{r.requirement.kind}</td>
                  <td>
                    <LinkedText text={r.requirement.text} known={known} onGo={onGo} />
                  </td>
                  <td>{r.stories.length === 0 ? <span className="muted">none</span> : r.stories.map((s) => <IdLink key={s} link={{ kind: 'story', id: s }} onGo={onGo} />)}</td>
                  <td>
                    <span className={`badge ${proofClass(r.proof.proved, r.proof.approved)}`}>{r.proof.text}</span>
                    {r.proof.signText && <span className="proof-sign">{r.proof.signText}</span>}
                  </td>
                  <td>
                    <button type="button" className="link select-btn" aria-label={`Select ${id}`} aria-pressed={on} onClick={() => onSelect({ kind: 'requirement', id })}>
                      Details
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.length > FIRST_ROWS && (
        <button type="button" className="link show-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show ${shown.length - FIRST_ROWS} more`}
        </button>
      )}
    </section>
  );
}

function SelectedPanel({ view, doc, known, rows, selected, onGo }: { view: ReviewEpicView; doc: PrdDoc; known: KnownIds; rows: Map<string, ContractRow>; selected: LinkRef; onGo: Go }) {
  const req = selected.kind === 'requirement' ? doc.requirements.find((r) => r.requirement.id === selected.id) : undefined;
  const card = selected.kind === 'story' ? doc.stories.find((s) => s.story.id === selected.id) : undefined;
  const text = req?.requirement.text ?? (card ? `As ${card.roleLabel}, I want ${card.story.want}, so that ${card.story.soThat}.` : '');
  const cites: Id[] = req?.cites ?? [];
  const proof = req?.proof ?? card?.proof;
  const note = proof && gateNote(selected.id, proof);
  const trace = traceOf(view, selected);
  return (
    <div data-testid={`prd-panel-${selected.id}`}>
      <h2>
        <IdLink link={selected} onGo={onGo} />
      </h2>
      {text && (
        <p>
          <LinkedText text={text} known={known} onGo={onGo} />
        </p>
      )}
      {proof && (
        <p>
          <span className={`badge ${proofClass(proof.proved, proof.approved)}`}>{proof.proved ? 'proved' : 'not proved yet'}</span> {proof.text}
          {proof.signText && `, ${proof.signText}`}
        </p>
      )}
      {note && (
        <p className="gate-note" data-testid="gate-note" role="note">
          {note}
        </p>
      )}
      <h3>Decisions it cites</h3>
      {cites.length === 0 ? <p className="muted">None.</p> : <p>{cites.map((d) => <IdLink key={d} link={{ kind: 'decision', id: d }} onGo={onGo} />)}</p>}
      <h3>Trace</h3>
      {trace.length === 0 ? (
        <p className="muted">Nothing traces to it yet.</p>
      ) : (
        <ul className="trace" data-testid="trace">
          {trace.map((r) => (
            <li key={r.id}>
              <IdLink link={{ kind: 'requirement', id: r.id }} onGo={onGo} />
              {r.stories.length === 0 ? (
                <span className="muted"> no story</span>
              ) : (
                <ul>
                  {r.stories.map((s) => (
                    <li key={s.id}>
                      <IdLink link={{ kind: 'story', id: s.id }} onGo={onGo} />
                      <ul>
                        <li>
                          <span className="muted">boxes: </span>
                          {s.boxes.length === 0 ? 'none' : s.boxes.map((b) => <BoxChip key={b} path={b} row={rows.get(b)} onGo={onGo} />)}
                        </li>
                        {s.scenarios.length === 0 ? (
                          <li className="muted">no scenario</li>
                        ) : (
                          s.scenarios.map((sc) => (
                            <li key={sc.id}>
                              <IdLink link={{ kind: 'scenario', id: sc.id }} onGo={onGo} /> <span className={`badge ${stateClass(sc)}`}>{sc.state.text}</span>
                            </li>
                          ))
                        )}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <h3>Open in rehearse</h3>
      <ul className="open-places">
        {openPlaces(view, selected).map((p, i) => (
          <li key={i}>
            <button type="button" className="link" onClick={() => onGo(p.place)}>
              Open in {p.label}
            </button>{' '}
            <span className="muted">{p.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
