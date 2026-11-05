// Use cases (S7-A1, D42): who may change what, as a use case diagram. Actors (the roles, with
// the role kind as an icon and in words) on the left; inside the system boundary one use case
// per box that writes data or makes a transition, grouped by story, tagged with the data it
// changes. A line goes from each actor to the use cases of its lane; a click on a use case opens
// its box. The old permission matrix stays behind the "Table" toggle.

import { useMemo, useState } from 'react';
import type { EntityModel, Flow, Prd } from '@rehearse/core';
import { ROLE_ICON, storyStyle } from '../model/features.js';
import { storiesOf } from '../model/review.js';
import { UCD, useCaseDiagram, useCaseLayout, type Simulation } from '../model/usecases.js';
import { wrapLines } from '../model/text.js';
import { MatrixView } from './MatrixView.js';
import { svgButton } from './svg.js';

export interface UseCaseViewProps {
  simulation?: Simulation;
  flow?: Flow;
  prd?: Prd;
  entities?: EntityModel;
  onOpenBox: (path: string) => void;
}

export function UseCaseView(props: UseCaseViewProps) {
  const [mode, setMode] = useState<'diagram' | 'table'>('diagram');
  return (
    <div data-testid="usecase-page">
      <div className="page view-toggle" role="group" aria-label="Show use cases as">
        <button type="button" className="action" data-testid="usecase-show-diagram" aria-pressed={mode === 'diagram'} onClick={() => setMode('diagram')}>
          Diagram
        </button>
        <button type="button" className="action" data-testid="usecase-show-table" aria-pressed={mode === 'table'} onClick={() => setMode('table')}>
          Table
        </button>
      </div>
      {mode === 'diagram' ? <UseCaseDiagramView {...props} /> : <MatrixView {...props} />}
    </div>
  );
}

function UseCaseDiagramView({ simulation, flow, prd, onOpenBox }: UseCaseViewProps) {
  const d = useMemo(() => useCaseDiagram(simulation, flow, prd), [simulation, flow, prd]);
  const lay = useMemo(() => useCaseLayout(d), [d]);
  if (!simulation) {
    return (
      <section className="page" data-testid="usecase-view">
        <h2>Use cases</h2>
        <p className="muted" data-testid="usecase-missing">The server sent no simulation. Run simulate, or update rehearse serve.</p>
      </section>
    );
  }
  const oval = new Map(lay.ovals.map((o) => [o.path, o]));
  const actorAt = new Map(lay.actors.map((a) => [a.role, a]));
  const group = new Map(lay.groups.map((g) => [g.storyId ?? '', g]));
  const storyIndex = new Map(storiesOf(prd).map((s, i) => [s.id, i]));
  const actorName = new Map(d.actors.map((a) => [a.role, a.label]));

  return (
    <section className="page" data-testid="usecase-view">
      <h2>Use cases</h2>
      <p className="muted">
        Who may change what. Each oval is a box that writes data or makes a transition, grouped by story, with the data it changes. A line joins each role
        to the use cases of its lane. Click a use case to open its box in the flow view.
      </p>
      <div className="ucd-wrap">
        <svg className="ucd" role="group" aria-label="Use case diagram: roles on the left, use cases inside the system" viewBox={`0 0 ${lay.width} ${lay.height}`} width={lay.width} height={lay.height}>
          <rect {...pos(lay.boundary)} rx={12} className="ucd-boundary" />
          <text x={lay.boundary.x + 16} y={lay.boundary.y + 26} className="ucd-system">
            {prd?.epic?.title ?? flow?.epic ?? 'System'}
          </text>
          {d.groups.map((g) => {
            const box = group.get(g.storyId ?? '');
            if (!box) return null;
            const color = g.storyId !== undefined ? storyStyle(storyIndex.get(g.storyId) ?? 0).color : '#8a93a6';
            return (
              <g key={g.storyId ?? '-'} data-testid={`usecase-group-${g.storyId ?? 'none'}`}>
                <rect {...pos(box)} rx={8} className="ucd-group" style={{ stroke: color }} />
                <text x={box.x + 12} y={box.y + 21} className="ucd-group-label">
                  {g.storyId ? `${g.storyId} · ${g.want ?? ''}` : 'No story'}
                </text>
              </g>
            );
          })}
          {lay.links.map((l) => (
            <line key={`${l.role} ${l.path}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className="ucd-link" data-testid={`usecase-link-${l.role}-${l.path}`} />
          ))}
          {d.groups.flatMap((g) =>
            g.useCases.map((u) => {
              const o = oval.get(u.path);
              if (!o) return null;
              const also = u.alsoStories.length ? `; also serves ${u.alsoStories.join(', ')}` : '';
              return (
                <g
                  key={u.path}
                  className="ucd-usecase"
                  data-testid={`usecase-${u.path}`}
                  {...svgButton(`Open box ${u.title} (${u.path}); ${actorName.get(u.lane) ?? u.lane}; ${u.tags.join(', ') || 'writes data'}${also}`, () => onOpenBox(u.path))}
                >
                  <title>{`${u.title} (${u.path})`}</title>
                  <ellipse cx={o.cx} cy={o.cy} rx={o.rx} ry={o.ry} />
                  {wrapLines(u.title, 30).map((t, i, all) => (
                    <text key={i} x={o.cx} y={o.cy + 5 + (i - (all.length - 1) / 2) * 15} textAnchor="middle" className="ucd-usecase-title">
                      {t}
                    </text>
                  ))}
                  {[...u.tags, ...(u.alsoStories.length ? [`also ${u.alsoStories.join(', ')}`] : [])].map((t, i, all) => (
                    <text key={t} x={o.cx + o.rx + 14} y={o.cy + 4 + (i - (all.length - 1) / 2) * UCD.tagH} className={i < u.tags.length ? 'ucd-tag' : 'ucd-also'} data-testid={i < u.tags.length ? `usecase-tag-${u.path}-${i}` : undefined}>
                      {t}
                    </text>
                  ))}
                </g>
              );
            }),
          )}
          {d.actors.map((a) => {
            const p = actorAt.get(a.role);
            if (!p) return null;
            return (
              <g key={a.role} className="ucd-actor" data-testid={`usecase-actor-${a.role}`}>
                <circle cx={p.x} cy={p.y - 14} r={18} fill="#fff" stroke={a.color} strokeWidth={2} />
                <text x={p.x} y={p.y - 8} textAnchor="middle" className="ucd-actor-icon" aria-hidden="true">
                  {ROLE_ICON[a.kind ?? ''] ?? '?'}
                </text>
                <text x={p.x} y={p.y + 20} textAnchor="middle" className="ucd-actor-label">
                  {a.label}
                </text>
                <text x={p.x} y={p.y + 35} textAnchor="middle" className="ucd-actor-kind">
                  {a.kind ?? 'role'}
                </text>
                {a.readOnly && (
                  <text x={p.x} y={p.y + 50} textAnchor="middle" className="ucd-readonly" data-testid={`usecase-readonly-${a.role}`}>
                    read only{a.reads.length ? `: ${a.reads.join(', ')}` : ''}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      {d.groups.length === 0 && <p className="muted" data-testid="usecase-empty">No box writes data or makes a transition.</p>}
    </section>
  );
}

function pos(r: { x: number; y: number; w: number; h: number }) {
  return { x: r.x, y: r.y, width: r.w, height: r.h };
}
