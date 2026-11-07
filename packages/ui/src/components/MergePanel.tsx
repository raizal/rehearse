// Land a thread's work (T48, box merge-panel): what the build or test thread's branch brings that
// the checked-out branch has not ("2 commits in the thread, not in main yet", the commit subjects,
// the files, and for a test thread the scenario rows the commits fill), and "Merge into <branch>"
// behind a confirm with that summary. The server refuses in plain words and changes nothing; the
// panel shows the refusal instead of the button. A conflict lists its files and offers "Ask the
// thread to rebase". Only the owner merges, here: no CLI command does it.

import { useCallback, useEffect, useState } from 'react';
import type { Id } from '@rehearse/core';
import { fetchMergeSummary, postAskRebase, postMerge, type MergeDone, type MergeKind, type MergeSummary, type ThreadOutcome } from '../api.js';
import { isServerRestarted, ServerRestarted } from './ServerRestarted.js';

/** The server calls, replaceable in tests. */
export interface MergeApi {
  summary: (story: Id, kind: MergeKind) => Promise<ThreadOutcome<MergeSummary>>;
  merge: (story: Id, kind: MergeKind) => Promise<ThreadOutcome<MergeDone>>;
  askRebase: (story: Id, kind: MergeKind, files: string[]) => Promise<ThreadOutcome<{ ok: true; threadId: string }>>;
}

export const HTTP_MERGE_API: MergeApi = {
  summary: (story, kind) => fetchMergeSummary(story, kind),
  merge: (story, kind) => postMerge(story, kind),
  askRebase: (story, kind, files) => postAskRebase(story, kind, files),
};

/** Files listed before "and N more". */
const SHOWN_FILES = 12;

type Note = { text: string; warn: boolean; details?: string };

export interface MergePanelProps {
  storyId: Id;
  kind: MergeKind;
  api?: MergeApi;
  /** Read the summary again when this changes (the thread's status, its last message). */
  refreshKey?: string;
  /** After a merge: the new tests of a test thread, to play. */
  onMerged?: (done: MergeDone) => void;
}

export function MergePanel({ storyId, kind, api = HTTP_MERGE_API, refreshKey = '', onMerged }: MergePanelProps) {
  const [summary, setSummary] = useState<MergeSummary | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | undefined>();
  const [conflict, setConflict] = useState<string[] | undefined>();

  const load = useCallback(async () => {
    const r = await api.summary(storyId, kind);
    if (r.kind === 'ok') {
      setSummary(r.body);
      setLoadError(undefined);
    } else {
      setSummary(undefined);
      // No thread of this kind, or a serve without the route: no panel, no error.
      setLoadError(r.status === 409 || r.status === 404 ? undefined : r.message);
    }
  }, [api, storyId, kind]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const merge = async () => {
    setBusy(true);
    setNote(undefined);
    setConflict(undefined);
    const r = await api.merge(storyId, kind);
    setBusy(false);
    setConfirming(false);
    if (r.kind === 'ok') {
      setSummary(r.body.summary);
      setNote({ text: `Merged ${r.body.merged.branch} into ${r.body.merged.into} (${r.body.merged.sha.slice(0, 7)}).`, warn: false });
      onMerged?.(r.body);
      return;
    }
    if (r.conflict) setConflict(r.conflict.files);
    setNote({ text: r.message, warn: true, ...(r.details ? { details: r.details } : {}) });
    void load();
  };

  const askRebase = async () => {
    setBusy(true);
    const r = await api.askRebase(storyId, kind, conflict ?? []);
    setBusy(false);
    if (r.kind === 'ok') {
      setConflict(undefined);
      setNote({ text: `Asked @thread:${r.body.threadId} to rebase. Merge again when it says it is done.`, warn: false });
    } else setNote({ text: r.message, warn: true, ...(r.details ? { details: r.details } : {}) });
  };

  if (!summary) {
    if (!loadError) return null;
    return isServerRestarted(loadError) ? (
      <ServerRestarted className="small warn" testId={`merge-error-${kind}`} />
    ) : (
      <p className="small warn" data-testid={`merge-error-${kind}`}>
        Cannot say what the thread brings: {loadError}
      </p>
    );
  }

  const into = summary.current ?? 'the checkout';
  const files = summary.files;
  // The headline says "nothing new" already: no second line for it.
  const refusal = summary.refusal !== null && summary.refusal !== summary.text ? summary.refusal : undefined;
  const t = `merge-${kind}`;

  return (
    <section className="merge-panel" data-testid={t} aria-label={kind === 'build' ? 'Merge the build thread' : 'Merge the test thread'}>
      <p className="merge-head" data-testid={`${t}-text`}>
        <strong>{summary.text}</strong>
        {summary.branch && <span className="small muted mono"> · {summary.branch}</span>}
      </p>
      {summary.commits.length > 0 && (
        <ul className="merge-commits small" data-testid={`${t}-commits`}>
          {summary.commits.map((c) => (
            <li key={c.sha}>
              <code className="muted">{c.sha.slice(0, 7)}</code> {c.subject}
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <details className="merge-files small" data-testid={`${t}-files`}>
          <summary>
            {files.length} file{files.length === 1 ? '' : 's'}
          </summary>
          <ul>
            {files.slice(0, SHOWN_FILES).map((f) => (
              <li key={f} className="mono">
                {f}
              </li>
            ))}
            {files.length > SHOWN_FILES && <li className="muted">and {files.length - SHOWN_FILES} more</li>}
          </ul>
        </details>
      )}
      {kind === 'tests' && summary.scenarios.length > 0 && (
        <p className="small" data-testid={`${t}-scenarios`}>
          Fills the rows of {summary.scenarios.join(', ')}.
        </p>
      )}
      {refusal && (
        <p className="small warn" role="note" data-testid={`${t}-refusal`}>
          {refusal}
        </p>
      )}
      {summary.refusal === null && !confirming && (
        <button type="button" className="action small primary" data-testid={`${t}-button`} disabled={busy} onClick={() => setConfirming(true)}>
          Merge into {into}
        </button>
      )}
      {summary.refusal === null && confirming && (
        <div className="merge-confirm" role="dialog" aria-label={`Merge into ${into}`} data-testid={`${t}-confirm`}>
          <p className="small">
            Merge {summary.commits.length} commit{summary.commits.length === 1 ? '' : 's'} of <code>{summary.branch}</code> into <code>{into}</code> with <code>git merge --no-ff</code>. The merge changes {files.length} file{files.length === 1 ? '' : 's'}
            {kind === 'tests' && summary.scenarios.length > 0 ? ` and adds the tests of ${summary.scenarios.join(', ')}` : ''}. The commit says “Merge {summary.title}”.
          </p>
          <button type="button" className="action small primary" data-testid={`${t}-yes`} disabled={busy} onClick={() => void merge()}>
            {busy ? 'Merging…' : `Merge into ${into}`}
          </button>{' '}
          <button type="button" className="action small" data-testid={`${t}-cancel`} disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      )}
      {note &&
        (isServerRestarted(note.text) ? (
          <ServerRestarted className="small warn" testId={`${t}-note`} />
        ) : (
          <div className={`small${note.warn ? ' warn' : ''}`} role="status" data-testid={`${t}-note`}>
            <p>{note.text}</p>
            {note.details && (
              <details>
                <summary>details</summary>
                <pre>{note.details}</pre>
              </details>
            )}
          </div>
        ))}
      {conflict && (
        <div className="merge-conflict small" data-testid={`${t}-conflict`}>
          <ul>
            {conflict.map((f) => (
              <li key={f} className="mono">
                {f}
              </li>
            ))}
          </ul>
          <button type="button" className="action small" data-testid={`${t}-ask-rebase`} disabled={busy} onClick={() => void askRebase()}>
            Ask the thread to rebase
          </button>
        </div>
      )}
    </section>
  );
}
