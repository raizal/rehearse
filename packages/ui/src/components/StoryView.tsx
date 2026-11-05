// One story (S4-A5, D42): WHAT (role, want, so that, the criteria as a checklist), HOW (a
// swimlane of only the boxes that serve it, in flow order) and OUTPUT (each data change as
// before → after, side effects, and what the user sees). The scenario cards come below it.
// A tab bar: Overview (all of the above) and Tests (T13: the story's e2e tests in Birdview).

import { useId, useMemo, useState } from 'react';
import type { Id } from '@rehearse/core';
import type { ReviewEpicView } from '../contract.js';
import { ROLE_ICON } from '../model/features.js';
import { howLayout, storyDetail, type StoryDetail } from '../model/storyview.js';
import { wrapLines } from '../model/text.js';
import { StoryTests } from './StoryTests.js';
import { svgButton } from './svg.js';

export const STORY_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'tests', label: 'Tests' },
] as const;
export type StoryTab = (typeof STORY_TABS)[number]['id'];

export interface StoryViewProps {
  view: ReviewEpicView;
  storyId: Id;
  onOpenBox: (path: string) => void;
  /** The open tab, when the parent keeps it (it shows the scenario cards under Overview only). */
  tab?: StoryTab;
  onTab?: (tab: StoryTab) => void;
}

export function StoryView({ view, storyId, onOpenBox, ...props }: StoryViewProps) {
  const d = useMemo(() => storyDetail(view, storyId), [view, storyId]);
  const [ownTab, setOwnTab] = useState<StoryTab>('overview');
  const tab = props.tab ?? ownTab;
  const setTab = props.onTab ?? setOwnTab;
  const tabId = useId().replace(/:/g, '');
  const scenarios = useMemo(() => view.scenarios.map((sv) => sv.scenario).filter((s) => s.story === storyId), [view, storyId]);
  return (
    <article className="story-view" data-testid="story-view" aria-labelledby="story-view-title">
      <h2 id="story-view-title">
        Story <code>{storyId}</code> {d.story?.want ?? ''}
      </h2>
      <div className="story-tabs" role="tablist" aria-label={`Views of ${storyId}`} data-testid="story-tabs">
        {STORY_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${tabId}-${t.id}`}
            aria-selected={t.id === tab}
            aria-controls={`${tabId}-${t.id}-panel`}
            className={t.id === tab ? 'tab is-active' : 'tab'}
            data-testid={`story-tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${tabId}-${tab}-panel`} aria-labelledby={`${tabId}-${tab}`}>
        {tab === 'overview' && (
          <div className="story-panels">
            <What d={d} />
            <How d={d} onOpenBox={onOpenBox} />
            <Output d={d} onOpenBox={onOpenBox} />
          </div>
        )}
        {tab === 'tests' && <StoryTests storyId={storyId} scenarios={scenarios} />}
      </div>
    </article>
  );
}

function What({ d }: { d: StoryDetail }) {
  const { story } = d;
  return (
    <section className="story-panel" data-testid="story-what" aria-labelledby="story-what-h">
      <h3 id="story-what-h">What</h3>
      {story ? (
        <p className="story-text">
          As <strong data-testid="story-role">{d.roleLabel}</strong>, I want <strong>{story.want}</strong>, so that {story.soThat}.
        </p>
      ) : (
        <p className="warn">No story {d.storyId} in prd.yaml.</p>
      )}
      <h4>Acceptance criteria</h4>
      {d.criteria.length === 0 ? (
        <p className="muted small">The story has no acceptance criteria.</p>
      ) : (
        <ul className="checklist" data-testid="story-criteria">
          {d.criteria.map(({ criterion: c, checked, scenarios }) => (
            <li key={c.id} className={checked ? 'is-checked' : 'is-open'} data-testid={`story-criterion-${c.id}`} data-checked={checked ? 'true' : 'false'}>
              <span className="check" aria-hidden="true">
                {checked ? '☑' : '☐'}
              </span>
              <div>
                <div>
                  <code>{c.id}</code>{' '}
                  <span className={`badge ${checked ? 'status-approved' : 'status-draft'}`}>{checked ? 'checked' : 'not checked'}</span>
                </div>
                <div className="small">
                  <strong>Given</strong> {c.given}, <strong>when</strong> {c.when}, <strong>then</strong> {c.then}.
                </div>
                <div className="small muted">
                  {checked ? `Proved by ${scenarios.join(', ')}, approved with a valid signature.` : 'No scenario approved with a valid signature names it.'}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function How({ d, onOpenBox }: { d: StoryDetail; onOpenBox: (path: string) => void }) {
  const lay = useMemo(() => howLayout(d.how), [d]);
  const marker = `how-arrow-${useId().replace(/:/g, '')}`;
  const at = new Map(lay.boxes.map((b) => [b.path, b]));
  const titles = new Map(d.how.boxes.map((b) => [b.path, b.box.title]));
  return (
    <section className="story-panel story-how" data-testid="story-how" aria-labelledby="story-how-h">
      <h3 id="story-how-h">How</h3>
      {d.how.boxes.length === 0 ? (
        <p className="muted small">No box in flow.yaml serves {d.storyId}.</p>
      ) : (
        <>
          <p className="muted small">Only the boxes that serve {d.storyId}, in flow order. A dashed edge passes through boxes of other stories. Click a box to open it.</p>
          <div className="how-wrap">
            <svg className="how-map" role="group" aria-label={`How ${d.storyId} works: ${d.how.boxes.map((b) => b.box.title).join(', then ')}`} viewBox={`0 0 ${lay.width} ${lay.height}`} width={lay.width} height={lay.height}>
              <defs>
                <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
                </marker>
              </defs>
              {lay.rows.map((r) => (
                <g key={r.role}>
                  <rect x={0} y={r.y} width={lay.width} height={r.height} className="bp-row" />
                  <rect x={0} y={r.y} width={6} height={r.height} fill={r.color} />
                  <text x={14} y={r.y + 26} className="bp-role-label">
                    <tspan aria-hidden="true">{ROLE_ICON[r.kind ?? ''] ?? '?'} </tspan>
                    {r.label}
                  </text>
                  <text x={14} y={r.y + 44} className="bp-role-kind">
                    {r.kind ?? 'role'}
                  </text>
                </g>
              ))}
              {lay.edges.map((e, i) => {
                const mid = (e.x1 + e.x2) / 2;
                const dip = Math.max(e.y1, e.y2) + 14;
                const path = e.back ? `M${e.x1},${e.y1} C${e.x1},${dip} ${e.x2},${dip} ${e.x2},${e.y2}` : `M${e.x1},${e.y1} C${mid},${e.y1} ${mid},${e.y2} ${e.x2},${e.y2}`;
                const text = [e.label, e.via.length ? `via ${e.via.join(', ')}` : undefined].filter(Boolean).join(' · ');
                return (
                  <g key={i} className={`how-edge is-${e.kind}${e.via.length ? ' is-via' : ''}`} data-testid={`story-how-edge-${e.from}-${e.to}`}>
                    <title>{`${titles.get(e.from)} → ${titles.get(e.to)}${text ? ` (${text})` : ''}`}</title>
                    <path d={path} markerEnd={`url(#${marker})`} />
                    {e.label && (
                      <text x={mid} y={(e.y1 + e.y2) / 2 - 6} textAnchor="middle" className="map-edge-label">
                        {e.label}
                      </text>
                    )}
                  </g>
                );
              })}
              {d.how.boxes.map((b) => {
                const p = at.get(b.path);
                if (!p) return null;
                const parent = b.parent ? titles.get(b.parent) : undefined;
                return (
                  <g key={b.path} className={`how-box${b.depth > 0 ? ' is-nested' : ''}`} data-testid={`story-how-box-${b.path}`} {...svgButton(`Open box ${b.box.title} (${b.path}) in the flow view${parent ? `, inside ${parent}` : ''}`, () => onOpenBox(b.path))}>
                    <title>{`${b.box.title} (${b.path})`}</title>
                    <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={8} />
                    {wrapLines(b.box.title, 22).map((t, i) => (
                      <text key={i} x={p.x + 8} y={p.y + 20 + i * 15} className="bp-process-title">
                        {t}
                      </text>
                    ))}
                    {parent && (
                      <text x={p.x + 8} y={p.y + p.h - 6} className="how-parent">
                        in {parent}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </>
      )}
    </section>
  );
}

function Output({ d, onOpenBox }: { d: StoryDetail; onOpenBox: (path: string) => void }) {
  const { changes, sideEffects, screens, states } = d.output;
  const boxLink = (path: string, title: string) => (
    <button type="button" className="box-link" aria-label={`Open box ${title} (${path}) in the flow view`} onClick={() => onOpenBox(path)}>
      {path}
    </button>
  );
  return (
    <section className="story-panel" data-testid="story-output" aria-labelledby="story-output-h">
      <h3 id="story-output-h">Output</h3>
      <h4>Data changes</h4>
      {changes.length === 0 ? (
        <p className="muted small">The boxes of this story write no data.</p>
      ) : (
        <ul className="output-list" data-testid="story-changes">
          {changes.map((c, i) => (
            <li key={i}>
              <code className="change">{c.text}</code> <span className="small muted">by</span> {boxLink(c.path, c.boxTitle)}
            </li>
          ))}
        </ul>
      )}
      {sideEffects.length > 0 && (
        <>
          <h4>Side effects</h4>
          <ul className="output-list" data-testid="story-side-effects">
            {sideEffects.map((s, i) => (
              <li key={i}>
                {s.text} <span className="small muted">by</span> {boxLink(s.path, s.boxTitle)}
              </li>
            ))}
          </ul>
        </>
      )}
      <h4>What the user sees</h4>
      {screens.length === 0 && states.length === 0 ? (
        <p className="muted small">No output box and no end state.</p>
      ) : (
        <ul className="output-list" data-testid="story-sees">
          {screens.map((s) => (
            <li key={s.path}>
              <span aria-hidden="true">▭ </span>
              {s.title} {boxLink(s.path, s.title)}
            </li>
          ))}
          {states.map((s, i) => (
            <li key={`${s.scenarioId}-${i}`}>
              <span aria-hidden="true">⚑ </span>
              <code>{s.scenarioId}</code> ends with <code>{s.key}</code> = <code>{typeof s.value === 'string' ? s.value : JSON.stringify(s.value)}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
