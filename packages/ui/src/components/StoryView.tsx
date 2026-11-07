// One story (S4-A5, D42), as design pages 2 and 12–15 draw it. A tab bar splits the story:
// WHAT, HOW and OUTPUT are the three cards of the story page (page 2: the role and the criteria;
// the processes it runs top to bottom; the data it writes and the status it moves), with the
// scenario cards below them; Before / after (StoryBeforeAfter.tsx), Code (StoryCode.tsx) and
// Tests (T13: the story's e2e tests in Birdview) each get the story header card on top. The story
// page head names the story's sign-off state with a link to the sign-off preview (T39), read only.

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { Id } from '@rehearse/core';
import type { ReviewEpicView } from '../contract.js';
import { howFlow, statusMachine, storyColor, storyState, type HowLink } from '../model/storypage.js';
import { storyDetail, type StoryDetail } from '../model/storyview.js';
import { CodeChip, StoryCode, useCodeIndex } from './StoryCode.js';
import { StoryTests } from './StoryTests.js';
import { StoryBeforeAfter } from './StoryBeforeAfter.js';
import { SignOffPreview } from './SignOffPreview.js';

export const STORY_TABS = [
  { id: 'what', label: 'WHAT' },
  { id: 'how', label: 'HOW' },
  { id: 'output', label: 'OUTPUT' },
  { id: 'before-after', label: 'Before / after' },
  { id: 'code', label: 'Code' },
  { id: 'tests', label: 'Tests' },
] as const;
export type StoryTab = (typeof STORY_TABS)[number]['id'];

/** WHAT, HOW and OUTPUT are the three cards of one page (design page 2). */
export const isStoryPage = (tab: StoryTab): boolean => tab === 'what' || tab === 'how' || tab === 'output';

export interface StoryViewProps {
  view: ReviewEpicView;
  storyId: Id;
  onOpenBox: (path: string) => void;
  /** The open tab, when the parent keeps it (it shows the scenario cards on the story page only). */
  tab?: StoryTab;
  onTab?: (tab: StoryTab) => void;
  /** The breadcrumb's "Big picture". */
  onBigPicture?: () => void;
  /** The breadcrumb's "Stories": the story list. */
  onStories?: () => void;
  /** Open another story's page (a story named on this page). */
  onOpenStory?: (id: Id) => void;
  /** The in-app "← Back" button (the previous place). */
  back?: BackControl;
  /** More of the story page, under the three cards (for example the scenario cards). */
  children?: ReactNode;
}

export function StoryView({ view, storyId, onOpenBox, onBigPicture, onStories, onOpenStory, back, children, ...props }: StoryViewProps) {
  const d = useMemo(() => storyDetail(view, storyId), [view, storyId]);
  const [ownTab, setOwnTab] = useState<StoryTab>('what');
  const tab = props.tab ?? ownTab;
  const setTab = props.onTab ?? setOwnTab;
  const code = useCodeIndex();
  const tabId = useId().replace(/:/g, '');
  const scenarios = useMemo(() => view.scenarios.map((sv) => sv.scenario).filter((s) => s.story === storyId), [view, storyId]);
  const statuses = useMemo(() => Object.fromEntries(view.scenarios.filter((sv) => sv.scenario.story === storyId).map((sv) => [sv.scenario.id, sv.status])), [view, storyId]);
  const page = isStoryPage(tab);
  // A click on WHAT, HOW or OUTPUT brings that card into view (not on the first render).
  // The picked card is outlined, so the reader sees which one the tab meant.
  const [picked, setPicked] = useState(false);
  useEffect(() => {
    if (!picked || !page) return;
    document.getElementById(`${tabId}-${tab}-card`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [tab, page, tabId, picked]);
  const pick = (t: StoryTab) => {
    setPicked(true);
    setTab(t);
  };
  const color = storyColor(view, storyId);
  const [preview, setPreview] = useState(false);
  useEffect(() => setPreview(false), [storyId]);
  return (
    <article className={`story-view${page ? ' is-page' : ' is-tab'}`} data-testid="story-view" aria-labelledby={`${tabId}-title`} style={{ ['--role' as string]: color }}>
      {page ? (
        <>
          <PageHead
            view={view}
            d={d}
            titleId={`${tabId}-title`}
            code={
              <>
                <CodeChip d={d} index={code} />
                {d.story && <SignOffChip view={view} storyId={storyId} open={preview} onToggle={() => setPreview((v) => !v)} />}
              </>
            }
            crumbs={{ onBigPicture, onStories, back }}
          />
          {preview && d.story && (
            <section className="story-signoff-preview" aria-label={`Sign-off preview of ${storyId}`} data-testid="story-signoff-preview">
              <div className="story-signoff-preview-head">
                <h2>Sign-off of {storyId}</h2>
                <button type="button" className="action" data-testid="story-signoff-preview-close" onClick={() => setPreview(false)}>
                  Close
                </button>
              </div>
              <SignOffPreview view={view} storyIds={[storyId]} onOpenBox={onOpenBox} />
              <p className="muted small">You sign off in the Sign-off tab.</p>
            </section>
          )}
        </>
      ) : (
        <CardHead
          view={view}
          d={d}
          titleId={`${tabId}-title`}
          code={<CodeChip d={d} index={code} />}
          crumbs={{ onBigPicture, onStories, back }}
          tabLabel={STORY_TABS.find((t) => t.id === tab)?.label ?? tab}
          onBack={() => pick('what')}
        />
      )}
      <div className="story-tabs seg" role="tablist" aria-label={`Views of story ${storyId}`} data-testid="story-tabs">
        {STORY_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${tabId}-${t.id}`}
            aria-selected={t.id === tab}
            aria-controls={`${tabId}-panel`}
            className={t.id === tab ? 'story-tab is-active' : 'story-tab'}
            data-testid={`story-tab-${t.id}`}
            onClick={() => pick(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${tab}`} className="story-tabpanel">
        {page && (
          <div className="story-panels">
            <What view={view} d={d} id={`${tabId}-what-card`} focus={picked && tab === 'what'} />
            <How view={view} d={d} onOpenBox={onOpenBox} onOpenStory={onOpenStory} id={`${tabId}-how-card`} focus={picked && tab === 'how'} />
            <Output d={d} onOpenBox={onOpenBox} id={`${tabId}-output-card`} focus={picked && tab === 'output'} />
          </div>
        )}
        {tab === 'before-after' && <StoryBeforeAfter view={view} storyId={storyId} onOpenBox={onOpenBox} />}
        {tab === 'code' && <StoryCode d={d} index={code} />}
        {tab === 'tests' && <StoryTests storyId={storyId} scenarios={scenarios} statuses={statuses} />}
      </div>
      {page && children}
    </article>
  );
}

// ---------------------------------------------------------------- headers

function StoryChips({ view, d }: { view: ReviewEpicView; d: StoryDetail }) {
  const state = storyState(view, d.storyId);
  const reqs = Array.isArray(d.story?.requirements) ? d.story.requirements : [];
  return (
    <>
      <span className="chip chip-role">{d.roleLabel}</span>
      {reqs.map((r) => (
        <span key={r} className="chip chip-plain">
          {r}
        </span>
      ))}
      <span className="chip chip-plain">
        {d.scenarios.length} scenario{d.scenarios.length === 1 ? '' : 's'}
      </span>
      <span className={`chip chip-state is-${state.kind}`} data-testid="story-state">
        {state.text}
      </span>
    </>
  );
}

/** The story's sign-off state (signed, stale, not signed) and the link that opens the sign-off preview (T39). */
function SignOffChip({ view, storyId, open, onToggle }: { view: ReviewEpicView; storyId: Id; open: boolean; onToggle: () => void }) {
  const status = view.readiness?.requirements.flatMap((r) => r.stories).find((s) => s.id === storyId)?.status;
  const [state, link] = status === 'signed' ? ['Sign-off: current', 'Preview sign-off'] : status === 'stale' ? ['Sign-off: stale', 'What changed'] : ['Sign-off: none yet', 'Preview sign-off'];
  return (
    <>
      <span className={`chip chip-plain signoff-state is-${status ?? 'draft'}`} data-testid="story-signoff-state">
        {state}
      </span>
      <button type="button" className="chip chip-link" aria-expanded={open} data-testid="story-signoff-preview-link" onClick={onToggle}>
        {open ? 'Hide sign-off preview' : link}
      </button>
    </>
  );
}

/** The in-app "← Back" button: the previous place (the bb panel has no browser buttons). */
export interface BackControl {
  can: boolean;
  onBack: () => void;
}

export function BackButton({ back }: { back?: BackControl }) {
  if (!back) return null;
  return (
    <button type="button" className="crumb-back" data-testid="nav-back" disabled={!back.can} aria-label="Back to the previous place" onClick={back.onBack}>
      ← Back
    </button>
  );
}

export interface CrumbLinks {
  onBigPicture?: () => void;
  onStories?: () => void;
  back?: BackControl;
}

/** A crumb that is a link when it has somewhere to go. */
function Crumb({ onClick, children, ...rest }: { onClick?: () => void; children: ReactNode; testId?: string; label?: string }) {
  return onClick ? (
    <button type="button" className="crumb" data-testid={rest.testId} aria-label={rest.label} onClick={onClick}>
      {children}
    </button>
  ) : (
    <span className="crumb">{children}</span>
  );
}

/** "← Back · Big picture / Stories", the start of every story breadcrumb. */
export function CrumbStart({ onBigPicture, onStories, back }: CrumbLinks) {
  return (
    <>
      <BackButton back={back} />
      <Crumb onClick={onBigPicture} testId="crumb-bigpicture">
        Big picture
      </Crumb>
      <span aria-hidden="true">/</span>
      <Crumb onClick={onStories} testId="crumb-stories">
        Stories
      </Crumb>
      <span aria-hidden="true">/</span>
    </>
  );
}

/** Design page 2: breadcrumb, `S6 · Builder wants …`, the "so that" line and the chips. */
function PageHead({ view, d, titleId, code, crumbs }: { view: ReviewEpicView; d: StoryDetail; titleId: string; code: ReactNode; crumbs: CrumbLinks }) {
  return (
    <header className="story-head">
      <nav className="crumbs" aria-label="Breadcrumb">
        <CrumbStart {...crumbs} />
        <span className="crumb is-current" aria-current="page" data-testid="crumb-story">
          {d.storyId}
        </span>
      </nav>
      <h1 id={titleId} className="story-title">
        {d.storyId} · {d.story ? `${d.roleLabel} wants ${d.story.want}` : 'not in prd.yaml'}
      </h1>
      {d.story && <p className="story-so-that">so that {d.story.soThat}</p>}
      <div className="story-chips">
        <StoryChips view={view} d={d} />
        {code}
      </div>
    </header>
  );
}

/** Design pages 12–15: breadcrumb (Big picture / Stories / S6 / Code) and the story card with its chips. */
function CardHead({
  view,
  d,
  titleId,
  code,
  crumbs,
  tabLabel,
  onBack,
}: {
  view: ReviewEpicView;
  d: StoryDetail;
  titleId: string;
  code: ReactNode;
  crumbs: CrumbLinks;
  tabLabel: string;
  onBack: () => void;
}) {
  return (
    <header className="story-head is-card">
      <nav className="crumbs" aria-label="Breadcrumb">
        <CrumbStart {...crumbs} />
        <button type="button" className="crumb" data-testid="crumb-story" onClick={onBack} aria-label={`Back to the story page of ${d.storyId}`}>
          {d.storyId}
        </button>
        <span aria-hidden="true">/</span>
        <span className="crumb is-current" aria-current="page">
          {tabLabel}
        </span>
      </nav>
      <div className="story-head-card">
        <div className="story-chips">
          <span className="chip chip-id">{d.storyId}</span>
          <StoryChips view={view} d={d} />
        </div>
        <h1 id={titleId} className="story-sentence">
          {d.story ? (
            <>
              As {article(d.roleLabel)} {d.roleLabel}, I want {d.story.want}, so that {d.story.soThat}.
            </>
          ) : (
            <>{d.storyId} is not in prd.yaml yet.</>
          )}
        </h1>
        <div className="story-chips">{code}</div>
      </div>
    </header>
  );
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

// ---------------------------------------------------------------- the three cards

function PanelHead({ n, kicker, title, id }: { n: number; kicker: string; title: string; id: string }) {
  return (
    <div className="panel-head">
      <p className="panel-kicker" aria-hidden="true">
        {n}&nbsp;&nbsp;{kicker}
      </p>
      <h2 id={id}>
        <span className="sr-only">{kicker}: </span>
        {title}
      </h2>
    </div>
  );
}

function What({ view, d, id, focus }: { view: ReviewEpicView; d: StoryDetail; id: string; focus: boolean }) {
  const { story } = d;
  const role = Array.isArray(view.prd?.roles) ? view.prd.roles.find((r) => r && r.id === story?.role) : undefined;
  return (
    <section id={id} className={`story-panel${focus ? ' is-focus' : ''}`} data-testid="story-what" aria-labelledby={`${id}-h`}>
      <PanelHead n={1} kicker="WHAT" title="What this feature is about" id={`${id}-h`} />
      {story ? (
        <div className="role-line">
          <span className="avatar" aria-hidden="true">
            {d.roleLabel.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong data-testid="story-role">{d.roleLabel}</strong>
            {role?.about && <p className="muted small role-about">{role.about}</p>}
          </div>
        </div>
      ) : (
        <p className="warn">No story {d.storyId} in prd.yaml.</p>
      )}
      {d.criteria.length === 0 ? (
        <p className="muted small">The story has no acceptance criteria.</p>
      ) : (
        <ul className="criteria" data-testid="story-criteria" aria-label="Acceptance criteria">
          {d.criteria.map(({ criterion: c, checked, scenarios }) => (
            <li key={c.id} className={`criterion${checked ? ' is-checked' : ''}`} data-testid={`story-criterion-${c.id}`} data-checked={checked ? 'true' : 'false'}>
              <div className="criterion-head">
                <span className="criterion-id">{c.id}</span>
                <span className={`badge ${checked ? 'status-approved' : 'status-draft'}`}>
                  <span aria-hidden="true">{checked ? '✓ ' : '○ '}</span>
                  {checked ? 'checked' : 'not checked'}
                </span>
              </div>
              <dl className="gwt-rows">
                <dt>GIVEN</dt>
                <dd>{c.given}</dd>
                <dt>WHEN</dt>
                <dd>{c.when}</dd>
                <dt>THEN</dt>
                <dd>{c.then}</dd>
              </dl>
              <p className="criterion-proof">{checked ? `Proved by ${scenarios.join(', ')}, approved with a valid signature.` : 'No scenario approved with a valid signature names it.'}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function How({
  view,
  d,
  onOpenBox,
  onOpenStory,
  id,
  focus,
}: {
  view: ReviewEpicView;
  d: StoryDetail;
  onOpenBox: (path: string) => void;
  onOpenStory?: (id: Id) => void;
  id: string;
  focus: boolean;
}) {
  const f = useMemo(() => howFlow(view, d), [view, d]);
  const titles = new Map(f.steps.map((s) => [s.path, s.title]));
  const linkText = (l: HowLink) => [l.label, l.via.length ? `via ${l.via.join(', ')}` : undefined].filter(Boolean).join(' · ');
  return (
    <section id={id} className={`story-panel story-how${focus ? ' is-focus' : ''}`} data-testid="story-how" aria-labelledby={`${id}-h`}>
      <PanelHead n={2} kicker="HOW" title="How it works: the processes it runs" id={`${id}-h`} />
      {f.steps.length === 0 ? (
        <p className="muted small">No box in flow.yaml serves {d.storyId}.</p>
      ) : (
        <>
          <ol className="how-flow" aria-label={`How ${d.storyId} works, in flow order`}>
            {f.steps.map((s, i) => {
              const link = f.links[i];
              return (
                <li key={s.path} className="how-item" style={{ ['--lane' as string]: s.color }}>
                  <div className="how-row">
                    <span className="lane-chip">{s.lane}</span>
                    <button
                      type="button"
                      className={`how-step${s.decision ? ' is-decision' : ''}`}
                      data-testid={`story-how-box-${s.path}`}
                      aria-label={`Open box ${s.title} (${s.path}) in the box drawer${s.parent ? `, inside ${s.parent}` : ''}`}
                      onClick={() => onOpenBox(s.path)}
                    >
                      <span className="how-title">
                        {s.decision && <span aria-hidden="true">◆ </span>}
                        {s.title}
                      </span>
                      <span className="how-sub">
                        {s.decision ? 'decision' : s.lane}
                        {s.parent && ` · in ${s.parent}`}
                        {s.also.length > 0 && ` · also ${s.also.join(', ')}`}
                      </span>
                    </button>
                    {s.also.length > 0 ? (
                      <span className="shared-chip" title={`Also serves ${s.also.join(', ')}`}>
                        shared
                      </span>
                    ) : (
                      <span className="shared-space" aria-hidden="true" />
                    )}
                  </div>
                  {onOpenStory && s.also.length > 0 && (
                    <p className="how-also">
                      also in{' '}
                      {s.also.map((other) => (
                        <button
                          key={other}
                          type="button"
                          className="story-link"
                          data-testid={`story-how-also-${s.path}-${other}`}
                          aria-label={`Open story ${other}, which also runs ${s.title}`}
                          onClick={() => onOpenStory(other)}
                        >
                          {other}
                        </button>
                      ))}
                    </p>
                  )}
                  {i < f.steps.length - 1 &&
                    (link ? (
                      <div
                        className={`how-link is-${link.kind}${link.via.length ? ' is-via' : ''}`}
                        data-testid={`story-how-edge-${link.from}-${link.to}`}
                        title={`${titles.get(link.from)} → ${titles.get(link.to)}`}
                      >
                        <span className="how-link-label">{linkText(link)}</span>
                      </div>
                    ) : (
                      <div className="how-link is-none" title="No edge joins these two boxes directly">
                        <span className="how-link-label" />
                      </div>
                    ))}
                </li>
              );
            })}
          </ol>
          {f.jumps.length > 0 && (
            <ul className="how-jumps" aria-label="Other edges">
              {f.jumps.map((l) => (
                <li key={`${l.from}-${l.to}`} className={`is-${l.kind}${l.via.length ? ' is-via' : ''}`} data-testid={`story-how-edge-${l.from}-${l.to}`}>
                  <span aria-hidden="true">↪ </span>
                  {titles.get(l.from)} → {titles.get(l.to)}
                  {linkText(l) && <span className="muted"> ({linkText(l)})</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Output({ d, onOpenBox, id, focus }: { d: StoryDetail; onOpenBox: (path: string) => void; id: string; focus: boolean }) {
  const { changes, sideEffects, screens, states } = d.output;
  const machine = useMemo(() => statusMachine(d), [d]);
  const boxLink = (path: string, title: string) => (
    <button type="button" className="box-link" aria-label={`Open box ${title} (${path}) in the box drawer`} title={title} onClick={() => onOpenBox(path)}>
      {path}
    </button>
  );
  return (
    <section id={id} className={`story-panel${focus ? ' is-focus' : ''}`} data-testid="story-output" aria-labelledby={`${id}-h`}>
      <PanelHead n={3} kicker="OUTPUT" title="What it leaves behind" id={`${id}-h`} />
      <h3>Data it writes</h3>
      {changes.length === 0 ? (
        <p className="muted small">The boxes of this story write no data.</p>
      ) : (
        <ul className="output-rows" data-testid="story-changes">
          {changes.map((c, i) => (
            <li key={i}>
              <span className="change">{c.text}</span>
              <span className="by">by {boxLink(c.path, c.boxTitle)}</span>
            </li>
          ))}
        </ul>
      )}
      {machine && (
        <>
          <h3>{machine.target}</h3>
          <div className="state-machine" data-testid="story-status-machine" role="group" aria-label={`${machine.target}: ${machine.moves.map((m) => `${m.from} to ${m.to} by ${m.by}`).join('; ')}`}>
            <ol className="state-pills" aria-hidden="true">
              {machine.states.map((s) => (
                <li key={s} className={`state-pill is-${s}`}>
                  {s}
                </li>
              ))}
            </ol>
            <ul className="state-moves" aria-hidden="true">
              {machine.moves.map((m, i) => (
                <li key={i}>
                  {m.from} → {m.to} <span className="muted">· {m.by}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
      {sideEffects.length > 0 && (
        <>
          <h3>Side effects</h3>
          <ul className="output-rows" data-testid="story-side-effects">
            {sideEffects.map((s, i) => (
              <li key={i}>
                <span className="change">{s.text}</span>
                <span className="by">by {boxLink(s.path, s.boxTitle)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>What the user sees</h3>
      {screens.length === 0 && states.length === 0 ? (
        <p className="muted small">No output box and no end state.</p>
      ) : (
        <ul className="output-rows is-plain" data-testid="story-sees">
          {screens.map((s) => (
            <li key={s.path}>
              <span className="change">
                <span aria-hidden="true">▭ </span>
                {s.title}
              </span>
              <span className="by">{boxLink(s.path, s.title)}</span>
            </li>
          ))}
          {states.map((s, i) => (
            <li key={`${s.scenarioId}-${i}`}>
              <span className="change">
                {s.scenarioId} ends with {s.key} = {typeof s.value === 'string' ? s.value : JSON.stringify(s.value)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="evidence-note">Evidence only when the approval has a valid SSH signature. A draft or stale scenario does not prove anything.</p>
    </section>
  );
}

