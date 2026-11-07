// The Status page (T58, S23, boxes status-table, whats-missing and status-sources): per story,
// whether it is signed, built, tested on the real screens and done, and what is missing and who
// acts, not done first. Filters: All / Not done / Built but not seen working. A row opens the
// story's progress (its boxes with their evidence, its scenarios with their tests). Read-only: it
// only GETs api/status and api/story-progress. A story with small changes (T62) says "New in C1".

import { useEffect, useState } from 'react';
import { fetchStatus, fetchStoryProgress, type StatusRow, type StatusTable, type StoryProgress, type ThreadOutcome } from '../api.js';
import { builtTone, doneTone, filterCount, filterStatusRows, signedTone, STATUS_FILTERS, type StatusFilterId } from '../model/status.js';
import type { ReviewEpicView } from '../contract.js';
import { storyChanges } from '../model/changes.js';
import { StoryProgressBlock } from './StoryProgress.js';
import { ChangeMark } from './ChangeMark.js';

export interface StatusPageApi {
  status: (slug: string) => Promise<ThreadOutcome<StatusTable>>;
  progress: (story: string) => Promise<ThreadOutcome<StoryProgress>>;
}

const HTTP: StatusPageApi = { status: (slug) => fetchStatus(slug), progress: (story) => fetchStoryProgress(story) };

type Load<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; body: T };

export function StatusPage({
  slug,
  onOpenStory,
  api = HTTP,
  now = Date.now(),
  changes,
}: {
  slug: string;
  onOpenStory: (story: string) => void;
  api?: StatusPageApi;
  now?: number;
  /** The small changes of the EPIC (T62), from `GET api/epic`. */
  changes?: ReviewEpicView['changes'];
}) {
  const [table, setTable] = useState<Load<StatusTable>>({ kind: 'loading' });
  const [filter, setFilter] = useState<StatusFilterId>('all');
  const [open, setOpen] = useState<string | undefined>(undefined);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    setTable({ kind: 'loading' });
    void api.status(slug).then((r) => {
      if (live) setTable(r.kind === 'ok' ? { kind: 'ready', body: r.body } : { kind: 'error', message: r.message });
    });
    return () => {
      live = false;
    };
  }, [api, slug, round]);

  if (table.kind === 'loading') return <div className="status-msg" data-testid="status-loading">rehearse reads signatures, commits, the code graph and test results…</div>;
  if (table.kind === 'error')
    return (
      <div className="status-msg error" data-testid="status-error">
        The Status page could not be made: {table.message}
      </div>
    );
  const t = table.body;
  const rows = filterStatusRows(t.rows, filter);
  return (
    <section className="status-page" data-testid="status-page" aria-labelledby="status-h">
      <header className="status-head">
        <h2 id="status-h">Status</h2>
        <p className="status-header" data-testid="status-header">
          {t.header}
        </p>
        <p className="small muted">Done means: every box is built (or needs no code of its own), the owner signed it off, and no test of it fails. Seen working means every approved scenario passed on the real screens.</p>
      </header>
      <div className="status-filters" role="group" aria-label="Show" data-testid="status-filters">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={f.id === filter ? 'chip is-active' : 'chip'}
            aria-pressed={f.id === filter}
            data-testid={`status-filter-${f.id}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label} ({filterCount(t, f.id)})
          </button>
        ))}
        <button type="button" className="link" data-testid="status-reload" onClick={() => setRound((n) => n + 1)}>
          Read again
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="small muted" data-testid="status-empty">
          {filter === 'not-done' ? 'Every story is done.' : 'No story is built but not seen working.'}
        </p>
      ) : (
        <table className="status-table" data-testid="status-table">
          <thead>
            <tr>
              <th scope="col">Story</th>
              <th scope="col">Signed</th>
              <th scope="col">Built</th>
              <th scope="col">Tests on the real screens</th>
              <th scope="col">Automated tests</th>
              <th scope="col">Done</th>
              <th scope="col">What's missing — who acts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <StatusTableRow key={r.id} row={r} changes={changes} open={open === r.id} onToggle={() => setOpen(open === r.id ? undefined : r.id)} onOpenStory={onOpenStory} api={api} now={now} />
            ))}
          </tbody>
        </table>
      )}
      <footer className="status-sources small muted" data-testid="status-sources">
        <p>Where the facts come from:</p>
        <ul>
          <li data-testid="status-source-commit">Commit: {t.sources.commit}</li>
          <li data-testid="status-source-graph">Built: {t.sources.graph}</li>
          <li data-testid="status-source-e2e">Tests on the real screens: {t.sources.e2e}</li>
          <li data-testid="status-source-unit">Automated tests: {t.sources.unit}</li>
        </ul>
      </footer>
    </section>
  );
}

function StatusTableRow({ row: r, changes, open, onToggle, onOpenStory, api, now }: { row: StatusRow; changes?: ReviewEpicView['changes']; open: boolean; onToggle: () => void; onOpenStory: (story: string) => void; api: StatusPageApi; now: number }) {
  return (
    <>
      <tr
        className={`status-row is-${doneTone(r)}${open ? ' is-open' : ''}`}
        data-testid={`status-row-${r.id}`}
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <th scope="row" className="status-story">
          <span className="status-id">{r.id}</span> <span className="status-title">{r.title}</span>
          {storyChanges({ changes }, r.id).map((c) => (
            <ChangeMark key={c.id} change={c} testId={`status-change-${r.id}-${c.id}`} />
          ))}
        </th>
        <td className={`tone-${signedTone(r)}`} data-testid={`status-signed-${r.id}`}>
          {r.signed.text}
        </td>
        <td className={`tone-${builtTone(r)}`} data-testid={`status-built-${r.id}`}>
          {r.built.text}
        </td>
        <td className={`tone-${r.e2e.tone}`} data-testid={`status-e2e-${r.id}`}>
          {r.e2e.text}
        </td>
        <td className={`tone-${r.unit.tone}`} data-testid={`status-unit-${r.id}`}>
          {r.unit.text}
        </td>
        <td className={`tone-${doneTone(r)}`} data-testid={`status-done-${r.id}`}>
          {r.done.text}
        </td>
        <td data-testid={`status-missing-${r.id}`}>
          {r.missing.length === 0 ? (
            <span className="muted">—</span>
          ) : (
            <ul className="status-missing">
              {r.missing.map((m, i) => (
                <li key={i} className={m.blocking ? 'is-blocking' : ''}>
                  {m.text}: <strong className="status-who">{m.who}</strong>
                </li>
              ))}
            </ul>
          )}
        </td>
      </tr>
      {open && (
        <tr className="status-detail-row">
          <td colSpan={7}>
            <StatusDetail story={r.id} onOpenStory={onOpenStory} api={api} now={now} />
          </td>
        </tr>
      )}
    </>
  );
}

/** The story progress view of one row: its boxes with their evidence, its scenarios with their tests. */
function StatusDetail({ story, onOpenStory, api, now }: { story: string; onOpenStory: (story: string) => void; api: StatusPageApi; now: number }) {
  const [p, setP] = useState<Load<StoryProgress>>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    void api.progress(story).then((r) => {
      if (live) setP(r.kind === 'ok' ? { kind: 'ready', body: r.body } : { kind: 'error', message: r.message });
    });
    return () => {
      live = false;
    };
  }, [api, story]);
  return (
    <div className="status-detail" data-testid={`status-detail-${story}`}>
      {p.kind === 'loading' && <p className="small muted">rehearse reads the progress of {story}…</p>}
      {p.kind === 'error' && <p className="small warn">The progress of {story} could not be read: {p.message}</p>}
      {p.kind === 'ready' && <StoryProgressBlock progress={p.body} now={now} />}
      <button type="button" className="link" data-testid={`status-open-${story}`} onClick={() => onOpenStory(story)}>
        Open story {story}
      </button>
    </div>
  );
}
