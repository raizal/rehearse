// System architecture (design page 8, D43 proposed): zones as dashed boxes with their names,
// components, stores, people and outside systems, labelled links, a legend and the notes. Drawn
// from docs/system/architecture.yaml, or from the to-be when the EPIC has architecture.yaml.
// With no file it says so in words and shows how to add one.

import { useId, useMemo } from 'react';
import type { DiffStatus } from '@rehearse/core';
import type { ReviewEpicView } from '../contract.js';
import { ARCH_EXAMPLE, archLayout, drawingOf, linkWord, statusLook, type ArchDrawing, type ArchLayout } from '../model/architecture.js';
import { wrapLines } from '../model/text.js';

const KIND_WORD: Record<string, string> = { component: 'component', store: 'store', person: 'person', outside: 'outside system' };

export function StatusBadge({ status, link = false }: { status: DiffStatus | undefined; link?: boolean }) {
  const look = statusLook(status);
  if (!look) return null;
  return (
    <span className={`badge diff-badge ${look.className}`}>
      <span aria-hidden="true">{look.mark} </span>
      {link ? linkWord(status) : look.word}
    </span>
  );
}

/** One architecture drawing. `lay` is shared when two sides must line up. */
export function ArchDiagram({ d, lay, label, testId }: { d: ArchDrawing; lay?: ArchLayout; label: string; testId: string }) {
  const layout = useMemo(() => lay ?? archLayout(d), [d, lay]);
  const marker = `arch-arrow-${useId().replace(/:/g, '')}`;
  const name = new Map(d.parts.map((p) => [p.id, p.name]));
  return (
    <div className="arch-wrap">
      <svg className="arch-map" data-testid={testId} role="group" aria-label={label} viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height}>
        <defs>
          <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
          </marker>
        </defs>
        {d.zones.map((z) => {
          const r = layout.zones.get(z.id);
          if (!r) return null;
          const look = statusLook(z.status);
          return (
            <g key={z.id} className={`arch-zone c-${z.color}${look ? ` ${look.className}` : ''}`} data-testid={`arch-zone-${z.id}`}>
              <title>{`Zone ${z.name}${z.about ? `, ${z.about}` : ''}${look ? `; ${look.word}` : ''}`}</title>
              <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={12} />
              <text x={r.x + 14} y={r.y + 24} className="arch-zone-name">
                {z.name}
                {z.about ? ` · ${z.about}` : ''}
                {look && look.word !== 'same' ? ` (${look.word})` : ''}
              </text>
            </g>
          );
        })}
        {d.links.map((l) => {
          const p = layout.links.find((x) => x.from === l.from && x.to === l.to);
          if (!p) return null;
          const look = statusLook(l.status);
          const word = linkWord(l.status);
          return (
            <g key={`${l.from} ${l.to}`} className={`arch-link${look ? ` ${look.className}` : ''}`} data-testid={`arch-link-${l.from}-${l.to}`}>
              <title>{`${name.get(l.from)} → ${name.get(l.to)}${l.label ? `: ${l.label}` : ''}${word ? ` (${word})` : ''}`}</title>
              <line x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} markerEnd={`url(#${marker})`} />
              {(l.label || (word && l.status !== 'same')) && (
                <text x={p.lx} y={p.ly - 5} textAnchor="middle" className="arch-link-label">
                  {[l.label, l.status === 'added' || l.status === 'removed' ? word : undefined].filter(Boolean).join(' · ')}
                </text>
              )}
            </g>
          );
        })}
        {d.parts.map((p) => {
          const r = layout.parts.get(p.id);
          if (!r) return null;
          const look = statusLook(p.status);
          const lines = wrapLines(p.about ?? '', 30).slice(0, 2);
          return (
            <g key={p.id} className={`arch-part kind-${p.kind}${p.color ? ` c-${p.color}` : ''}${look ? ` ${look.className}` : ''}`} data-testid={`arch-part-${p.id}`} data-status={p.status}>
              <title>{`${p.name}, ${KIND_WORD[p.kind] ?? p.kind}${p.about ? `: ${p.about}` : ''}${look ? `; ${look.word}` : ''}`}</title>
              <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={p.kind === 'store' ? 14 : 6} />
              <text x={r.x + 10} y={r.y + 20} className="arch-part-name">
                {p.name}
              </text>
              {lines.map((t, i) => (
                <text key={i} x={r.x + 10} y={r.y + 37 + i * 14} className="arch-part-about">
                  {t}
                </text>
              ))}
              {look && look.word !== 'same' && (
                <text x={r.x + r.w - 8} y={r.y + r.h - 8} textAnchor="end" className="arch-part-status">
                  {`${look.mark} ${look.word}`}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function ArchLegend({ diff = false }: { diff?: boolean }) {
  return (
    <ul className="arch-legend" data-testid="arch-legend" aria-label="Legend">
      {diff ? (
        <>
          {(['added', 'changed', 'same', 'removed'] as const).map((s) => (
            <li key={s}>
              <span className={`legend-swatch arch-part-swatch ${statusLook(s)!.className}`} aria-hidden="true" />
              {s === 'added' ? 'Added by this EPIC' : s === 'same' ? 'Same as before' : s === 'changed' ? 'Changed' : 'Removed (dashed)'}
            </li>
          ))}
          <li>
            <span className="legend-swatch legend-line is-added" aria-hidden="true" />
            New link
          </li>
        </>
      ) : (
        <>
          <li>
            <span className="legend-swatch legend-zone" aria-hidden="true" />
            Machine / trust zone (dashed)
          </li>
          <li>
            <span className="legend-swatch legend-part" aria-hidden="true" />
            Component
          </li>
          <li>
            <span className="legend-swatch legend-store" aria-hidden="true" />
            Store (files)
          </li>
          <li>
            <span className="legend-swatch legend-person" aria-hidden="true" />
            Person / outside system
          </li>
          <li>
            <span className="legend-swatch legend-line" aria-hidden="true" />
            Call or data
          </li>
        </>
      )}
    </ul>
  );
}

/** How to add docs/system/architecture.yaml, shown when the repo has none. */
export function NoArchitecture({ what = 'docs/system/architecture.yaml' }: { what?: string }) {
  return (
    <div className="arch-empty" data-testid="arch-empty">
      <p>
        This repo has no <code>{what}</code>, so there is no architecture to draw. Add the file to describe the system as built: its zones (machines or
        trust zones), the components in each, the people and outside systems, and the links between them.
      </p>
      <pre className="yaml-example" aria-label="Example docs/system/architecture.yaml">
        {ARCH_EXAMPLE}
      </pre>
      <p className="muted small">
        An EPIC that changes the system adds its own <code>architecture.yaml</code> with only the change; Before / after then compares the two.
      </p>
    </div>
  );
}

export function ArchitectureView({ view }: { view: ReviewEpicView }) {
  const sys = view.system;
  const toBe = view.compare?.hasChange ? view.compare.architecture.after : undefined;
  const arch = toBe ?? sys?.architecture;
  const d = useMemo(() => (arch ? drawingOf(arch) : undefined), [arch]);
  return (
    <section className="page arch-view" data-testid="architecture-view" aria-labelledby="arch-title">
      <h2 id="arch-title">System architecture</h2>
      <p className="muted">
        Where each part runs, what it talks to, and which trust zone it is in.{' '}
        {toBe
          ? 'This is the to-be: the system as built (docs/system/) with the change of this EPIC (architecture.yaml).'
          : d
            ? 'This is the system as built (docs/system/architecture.yaml).'
            : ''}
      </p>
      {sys && !sys.report.ok && (
        <p className="warn" data-testid="arch-findings">
          docs/system/ has {sys.report.findings.length} finding{sys.report.findings.length === 1 ? '' : 's'}: {sys.report.findings.map((f) => `${f.file} ${f.path}: ${f.message}`).join('; ')}
        </p>
      )}
      {!d ? (
        <NoArchitecture />
      ) : (
        <>
          <ArchLegend />
          <ArchDiagram d={d} label={`System architecture${toBe ? ' (to-be)' : ''}: ${d.zones.length} zones, ${d.parts.length} parts, ${d.links.length} links`} testId="arch-map" />
          {d.notes.length > 0 && (
            <ul className="arch-notes" data-testid="arch-notes" aria-label="Notes">
              {d.notes.map((n, i) => (
                <li key={i} className={`arch-note is-${n.kind ?? 'info'}`}>
                  <strong>{n.kind === 'warning' ? 'Warning' : n.kind === 'trust' ? 'Trust' : 'Note'}</strong>
                  {n.zone ? ` (${d.zones.find((z) => z.id === n.zone)?.name ?? n.zone})` : ''}: {n.text}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
