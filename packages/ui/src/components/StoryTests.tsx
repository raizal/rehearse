// The story Tests tab (T13, design page 14; T45): the story's playlist, built from the record and
// the spec files, and one "Play in Birdview" button that switches the player to this repo's test
// project, writes the playlist through it and plays it. A ▶ per test plays that test only. One
// line says which project and playlist Birdview shows; when it plays another project, the tab
// says Play will switch it, and "Switch back" returns it to its default project. Busy and not
// running are said in plain words; nothing is queued or retried. Every call goes to
// `rehearse serve`, which talks to the player on 127.0.0.1. The player is embedded while it plays
// this repo; the tab reads it again every few seconds, every second while a test runs.
//
// T47 (box start-test-thread): a `no test` row of an approved scenario has "Write this test with an
// agent", the summary line "Write the K missing tests with an agent" (one thread for all). Both
// start the story's test thread through `rehearse serve`; while it works, they send the scenarios
// to it instead. The rows it has show its status, last activity and `@thread:` link; a draft or
// stale scenario says "approve this scenario first" and has no button.
//
// T48 (box merge-panel): the test thread commits on its branch; the merge panel says which rows its
// commits fill and merges them on the owner's press. After the merge the rows say "not run" and one
// button plays the new tests in Birdview.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Id, Scenario } from '@rehearse/core';
import type { MouseEvent } from 'react';
import { fetchBirdview, fetchTestThread, postBirdview, postTestThread, type BirdviewAction, type BirdviewInfo, type BirdviewOutcome, type TestThreadView, type ThreadOutcome } from '../api.js';
import type { NewTest } from '@rehearse/server';
import { HTTP_MERGE_API, MergePanel, type MergeApi } from './MergePanel.js';
import { isServerRestarted, ServerRestarted } from './ServerRestarted.js';
import { timeLabel, toneOf } from '../model/storythread.js';
import { APPROVE_FIRST, birdviewStatus, embedUrl, testRows, testSummary, toSend, writeMissingLabel, type TestRow } from '../model/tests.js';

/** The calls the tab makes; they take the token from the shared session client. Tests replace `fetch`, not this. */
export interface TestsApi {
  birdview: (storyId: Id) => Promise<BirdviewInfo>;
  call: (action: BirdviewAction, body: Record<string, string | string[]>) => Promise<BirdviewOutcome>;
  /** The story's test thread (T47). */
  testThread?: (storyId: Id) => Promise<ThreadOutcome<TestThreadView>>;
  /** Start the test thread, or send scenarios to it (T47). */
  testCall?: (action: 'thread' | 'send', body: { story: Id; scenarios?: Id[] }) => Promise<ThreadOutcome<TestThreadView>>;
  /** "Merge into <branch>" of the test thread (T48). */
  merge?: MergeApi;
}

const HTTP_TESTS_API: TestsApi = {
  birdview: (id) => fetchBirdview(id),
  call: (action, body) => postBirdview(action, body),
  testThread: (id) => fetchTestThread(id),
  testCall: (action, body) => postTestThread(action, body),
  merge: HTTP_MERGE_API,
};

/** How often the tab reads the player again while it is open. */
export const POLL_MS = 5000;
/** How often while a test of this story runs, for live status. */
export const LIVE_POLL_MS = 1000;

const STATUS_CLASS: Record<TestRow['status'], string> = {
  passed: 'status-approved',
  failed: 'status-stale',
  running: 'status-running',
  'not run': 'status-draft',
  'no test': 'status-draft',
};
const STATUS_MARK: Record<TestRow['status'], string> = { passed: '✓', failed: '✗', running: '▶', 'not run': '○', 'no test': '–' };

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; info: BirdviewInfo };
/** The answer to the last button: plain words, and whether it went wrong. */
type Msg = { text: string; warn: boolean };

export interface StoryTestsProps {
  storyId: Id;
  scenarios: Scenario[];
  /** Each scenario's trust: only approved ones go to an agent (T47). */
  statuses?: Record<Id, 'approved' | 'draft' | 'stale'>;
  api?: TestsApi;
}

export function StoryTests({ storyId, scenarios, statuses, api = HTTP_TESTS_API }: StoryTestsProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [msg, setMsg] = useState<Msg | undefined>();
  const [pending, setPending] = useState(false);
  const [tv, setTv] = useState<TestThreadView | undefined>();
  /** The tests the last merge brought (T48): one button plays them. */
  const [merged, setMerged] = useState<NewTest[]>([]);

  const refreshPlayer = useCallback(() => {
    api.birdview(storyId).then(
      (info) => setLoad({ kind: 'ready', info }),
      (e: unknown) => setLoad({ kind: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
  }, [api, storyId]);
  // The test thread asks bb each time: polled on its own, never at the live rate of a playing test.
  // A server without the test thread API leaves the rows as they were (no agent buttons).
  const refreshThread = useCallback(() => {
    api.testThread?.(storyId).then(
      (out) => setTv(out.kind === 'ok' ? out.body : undefined),
      () => setTv(undefined),
    );
  }, [api, storyId]);
  const refresh = useCallback(() => {
    refreshPlayer();
    refreshThread();
  }, [refreshPlayer, refreshThread]);

  const info = load.kind === 'ready' ? load.info : undefined;
  // The trust of each scenario: from the record the page has, else from the server's test thread view.
  const trust = useMemo(() => statuses ?? (tv ? Object.fromEntries(tv.notApproved.map((n) => [n.id, n.status])) : undefined), [statuses, tv]);
  const rows = useMemo(() => testRows(scenarios, info, { ...(trust ? { statuses: trust } : {}), thread: tv?.thread ?? null }), [scenarios, info, trust, tv]);
  const running = tv?.thread?.running === true;
  const sendable = toSend(rows, tv);
  const missing = (tv?.missing ?? []).filter((id) => rows.some((r) => r.scenarioId === id && r.status === 'no test'));
  const status = info ? birdviewStatus(info) : undefined;
  const live = rows.some((r) => r.status === 'running');

  useEffect(() => {
    setLoad({ kind: 'loading' });
    setMsg(undefined);
    refresh();
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(refreshPlayer, live ? LIVE_POLL_MS : POLL_MS);
    return () => clearInterval(timer);
  }, [refreshPlayer, live]);
  useEffect(() => {
    const timer = setInterval(refreshThread, POLL_MS);
    return () => clearInterval(timer);
  }, [refreshThread]);

  const send = async (action: BirdviewAction, body: Record<string, string | string[]>, asking: string, done: string) => {
    setPending(true);
    setMsg({ text: asking, warn: false });
    const out = await api.call(action, body);
    setMsg(out.ok ? { text: done, warn: false } : { text: out.error, warn: true });
    setPending(false);
    refresh();
  };

  /** Start the story's test thread, or, while it works, send the scenarios to it. */
  const toAgent = async (ids: Id[]) => {
    if (!api.testCall || ids.length === 0) return;
    setPending(true);
    const sending = running;
    setMsg({ text: sending ? 'rehearse sends the scenarios to the test thread…' : 'rehearse starts a test thread…', warn: false });
    const out = await api.testCall(sending ? 'send' : 'thread', { story: storyId, scenarios: ids });
    if (out.kind === 'ok') {
      setTv(out.body);
      const id = out.body.thread?.id;
      setMsg({ text: sending ? `Sent ${ids.join(', ')} to @thread:${id}.` : `A test thread writes ${ids.join(', ')}: @thread:${id}.`, warn: false });
    } else setMsg({ text: out.details ? `${out.message} (${out.details})` : out.message, warn: true });
    setPending(false);
    refresh();
  };

  const playlist = info?.playlist;
  const playerReachable = !!info?.projectDir && info.player.kind !== 'off';
  const playBlocked = !status || status.blocked !== undefined || pending;
  const playlistWords = playlist ? `playlist ${playlist.name} · ${playlist.tests.length} test${playlist.tests.length === 1 ? '' : 's'}` : `playlist ${storyId}`;

  return (
    <section className="story-tests" data-testid="story-tests" aria-labelledby="story-tests-h">
      <header className="story-tests-head">
        <h3 id="story-tests-h">E2E tests</h3>
        <span className="badge status-running">Birdview player</span>
        <span className="small muted" data-testid="story-tests-playlist">
          {playlistWords}
        </span>
        <span className="story-tests-actions">
          <button type="button" className="action small" data-testid="story-tests-refresh" onClick={refresh}>
            Refresh
          </button>
          <button
            type="button"
            className="action small primary"
            data-testid="story-tests-play"
            disabled={playBlocked}
            title={status?.blocked}
            onClick={() => void send('play-story', { story: storyId }, 'rehearse asks Birdview…', `Birdview plays the ${playlist?.name ?? storyId} playlist.`)}
          >
            ▶ Play in Birdview
          </button>
          {status?.embed && info && (
            <a className="action small" href={info.playerUrl} target="_blank" rel="noopener noreferrer" data-testid="story-tests-big-screen" aria-label="Open the Birdview player on a big screen, in a new tab">
              ↗ Big screen
            </a>
          )}
        </span>
      </header>
      {status && (
        <div className="story-tests-birdview">
          <p className="small" data-testid="story-tests-birdview">
            {status.line}
            {status.switchBack && !status.other && (
              <>
                {' · '}
                <SwitchBack label={status.switchBack.label} disabled={pending} onClick={() => void send('use-project', { to: 'default' }, 'rehearse asks Birdview…', 'Birdview is back on its default project.')} />
              </>
            )}
          </p>
          {status.other && (
            <p className="small warn" role="note" data-testid="story-tests-other">
              {status.other}
              {status.switchBack && (
                <>
                  {' '}
                  <SwitchBack label="Switch back" disabled={pending} onClick={() => void send('use-project', { to: 'default' }, 'rehearse asks Birdview…', 'Birdview is back on its default project.')} />
                </>
              )}
            </p>
          )}
          {status.blocked && status.blocked !== status.line && (
            <p className="small muted" data-testid="story-tests-blocked">
              {status.blocked}
            </p>
          )}
        </div>
      )}
      {msg &&
        (isServerRestarted(msg.text) ? (
          <ServerRestarted className="small warn" testId="story-tests-msg" />
        ) : (
          <p className={`small${msg.warn ? ' warn' : ''}`} role="status" data-testid="story-tests-msg">
            {msg.text}
          </p>
        ))}
      {load.kind === 'error' &&
        (isServerRestarted(load.message) ? (
          <ServerRestarted testId="story-tests-error" />
        ) : (
          <p className="warn" data-testid="story-tests-error">
            Could not read the tests: {load.message}
          </p>
        ))}
      <div className="story-tests-body">
        <div className="story-tests-list">
          <h4>One test per scenario</h4>
          <p className="small muted" data-testid="story-tests-summary">
            {load.kind === 'loading' ? 'rehearse reads the player…' : testSummary(rows)}
          </p>
          {api.merge && tv?.thread && (
            <MergePanel
              storyId={storyId}
              kind="tests"
              api={api.merge}
              refreshKey={`${tv.thread.id}:${tv.thread.bb.ok ? tv.thread.bb.statusText : ''}`}
              onMerged={(done) => {
                setMerged(done.tests);
                refresh();
              }}
            />
          )}
          {merged.length > 0 && (
            <p className="story-tests-agent">
              <button
                type="button"
                className="action small primary"
                data-testid="story-tests-play-new"
                disabled={!playerReachable || pending}
                title={merged.map((t) => t.key).join(', ')}
                onClick={() => void send('play-test', { story: storyId, test: merged.map((t) => t.key) }, 'rehearse asks Birdview…', `Birdview plays ${merged.map((t) => t.scenario).join(', ')}.`)}
              >
                ▶ Play the new tests in Birdview
              </button>
            </p>
          )}
          {api.testCall && (running ? sendable.length > 0 : missing.length > 0) && (
            <p className="story-tests-agent">
              <button type="button" className="action small" data-testid="story-tests-write-all" disabled={pending} onClick={() => void toAgent(running ? sendable : missing)}>
                {running ? 'Send these scenarios to the running thread' : writeMissingLabel(missing.length)}
              </button>
            </p>
          )}
          <ul data-testid="story-tests-rows">
            {rows.map((r) => (
              <li key={r.scenarioId} className={`story-test is-${r.status.replace(' ', '-')}`} data-testid={`story-test-${r.scenarioId}`}>
                <div className="story-test-head">
                  <code>{r.scenarioId}</code>
                  <span className={`badge ${STATUS_CLASS[r.status]}`} data-testid={`story-test-status-${r.scenarioId}`}>
                    <span aria-hidden="true">{STATUS_MARK[r.status]} </span>
                    {r.words}
                  </span>
                  {r.key && (
                    <button
                      type="button"
                      className="action small story-test-play"
                      data-testid={`story-test-play-${r.scenarioId}`}
                      disabled={!playerReachable || pending}
                      aria-label={`Play the test of ${r.scenarioId} in Birdview`}
                      title={`Play ${r.key} in Birdview`}
                      onClick={() => void send('play-test', { story: storyId, test: r.key! }, 'rehearse asks Birdview…', `Birdview plays ${r.key}.`)}
                    >
                      ▶
                    </button>
                  )}
                </div>
                <div>{r.title}</div>
                {r.key && <div className="small muted mono">{r.key}</div>}
                {r.reason && <div className="small warn">{r.reason}</div>}
                {r.approveFirst && (
                  <div className="small muted" data-testid={`story-test-approve-first-${r.scenarioId}`}>
                    {APPROVE_FIRST[0]!.toUpperCase() + APPROVE_FIRST.slice(1)}: an agent writes tests for approved scenarios only.
                  </div>
                )}
                {r.withThread && tv?.thread && <ThreadLine thread={tv.thread} scenarioId={r.scenarioId} />}
                {api.testCall && r.status === 'no test' && !r.approveFirst && !r.withThread && tv?.missing.includes(r.scenarioId) && (
                  <button type="button" className="action small story-test-agent" data-testid={`story-test-agent-${r.scenarioId}`} disabled={pending} onClick={() => void toAgent([r.scenarioId])}>
                    {running ? 'Send this scenario to the running thread' : 'Write this test with an agent'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <aside className="story-tests-note" data-testid="story-tests-failure-note">
            <strong>Where a failure goes</strong>
            <p className="small">Today, a failure holds every Birdview window on the failure screen. The failure goes to the Birdview chat thread, not to the thread of this story.</p>
          </aside>
        </div>
        <div className="story-tests-player">
          {status?.embed && info ? (
            <iframe className="story-tests-frame" data-testid="story-tests-frame" title="Birdview e2e player" src={embedUrl(info)} />
          ) : (
            status && (
              <div className="story-tests-notice" role="note" data-testid="story-tests-notice">
                <strong>{info?.player.kind === 'off' ? 'Birdview is not running' : info?.player.kind === 'other' ? 'Birdview plays another project' : 'No player here'}</strong>
                <p className="small">
                  {info?.player.kind === 'other'
                    ? 'The player shows here once it plays this repo: press Play in Birdview.'
                    : info?.player.kind === 'off'
                      ? 'Open Birdview from the bb sidebar, then press Refresh.'
                      : status.line}
                </p>
              </div>
            )
          )}
        </div>
      </div>
    </section>
  );
}

/** The test thread on a row: status words, last activity, and the `@thread:` link (a click copies it). */
function ThreadLine({ thread, scenarioId }: { thread: NonNullable<TestThreadView['thread']>; scenarioId: Id }) {
  const words = thread.bb.ok ? thread.bb.statusText : 'bb cannot be asked';
  const at = thread.bb.ok ? thread.bb.updatedAt : null;
  return (
    <div className={`small story-test-thread tone-${toneOf(thread.bb.ok ? thread.bb.statusText : undefined)}`} data-testid={`story-test-thread-${scenarioId}`}>
      Agent thread {words}
      {typeof at === 'number' && <>, last activity {timeLabel(at, Date.now())}</>}
      {' · '}
      <a className="thread-link" href={`#thread=${thread.id}`} aria-label={`@thread:${thread.id}: copy the reference to paste in bb`} title={`bb thread ${thread.id}; click to copy`} onClick={(e) => copyRef(e, thread.id)}>
        @thread:{thread.id}
      </a>
    </div>
  );
}

function copyRef(e: MouseEvent, id: string) {
  e.preventDefault();
  void navigator.clipboard?.writeText(`@thread:${id}`).catch(() => undefined);
}

function SwitchBack({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className="link-button" data-testid="story-tests-switch-back" disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}
