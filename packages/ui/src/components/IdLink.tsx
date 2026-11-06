// The id links of the PRD and Tech spec pages (T15 feature 2): one colour per kind, a name for
// screen readers, the page header with its link colours, linked text, the box chip with its
// contract on hover or focus, the contents rail and the "open in rehearse" rows (T18: the frame of
// design pages 9 and 10).

import { useState, type FocusEvent, type ReactNode, type UIEvent } from 'react';
import { linkName, placeKind, placeOf, textParts, type KnownIds, type LegendSample, type LinkRef, type Place } from '../model/links.js';
import { activeSection, type Contents, type OpenPlace } from '../model/prd.js';
import type { ContractRow } from '../model/techspec.js';

export type Go = (place: Place) => void;

/** An id as a link to the place it lives. */
export function IdLink({ link, onGo, children }: { link: LinkRef; onGo: Go; children?: ReactNode }) {
  return (
    <button type="button" className={`id-link id-${link.kind}`} aria-label={linkName(link)} title={linkName(link)} data-testid={`link-${link.kind}-${link.id}`} onClick={() => onGo(placeOf(link))}>
      {children ?? link.id}
    </button>
  );
}

/** What each link colour opens: a sample chip of each kind and where it goes. */
export function LinkLegend({ samples }: { samples: LegendSample[] }) {
  return (
    <div className="link-legend-row">
      <span className="link-legend-label" aria-hidden="true">
        Link colours:
      </span>
      <ul className="link-legend" data-testid="link-legend" aria-label="Link colours">
        {samples.map((s) => (
          <li key={s.kind}>
            <span className={`id-link id-sample id-${s.kind}`}>
              <span className="sr-only">{s.kind} </span>
              {s.sample ?? s.kind}
            </span>{' '}
            → {s.goes}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The page header of a document: title, what it is made of, the link colours and the source files. */
export function DocHeader({ title, summary, source, samples }: { title: string; summary: string; source: string; samples: LegendSample[] }) {
  return (
    <header className="doc-head">
      <div className="doc-head-text">
        <h1 className="doc-title">{title}</h1>
        <p className="doc-summary">{summary}</p>
        <LinkLegend samples={samples} />
      </div>
      <span className="doc-source" data-testid="doc-source">
        Source: {source}
      </span>
    </header>
  );
}

/** A section heading with its count tag. */
export function SectionHead({ id, title, count, children }: { id: string; title: string; count?: string | number; children?: ReactNode }) {
  return (
    <div className="doc-section-head">
      <h2 id={id}>{title}</h2>
      {count !== undefined && <span className="doc-tag">{count}</span>}
      {children}
    </div>
  );
}

/** A status dot with its words for screen readers; `tone` is a `status-…` class. */
export function Dot({ tone, label }: { tone: string; label?: string }) {
  return (
    <span className={`dot ${tone}`} title={label} aria-hidden={label ? undefined : true}>
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

/** One row per place in rehearse that shows the id: a coloured edge for the kind, the view, what it shows there. */
export function OpenRows({ places, onGo, label, testId }: { places: OpenPlace[]; onGo: Go; label: string; testId?: string }) {
  return (
    <ul className="open-places" aria-label={label} data-testid={testId}>
      {places.map((p, i) => (
        <li key={i}>
          <button type="button" className={`open-row id-${placeKind(p.place)}`} aria-label={`Open in ${p.label}: ${p.detail}`} onClick={() => onGo(p.place)}>
            <strong>{p.label}</strong>
            <span className="open-detail">{p.detail}</span>
            <span className="open-arrow" aria-hidden="true">
              →
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Text with the ids the record knows as links. */
export function LinkedText({ text, known, onGo }: { text: string; known: KnownIds; onGo: Go }) {
  return (
    <>
      {textParts(text, known).map((p, i) => (typeof p === 'string' ? <span key={i}>{p}</span> : <IdLink key={i} link={p} onGo={onGo} />))}
    </>
  );
}

/** A box link; hovering or focusing it shows the box contract with links to Flow and Tech spec. */
export function BoxChip({ path, row, onGo }: { path: string; row: ContractRow | undefined; onGo: Go }) {
  const [open, setOpen] = useState(false);
  const onBlur = (e: FocusEvent<HTMLSpanElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
  };
  return (
    <span
      className="box-chip"
      data-testid={`box-chip-${path}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      <IdLink link={{ kind: 'box', id: path }} onGo={onGo} />
      {open && (
        <span className="box-pop" role="group" aria-label={`Contract of box ${path}`} data-testid={`box-pop-${path}`}>
          <span className="box-pop-head">
            <span className="id-link id-box id-sample">{path}</span>
            {row && (
              <span className="doc-tag">
                {row.box.kind} · {row.laneLabel} lane
              </span>
            )}
          </span>
          <span className="box-pop-title">{row?.box.title ?? path}</span>
          {row ? (
            <span className="box-pop-body">
              <span>
                <span className="muted">in</span> {row.ins.join(', ') || 'nothing'} → <span className="muted">out</span> {row.outs.join(', ') || 'nothing'}
              </span>
              <span className="box-pop-writes">
                <span className="muted">writes</span>
                {row.writes.length === 0 ? (
                  ' nothing'
                ) : (
                  <span className="box-pop-chips">
                    {row.writes.map((w) => (
                      <span key={w.text} className="id-link id-entity id-sample">
                        {w.text}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </span>
          ) : (
            <span className="box-pop-body">This box is not in flow.yaml.</span>
          )}
          <span className="box-pop-actions">
            <button type="button" className="link" onClick={() => onGo({ view: 'box', box: path })}>
              Open box
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" className="link" onClick={() => onGo({ view: 'techspec', focus: `box:${path}` })}>
              Contract in Tech spec <span aria-hidden="true">→</span>
            </button>
          </span>
        </span>
      )}
    </span>
  );
}

/** The contents rail: a link per section with its count. */
export function ContentsRail({ items, prefix, label, active, onPick }: { items: Contents[]; prefix: string; label: string; active?: string; onPick?: (id: string) => void }) {
  return (
    <nav className="doc-rail" aria-label={label} data-testid={`${prefix}-contents`}>
      <h2 className="rail-title">Contents</h2>
      <ul>
        {items.map((c) => (
          <li key={c.id}>
            <a href={`#${prefix}-${c.id}`} className={c.id === active ? 'is-active' : undefined} aria-current={c.id === active ? 'location' : undefined} onClick={() => onPick?.(c.id)}>
              {c.label}
              {c.count !== undefined && <span className="rail-count">{c.count}</span>}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A status word with its colour: approved and signed, approved but not signed, or not approved. */
export function proofClass(proved: boolean, approved: number): string {
  if (proved) return 'status-approved';
  return approved > 0 ? 'status-unsigned' : 'status-stale';
}

/** The contents row to mark: follows the scroll of the document card, or the row just picked. */
export function useActiveSection(prefix: string, ids: string[]) {
  const [active, setActive] = useState<string | undefined>(ids[0]);
  const onScroll = (e: UIEvent<HTMLElement>) => {
    const box = e.currentTarget;
    const base = box.getBoundingClientRect().top - box.scrollTop;
    const tops = ids.flatMap((id) => {
      const el = document.getElementById(`${prefix}-${id}`);
      return el ? [{ id, top: el.getBoundingClientRect().top - base }] : [];
    });
    // At the bottom the last section that shows is the one being read.
    const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 2;
    setActive(atEnd && box.scrollTop > 0 ? tops[tops.length - 1]?.id : activeSection(tops, box.scrollTop));
  };
  return { active, setActive, onScroll };
}
