// The story thread panel (T12, design pages 13 and 15): the right column of the story page.
// One bb thread per story: its status, the brief, the messages (polled), earlier task threads
// from Flow-Box trailers, and a composer that sends with the context line on top. » collapses it
// to a 56 px strip for every story (localStorage); `]` toggles it. Without bb it says so in
// words and shows the thread id only. All talk goes through `rehearse serve` (api.ts), with the
// token of the shared session client (T24).
// T44: a signed story that is not stale starts a build thread from its build brief ("Build with
// an agent"); otherwise the panel says why and offers a question thread. When the plan changes
// after the thread started, a notice lists what changed and sends it. The progress block shows
// what rehearse sees of the work.
// T48: the thread commits on its branch and stops; the merge panel says what the branch brings and
// the owner presses "Merge into <branch>" (MergePanel).

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Id } from '@rehearse/core';
import { fetchStoryProgress, fetchStoryThread, postStoryThread, type StoryProgress, type StoryThreadAction, type StoryThreadView, type ThreadOutcome } from '../api.js';
import {
  browserLocalStorage,
  isToggleKey,
  lastSeq,
  loadCollapsed,
  loadReadMarks,
  newIncoming,
  POLL_COLLAPSED_MS,
  POLL_OPEN_MS,
  saveCollapsed,
  saveReadMarks,
  shownText,
  threadIdOf,
  timeLabel,
  toneOf,
  TOAST_MS,
  unreadCount,
  whoLabel,
  type ReadMarks,
} from '../model/storythread.js';
import { isServerRestarted, ServerRestarted } from './ServerRestarted.js';
import { HTTP_MERGE_API, MergePanel, type MergeApi } from './MergePanel.js';
import { StoryProgressBlock } from './StoryProgress.js';

/** The server calls, replaceable in tests. */
export interface StoryThreadApi {
  load: (story: Id) => Promise<ThreadOutcome<StoryThreadView>>;
  post: (action: StoryThreadAction, body: { story: Id } & Record<string, string>) => Promise<ThreadOutcome<unknown>>;
  /** The progress block (T44); without it the panel shows none. */
  progress?: (story: Id) => Promise<ThreadOutcome<StoryProgress>>;
  /** "Merge into <branch>" of the build thread (T48); without it the panel shows none. */
  merge?: MergeApi;
}

const HTTP: StoryThreadApi = { load: (story) => fetchStoryThread(story), post: (action, body) => postStoryThread(action, body), progress: (story) => fetchStoryProgress(story), merge: HTTP_MERGE_API };

export interface StoryThreadProps {
  storyId: Id;
  /** What the owner is looking at, for the composer's chip (see contextLabel). */
  context: string;
  api?: StoryThreadApi;
  storage?: Storage;
  now?: () => number;
}

type Data = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; view: StoryThreadView };

export function StoryThread({ storyId, context, api = HTTP, storage = browserLocalStorage(), now = Date.now }: StoryThreadProps) {
  const [collapsed, setCollapsedState] = useState(() => loadCollapsed(storage));
  const [data, setData] = useState<Data>({ kind: 'loading' });
  const [marks, setMarks] = useState<ReadMarks>(() => loadReadMarks(storage));
  const [toast, setToast] = useState<{ text: string } | undefined>();
  const [busy, setBusy] = useState<StoryThreadAction | undefined>();
  const [actionError, setActionError] = useState<{ message: string; details?: string } | undefined>();
  const [draft, setDraft] = useState('');
  const [progress, setProgress] = useState<StoryProgress | undefined>();
  const known = useRef<{ thread: string | null; seq: number } | undefined>(undefined);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const panelId = useId();

  const setCollapsed = useCallback(
    (next: boolean | ((old: boolean) => boolean)) =>
      setCollapsedState((old) => {
        const value = typeof next === 'function' ? next(old) : next;
        saveCollapsed(storage, value);
        if (!value) setToast(undefined);
        return value;
      }),
    [storage],
  );

  // `]` toggles the panel, not while typing.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!isToggleKey(e)) return;
      e.preventDefault();
      setCollapsed((c) => !c);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setCollapsed]);

  // A new story starts from scratch.
  useEffect(() => {
    setData({ kind: 'loading' });
    setActionError(undefined);
    setToast(undefined);
    setProgress(undefined);
    known.current = undefined;
  }, [storyId]);

  const accept = useCallback((view: StoryThreadView) => {
    setData({ kind: 'ok', view });
    const seq = lastSeq(view.messages);
    const before = known.current;
    if (before && before.thread === view.threadId) {
      const fresh = newIncoming(view.messages, before.seq);
      if (fresh) setToast({ text: fresh.text });
    }
    const kept = before && before.thread === view.threadId ? before.seq : 0;
    known.current = { thread: view.threadId, seq: Math.max(seq, kept) };
    // A thread seen for the first time starts read: unread counts what arrives from now on.
    const id = view.threadId;
    if (id) setMarks((m) => (m[id] === undefined ? { ...m, [id]: seq } : m));
  }, []);

  const loadProgress = useCallback(async () => {
    if (!api.progress) return;
    const p = await api.progress(storyId);
    // An older serve has no progress route: no block, and no error either.
    if (p.kind === 'ok') setProgress(p.body);
  }, [api, storyId]);

  const refresh = useCallback(async () => {
    const [r] = await Promise.all([api.load(storyId), collapsedRef.current ? undefined : loadProgress()]);
    if (r.kind === 'ok') accept(r.body);
    else setData((old) => (old.kind === 'ok' ? old : { kind: 'error', message: r.message }));
  }, [api, storyId, accept, loadProgress]);

  // Poll: often while open, slower while collapsed (for the unread count and the toast).
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      await refresh();
      if (!stop) timer = setTimeout(() => void tick(), collapsed ? POLL_COLLAPSED_MS : POLL_OPEN_MS);
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [refresh, collapsed]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const view = data.kind === 'ok' ? data.view : undefined;
  const threadId = view?.threadId ?? null;
  const seq = view ? lastSeq(view.messages) : 0;
  // While open, everything shown is read.
  useEffect(() => {
    if (collapsed || !threadId) return;
    setMarks((m) => (m[threadId] === seq ? m : { ...m, [threadId]: seq }));
  }, [collapsed, threadId, seq]);
  useEffect(() => saveReadMarks(storage, marks), [storage, marks]);

  const unread = view && threadId ? unreadCount(view.messages, marks[threadId] ?? seq) : 0;
  const bb = view?.bb;
  const statusText = !view ? (data.kind === 'error' ? 'not available' : 'loading') : !threadId ? 'no thread' : bb?.ok ? bb.statusText : 'bb not available';
  const tone = bb?.ok ? toneOf(bb.statusText) : 'none';

  const act = async (action: StoryThreadAction, body: Record<string, string> = {}): Promise<boolean> => {
    setBusy(action);
    setActionError(undefined);
    const r = await api.post(action, { story: storyId, ...body });
    setBusy(undefined);
    if (r.kind === 'error') {
      setActionError({ message: r.message, ...(r.details ? { details: r.details } : {}) });
      return false;
    }
    if (action !== 'open') accept(r.body as StoryThreadView);
    if (action === 'build' || action === 'send-change') void loadProgress();
    return true;
  };

  if (collapsed) {
    return (
      <>
        <aside className="story-thread is-collapsed" data-testid="story-thread" aria-label="Story thread (hidden)">
          <button type="button" className="thread-toggle" data-testid="story-thread-show" aria-expanded="false" aria-controls={panelId} aria-label="Show the story thread (])" title="Show the story thread (])" onClick={() => setCollapsed(false)}>
            «
          </button>
          {unread > 0 && (
            <span className="thread-unread" data-testid="story-thread-unread">
              {unread}
              <span className="sr-only"> unread</span>
            </span>
          )}
          <span className={`thread-dot tone-${tone}`} aria-hidden="true" />
          <span className="sr-only" data-testid="story-thread-strip-status">
            Status: {statusText}
          </span>
          <span className="thread-strip-label" aria-hidden="true">
            Story thread
          </span>
        </aside>
        <div className="thread-toast-row" role="status" aria-live="polite">
          {toast && (
            <button type="button" className="thread-toast" data-testid="story-thread-toast" onClick={() => setCollapsed(false)}>
              <strong>New in the story thread:</strong> {toast.text.split('\n')[0]!.slice(0, 120)} <span className="muted">Press ] or click to show it.</span>
            </button>
          )}
        </div>
      </>
    );
  }

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    if (draft.trim() === '') return;
    if (await act('send', { text: draft, context })) setDraft('');
  };
  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
  };
  const canTalk = Boolean(threadId && bb?.ok);

  return (
    <aside className="story-thread" id={panelId} data-testid="story-thread" aria-labelledby={`${panelId}-h`}>
      <header className="thread-head">
        <h2 id={`${panelId}-h`}>Story thread</h2>
        <span className={`thread-status tone-${tone}`} data-testid="story-thread-status">
          <span className={`thread-dot tone-${tone}`} aria-hidden="true" />
          {statusText}
        </span>
        <span className="thread-head-actions">
          {threadId && (
            <button type="button" className="action small" data-testid="story-thread-open" disabled={!bb?.ok || busy !== undefined} aria-label="Open the story thread in bb" onClick={() => void act('open')}>
              Open in bb ↗
            </button>
          )}
          <button type="button" className="thread-toggle" data-testid="story-thread-hide" aria-expanded="true" aria-controls={panelId} aria-label="Hide the story thread (])" title="Hide the story thread (])" onClick={() => setCollapsed(true)}>
            »
          </button>
        </span>
      </header>

      {view && <Brief view={view} />}
      {view?.planChanged && <PlanChanged changes={view.planChanged.changes} busy={busy} canSend={Boolean(bb?.ok)} onSend={() => void act('send-change')} />}
      {progress && <StoryProgressBlock progress={progress} now={now()} />}
      {api.merge && threadId && bb?.ok && <MergePanel storyId={storyId} kind="build" api={api.merge} refreshKey={`${threadId}:${bb.statusText}:${seq}`} />}
      {data.kind === 'loading' && <p className="muted small thread-pad">Loading the story thread…</p>}
      {data.kind === 'error' &&
        (isServerRestarted(data.message) ? (
          <ServerRestarted className="warn thread-pad" testId="story-thread-error" />
        ) : (
          <p className="warn thread-pad" data-testid="story-thread-error">
            The story thread is not available: {data.message}
          </p>
        ))}

      {view && !threadId && <NoThread build={view.build} busy={busy} onLink={(id) => void act('link', { threadId: id })} onStart={() => void act('start')} onBuild={() => void act('build')} />}
      {view && threadId && bb && !bb.ok && (
        <p className="warn thread-pad" data-testid="story-thread-no-bb">
          bb is not available, so the thread cannot be shown here: {bb.error}. The thread of this story is <code>{threadId}</code>.
        </p>
      )}
      {view && threadId && bb?.ok && <Messages view={view} now={now()} />}

      {view && view.earlier.length > 0 && (
        <section className="thread-earlier" data-testid="story-thread-earlier" aria-labelledby={`${panelId}-earlier`}>
          <h3 id={`${panelId}-earlier`}>Earlier work on this story</h3>
          <p className="muted small">Task threads found by Flow-Box trailers</p>
          <ul>
            {view.earlier.map((w) => (
              <li key={w.threadId} className="thread-earlier-item">
                <span className="thread-earlier-title">{w.subject}</span>
                <span className="small">
                  <code className="thread-id">{w.threadId}</code> <code className="muted">{w.sha}</code>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {actionError &&
        (isServerRestarted(actionError.message) ? (
          <ServerRestarted className="warn thread-pad" testId="story-thread-action-error" />
        ) : (
          <div className="warn thread-pad thread-error" role="alert" data-testid="story-thread-action-error">
            <p>{actionError.message}</p>
            {actionError.details && (
              <details data-testid="story-thread-action-details">
                <summary>details</summary>
                <pre>{actionError.details}</pre>
              </details>
            )}
          </div>
        ))}

      {view && threadId && (
        <form className="thread-composer" data-testid="story-thread-composer" onSubmit={(e) => void send(e)}>
          {context !== '' && (
            <span className="chip" data-testid="story-thread-context">
              context: {context}
            </span>
          )}
          <div className="thread-compose-row">
            <label className="sr-only" htmlFor={`${panelId}-text`}>
              Message to the story thread
            </label>
            <textarea id={`${panelId}-text`} data-testid="story-thread-text" rows={2} placeholder="Ask about this story…" value={draft} disabled={!canTalk} onChange={(e) => setDraft(e.target.value)} onKeyDown={onComposerKey} />
            <button type="submit" className="action primary" data-testid="story-thread-send" disabled={!canTalk || draft.trim() === '' || busy !== undefined}>
              {busy === 'send' ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      )}
    </aside>
  );
}

function Brief({ view }: { view: StoryThreadView }) {
  const { brief } = view;
  return (
    <div className="thread-brief" data-testid="story-thread-brief">
      <p className="thread-brief-title">
        {brief.storyId} · {brief.want}
      </p>
      {view.link?.kind === 'build' ? (
        <p className="muted small" data-testid="story-thread-link-info">
          A build thread: it started from the build brief{view.link.at ? ` on ${view.link.at.slice(0, 16).replace('T', ' ')}` : ''}
          {view.link.hash ? (
            <>
              , plan <code title={view.link.hash}>{view.link.hash.slice(7, 19)}</code>
            </>
          ) : null}
          .
        </p>
      ) : (
        <p className="muted small">One thread per story. It starts with the story brief:</p>
      )}
      <ul className="chips" aria-label="Story brief">
        <li className="chip">{brief.storyId}</li>
        {brief.boxes.map((b) => (
          <li key={b.path} className="chip chip-box" title={b.title}>
            {b.path}
          </li>
        ))}
        <li className="chip chip-count">
          {brief.scenarios.length} {brief.scenarios.length === 1 ? 'scenario' : 'scenarios'}
        </li>
      </ul>
    </div>
  );
}

function Messages({ view, now }: { view: StoryThreadView; now: number }) {
  const list = useRef<HTMLOListElement>(null);
  const count = view.messages.length;
  // Newest at the bottom: keep the list scrolled to the end as messages arrive.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);
  if (count === 0) return <p className="muted small thread-pad">No messages yet.</p>;
  return (
    <ol className="thread-messages" ref={list} data-testid="story-thread-messages" aria-label="Messages" aria-live="polite" aria-relevant="additions" tabIndex={0}>
      {view.messages.map((m) => (
        <li key={m.seq} className={`thread-msg from-${m.from}`} data-testid={`story-thread-msg-${m.seq}`}>
          <span className="thread-avatar" aria-hidden="true">
            {whoLabel(m)[0]}
          </span>
          <div className="thread-msg-body">
            <div className="thread-msg-head">
              <strong>{whoLabel(m)}</strong> <time dateTime={new Date(m.at).toISOString()}>{timeLabel(m.at, now)}</time>
            </div>
            <div className="thread-msg-text">{shownText(m.text)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function NoThread({ build, busy, onLink, onStart, onBuild }: { build: StoryThreadView['build'] | undefined; busy: StoryThreadAction | undefined; onLink: (id: string) => void; onStart: () => void; onBuild: () => void }) {
  const [text, setText] = useState('');
  const id = threadIdOf(text);
  const inputId = useId();
  const buildable = build?.buildable === true;
  return (
    <div className="thread-none thread-pad" data-testid="story-thread-none">
      <p>
        <strong>No thread for this story</strong>
      </p>
      {buildable ? (
        <>
          <p className="small muted">The story is signed off. bb starts a thread in a new worktree on this branch, with the build brief: the story, its approved scenarios, boxes and how to work.</p>
          <button type="button" className="action primary" data-testid="story-thread-build" disabled={busy !== undefined} onClick={onBuild}>
            {busy === 'build' ? 'Starting…' : 'Build with an agent'}
          </button>
        </>
      ) : (
        build?.refusal && (
          <p className="small warn" data-testid="story-thread-refusal">
            Not ready to build: {build.refusal}. Ask about it in a question thread first.
          </p>
        )
      )}
      <form
        className="thread-link"
        onSubmit={(e) => {
          e.preventDefault();
          if (id) onLink(id);
        }}
      >
        <label htmlFor={inputId} className="small">
          Thread id
        </label>
        <input id={inputId} data-testid="story-thread-link-id" placeholder="thr_…" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={text.trim() !== '' && !id} />
        <button type="submit" className="action" data-testid="story-thread-link" disabled={!id || busy !== undefined}>
          {busy === 'link' ? 'Linking…' : 'Link a thread'}
        </button>
      </form>
      {text.trim() !== '' && !id && <p className="small warn">A thread id looks like thr_abc123.</p>}
      <p className="small muted">Or start a question thread: bb spawns a thread with the short story brief as its first message.</p>
      <button type="button" className={buildable ? 'action' : 'action primary'} data-testid="story-thread-start" disabled={busy !== undefined} onClick={onStart}>
        {busy === 'start' ? 'Starting…' : 'Start a question thread'}
      </button>
    </div>
  );
}

function PlanChanged({ changes, busy, canSend, onSend }: { changes: string[]; busy: StoryThreadAction | undefined; canSend: boolean; onSend: () => void }) {
  const shown = changes.slice(0, 8);
  return (
    <div className="thread-plan-changed thread-pad" role="status" data-testid="story-thread-plan-changed">
      <p>
        <strong>The plan changed since this thread started.</strong>
      </p>
      <ul className="small">
        {shown.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
        {changes.length > shown.length && <li className="muted">and {changes.length - shown.length} more</li>}
      </ul>
      <button type="button" className="action primary" data-testid="story-thread-send-change" disabled={!canSend || busy !== undefined} onClick={onSend}>
        {busy === 'send-change' ? 'Sending…' : 'Send the change'}
      </button>
    </div>
  );
}
