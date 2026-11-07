// The story Tests tab (T13, design page 14; T45): the story's playlist, built from the record and
// the spec files, and one "Play in Birdview" button that switches the player to this repo's test
// project, writes the playlist through it and plays it. A ▶ per test plays that test only. One
// line says which project and playlist Birdview shows; when it plays another project, the tab
// says Play will switch it, and "Switch back" returns it to its default project. Busy and not
// running are said in plain words; nothing is queued or retried. Every call goes to
// `rehearse serve`, which talks to the player on 127.0.0.1. The player is embedded while it plays
// this repo; the tab reads it again every few seconds, every second while a test runs.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Id, Scenario } from '@rehearse/core';
import { fetchBirdview, postBirdview, type BirdviewAction, type BirdviewInfo, type BirdviewOutcome } from '../api.js';
import { isServerRestarted, ServerRestarted } from './ServerRestarted.js';
import { birdviewStatus, embedUrl, testRows, testSummary, type TestRow } from '../model/tests.js';

/** The calls the tab makes; they take the token from the shared session client. Tests replace `fetch`, not this. */
export interface TestsApi {
  birdview: (storyId: Id) => Promise<BirdviewInfo>;
  call: (action: BirdviewAction, body: Record<string, string>) => Promise<BirdviewOutcome>;
}

const HTTP_TESTS_API: TestsApi = { birdview: (id) => fetchBirdview(id), call: (action, body) => postBirdview(action, body) };

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
  api?: TestsApi;
}

export function StoryTests({ storyId, scenarios, api = HTTP_TESTS_API }: StoryTestsProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [msg, setMsg] = useState<Msg | undefined>();
  const [pending, setPending] = useState(false);

  const refresh = useCallback(() => {
    api.birdview(storyId).then(
      (info) => setLoad({ kind: 'ready', info }),
      (e: unknown) => setLoad({ kind: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
  }, [api, storyId]);

  const info = load.kind === 'ready' ? load.info : undefined;
  const rows = useMemo(() => testRows(scenarios, info), [scenarios, info]);
  const status = info ? birdviewStatus(info) : undefined;
  const live = rows.some((r) => r.status === 'running');

  useEffect(() => {
    setLoad({ kind: 'loading' });
    setMsg(undefined);
    refresh();
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(refresh, live ? LIVE_POLL_MS : POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, live]);

  const send = async (action: BirdviewAction, body: Record<string, string>, asking: string, done: string) => {
    setPending(true);
    setMsg({ text: asking, warn: false });
    const out = await api.call(action, body);
    setMsg(out.ok ? { text: done, warn: false } : { text: out.error, warn: true });
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
            onClick={() => void send('play-story', { story: storyId }, 'Asking Birdview…', `Birdview plays the ${playlist?.name ?? storyId} playlist.`)}
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
                <SwitchBack label={status.switchBack.label} disabled={pending} onClick={() => void send('use-project', { to: 'default' }, 'Asking Birdview…', 'Birdview is back on its default project.')} />
              </>
            )}
          </p>
          {status.other && (
            <p className="small warn" role="note" data-testid="story-tests-other">
              {status.other}
              {status.switchBack && (
                <>
                  {' '}
                  <SwitchBack label="Switch back" disabled={pending} onClick={() => void send('use-project', { to: 'default' }, 'Asking Birdview…', 'Birdview is back on its default project.')} />
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
            {load.kind === 'loading' ? 'Reading the player…' : testSummary(rows)}
          </p>
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
                      onClick={() => void send('play-test', { story: storyId, test: r.key! }, 'Asking Birdview…', `Birdview plays ${r.key}.`)}
                    >
                      ▶
                    </button>
                  )}
                </div>
                <div>{r.title}</div>
                {r.key && <div className="small muted mono">{r.key}</div>}
                {r.reason && <div className="small warn">{r.reason}</div>}
              </li>
            ))}
          </ul>
          <aside className="story-tests-note" data-testid="story-tests-failure-note">
            <strong>Where a failure goes</strong>
            <p className="small">As Birdview works today, a failure holds every window on the failure screen and goes to the Birdview chat thread, not to the thread of this story.</p>
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

function SwitchBack({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className="link-button" data-testid="story-tests-switch-back" disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}
