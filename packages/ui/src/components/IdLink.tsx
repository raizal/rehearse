// The id links of the PRD and Tech spec pages (T15 feature 2): one colour per kind, a name for
// screen readers, the legend under each page title, linked text, the box chip with its contract
// on hover or focus, and the contents rail.

import { useState, type FocusEvent, type ReactNode } from 'react';
import { LINK_GOES, LINK_KINDS, linkName, placeOf, textParts, type KnownIds, type LinkRef, type Place } from '../model/links.js';
import type { Contents } from '../model/prd.js';
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

/** What each link colour opens. */
export function LinkLegend() {
  return (
    <ul className="link-legend" data-testid="link-legend" aria-label="Link colours">
      {LINK_KINDS.map((k) => (
        <li key={k}>
          <span className={`legend-dot id-${k}`} aria-hidden="true" />
          {k} → {LINK_GOES[k]}
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
          <span className="box-pop-title">{row?.box.title ?? path}</span>
          {row ? (
            <span className="box-pop-body">
              <span>lane: {row.laneLabel}</span>
              <span>
                in → out: {row.ins.join(', ') || 'nothing'} → {row.outs.join(', ') || 'nothing'}
              </span>
              <span>writes: {row.writes.map((w) => w.text).join('; ') || 'nothing'}</span>
            </span>
          ) : (
            <span className="box-pop-body">This box is not in flow.yaml.</span>
          )}
          <span className="box-pop-actions">
            <button type="button" className="link" onClick={() => onGo({ view: 'flow', box: path })}>
              Open in Flow
            </button>
            <button type="button" className="link" onClick={() => onGo({ view: 'techspec', focus: `box:${path}` })}>
              Contract in Tech spec
            </button>
          </span>
        </span>
      )}
    </span>
  );
}

/** The contents rail: a link per section with its count. */
export function ContentsRail({ items, prefix, label }: { items: Contents[]; prefix: string; label: string }) {
  return (
    <nav className="doc-rail" aria-label={label} data-testid={`${prefix}-contents`}>
      <h2 className="rail-title">Contents</h2>
      <ul>
        {items.map((c) => (
          <li key={c.id}>
            <a href={`#${prefix}-${c.id}`}>
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
