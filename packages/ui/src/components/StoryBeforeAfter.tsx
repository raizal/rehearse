// A story's Before / after tab (design page 12, D43 proposed): the story's boxes before and
// after, in lanes, a "What changes in this story" table and the impact on the system as built
// (which as-is boxes and which frozen stories of finished EPICs the story touches).

import { useId, useMemo } from 'react';
import type { Id } from '@rehearse/core';
import type { ReviewEpicView } from '../contract.js';
import { clipToRect, statusLook } from '../model/architecture.js';
import { storyBaLayout, storyChangeSummary, storyCompare, type StoryBaLayout, type StoryCompare } from '../model/story-compare.js';
import { wrapLines } from '../model/text.js';
import { ArchLegend, StatusBadge } from './ArchitectureView.js';

export function StoryBeforeAfter({ view, storyId, onOpenBox }: { view: ReviewEpicView; storyId: Id; onOpenBox: (path: string) => void }) {
  const sc = useMemo(() => storyCompare(view, storyId), [view, storyId]);
  const lay = useMemo(() => storyBaLayout(sc), [sc]);
  if (!sc.available) {
    return (
      <section className="story-ba" data-testid="story-ba" aria-label={`Before / after of ${storyId}`}>
        <p className="muted" data-testid="story-ba-empty">
          This EPIC has no <code>architecture.yaml</code>, so {storyId} does not change the system as built. Add the file to the EPIC folder to compare
          before and after; Big picture → Before / after shows how.
        </p>
      </section>
    );
  }
  return (
    <section className="story-ba" data-testid="story-ba" aria-label={`Before / after of ${storyId}`}>
      <div className="story-ba-head">
        <span className="small muted">Change in this story</span>
        <ul className="chip-row" data-testid="story-ba-summary">
          {storyChangeSummary(sc.rows).map((s) => (
            <li key={s.status} className={`badge diff-badge ${statusLook(s.status)!.className}`}>
              <span aria-hidden="true">{statusLook(s.status)!.mark} </span>
              {s.text}
            </li>
          ))}
        </ul>
        {sc.why.length > 0 && (
          <span className="small">
            <span className="muted">Decisions </span>
            {sc.why.map((w) => (
              <code key={w} className="ref-chip">
                {w}
              </code>
            ))}
          </span>
        )}
      </div>
      <ArchLegend diff />
      <div className="ba-sides">
        <StoryCanvas sc={sc} lay={lay} side="before" />
        <StoryCanvas sc={sc} lay={lay} side="after" />
      </div>
      <div className="story-ba-bottom">
        <StoryChanges sc={sc} onOpenBox={onOpenBox} />
        <Impact sc={sc} onOpenBox={onOpenBox} />
      </div>
    </section>
  );
}

function StoryCanvas({ sc, lay, side }: { sc: StoryCompare; lay: StoryBaLayout; side: 'before' | 'after' }) {
  const marker = `sba-arrow-${useId().replace(/:/g, '')}`;
  const after = side === 'after';
  const boxes = sc.boxes.filter((b) => (after ? b.onAfter : b.onBefore));
  const title = after ? 'After · to-be' : 'Before · as-is';
  return (
    <section className={`ba-side${after ? ' is-after' : ''}`} aria-label={`${title} of ${sc.storyId}`}>
      <h3 className="ba-side-title">{title}</h3>
      <div className="arch-wrap">
        <svg className="story-ba-map" data-testid={`story-ba-${side}`} role="group" aria-label={`${title}: ${boxes.map((b) => b.title).join(', ') || 'nothing yet'}`} viewBox={`0 0 ${lay.width} ${lay.height}`} width={lay.width} height={lay.height}>
          <defs>
            <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
            </marker>
          </defs>
          {lay.lanes.map((l, i) => (
            <g key={l.id}>
              <rect x={0} y={l.y} width={lay.width} height={l.h} className={i % 2 ? 'bp-row' : 'bp-row is-alt'} />
              <text x={10} y={l.y + 20} className="bp-role-label">
                {l.label}
              </text>
            </g>
          ))}
          {!after && boxes.every((b) => b.lane !== 'files') && (
            <text x={10} y={lay.lanes.at(-1)!.y + 44} className="arch-part-about">
              no file yet
            </text>
          )}
          {sc.edges
            .filter((e) => e.side === side)
            .map((e) => {
              const a = lay.boxes.get(e.from)!;
              const b = lay.boxes.get(e.to)!;
              const p1 = clipToRect(a, b.x + b.w / 2, b.y + b.h / 2);
              const p2 = clipToRect(b, a.x + a.w / 2, a.y + a.h / 2);
              const fresh = after && sc.boxes.some((x) => (x.key === e.from || x.key === e.to) && x.status === 'added');
              return (
                <g key={`${e.from} ${e.to}`} className={`arch-link${fresh ? ' is-added' : ''}`}>
                  <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} markerEnd={`url(#${marker})`} />
                  {e.label && (
                    <text x={(p1.x + p2.x) / 2} y={(p1.y + p2.y) / 2 - 5} textAnchor="middle" className="arch-link-label">
                      {e.label}
                    </text>
                  )}
                </g>
              );
            })}
          {boxes.map((b) => {
            const r = lay.boxes.get(b.key)!;
            const status = after ? b.status : b.status === 'removed' ? 'removed' : undefined;
            const look = statusLook(status);
            return (
              <g key={b.key} className={`arch-part${b.lane === 'files' ? ' kind-store' : ''}${look ? ` ${look.className}` : ''}`} data-testid={`story-ba-${side}-${b.key}`} data-status={status}>
                <title>{`${b.title}${b.sub ? `: ${b.sub}` : ''}${look ? `; ${look.word}` : ''}${b.outside ? '; outside the record' : ''}`}</title>
                <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={b.lane === 'files' ? 14 : 6} />
                {wrapLines(b.title, 20)
                  .slice(0, 2)
                  .map((t, i) => (
                    <text key={i} x={r.x + 8} y={r.y + 17 + i * 14} className="arch-part-name">
                      {t}
                    </text>
                  ))}
                {(after || b.status === 'same' || b.status === 'changed') && b.sub && (
                  <text x={r.x + 8} y={r.y + r.h - 22} className="arch-part-about">
                    {wrapLines(after ? b.sub : b.status === 'changed' ? '' : b.sub, 24)[0] ?? ''}
                  </text>
                )}
                {look && look.word !== 'same' && (
                  <text x={r.x + r.w - 6} y={r.y + r.h - 6} textAnchor="end" className="arch-part-status">
                    {`${look.mark} ${look.word}`}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

function StoryChanges({ sc, onOpenBox }: { sc: StoryCompare; onOpenBox: (path: string) => void }) {
  return (
    <section className="ba-changes" data-testid="story-ba-changes" aria-labelledby="story-ba-changes-h">
      <h3 id="story-ba-changes-h">What changes in this story</h3>
      <table className="ba-table">
        <thead>
          <tr>
            <th scope="col">Change</th>
            <th scope="col">Item</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
            <th scope="col">Why</th>
          </tr>
        </thead>
        <tbody>
          {sc.rows.map((r) => (
            <tr key={r.key} data-testid={`story-ba-row-${r.key}`}>
              <td>
                <StatusBadge status={r.status} />
              </td>
              <td>
                <span className="small muted">{r.area} </span>
                {r.path && r.status !== 'removed' ? (
                  <button type="button" className="box-link" aria-label={`Open box ${r.item} (${r.path}) in the flow view`} onClick={() => onOpenBox(r.path!)}>
                    {r.item}
                  </button>
                ) : (
                  <strong>{r.item}</strong>
                )}
              </td>
              <td className="muted">{r.before}</td>
              <td>{r.after}</td>
              <td>{r.why.map((w) => <code key={w} className="ref-chip">{w}</code>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Impact({ sc, onOpenBox }: { sc: StoryCompare; onOpenBox: (path: string) => void }) {
  const { impact } = sc;
  const epic = impact.asIsEpic ? `${impact.asIsEpic} ` : '';
  return (
    <section className="story-impact" data-testid="story-ba-impact" aria-labelledby="story-impact-h">
      <h3 id="story-impact-h">Impact on the current system</h3>
      {impact.boxes.length === 0 ? (
        <p className="impact-ok">This story touches no box of the system as built: everything it does is new.</p>
      ) : (
        <>
          <p className="impact-ok" data-testid="story-ba-frozen">
            <strong>The system as built stays valid.</strong>{' '}
            {impact.frozen.length
              ? `${impact.boxes.map((b) => b.title).join(', ')} belong${impact.boxes.length === 1 ? 's' : ''} to ${epic}stor${impact.frozen.length === 1 ? 'y' : 'ies'} ${impact.frozen.join(', ')}, which ${impact.frozen.length === 1 ? 'is' : 'are'} frozen. This EPIC does not make ${impact.frozen.length === 1 ? 'it' : 'them'} stale: its change is a diff on top of the as-is.`
              : 'The as-is boxes it touches belong to no finished story.'}
          </p>
          <h4>Touches in the as-is</h4>
          <ul className="chip-row" data-testid="story-ba-touches">
            {impact.boxes.map((b) => (
              <li key={b.path}>
                <button type="button" className="box-link" aria-label={`Open box ${b.title} (${b.path}) in the flow view; ${b.status}`} onClick={() => onOpenBox(b.path)}>
                  {b.path}
                </button>{' '}
                <span className="small muted">({b.status})</span>
              </li>
            ))}
            {impact.frozen.map((s) => (
              <li key={s}>
                <code className="ref-chip">{`${epic}${s}`}</code> <span className="small muted">(frozen)</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className={impact.scenarios < impact.newBoxes ? 'impact-warn' : 'impact-ok'} data-testid="story-ba-scenarios">
        <strong>
          Scenarios: {impact.scenarios} written, {impact.newBoxes} new box{impact.newBoxes === 1 ? '' : 'es'}.
        </strong>{' '}
        Each new box needs a given / when / then example before the gate.
      </p>
    </section>
  );
}
