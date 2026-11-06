// The box drawer (T38): a box opens on the right, over the page the reader is on. It shows where
// the box sits (parents, lane, kind), its contract, the decisions and stories it names, the steps
// inside it as a small diagram, the edges in and out with their labels, its code from the
// Flow-Box commits and the scenarios that step through it. Every box it names opens in the same
// drawer. Esc, ✕ or a click outside closes it; focus stays inside and goes back when it closes.

import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import type { Id } from '@rehearse/core';
import type { ReviewEpicView } from '../contract.js';
import { boxDrawer, kindText, type DrawerEdge } from '../model/boxdrawer.js';
import { NO_CODE_KINDS } from '../model/code.js';
import type { Place } from '../model/links.js';
import type { StoryTabId } from '../model/nav.js';
import { BoxDiagram } from './BoxDiagram.js';
import { IdLink } from './IdLink.js';
import { useCodeIndex } from './StoryCode.js';
import { KeyValues, Tags } from './Values.js';

export interface BoxDrawerProps {
  view: ReviewEpicView;
  path: string;
  onOpenBox: (path: string) => void;
  onClose: () => void;
  onGo: (place: Place) => void;
  onOpenStory: (id: Id, tab: StoryTabId) => void;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function BoxDrawer({ view, path, onOpenBox, onClose, onGo, onOpenStory }: BoxDrawerProps) {
  const d = useMemo(() => boxDrawer(view, path), [view, path]);
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Focus goes back to what opened the drawer when it closes.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);
  // Each box the drawer opens starts with its title.
  useEffect(() => heading.current?.focus(), [path]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const all = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (all.length === 0) return;
    const first = all[0]!;
    const last = all[all.length - 1]!;
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === heading.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const title = d?.box.title ?? path;
  return (
    <div className="drawer-backdrop" data-testid="box-drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside
        ref={panel}
        className="box-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="box-drawer-title"
        data-testid="box-drawer"
        data-box={path}
        onKeyDown={onKeyDown}
      >
        <header className="drawer-head">
          <nav className="breadcrumb drawer-crumbs" aria-label="Boxes above this one" data-testid="drawer-breadcrumb">
            {(d?.parents ?? []).map((c) => (
              <span key={c.path} className="crumb">
                <button type="button" data-testid={`drawer-crumb-${c.path}`} title={c.title} aria-label={`Open box ${c.title} (${c.path})`} onClick={() => onOpenBox(c.path)}>
                  {c.title}
                </button>
                <span className="crumb-sep" aria-hidden="true">
                  ›
                </span>
              </span>
            ))}
            <span className="crumb-current" aria-current="page" data-testid="drawer-crumb-current">
              {path}
            </span>
          </nav>
          <button type="button" className="drawer-close" data-testid="box-drawer-close" aria-label="Close the box drawer" onClick={onClose}>
            ✕
          </button>
          <h2 id="box-drawer-title" ref={heading} tabIndex={-1} data-testid="drawer-title">
            {title}
          </h2>
          {d && (
            <div className="drawer-meta">
              <span className={`pill kind-${d.box.kind}`} data-testid="drawer-kind">
                {kindText(d.box.kind)}
              </span>
              <span className="lane-chip" style={{ ['--lane' as string]: d.lane.color }} data-testid="drawer-lane">
                {d.lane.label} lane
              </span>
              {d.box.package && <span className="pill">package {d.box.package}</span>}
            </div>
          )}
        </header>
        {!d ? (
          <p className="muted" data-testid="drawer-missing">
            flow.yaml has no box at {path}.
          </p>
        ) : (
          <div className="drawer-body">
            <section aria-labelledby="drawer-contract-h" data-testid="contract">
              <h3 id="drawer-contract-h">Contract</h3>
              <div className="drawer-grid">
                <h4>Inputs</h4>
                <KeyValues values={d.box.inputs} testId="contract-inputs" />
                <h4>Outputs</h4>
                <KeyValues values={d.box.outputs} testId="contract-outputs" />
                <h4>Reads</h4>
                <Tags items={d.box.reads} testId="contract-reads" />
                <h4>Writes</h4>
                <Tags items={d.box.writes} testId="contract-writes" kind="writes" />
                {(d.box.sideEffects?.length ?? 0) > 0 && (
                  <>
                    <h4>Side effects</h4>
                    <Tags items={d.box.sideEffects} testId="contract-side-effects" />
                  </>
                )}
                {(d.box.errorExits?.length ?? 0) > 0 && (
                  <>
                    <h4>Error exits</h4>
                    <Tags items={d.box.errorExits} testId="contract-error-exits" kind="errors" />
                  </>
                )}
                <h4>Decisions</h4>
                {d.decisions.length === 0 ? (
                  <div className="muted" data-testid="drawer-decisions">—</div>
                ) : (
                  <div className="drawer-links" data-testid="drawer-decisions">
                    {d.decisions.map((id) => (
                      <IdLink key={id} link={{ kind: 'decision', id }} onGo={onGo} />
                    ))}
                  </div>
                )}
                <h4>Stories</h4>
                {d.stories.length === 0 ? (
                  <div className="muted" data-testid="drawer-stories">—</div>
                ) : (
                  <div className="drawer-links" data-testid="drawer-stories">
                    {d.stories.map((id) => (
                      <button key={id} type="button" className="id-link id-story" data-testid={`drawer-story-${id}`} aria-label={`Story ${id}: open the Story view`} onClick={() => onOpenStory(id, 'what')}>
                        {id}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {d.children && (
              <section aria-labelledby="drawer-steps-h" data-testid="drawer-steps">
                <h3 id="drawer-steps-h">Steps inside ({d.childPaths.length})</h3>
                <BoxDiagram flow={view.flow} prd={view.prd} diagramPath={path} label={`The ${d.childPaths.length} steps inside ${title}`} onSelect={onOpenBox} />
                <ol className="drawer-list">
                  {d.childPaths.map((p) => {
                    const child = d.children!.boxes.find((b) => `${path}/${b.id}` === p)!;
                    return (
                      <li key={p}>
                        <BoxButton path={p} title={child.title} testId={`drawer-child-${p}`} onOpenBox={onOpenBox} />
                        <span className="muted small"> {kindText(child.kind)}</span>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}

            <section aria-labelledby="drawer-edges-h" data-testid="drawer-edges">
              <h3 id="drawer-edges-h">Edges</h3>
              <Edges title="Comes from" edges={d.incoming} dir="in" onOpenBox={onOpenBox} />
              <Edges title="Goes to" edges={d.outgoing} dir="out" onOpenBox={onOpenBox} />
            </section>

            <DrawerCode path={path} kind={d.box.kind} stories={d.stories} onOpenStory={onOpenStory} />

            <section aria-labelledby="drawer-scenarios-h" data-testid="drawer-scenarios">
              <h3 id="drawer-scenarios-h">Scenarios through it</h3>
              {d.scenarios.length === 0 ? (
                <p className="muted small">No scenario steps through this box.</p>
              ) : (
                <ul className="drawer-list">
                  {d.scenarios.map((s) => (
                    <li key={s.id}>
                      <IdLink link={{ kind: 'scenario', id: s.id }} onGo={onGo} /> <span className="small">{s.title}</span>
                      <span className="muted small"> · step {s.steps.join(', ')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

function BoxButton({ path, title, testId, onOpenBox }: { path: string; title: string; testId: string; onOpenBox: (path: string) => void }) {
  return (
    <button type="button" className="box-link" data-testid={testId} aria-label={`Open box ${title} (${path})`} onClick={() => onOpenBox(path)}>
      {title}
    </button>
  );
}

function Edges({ title, edges, dir, onOpenBox }: { title: string; edges: DrawerEdge[]; dir: 'in' | 'out'; onOpenBox: (path: string) => void }) {
  return (
    <>
      <h4>{title}</h4>
      {edges.length === 0 ? (
        <p className="muted small" data-testid={`drawer-edges-${dir}`}>
          {dir === 'in' ? 'No edge comes in: it starts this diagram.' : 'No edge goes out: it ends this diagram.'}
        </p>
      ) : (
        <ul className="drawer-list" data-testid={`drawer-edges-${dir}`}>
          {edges.map((e) => (
            <li key={`${e.path}:${e.label ?? ''}`} className={`drawer-edge edge-${e.kind}`}>
              {e.label !== undefined && (
                <span className={`edge-label edge-label-${e.kind}`} data-testid={`drawer-edge-${dir}-${e.path}-label`}>
                  {e.kind === 'error' ? `⚠ ${e.label}` : e.label}
                </span>
              )}
              <span aria-hidden="true">{dir === 'in' ? '←' : '→'}</span>
              <BoxButton path={e.path} title={e.title} testId={`drawer-edge-${dir}-${e.path}`} onOpenBox={onOpenBox} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function DrawerCode({ path, kind, stories, onOpenStory }: { path: string; kind: string; stories: Id[]; onOpenStory: (id: Id, tab: StoryTabId) => void }) {
  const index = useCodeIndex();
  const own = index?.ok ? index.boxes[path] : undefined;
  const commits = own?.commits ?? [];
  let words: string;
  if (NO_CODE_KINDS.includes(kind)) words = `A ${kind} box has no code: it is a choice or an end, not work.`;
  else if (index === undefined) words = 'Reading the code…';
  else if (!index.ok) words = `No code: ${index.reason}.`;
  else if (commits.length === 0) words = 'This box has no code yet.';
  else words = `${commits.length} ${commits.length === 1 ? 'commit names' : 'commits name'} this box in a Flow-Box trailer, ${own!.files.length} ${own!.files.length === 1 ? 'file' : 'files'}.`;
  return (
    <section aria-labelledby="drawer-code-h" data-testid="drawer-code">
      <h3 id="drawer-code-h">Code</h3>
      <p className="small" data-testid="drawer-code-words">
        {words}
      </p>
      {commits.length > 0 && (
        <ul className="drawer-list drawer-commits">
          {commits
            .slice(-5)
            .reverse()
            .map((c) => (
              <li key={c.sha} className="small">
                <code>{c.short}</code> {c.subject}
              </li>
            ))}
        </ul>
      )}
      {stories.length > 0 && (
        <p className="drawer-links">
          {stories.map((id) => (
            <button key={id} type="button" className="link small" data-testid={`drawer-code-story-${id}`} onClick={() => onOpenStory(id, 'code')}>
              Code tab of {id} →
            </button>
          ))}
        </p>
      )}
    </section>
  );
}
