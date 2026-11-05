// The story Tests tab (T13, design page 14): one e2e test per scenario, with status in words,
// and the Birdview player embedded when it plays this EPIC's test project. When it does not
// (off, or another project), the tab says so and lists the commands to set it up. Every call
// goes to `rehearse serve`, which talks to the player on 127.0.0.1.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Id, Scenario } from '@rehearse/core';
import { fetchBirdview, fetchSession, postBirdviewSelect, type BirdviewInfo } from '../api.js';
import { embedUrl, playerNotice, testRows, testSummary, type TestRow } from '../model/tests.js';

/** The calls the tab makes. Tests replace `fetch`, not this. */
export interface TestsApi {
  token: () => Promise<string>;
  birdview: (token: string, storyId: Id) => Promise<BirdviewInfo>;
  select: (token: string, storyId: Id) => Promise<{ ok: true } | { ok: false; error: string }>;
}

const HTTP_TESTS_API: TestsApi = { token: async () => (await fetchSession()).token, birdview: fetchBirdview, select: postBirdviewSelect };

/** How often the tab reads the player again while it is open. */
export const POLL_MS = 5000;

const STATUS_CLASS: Record<TestRow['status'], string> = {
  passed: 'status-approved',
  failed: 'status-stale',
  running: 'status-running',
  'not run': 'status-draft',
  'no test': 'status-draft',
};
const STATUS_MARK: Record<TestRow['status'], string> = { passed: '✓', failed: '✗', running: '▶', 'not run': '○', 'no test': '–' };

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; info: BirdviewInfo };

export interface StoryTestsProps {
  storyId: Id;
  scenarios: Scenario[];
  api?: TestsApi;
}

export function StoryTests({ storyId, scenarios, api = HTTP_TESTS_API }: StoryTestsProps) {
  const [token, setToken] = useState<string | undefined>();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [selectMsg, setSelectMsg] = useState<string | undefined>();

  useEffect(() => {
    let live = true;
    api.token().then(
      (t) => live && setToken(t),
      (e: unknown) => live && setLoad({ kind: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [api]);

  const refresh = useCallback(() => {
    if (!token) return;
    api.birdview(token, storyId).then(
      (info) => setLoad({ kind: 'ready', info }),
      (e: unknown) => setLoad({ kind: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
  }, [api, token, storyId]);
  useEffect(() => {
    setLoad({ kind: 'loading' });
    setSelectMsg(undefined);
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const info = load.kind === 'ready' ? load.info : undefined;
  const rows = useMemo(() => testRows(scenarios, info), [scenarios, info]);
  const notice = info ? playerNotice(info) : undefined;
  const selected = info?.player.kind === 'ours' && info.player.selected === info.playlistId;

  const select = async () => {
    if (!token) return;
    setSelectMsg('Asking the player…');
    const out = await api.select(token, storyId);
    setSelectMsg(out.ok ? `The player shows the ${storyId} playlist.` : `The player did not switch: ${out.error}`);
    refresh();
  };

  return (
    <section className="story-tests" data-testid="story-tests" aria-labelledby="story-tests-h">
      <header className="story-tests-head">
        <h3 id="story-tests-h">E2E tests</h3>
        <span className="badge status-running">Birdview player</span>
        <span className="small muted" data-testid="story-tests-playlist">
          playlist {storyId}
          {info?.playlistsDir ? ` · ${info.playlistsDir}/${info.playlistId}.json` : ''}
          {info && !info.playlist ? ' (not written yet: run rehearse playlists)' : ''}
        </span>
        <span className="story-tests-actions">
          <button type="button" className="action small" data-testid="story-tests-refresh" onClick={refresh} disabled={!token}>
            Refresh
          </button>
          {notice?.embed && info && (
            <>
              <button type="button" className="action small primary" data-testid="story-tests-select" onClick={() => void select()} disabled={!info.playlist || selected} aria-label={`Show the ${storyId} playlist in the Birdview player`}>
                {selected ? `Playing ${storyId} playlist` : `Show ${storyId} playlist`}
              </button>
              <a className="action small" href={info.playerUrl} target="_blank" rel="noopener noreferrer" data-testid="story-tests-big-screen" aria-label="Open the Birdview player on a big screen, in a new tab">
                ↗ Big screen
              </a>
            </>
          )}
        </span>
      </header>
      {selectMsg && (
        <p className="small" role="status" data-testid="story-tests-select-msg">
          {selectMsg}
        </p>
      )}
      {load.kind === 'error' && (
        <p className="warn" data-testid="story-tests-error">
          Could not read the tests: {load.message}
        </p>
      )}
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
          {notice && !notice.embed && (
            <div className="story-tests-notice" role="note" data-testid="story-tests-notice">
              <strong>{notice.title}</strong>
              <p className="small">{notice.text}</p>
              {notice.commands.length > 0 && (
                <ol className="small">
                  {notice.commands.map((c) => (
                    <li key={c}>
                      <code>{c}</code>
                    </li>
                  ))}
                  {!info?.playlist && (
                    <li>
                      <code>rehearse playlists</code> writes the story playlists.
                    </li>
                  )}
                  <li>Reopen Birdview, then come back to this tab.</li>
                </ol>
              )}
            </div>
          )}
          {notice?.embed && info && (
            <>
              {notice.title && (
                <div className="story-tests-notice" role="note" data-testid="story-tests-notice">
                  <strong>{notice.title}</strong>
                  <p className="small">{notice.text}</p>
                  {notice.commands.map((c) => (
                    <code key={c}>{c}</code>
                  ))}
                </div>
              )}
              <iframe className="story-tests-frame" data-testid="story-tests-frame" title="Birdview e2e player" src={embedUrl(info)} />
            </>
          )}
        </div>
      </div>
    </section>
  );
}
