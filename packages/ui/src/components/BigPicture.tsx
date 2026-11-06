// The big picture of the EPIC (S4-A4, D42, design page 1): the review opens here. A page header
// with the counts; the feature map card, where rows are the roles, boxes are the main processes
// in flow order with the stories that use them as chips underneath, and arrows join the boxes;
// and the list of features (stories). A process that two or more stories use says "shared".
// Hover or focus a story to light up its processes; click it to open its story view; click a
// process to open it in the box drawer.

import { useMemo, useState } from 'react';
import type { Id } from '@rehearse/core';
import type { ReviewEpicView } from '../contract.js';
import { bigPicture, bigPictureStats, boxTitleLines, featureMapLayout, FM, KIND_LINE, laneTint, scenarioCounts, type FeatureStory } from '../model/features.js';
import { roleName } from '../model/diagram.js';
import { svgButton } from './svg.js';

export interface BigPictureProps {
  view: ReviewEpicView;
  onOpenStory: (id: Id) => void;
  onOpenBox: (path: string) => void;
}

export function BigPicture({ view, onOpenStory, onOpenBox }: BigPictureProps) {
  const bp = useMemo(() => bigPicture(view.flow, view.prd), [view]);
  const lay = useMemo(() => featureMapLayout(bp), [bp]);
  const stats = useMemo(() => bigPictureStats(bp, view), [bp, view]);
  const scen = useMemo(() => scenarioCounts(view.scenarios), [view]);
  const [selected, setSelected] = useState<Id | undefined>();
  const box = new Map(lay.boxes.map((b) => [b.id, b]));
  const laneColor = new Map(bp.lanes.map((l) => [l.role, l.color]));
  const chipsBy = new Map<Id, typeof lay.chips>();
  for (const c of lay.chips) chipsBy.set(c.storyId, [...(chipsBy.get(c.storyId) ?? []), c]);
  const processLane = new Map(bp.processes.map((p) => [p.id, p.lane]));
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  return (
    <section className="page big-picture fm-page" data-testid="big-picture" aria-labelledby="bp-title">
      <h2 id="bp-title">The whole EPIC</h2>
      <p className="muted fm-sub">Who does what, which processes each feature (story) runs through, and what the features share.</p>
      <ul className="fm-stats" aria-label="Counts" data-testid="bp-stats">
        <li>{plural(stats.roles, 'role')}</li>
        <li>
          {stats.stories} {stats.stories === 1 ? 'story' : 'stories'}
        </li>
        <li>
          {stats.processes} {stats.processes === 1 ? 'process' : 'processes'}
        </li>
        <li>{plural(stats.scenarios, 'scenario')}</li>
        <li>
          {stats.signed} of {stats.stories} stories signed
        </li>
      </ul>
      {bp.processes.length === 0 && <p className="warn" data-testid="bp-empty">The root diagram has no process, input, output or external box.</p>}

      <div className="bp-body fm-body">
        <div className="fm-card">
          <header className="fm-card-head">
            <div>
              <h3>Feature map</h3>
              <p className="muted">Rows are roles. Boxes are processes. Chips under a box are the stories that use it.</p>
            </div>
            <ul className="fm-legend" aria-label="Legend">
              <li>
                <span className="fm-key fm-key-shared" aria-hidden="true" />
                Shared by 2+ stories
              </li>
              <li>
                <span className="fm-key fm-key-selected" aria-hidden="true" />
                Selected story: {selected ?? 'none'}
              </li>
              <li>
                <svg width={30} height={4} aria-hidden="true">
                  <line x1={0} y1={2} x2={30} y2={2} className="fm-edge is-back" />
                </svg>
                loop back
              </li>
            </ul>
          </header>
          <div className="fm-map-wrap">
            <svg
              className="fm-map"
              role="group"
              aria-label="Feature map: roles in rows, processes as boxes, the stories that use a process as chips under it"
              viewBox={`0 0 ${lay.width} ${lay.height}`}
              style={{ maxWidth: lay.width }}
            >
              <defs>
                <marker id="fm-head" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" className="fm-head" />
                </marker>
              </defs>
              {lay.rows.map((r) => (
                <g key={r.role} data-testid={`bp-role-${r.role}`}>
                  <rect x={0} y={r.y} width={lay.width} height={r.height} rx={10} fill={r.tint} />
                  <rect x={0} y={r.y} width={6} height={r.height} rx={3} fill={r.color} />
                  <text x={20} y={r.y + 32} className="fm-role" fill={r.color}>
                    {r.label}
                  </text>
                  <text x={20} y={r.y + 52} className="fm-role-kind">
                    {r.kind ?? (r.unknown ? 'not in lanes' : 'role')}
                  </text>
                </g>
              ))}
              {lay.edges.map((e) => (
                <polyline
                  key={`${e.from} ${e.to}`}
                  className={e.back ? 'fm-edge is-back' : 'fm-edge'}
                  points={e.points.map((p) => `${p.x},${p.y}`).join(' ')}
                  markerEnd="url(#fm-head)"
                  data-testid={`bp-edge-${e.from}-${e.to}`}
                  aria-hidden="true"
                />
              ))}
              {bp.processes.map((p) => {
                const b = box.get(p.id);
                if (!b) return null;
                const stories = p.stories.length ? `serves ${p.stories.join(', ')}` : 'serves no story';
                const color = laneColor.get(p.lane) ?? '#94A3B8';
                const isSel = selected !== undefined && p.stories.includes(selected);
                return (
                  <g
                    key={p.id}
                    className={`fm-process${p.shared ? ' is-shared' : ''}${isSel ? ' is-selected' : ''}`}
                    data-testid={`bp-process-${p.id}`}
                    {...svgButton(`Open process ${p.title} (${p.id}) in the box drawer; ${p.kind}; ${stories}${p.shared ? '; shared' : ''}`, () => onOpenBox(p.id))}
                  >
                    <title>{`${p.title} (${p.id}), ${p.kind}; ${stories}`}</title>
                    <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={10} stroke={color} />
                    {boxTitleLines(p.title).map((t, i) => (
                      <text key={i} x={b.x + 10} y={b.y + 22 + i * 17} className="fm-process-title">
                        {t}
                      </text>
                    ))}
                    <text x={b.x + 10} y={b.y + b.h - 10} className="fm-kind">
                      {KIND_LINE[p.kind] ?? p.kind}
                    </text>
                    {p.shared && (
                      <g data-testid={`bp-shared-${p.id}`} className="fm-shared">
                        <title>{`shared: ${p.stories.join(', ')}`}</title>
                        <rect x={b.x + b.w - 56} y={b.y - 10} width={50} height={18} rx={9} />
                        <text x={b.x + b.w - 31} y={b.y + 3} textAnchor="middle">
                          shared
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
              {bp.stories.map((s) => {
                const chips = chipsBy.get(s.id) ?? [];
                if (chips.length === 0) return null;
                return (
                  <g key={s.id} data-testid={`bp-line-${s.id}`} data-points={chips.length}>
                    {chips.map((c) => {
                      const color = laneColor.get(processLane.get(c.process) ?? '') ?? '#94A3B8';
                      const isSel = s.id === selected;
                      return (
                        <g
                          key={c.process}
                          className={`fm-chip${isSel ? ' is-selected' : ''}`}
                          {...svgButton(`Light up story ${s.id} on the map`, () => setSelected(s.id === selected ? undefined : s.id))}
                        >
                          <rect x={c.x} y={c.y} width={c.w} height={FM.chipH} rx={FM.chipH / 2} style={isSel ? undefined : { stroke: color, fill: '#fff' }} />
                          <text x={c.x + c.w / 2} y={c.y + 14} textAnchor="middle" style={isSel ? undefined : { fill: color }}>
                            {s.id}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        <aside className="fm-card fm-features" aria-label="Features (stories)">
          <h3>Features (stories)</h3>
          <p className="muted">Hover a story to see its processes on the map; click it to open it.</p>
          <ul data-testid="bp-legend">
            {bp.stories.map((s) => (
              <li key={s.id} className={s.id === selected ? 'is-selected' : undefined}>
                <StoryButton
                  story={s}
                  role={s.role !== undefined ? roleName(view.prd, s.role) : undefined}
                  color={s.role !== undefined ? laneColor.get(s.role) : undefined}
                  scenarios={scen.get(s.id) ?? 0}
                  onOpen={onOpenStory}
                  onSelect={setSelected}
                />
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}

interface StoryButtonProps {
  story: FeatureStory;
  role?: string;
  color?: string;
  scenarios: number;
  onOpen: (id: Id) => void;
  onSelect: (id: Id) => void;
}

function StoryButton({ story, role, color, scenarios, onOpen, onSelect }: StoryButtonProps) {
  const n = story.processes.length;
  return (
    <button
      type="button"
      className="fm-story"
      data-testid={`bp-story-${story.id}`}
      aria-label={`Open story ${story.id}: ${story.want ?? ''} (${n} process${n === 1 ? '' : 'es'}, ${scenarios} scenario${scenarios === 1 ? '' : 's'})`}
      onClick={() => onOpen(story.id)}
      onMouseEnter={() => onSelect(story.id)}
      onFocus={() => onSelect(story.id)}
    >
      <strong>{story.id}</strong>
      {role !== undefined && (
        <span className="fm-role-chip" style={color ? { color, background: laneTint(color) } : undefined}>
          {role}
        </span>
      )}
      <span className="fm-counts">
        {n} proc · {scenarios} scen
      </span>
      <span className="fm-want">{story.want ? `wants ${story.want}` : 'not in prd.yaml'}</span>
    </button>
  );
}
