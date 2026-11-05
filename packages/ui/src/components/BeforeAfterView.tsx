// Before / after of the whole system (design page 11, D43 proposed): the as-is (docs/system/)
// and the to-be (as-is + the EPIC's architecture.yaml). Toggles: Architecture · Flow · Entities
// and Side by side · After with diff · Before only. Colours and words: added, changed, same,
// removed (dashed), new link. Below: the "Changes in this EPIC" table.

import { useMemo, useState } from 'react';
import type { DiffStatus, SystemCompare } from '@rehearse/core';
import type { ReviewEpicView } from '../contract.js';
import { archLayout, changeRows, countStatuses, countsText, diffDrawing, storyNote, type DiffSide } from '../model/architecture.js';
import { ArchDiagram, ArchLegend, NoArchitecture, StatusBadge } from './ArchitectureView.js';

const SUBJECTS = [
  { id: 'architecture', label: 'Architecture' },
  { id: 'flow', label: 'Flow' },
  { id: 'entities', label: 'Entities' },
] as const;
const MODES = [
  { id: 'side', label: 'Side by side' },
  { id: 'diff', label: 'After with diff' },
  { id: 'before', label: 'Before only' },
] as const;
type Subject = (typeof SUBJECTS)[number]['id'];
type Mode = (typeof MODES)[number]['id'];

const CHANGE_EXAMPLE = `# docs/epics/<slug>/architecture.yaml: only what this EPIC changes
version: 1
components:
  - { id: graph, change: added, name: my new part, zone: repo, why: [G2] }
  - { id: cli, change: changed, what: + a new command, why: [G1] }
links:
  - { from: cli, to: graph, change: added, label: find, why: [G1] }
`;

/** A row of toggle buttons; the pressed one says so to assistive tech. */
export function Toggle<T extends string>({ label, items, value, onChange, testId }: { label: string; items: readonly { id: T; label: string }[]; value: T; onChange: (v: T) => void; testId: string }) {
  return (
    <div className="seg" role="group" aria-label={label} data-testid={testId}>
      {items.map((i) => (
        <button key={i.id} type="button" className={i.id === value ? 'seg-btn is-active' : 'seg-btn'} aria-pressed={i.id === value} data-testid={`${testId}-${i.id}`} onClick={() => onChange(i.id)}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function BeforeAfterView({ view }: { view: ReviewEpicView }) {
  const [subject, setSubject] = useState<Subject>('architecture');
  const [mode, setMode] = useState<Mode>('side');
  const c = view.compare;
  return (
    <section className="page before-after" data-testid="before-after" aria-labelledby="ba-title">
      <h2 id="ba-title">Before / after</h2>
      <p className="muted">The system as built (docs/system/) beside the system after this EPIC. Every change says why: the decisions, and the story once prd.yaml has it.</p>
      {!c?.hasChange ? (
        <div className="arch-empty" data-testid="ba-empty">
          <p>
            This EPIC has no <code>architecture.yaml</code>, so it does not change the system as built.
            {c?.hasSystem ? '' : ' The repo has no docs/system/architecture.yaml either.'} To show a change, add the file to the EPIC folder with only what the EPIC adds,
            changes or removes, and the decisions behind each change:
          </p>
          <pre className="yaml-example" aria-label="Example architecture.yaml of an EPIC">
            {CHANGE_EXAMPLE}
          </pre>
          {!c?.hasSystem && <NoArchitecture />}
        </div>
      ) : (
        <>
          <div className="ba-controls">
            <Toggle label="What to compare" items={SUBJECTS} value={subject} onChange={setSubject} testId="ba-subject" />
            <Toggle label="How to show it" items={MODES} value={mode} onChange={setMode} testId="ba-mode" />
          </div>
          <ArchLegend diff />
          {subject === 'architecture' && <ArchitectureCompareView c={c} mode={mode} />}
          {subject === 'flow' && (
            <CardCompare
              mode={mode}
              testId="ba-flow"
              noun="box"
              items={c.boxes.map((b) => ({ key: b.path, title: b.title, sub: b.what ?? (b.inEpic ? '' : 'not in this EPIC'), status: b.status, onBefore: b.status !== 'added', onAfter: b.status !== 'removed' }))}
            />
          )}
          {subject === 'entities' && (
            <CardCompare
              mode={mode}
              testId="ba-entities"
              noun="entity"
              items={c.entities.map((e) => ({ key: e.id, title: e.id, sub: e.what ?? Object.keys((e.after ?? e.before)?.fields ?? {}).join(', '), status: e.status, onBefore: e.status !== 'added', onAfter: e.status !== 'removed' }))}
            />
          )}
          <ChangeTable c={c} hasPrd={view.prd !== undefined} />
        </>
      )}
    </section>
  );
}

function ArchitectureCompareView({ c, mode }: { c: SystemCompare; mode: Mode }) {
  const a = c.architecture;
  // One layout of every item, so a part stands in the same place on both sides.
  const lay = useMemo(() => archLayout(diffDrawing(a, 'diff')), [a]);
  const side = (s: DiffSide) => diffDrawing(a, s);
  if (mode === 'diff') return <ArchDiagram d={side('diff')} lay={lay} label="After with diff: every part and link with its status" testId="ba-arch-diff" />;
  if (mode === 'before') return <Side title="Before · as-is, docs/system/">{a.before ? <ArchDiagram d={side('before')} lay={lay} label="Before: the system as built" testId="ba-arch-before" /> : <NoArchitecture />}</Side>;
  return (
    <div className="ba-sides">
      <Side title="Before · as-is, docs/system/">{a.before ? <ArchDiagram d={side('before')} lay={lay} label="Before: the system as built" testId="ba-arch-before" /> : <NoArchitecture />}</Side>
      <Side title="After · to-be with this EPIC" after>
        <ArchDiagram d={side('after')} lay={lay} label="After: the system with this EPIC" testId="ba-arch-after" />
      </Side>
    </div>
  );
}

function Side({ title, after = false, children }: { title: string; after?: boolean; children: React.ReactNode }) {
  return (
    <section className={`ba-side${after ? ' is-after' : ''}`} aria-label={title}>
      <h3 className="ba-side-title">{title}</h3>
      {children}
    </section>
  );
}

interface CardItem {
  key: string;
  title: string;
  sub: string;
  status: DiffStatus;
  onBefore: boolean;
  onAfter: boolean;
}

/** Flow boxes or entities as cards with their status, for the Flow and Entities toggles. */
function CardCompare({ items, mode, testId, noun }: { items: CardItem[]; mode: Mode; testId: string; noun: string }) {
  const list = (side: DiffSide) => {
    const shown = items.filter((i) => (side === 'before' ? i.onBefore : side === 'after' ? i.onAfter : true));
    if (shown.length === 0) return <p className="muted small">No {noun} on this side.</p>;
    return (
      <ul className="ba-cards" data-testid={`${testId}-${side}`}>
        {shown.map((i) => {
          const status = side === 'before' ? (i.status === 'removed' ? 'removed' : undefined) : i.status;
          return (
            <li key={i.key} className={`ba-card${status ? ` is-${status}` : ''}`} data-testid={`${testId}-${side}-${i.key}`}>
              <span className="ba-card-title">{i.title}</span>
              <StatusBadge status={status} />
              {i.sub && side !== 'before' && <span className="ba-card-sub">{i.sub}</span>}
            </li>
          );
        })}
      </ul>
    );
  };
  if (mode === 'diff') return list('diff');
  if (mode === 'before') return <Side title="Before · as-is">{list('before')}</Side>;
  return (
    <div className="ba-sides">
      <Side title="Before · as-is">{list('before')}</Side>
      <Side title="After · to-be" after>
        {list('after')}
      </Side>
    </div>
  );
}

function ChangeTable({ c, hasPrd }: { c: SystemCompare; hasPrd: boolean }) {
  const rows = useMemo(() => changeRows(c), [c]);
  // Page 11 counts the parts the diagram draws: not people.
  const counts = countsText(countStatuses(c.architecture.parts.filter((p) => (p.after ?? p.before)?.kind !== 'person')));
  const note = storyNote(hasPrd, rows);
  return (
    <section className="ba-changes" data-testid="ba-changes" aria-labelledby="ba-changes-h">
      <h3 id="ba-changes-h">
        Changes in this EPIC <span className="badge status-draft" data-testid="ba-counts">{`parts: ${counts}`}</span>
      </h3>
      {note && (
        <p className="ba-story-note" data-testid="ba-story-note">
          {note}
        </p>
      )}
      <table className="ba-table">
        <thead>
          <tr>
            <th scope="col">Change</th>
            <th scope="col">Part</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
            <th scope="col">Why</th>
            <th scope="col">Story</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-testid={`ba-row-${r.key}`}>
              <td>
                <StatusBadge status={r.status} />
              </td>
              <td>
                <span className="small muted">{r.area} </span>
                <strong>{r.item}</strong>
              </td>
              <td className="muted">{r.before}</td>
              <td>{r.after}</td>
              <td>{r.why.map((w) => <code key={w} className="ref-chip">{w}</code>)}</td>
              <td>
                {!hasPrd ? (
                  <span className="badge status-draft">no story yet</span>
                ) : r.stories.length ? (
                  r.stories.map((s) => <code key={s} className="ref-chip">{s}</code>)
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
