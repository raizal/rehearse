// Use cases (S7-A1, D42, design page 4): who may change which data. Actors (the roles, as stick
// figures, with the role kind in words) on the left; inside the system boundary one use case per
// box that writes data or makes a transition, with the stories it serves underneath; the data
// those use cases change as «data» boxes on the right. A line goes from each actor to the use
// cases of its lane, a dashed arrow from each use case to the data it changes; a click on a use
// case opens its box. A "Check" note says in words what the lines show. The old permission matrix
// stays behind the "Table" toggle.

import { useMemo, useState } from 'react';
import type { EntityModel, Flow, Prd } from '@rehearse/core';
import { laneTint } from '../model/features.js';
import { permissionChecks, systemName, UCD, useCaseDiagram, useCaseLayout, type Simulation } from '../model/usecases.js';
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

const GREY = '#94A3B8';

function UseCaseDiagramView({ simulation, flow, prd, onOpenBox }: UseCaseViewProps) {
  const d = useMemo(() => useCaseDiagram(simulation, flow, prd), [simulation, flow, prd]);
  const lay = useMemo(() => useCaseLayout(d), [d]);
  const checks = useMemo(() => permissionChecks(d), [d]);
  const header = (
    <>
      <h2>Who may change which data</h2>
      <p className="muted">Roles on the left. What they do in the middle. The data each action changes on the right.</p>
    </>
  );
  if (!simulation) {
    return (
      <section className="page uc-page" data-testid="usecase-view">
        {header}
        <p className="muted" data-testid="usecase-missing">The server sent no simulation. Run simulate, or update rehearse serve.</p>
      </section>
    );
  }
  const oval = new Map(lay.ovals.map((o) => [o.path, o]));
  const actorAt = new Map(lay.actors.map((a) => [a.role, a]));
  const dataAt = new Map(lay.data.map((x) => [x.entity, x]));
  const actor = new Map(d.actors.map((a) => [a.role, a]));
  const colorOf = (role: string) => actor.get(role)?.color ?? GREY;
  const laneOf = new Map(d.useCases.map((u) => [u.path, u.lane]));
  const tagsOf = new Map(d.dataLinks.map((l) => [`${l.path} ${l.entity}`, l.tags]));
  const heads = [...new Set(d.actors.map((a) => a.color))];
  const system = systemName(flow?.epic, prd?.epic?.title);

  return (
    <section className="page uc-page" data-testid="usecase-view">
      {header}
      <div className="uc-body">
        <svg
          className="uc-map"
          role="group"
          aria-label="Use case diagram: roles on the left, use cases inside the system, the data they change on the right"
          viewBox={`0 0 ${lay.width} ${lay.height}`}
          style={{ maxWidth: lay.width }}
        >
          <defs>
            {heads.map((c, i) => (
              <marker key={c} id={`uc-head-${i}`} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto">
                <path d="M0,0 L10,5 L0,10 z" fill={c} />
              </marker>
            ))}
          </defs>
          <rect {...pos(lay.boundary)} rx={16} className="uc-boundary" />
          <text x={lay.boundary.x + 24} y={lay.boundary.y + 32} className="uc-system">
            {system}
          </text>
          {lay.links.map((l) => (
            <line key={`${l.role} ${l.path}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className="uc-link" stroke={colorOf(l.role)} data-testid={`usecase-link-${l.role}-${l.path}`} />
          ))}
          {lay.dataLinks.map((l) => {
            const color = colorOf(laneOf.get(l.path) ?? '');
            return (
              <line
                key={`${l.path} ${l.entity}`}
                x1={l.x1}
                y1={l.y1}
                x2={l.x2}
                y2={l.y2}
                className="uc-data-link"
                stroke={color}
                markerEnd={`url(#uc-head-${heads.indexOf(color)})`}
                data-testid={`usecase-data-link-${l.path}-${l.entity}`}
              >
                <title>{`${l.path} changes ${(tagsOf.get(`${l.path} ${l.entity}`) ?? []).join(', ')}`}</title>
              </line>
            );
          })}
          {d.useCases.map((u) => {
            const o = oval.get(u.path);
            if (!o) return null;
            const color = colorOf(u.lane);
            const sub = u.stories.length ? u.stories.join(', ') : 'automatic';
            return (
              <g
                key={u.path}
                className="ucd-usecase"
                data-testid={`usecase-${u.path}`}
                {...svgButton(`Open box ${u.title} (${u.path}); ${actor.get(u.lane)?.label ?? u.lane}; ${u.tags.join(', ') || 'writes data'}`, () => onOpenBox(u.path))}
              >
                <title>{`${u.title} (${u.path}): ${u.tags.join(', ')}`}</title>
                <ellipse cx={o.cx} cy={o.cy} rx={o.rx} ry={o.ry} fill={laneTint(color)} stroke={color} />
                {wrapLines(u.title, 40, 1).map((t, i) => (
                  <text key={i} x={o.cx} y={o.cy - 2} textAnchor="middle" className="uc-oval-title">
                    {t}
                  </text>
                ))}
                <text x={o.cx} y={o.cy + 18} textAnchor="middle" className="uc-oval-sub" fill={color}>
                  {sub}
                </text>
              </g>
            );
          })}
          {d.actors.map((a) => {
            const p = actorAt.get(a.role);
            if (!p) return null;
            const cx = p.x;
            const y = p.y;
            return (
              <g key={a.role} className="uc-actor" data-testid={`usecase-actor-${a.role}`} stroke={a.color} strokeWidth={3} strokeLinecap="round" fill="none">
                <circle cx={cx} cy={y + 22} r={22} fill={laneTint(a.color)} />
                <path d={`M${cx},${y + 44} V${y + 100} M${cx - 34},${y + 64} H${cx + 34} M${cx - 28},${y + 140} L${cx},${y + 100} L${cx + 28},${y + 140}`} />
                <text x={cx} y={y + 166} textAnchor="middle" className="uc-actor-label" fill={a.color} stroke="none">
                  {a.label}
                </text>
                <text x={cx} y={y + 186} textAnchor="middle" className="uc-actor-kind" stroke="none">
                  {a.kind ?? 'role'}
                </text>
                {a.readOnly && (
                  <g data-testid={`usecase-readonly-${a.role}`} stroke="none">
                    <text x={cx + 60} y={y + 60} className="uc-readonly">
                      Changes no data.
                    </text>
                    {wrapLines(`read only${a.reads.length ? `: ${a.reads.join(', ')}` : ''}`, 34, 4).map((t, i) => (
                      <text key={i} x={cx + 60} y={y + 78 + i * 17} className="uc-readonly">
                        {t}
                      </text>
                    ))}
                  </g>
                )}
              </g>
            );
          })}
          {d.entities.map((e) => {
            const b = dataAt.get(e);
            if (!b) return null;
            return (
              <g key={e} className="uc-data" data-testid={`usecase-data-${e}`}>
                <rect {...pos(b)} rx={8} />
                <path d={`M${b.x + 1},${b.y + UCD.dataHead} V${b.y + 8} a7,7 0 0 1 7,-7 H${b.x + b.w - 8} a7,7 0 0 1 7,7 V${b.y + UCD.dataHead} Z`} className="uc-data-head" />
                <text x={b.x + 12} y={b.y + 15} className="uc-stereo">
                  «data»
                </text>
                <text x={b.x + 12} y={b.y + 47} className="uc-data-name">
                  {e}
                </text>
              </g>
            );
          })}
        </svg>
        <aside className="uc-check" aria-label="Permission check" data-testid="usecase-check">
          <h3>Check</h3>
          <ul>
            {checks.map((c) => (
              <li key={c.text} className={c.ok ? 'is-ok' : undefined}>
                {c.text}
              </li>
            ))}
          </ul>
          <p className="muted">Click a use case to open its box in the flow view.</p>
        </aside>
      </div>
      {d.useCases.length === 0 && <p className="muted" data-testid="usecase-empty">No box writes data or makes a transition.</p>}
    </section>
  );
}

function pos(r: { x: number; y: number; w: number; h: number }) {
  return { x: r.x, y: r.y, width: r.w, height: r.h };
}
