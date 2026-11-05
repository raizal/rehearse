// The big picture of the EPIC (S4-A4, D42): the review opens here. Rows are the roles, with
// the role kind as an icon and in words; columns are the main processes in flow order; one
// coloured line per story runs through the processes that serve it, and a process that two or
// more stories use says "shared" with their ids. Click a story to open its story view; click a
// process to open it in the flow view.

import { useMemo } from 'react';
import type { Id } from '@rehearse/core';
import type { ReviewEpicView } from '../contract.js';
import { bigPicture, bigPictureLayout, ROLE_ICON, type FeatureStory } from '../model/features.js';
import { wrapLines } from '../model/text.js';
import { curvePath, svgButton } from './svg.js';

export interface BigPictureProps {
  view: ReviewEpicView;
  onOpenStory: (id: Id) => void;
  onOpenBox: (path: string) => void;
}

export function BigPicture({ view, onOpenStory, onOpenBox }: BigPictureProps) {
  const bp = useMemo(() => bigPicture(view.flow, view.prd), [view]);
  const lay = useMemo(() => bigPictureLayout(bp), [bp]);
  const box = new Map(lay.boxes.map((b) => [b.id, b]));
  const shared = bp.processes.filter((p) => p.shared);
  const style = new Map(bp.stories.map((s) => [s.id, s.style]));

  return (
    <section className="page big-picture" data-testid="big-picture" aria-labelledby="bp-title">
      <h2 id="bp-title">Big picture</h2>
      <p className="muted">
        {view.prd?.epic?.goal ?? ''} Rows are the roles, columns the main processes in flow order. Each coloured line is one story (feature) through the
        processes that serve it. Click a story to open it; click a process to open it in the flow view.
      </p>
      {bp.processes.length === 0 && <p className="warn" data-testid="bp-empty">The root diagram has no process, input, output or external box.</p>}

      <div className="bp-body">
        <div className="bp-map-wrap">
          <svg className="bp-map" role="group" aria-label="Feature map: roles in rows, processes in flow order, one line per story" viewBox={`0 0 ${lay.width} ${lay.height}`} width={lay.width} height={lay.height}>
            {lay.rows.map((r) => (
              <g key={r.role} data-testid={`bp-role-${r.role}`}>
                <rect x={0} y={r.y} width={lay.width} height={r.height} className="bp-row" />
                <rect x={0} y={r.y} width={6} height={r.height} fill={r.color} />
                <text x={16} y={r.y + 28} className="bp-role-icon" aria-hidden="true">
                  {ROLE_ICON[r.kind ?? ''] ?? '?'}
                </text>
                <text x={42} y={r.y + 28} className="bp-role-label">
                  {r.label}
                </text>
                <text x={16} y={r.y + 46} className="bp-role-kind">
                  {r.kind ?? (r.unknown ? 'not in lanes' : 'role')}
                </text>
              </g>
            ))}
            {lay.lines.map((l) =>
              l.points.length > 1 ? (
                <path key={l.storyId} className="bp-line" d={curvePath(l.points)} stroke={l.style.color} strokeDasharray={l.style.dash} aria-hidden="true" />
              ) : null,
            )}
            {bp.processes.map((p) => {
              const b = box.get(p.id);
              if (!b) return null;
              const stories = p.stories.length ? `serves ${p.stories.join(', ')}` : 'serves no story';
              return (
                <g
                  key={p.id}
                  className={`bp-process${p.shared ? ' is-shared' : ''}`}
                  data-testid={`bp-process-${p.id}`}
                  {...svgButton(`Open process ${p.title} (${p.id}) in the flow view; ${p.kind}; ${stories}${p.shared ? '; shared' : ''}`, () => onOpenBox(p.id))}
                >
                  <title>{`${p.title} (${p.id}), ${p.kind}; ${stories}`}</title>
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} />
                  {wrapLines(p.title, 19).map((t, i) => (
                    <text key={i} x={b.x + 8} y={b.y + 16 + i * 14} className="bp-process-title">
                      {t}
                    </text>
                  ))}
                  {p.shared && (
                    <text x={b.x + 8} y={b.y + 46} className="bp-shared" data-testid={`bp-shared-${p.id}`}>
                      shared: {p.stories.join(', ')}
                    </text>
                  )}
                </g>
              );
            })}
            {lay.lines.map((l) => {
              const first = l.points[0]!;
              return (
                <g key={l.storyId} className="bp-marks" data-testid={`bp-line-${l.storyId}`} data-points={l.points.length} aria-hidden="true" pointerEvents="none">
                  {l.points.map((pt, i) => (
                    <circle key={i} cx={pt.x} cy={pt.y} r={l.points.length === 1 ? 5 : 3.5} fill={l.style.color} />
                  ))}
                  <text x={first.x - 8} y={first.y + 3} textAnchor="end" className="bp-line-label">
                    {l.storyId}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <aside className="bp-legend" aria-label="Stories">
          <h3>Stories</h3>
          <ul data-testid="bp-legend">
            {bp.stories.map((s) => (
              <li key={s.id}>
                <StoryButton story={s} onOpen={onOpenStory} />
              </li>
            ))}
          </ul>
          <h3>Shared processes</h3>
          {shared.length === 0 ? (
            <p className="muted small" data-testid="bp-shared-list">No process serves two stories.</p>
          ) : (
            <ul className="bp-shared-list" data-testid="bp-shared-list">
              {shared.map((p) => (
                <li key={p.id}>
                  <button type="button" className="box-link" aria-label={`Open process ${p.title} (${p.id}) in the flow view`} onClick={() => onOpenBox(p.id)}>
                    {p.id}
                  </button>{' '}
                  shared by{' '}
                  {p.stories.map((id) => (
                    <span key={id} className="bp-chip" style={{ borderColor: style.get(id)?.color }}>
                      {id}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </section>
  );
}

function StoryButton({ story, onOpen }: { story: FeatureStory; onOpen: (id: Id) => void }) {
  const n = story.processes.length;
  return (
    <button
      type="button"
      className="bp-story"
      data-testid={`bp-story-${story.id}`}
      aria-label={`Open story ${story.id}: ${story.want ?? ''} (${n} process${n === 1 ? '' : 'es'})`}
      onClick={() => onOpen(story.id)}
    >
      <svg width={34} height={12} aria-hidden="true" className="bp-swatch">
        <line x1={2} y1={6} x2={32} y2={6} stroke={story.style.color} strokeWidth={3} strokeDasharray={story.style.dash} />
        <circle cx={17} cy={6} r={4} fill={story.style.color} />
      </svg>
      <strong>{story.id}</strong>
      <span className="bp-want">{story.want ?? 'not in prd.yaml'}</span>
      <span className="small muted">
        {n} process{n === 1 ? '' : 'es'}
      </span>
    </button>
  );
}
