// The PRD page (T15 feature 3, design page 9): the EPIC, its roles, requirements with their proof,
// stories with the scenario that proves each acceptance criterion, out of scope and resolved
// questions. Every id is a link (feature 2). The right panel shows the selected id: its text,
// the decisions it cites, its trace, every view that shows it and, when it is not proved, why.
// T18: the frame of the design: a page header, then three full-height cards side by side
// (contents 220 · document 1020 · selected 560), each scrolling inside.

import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { Id, RequirementKind } from '@rehearse/core';
import type { ReviewEpicView } from '../contract.js';
import { chipWidth, knownIds, legendSamples, type KnownIds, type LinkRef } from '../model/links.js';
import { gateNote, openPlaces, prdDoc, prdSummary, storyBoxes, traceLayout, traceOf, type PrdDoc, type StoryCard, type TraceScenario } from '../model/prd.js';
import { boxContracts, specLinks, type ContractRow } from '../model/techspec.js';
import { BoxChip, ContentsRail, DocHeader, Dot, IdLink, LinkedText, OpenRows, proofClass, SectionHead, useActiveSection, type Go } from './IdLink.js';

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

/** A click on a row or card selects it, unless it was on a control inside. */
export function selectOnClick(select: () => void) {
  return (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button, a') === null) select();
  };
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
  const rail = useActiveSection(
    'prd',
    doc.contents.map((c) => c.id),
  );
  // The box sample is a box the first story runs through, not the start box.
  const samples = useMemo(() => {
    const box = storyBoxes(view, [...known.stories][0] ?? '')[0];
    return legendSamples(known, { ...(box ? { box } : {}), ...(selected ? { [selected.kind]: selected.id } : {}) });
  }, [view, known, selected]);

  return (
    <div className="doc-screen" data-testid="prd-view">
      <DocHeader title="PRD" summary={prdSummary(doc)} source="prd.yaml" samples={samples} />
      <div className="doc-layout">
        <ContentsRail items={doc.contents} prefix="prd" label="PRD contents" active={rail.active} onPick={rail.setActive} />
        <article className="doc-page" aria-label="PRD document" onScroll={rail.onScroll}>
          <Epic view={view} doc={doc} known={known} onGo={onGo} />
          <Requirements doc={doc} known={known} onGo={onGo} onSelect={setSelected} selected={selected} />
          <section id="prd-stories" aria-labelledby="prd-stories-h">
            <SectionHead id="prd-stories-h" title="Stories" count={doc.stories.length} />
            <div className="story-cards">
              {doc.stories.map((c) => (
                <StoryCardView key={c.story.id} card={c} known={known} rows={rows} selected={selected} onSelect={setSelected} onGo={onGo} />
              ))}
            </div>
          </section>
          <section id="prd-out-of-scope" aria-labelledby="prd-oos-h">
            <SectionHead id="prd-oos-h" title="Out of scope" count={doc.outOfScope.length} />
            {doc.outOfScope.length === 0 ? (
              <p className="muted">Nothing is listed as out of scope.</p>
            ) : (
              <ul className="doc-list">
                {doc.outOfScope.map((t, i) => (
                  <li key={i}>
                    <LinkedText text={t} known={known} onGo={onGo} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section id="prd-resolved" aria-labelledby="prd-resolved-h">
            <SectionHead id="prd-resolved-h" title="Resolved questions" count={doc.resolved.length} />
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
    </div>
  );
}

/** The EPIC block at the top of the document: title, goal, success measure and the roles. */
function Epic({ view, doc, known, onGo }: { view: ReviewEpicView; doc: PrdDoc; known: KnownIds; onGo: Go }) {
  return (
    <section id="prd-goal" className="doc-epic" aria-labelledby="prd-goal-h">
      <p className="doc-eyebrow">EPIC · {view.slug}</p>
      <h2 id="prd-goal-h" className="doc-epic-title">
        {doc.title}
      </h2>
      <p className="doc-goal">
        <LinkedText text={doc.goal} known={known} onGo={onGo} />
      </p>
      <dl className="doc-facts">
        {doc.successMeasure && (
          <div>
            <dt>Success measure</dt>
            <dd>
              <LinkedText text={doc.successMeasure} known={known} onGo={onGo} />
            </dd>
          </div>
        )}
        <div id="prd-roles">
          <dt>Roles</dt>
          <dd className="doc-roles">
            {doc.roles.map((r) => (
              <span key={r.id} className={`chip role-${r.id}`} title={r.about}>
                {r.name} · {r.kind}
              </span>
            ))}
            <span className="muted doc-roles-note">→ lane in Flow, actor in Use cases</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}

function ProofCell({ proof }: { proof: PrdDoc['requirements'][number]['proof'] }) {
  const tone = proofClass(proof.proved, proof.approved);
  return (
    <span className="proof-cell">
      <Dot tone={tone} />
      <span>
        <span className="proof-text">{proof.text}</span>
        {proof.signText && <span className={`proof-sign ${tone}`}>{proof.signText}</span>}
      </span>
    </span>
  );
}

function Requirements({ doc, known, onGo, onSelect, selected }: { doc: PrdDoc; known: KnownIds; onGo: Go; onSelect: (r: LinkRef) => void; selected: LinkRef | undefined }) {
  const [kind, setKind] = useState<RequirementKind | 'all'>('all');
  const [all, setAll] = useState(false);
  const shown = doc.requirements.filter((r) => kind === 'all' || r.requirement.kind === kind);
  const rows = all ? shown : shown.slice(0, FIRST_ROWS);
  return (
    <section id="prd-requirements" aria-labelledby="prd-req-h">
      <SectionHead id="prd-req-h" title="Requirements" count={doc.requirements.length}>
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
      </SectionHead>
      <table className="doc-table req-table" data-testid="prd-requirements">
        <colgroup>
          <col style={{ width: 60 }} />
          <col style={{ width: 104 }} />
          <col />
          <col style={{ width: 100 }} />
          <col style={{ width: 196 }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Id</th>
            <th scope="col">Kind</th>
            <th scope="col">Requirement</th>
            <th scope="col">Stories</th>
            <th scope="col">Proof in rehearse</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const id = r.requirement.id;
            const on = selected?.kind === 'requirement' && selected.id === id;
            return (
              <tr key={id} className={on ? 'is-selected' : undefined} data-testid={`prd-req-${id}`} onClick={selectOnClick(() => onSelect({ kind: 'requirement', id }))}>
                <td>
                  <IdLink link={{ kind: 'requirement', id }} onGo={onGo} />
                  <button type="button" className="select-btn" aria-label={`Select ${id}`} aria-pressed={on} onClick={() => onSelect({ kind: 'requirement', id })}>
                    Select
                  </button>
                </td>
                <td>
                  <span className="doc-tag">{r.requirement.kind}</span>
                </td>
                <td>
                  <span className="clamp-2" title={r.requirement.text}>
                    <LinkedText text={r.requirement.text} known={known} onGo={onGo} />
                  </span>
                </td>
                <td>{r.stories.length === 0 ? <span className="muted">none</span> : r.stories.map((s) => <IdLink key={s} link={{ kind: 'story', id: s }} onGo={onGo} />)}</td>
                <td>
                  <ProofCell proof={r.proof} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {shown.length > FIRST_ROWS && (
        <button type="button" className="link show-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer requirements' : `Show ${shown.length - FIRST_ROWS} more requirements`}
        </button>
      )}
    </section>
  );
}

function StoryCardView({ card: c, known, rows, selected, onSelect, onGo }: { card: StoryCard; known: KnownIds; rows: Map<string, ContractRow>; selected: LinkRef | undefined; onSelect: (r: LinkRef) => void; onGo: Go }) {
  const id = c.story.id;
  const on = selected?.kind === 'story' && selected.id === id;
  const linked = on || (selected?.kind === 'requirement' && (c.story.requirements ?? []).includes(selected.id));
  const firstScenario = c.criteria.flatMap((cr) => cr.provedBy)[0]?.id;
  const chip = (path: string) => <BoxChip key={path} path={path} row={rows.get(path)} onGo={onGo} />;
  return (
    <div className={`doc-card story-card${on ? ' is-selected' : ''}${linked ? ' is-linked' : ''}`} data-testid={`prd-story-${id}`} onClick={selectOnClick(() => onSelect({ kind: 'story', id }))}>
      <div className="doc-card-head">
        <IdLink link={{ kind: 'story', id }} onGo={onGo} />
        <span className={`chip role-${c.story.role}`}>{c.roleLabel}</span>
        <span className="doc-tag">{c.story.status ?? 'draft'}</span>
        <span className={`badge ${proofClass(c.proof.proved, c.proof.approved)}`}>{c.proof.text}</span>
        <button type="button" className="select-btn" aria-label={`Select ${id}`} aria-pressed={on} onClick={() => onSelect({ kind: 'story', id })}>
          Select
        </button>
      </div>
      <p className="story-sentence">
        As {c.roleLabel}, I want <LinkedText text={c.story.want} known={known} onGo={onGo} />, so that <LinkedText text={c.story.soThat} known={known} onGo={onGo} />.
      </p>
      <h3 className="doc-eyebrow">Acceptance criteria</h3>
      <ul className="criteria">
        {c.criteria.map((cr) => {
          const text = `Given ${cr.criterion.given}, when ${cr.criterion.when}, then ${cr.criterion.then}.`;
          return (
            <li key={cr.criterion.id}>
              <IdLink link={{ kind: 'story', id: cr.criterion.id }} onGo={onGo} />
              <span className="criterion-text" title={text}>
                {text}
              </span>
              <span className="criterion-proof">
                <span className="muted">proved by</span>
                {cr.provedBy.length === 0 ? (
                  <span className="muted">no scenario yet</span>
                ) : (
                  cr.provedBy.map((s) => (
                    <span key={s.id} className="proof-item">
                      <IdLink link={{ kind: 'scenario', id: s.id }} onGo={onGo} />
                      <Dot tone={stateClass(s)} />
                      <span className={`proof-state ${stateClass(s)}`}>{s.state.text}</span>
                    </span>
                  ))
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="story-foot">
        <span className="doc-key">Requirement</span>
        {(c.story.requirements ?? []).map((r) => (
          <IdLink key={r} link={{ kind: 'requirement', id: r }} onGo={onGo} />
        ))}
        <span className="doc-key">Boxes</span>
        {c.boxes.length === 0 ? <span className="muted">no box serves this story yet</span> : c.boxes.map(chip)}
        <span className="story-actions">
          <button type="button" className="btn-outline" onClick={() => onGo({ view: 'story', story: id })}>
            Open story view →
          </button>
          {firstScenario && (
            <button type="button" className="btn-outline" onClick={() => onGo({ view: 'storyboard', scenario: firstScenario })}>
              Open storyboard →
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

/** The trace as a small tree: requirement → story → boxes → scenarios with their status. */
export function TraceTree({ view, selected, rows, onGo }: { view: ReviewEpicView; selected: LinkRef; rows: Map<string, ContractRow>; onGo: Go }) {
  const trace = traceOf(view, selected);
  if (trace.length === 0) return <p className="muted">Nothing traces to it yet.</p>;
  const lay = traceLayout(trace, chipWidth);
  return (
    <div className="trace-wrap" data-testid="trace">
      <div className="trace" style={{ width: lay.width, height: lay.height }}>
        <svg className="trace-lines" width={lay.width} height={lay.height} aria-hidden="true">
          {lay.lines.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </svg>
        {lay.nodes.map((n, i) => (
          <span key={i} className="trace-node" style={{ left: n.x, top: n.y }}>
            {n.kind === 'box' ? <BoxChip path={n.id} row={rows.get(n.id)} onGo={onGo} /> : <IdLink link={{ kind: n.kind, id: n.id }} onGo={onGo} />}
            {n.state && (
              <span className={`trace-state ${stateClass({ id: n.id, state: n.state })}`}>
                <Dot tone={stateClass({ id: n.id, state: n.state })} />
                {n.state.text}
              </span>
            )}
          </span>
        ))}
        {lay.notes.map((n, i) => (
          <span key={i} className="trace-note muted" style={{ left: n.x, top: n.y }}>
            {n.text}
          </span>
        ))}
      </div>
    </div>
  );
}

function SelectedPanel({ view, doc, known, rows, selected, onGo }: { view: ReviewEpicView; doc: PrdDoc; known: KnownIds; rows: Map<string, ContractRow>; selected: LinkRef; onGo: Go }) {
  const req = selected.kind === 'requirement' ? doc.requirements.find((r) => r.requirement.id === selected.id) : undefined;
  const card = selected.kind === 'story' ? doc.stories.find((s) => s.story.id === selected.id) : undefined;
  const text = req?.requirement.text ?? (card ? `As ${card.roleLabel}, I want ${card.story.want}, so that ${card.story.soThat}.` : '');
  const cites: Id[] = req?.cites ?? [];
  const proof = req?.proof ?? card?.proof;
  const note = proof && gateNote(selected.id, proof);
  const spec = specLinks(view, selected, known);
  const kindTag = req?.requirement.kind ?? (card ? card.roleLabel : selected.kind);
  return (
    <div className="panel-body" data-testid={`prd-panel-${selected.id}`}>
      <p className="doc-eyebrow">Selected · linked in rehearse</p>
      <h2 className="panel-id">
        <IdLink link={selected} onGo={onGo} />
        <span className="doc-tag">{kindTag}</span>
      </h2>
      {text && (
        <p className="panel-text">
          <LinkedText text={text} known={known} onGo={onGo} />
        </p>
      )}
      <p className="panel-cites">
        <span className="doc-key">Cites</span>
        {cites.length === 0 ? <span className="muted">no decision</span> : cites.map((d) => <IdLink key={d} link={{ kind: 'decision', id: d }} onGo={onGo} />)}
      </p>
      <h3 className="doc-eyebrow">Trace</h3>
      <TraceTree view={view} selected={selected} rows={rows} onGo={onGo} />
      <h3 className="doc-eyebrow">Open in rehearse</h3>
      <OpenRows places={openPlaces(view, selected)} onGo={onGo} label="Open in rehearse" />
      {(spec.entities.length > 0 || spec.boxes.length > 0 || spec.decisions.length > 0) && (
        <>
          <h3 className="doc-eyebrow">Linked from tech spec</h3>
          <p className="panel-chips" data-testid="linked-from-spec">
            {spec.entities.map((e) => (
              <IdLink key={e} link={{ kind: 'entity', id: e }} onGo={onGo} />
            ))}
            {spec.boxes.map((b) => (
              <BoxChip key={b} path={b} row={rows.get(b)} onGo={onGo} />
            ))}
            {spec.decisions.map((d) => (
              <IdLink key={d} link={{ kind: 'decision', id: d }} onGo={onGo} />
            ))}
          </p>
        </>
      )}
      {note && (
        <div className="gate-note" data-testid="gate-note" role="note">
          <strong>Gate: {selected.id} is not proved yet</strong>
          <p>{note}</p>
        </div>
      )}
      {proof?.proved && (
        <div className="gate-note is-ok" role="note">
          <strong>Proved</strong>
          <p>
            {proof.text}, {proof.signText}.
          </p>
        </div>
      )}
    </div>
  );
}
