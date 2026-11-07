// T47: a scenario with no e2e test can go to an agent from the Tests tab. "Write this test with an
// agent" on a `no test` row of an approved scenario only, "approve this scenario first" on a draft
// or stale one, "Write the K missing tests with an agent" on the summary (one thread for all), the
// thread on the rows it has, "test written, not run yet", and "Send … to the running thread"
// instead of a second thread.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BirdviewInfo, PlaylistTest, TestThreadView } from '@rehearse/server';
import type { Scenario } from '@rehearse/core';
import { App } from '../src/App.js';
import type { ThreadOutcome } from '../src/api.js';
import { StoryTests, type TestsApi } from '../src/components/StoryTests.js';
import { testRows, toSend, writeMissingLabel } from '../src/model/tests.js';
import { reviewEpic } from './fixture.js';
import { mockServer, SESSION } from './mock-server.js';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const sc = (id: string): Scenario => ({ id, story: 'S1', title: `Title of ${id}`, steps: [] }) as unknown as Scenario;
const SCENARIOS = ['S1-buy', 'S1-empty', 'S1-late', 'S1-draft'].map(sc);
const STATUSES = { 'S1-buy': 'approved', 'S1-empty': 'approved', 'S1-late': 'approved', 'S1-draft': 'draft' } as const;
const test1 = (name: string, line: number): PlaylistTest => ({ file: 'tests/S1.spec.ts', line, name, about: name, steps: {} });

function info(tests: PlaylistTest[]): BirdviewInfo {
  return {
    port: 3298,
    playerUrl: 'http://127.0.0.1:3298/',
    projectDir: '/repo/e2e',
    playlistsDir: '/repo/e2e/birdview/playlists',
    storyId: 'S1',
    playlist: { name: 'S1 · to pay', tests },
    player: { kind: 'off', reason: 'ECONNREFUSED' },
  } as BirdviewInfo;
}

const UPDATED = new Date(2026, 10, 7, 14, 52).getTime();
function threadView(missing: string[], thread?: { scenarios: string[]; status: string }): TestThreadView {
  return {
    storyId: 'S1',
    missing,
    notApproved: [{ id: 'S1-draft', status: 'draft' }],
    thread: thread
      ? {
          id: 'thr_tests1',
          scenarios: thread.scenarios,
          at: '2026-11-07T07:00:00.000Z',
          bb: { ok: true, status: thread.status, statusText: thread.status === 'active' ? 'working' : thread.status, title: 'Tests: S1', updatedAt: UPDATED, branch: null },
          running: thread.status === 'active',
        }
      : null,
  };
}

/** A fake server: the playlist has `tests`; the test thread view changes when a call starts or sends. */
function fakeApi(tests: PlaylistTest[], start: TestThreadView) {
  let view = start;
  const calls: { action: string; body: unknown }[] = [];
  const api: TestsApi = {
    birdview: async () => info(tests),
    call: async () => ({ ok: true, body: {} }),
    testThread: async () => ({ kind: 'ok', body: view }),
    testCall: async (action, body): Promise<ThreadOutcome<TestThreadView>> => {
      calls.push({ action, body });
      const ids = body.scenarios ?? [];
      const had = view.thread?.scenarios ?? [];
      view = threadView(view.missing, { scenarios: action === 'send' ? [...had, ...ids] : ids, status: 'active' });
      return { kind: 'ok', body: view };
    },
  };
  return { api, calls };
}

describe('T47 the Tests tab hands missing tests to an agent', () => {
  it('a no-test row of an approved scenario has "Write this test with an agent"; a draft says approve first, with no button', async () => {
    const { api } = fakeApi([test1('S1-buy', 5)], threadView(['S1-empty', 'S1-late']));
    render(<StoryTests storyId="S1" scenarios={SCENARIOS} statuses={STATUSES} api={api} />);
    expect(await screen.findByTestId('story-test-agent-S1-empty')).toHaveTextContent('Write this test with an agent');
    expect(screen.getByTestId('story-test-agent-S1-late')).toBeInTheDocument();
    // A row with a test has none.
    expect(screen.queryByTestId('story-test-agent-S1-buy')).toBeNull();
    // A draft: the words, no button.
    expect(screen.getByTestId('story-test-approve-first-S1-draft')).toHaveTextContent('Approve this scenario first: an agent writes tests for approved scenarios only.');
    expect(screen.queryByTestId('story-test-agent-S1-draft')).toBeNull();
    expect(screen.getByTestId('story-test-status-S1-draft')).toHaveTextContent('no test');
  });

  it('the summary line has "Write the K missing tests with an agent": one thread for all of them', async () => {
    const { api, calls } = fakeApi([test1('S1-buy', 5)], threadView(['S1-empty', 'S1-late']));
    const user = userEvent.setup();
    render(<StoryTests storyId="S1" scenarios={SCENARIOS} statuses={STATUSES} api={api} />);
    const all = await screen.findByTestId('story-tests-write-all');
    expect(all).toHaveTextContent('Write the 2 missing tests with an agent');
    await user.click(all);
    expect(calls).toEqual([{ action: 'thread', body: { story: 'S1', scenarios: ['S1-empty', 'S1-late'] } }]);
    expect(await screen.findByTestId('story-tests-msg')).toHaveTextContent('A test thread writes S1-empty, S1-late: @thread:thr_tests1.');
  });

  it('once started, the rows show the thread: status words, last activity and the @thread link', async () => {
    const { api, calls } = fakeApi([test1('S1-buy', 5)], threadView(['S1-empty', 'S1-late']));
    const user = userEvent.setup();
    render(<StoryTests storyId="S1" scenarios={SCENARIOS} statuses={STATUSES} api={api} />);
    await user.click(await screen.findByTestId('story-test-agent-S1-empty'));
    expect(calls).toEqual([{ action: 'thread', body: { story: 'S1', scenarios: ['S1-empty'] } }]);
    const line = await screen.findByTestId('story-test-thread-S1-empty');
    expect(line).toHaveTextContent('Agent thread working');
    expect(line).toHaveTextContent('last activity');
    const link = screen.getByRole('link', { name: /@thread:thr_tests1/ });
    expect(link).toHaveAttribute('href', '#thread=thr_tests1');
    expect(link).toHaveTextContent('@thread:thr_tests1');
    expect(screen.queryByTestId('story-test-agent-S1-empty')).toBeNull();
    expect(screen.queryByTestId('story-test-thread-S1-late')).toBeNull();
  });

  it('while it works, a second press sends to the running thread instead of starting another', async () => {
    const { api, calls } = fakeApi([test1('S1-buy', 5)], threadView(['S1-empty', 'S1-late'], { scenarios: ['S1-empty'], status: 'active' }));
    const user = userEvent.setup();
    render(<StoryTests storyId="S1" scenarios={SCENARIOS} statuses={STATUSES} api={api} />);
    const row = await screen.findByTestId('story-test-agent-S1-late');
    expect(row).toHaveTextContent('Send this scenario to the running thread');
    expect(screen.getByTestId('story-tests-write-all')).toHaveTextContent('Send these scenarios to the running thread');
    await user.click(screen.getByTestId('story-tests-write-all'));
    expect(calls).toEqual([{ action: 'send', body: { story: 'S1', scenarios: ['S1-late'] } }]);
    expect(await screen.findByTestId('story-tests-msg')).toHaveTextContent('Sent S1-late to @thread:thr_tests1.');
    await waitFor(() => expect(screen.getByTestId('story-test-thread-S1-late')).toBeInTheDocument());
    // Nothing left to send: no button.
    expect(screen.queryByTestId('story-tests-write-all')).toBeNull();
  });

  it('a finished thread does not block a new one; a refusal is shown in words', async () => {
    const { api } = fakeApi([test1('S1-buy', 5)], threadView(['S1-late'], { scenarios: ['S1-empty'], status: 'idle' }));
    api.testCall = async () => ({ kind: 'error', status: 502, message: 'bb could not start the thread.', details: 'HTTP 500' });
    const user = userEvent.setup();
    render(<StoryTests storyId="S1" scenarios={SCENARIOS} statuses={STATUSES} api={api} />);
    expect(await screen.findByTestId('story-test-thread-S1-empty')).toHaveTextContent('Agent thread idle');
    const all = screen.getByTestId('story-tests-write-all');
    expect(all).toHaveTextContent('Write the missing test with an agent');
    await user.click(all);
    expect(await screen.findByTestId('story-tests-msg')).toHaveTextContent('bb could not start the thread. (HTTP 500)');
  });

  it('a test the thread wrote reads "test written, not run yet", then the normal statuses', () => {
    const thread = threadView([], { scenarios: ['S1-empty'], status: 'active' }).thread;
    const rows = testRows(SCENARIOS, info([test1('S1-buy', 5), test1('S1-empty', 9)]), { statuses: STATUSES, thread });
    expect(rows.find((r) => r.scenarioId === 'S1-empty')).toMatchObject({ status: 'not run', words: 'test written, not run yet', withThread: true });
    expect(rows.find((r) => r.scenarioId === 'S1-buy')).toMatchObject({ words: 'not run' });
    const played = { ...info([test1('S1-empty', 9)]), player: { kind: 'ours', status: 'idle', results: { 'tests/S1.spec.ts:9': { last: 'passed' } }, playlistsDir: '' } } as BirdviewInfo;
    expect(testRows(SCENARIOS, played, { thread }).find((r) => r.scenarioId === 'S1-empty')).toMatchObject({ words: 'passed' });
    expect(toSend(rows, threadView(['S1-late'], { scenarios: ['S1-empty'], status: 'active' }))).toEqual(['S1-late']);
    expect(writeMissingLabel(3)).toBe('Write the 3 missing tests with an agent');
  });

  it('in the app: the calls go to api/story-tests with the session token', async () => {
    let view = threadView(['S1-empty']);
    const server = mockServer({
      epic: () => reviewEpic(),
      birdview: () => ({ status: 200, body: info([test1('S1-buy', 5)]) }),
      testThread: (method, path, body) => {
        if (method === 'POST' && path === 'thread') view = threadView(['S1-empty'], { scenarios: (body as { scenarios: string[] }).scenarios, status: 'active' });
        return { status: 200, body: view };
      },
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('big-picture');
    await user.click(screen.getByTestId('nav-stories'));
    await screen.findByTestId('story-view');
    await user.click(screen.getByTestId('story-tab-tests'));
    // The shop's scenarios are drafts in the page's record: the row says approve first.
    expect(await screen.findByTestId('story-test-approve-first-S1-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('story-test-agent-S1-empty')).toBeNull();
    expect(server.gets('api/story-tests/thread?story=S1')[0]!.headers['x-rehearse-token']).toBe(SESSION.token);
  });
});
