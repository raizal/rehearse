// T48, box merge-panel: the owner lands a thread's work. The panel says what the thread's branch
// brings ("2 commits in the thread, not in main yet", the subjects, the files, the rows a test
// thread fills), "Merge into main" opens a confirm with that summary, each refusal is said in plain
// words instead of the button, a conflict offers "Ask the thread to rebase", and after a test merge
// the rows say "not run" and one button plays the new tests in Birdview. Against fake servers only.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BirdviewInfo, MergeDone, MergeSummary, PlaylistTest, StoryThreadView, TestThreadView } from '@rehearse/server';
import type { Scenario } from '@rehearse/core';
import type { ThreadOutcome } from '../src/api.js';
import { MergePanel, type MergeApi } from '../src/components/MergePanel.js';
import { StoryTests, type TestsApi } from '../src/components/StoryTests.js';
import { StoryThread } from '../src/components/StoryThread.js';
import { mockServer, SESSION } from './mock-server.js';
import { reviewEpic } from './fixture.js';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

const ok = <T,>(body: T): ThreadOutcome<T> => ({ kind: 'ok', body });
const NOTHING = 'Nothing in the thread that main does not have.';

function summary(over: Partial<MergeSummary> = {}): MergeSummary {
  return {
    ok: true,
    storyId: 'S4',
    kind: 'build',
    threadId: 'thr_build4',
    title: 'Build S4',
    status: 'idle',
    branch: 'bb/build-s4',
    current: 'main',
    commits: [
      { sha: 'a'.repeat(40), subject: 'T49: back to the parent', files: ['packages/ui/test/drill.test.tsx'] },
      { sha: 'b'.repeat(40), subject: 'T49: drill into a box', files: ['packages/ui/src/Drill.tsx'] },
    ],
    files: ['packages/ui/src/Drill.tsx', 'packages/ui/test/drill.test.tsx'],
    scenarios: [],
    dirty: [],
    refusal: null,
    text: '2 commits in the thread, not in main yet',
    ...over,
  };
}

const merged = (s: MergeSummary, tests: MergeDone['tests'] = []): MergeDone => ({
  ok: true,
  merged: { sha: 'c'.repeat(40), message: `Merge ${s.title}`, branch: s.branch!, into: 'main' },
  tests,
  summary: { ...s, commits: [], files: [], scenarios: [], text: NOTHING, refusal: NOTHING },
});

/** A fake merge server: `first` is the summary; merge answers `onMerge`, then nothing is left. */
function fakeMerge(first: MergeSummary, onMerge?: ThreadOutcome<MergeDone>) {
  let current = first;
  const calls: { call: string; args: unknown[] }[] = [];
  const api: MergeApi = {
    summary: async (...args) => {
      calls.push({ call: 'summary', args });
      return ok(current);
    },
    merge: async (...args) => {
      calls.push({ call: 'merge', args });
      const out = onMerge ?? ok(merged(current));
      if (out.kind === 'ok') current = out.body.summary;
      return out;
    },
    askRebase: async (...args) => {
      calls.push({ call: 'askRebase', args });
      return ok({ ok: true as const, threadId: current.threadId });
    },
  };
  return { api, calls, merges: () => calls.filter((c) => c.call === 'merge') };
}

describe('T48 the merge panel (box merge-panel)', () => {
  it('shows "N commits in the thread, not in main yet" with the subjects and files; Merge into main asks first, then merges', async () => {
    const fake = fakeMerge(summary());
    render(<MergePanel storyId="S4" kind="build" api={fake.api} />);
    expect(await screen.findByTestId('merge-build-text')).toHaveTextContent('2 commits in the thread, not in main yet · bb/build-s4');
    const commits = screen.getByTestId('merge-build-commits');
    expect(within(commits).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['aaaaaaa T49: back to the parent', 'bbbbbbb T49: drill into a box']);
    expect(screen.getByTestId('merge-build-files')).toHaveTextContent('2 files');
    expect(screen.getByTestId('merge-build-files')).toHaveTextContent('packages/ui/src/Drill.tsx');
    expect(screen.queryByTestId('merge-build-refusal')).toBeNull();

    // The button opens a confirm with the summary; Cancel merges nothing.
    await userEvent.click(screen.getByRole('button', { name: 'Merge into main' }));
    const confirm = screen.getByTestId('merge-build-confirm');
    expect(confirm).toHaveTextContent('Merge 2 commits of bb/build-s4 into main with git merge --no-ff, touching 2 files. The commit says “Merge Build S4”.');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('merge-build-confirm')).toBeNull();
    expect(fake.merges()).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Merge into main' }));
    await userEvent.click(within(screen.getByTestId('merge-build-confirm')).getByRole('button', { name: 'Merge into main' }));
    expect(fake.merges().map((c) => c.args)).toEqual([['S4', 'build']]);
    expect(await screen.findByTestId('merge-build-note')).toHaveTextContent('Merged bb/build-s4 into main (ccccccc).');
    expect(screen.getByTestId('merge-build-text')).toHaveTextContent(NOTHING);
    expect(screen.queryByRole('button', { name: 'Merge into main' })).toBeNull();
    // The headline says it; no second line repeats it.
    expect(screen.queryByTestId('merge-build-refusal')).toBeNull();
  });

  it('each refusal shows in plain words instead of the button: still working, uncommitted changes, nothing new', async () => {
    const working = 'The thread is still working (bb says working). Merge when bb says it is idle.';
    const dirty = 'The checkout has uncommitted changes in files the merge touches: packages/ui/src/Drill.tsx. Commit or put them aside, then merge.';
    const cases: [Partial<MergeSummary>, string][] = [
      [{ status: 'working', refusal: working }, working],
      [{ dirty: ['packages/ui/src/Drill.tsx'], refusal: dirty }, dirty],
    ];
    for (const [over, words] of cases) {
      const fake = fakeMerge(summary(over));
      const { unmount } = render(<MergePanel storyId="S4" kind="build" api={fake.api} />);
      expect(await screen.findByTestId('merge-build-refusal')).toHaveTextContent(words);
      expect(screen.getByTestId('merge-build-text')).toHaveTextContent('2 commits in the thread, not in main yet');
      expect(screen.queryByRole('button', { name: /Merge into/ })).toBeNull();
      unmount();
    }
    const none = fakeMerge(summary({ commits: [], files: [], text: NOTHING, refusal: NOTHING }));
    render(<MergePanel storyId="S4" kind="build" api={none.api} />);
    expect(await screen.findByTestId('merge-build-text')).toHaveTextContent(NOTHING);
    expect(screen.queryByTestId('merge-build-commits')).toBeNull();
    expect(screen.queryByRole('button', { name: /Merge into/ })).toBeNull();
  });

  it('a refusal at merge time (the checkout changed since) and a conflict: the error, the files, and Ask the thread to rebase', async () => {
    const message = "The thread's branch bb/build-s4 conflicts with main in packages/ui/src/Drill.tsx. Nothing was merged. Ask the thread to rebase onto main.";
    const fake = fakeMerge(summary(), { kind: 'error', status: 409, message, conflict: { files: ['packages/ui/src/Drill.tsx'] } });
    render(<MergePanel storyId="S4" kind="build" api={fake.api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Merge into main' }));
    await userEvent.click(within(screen.getByTestId('merge-build-confirm')).getByRole('button', { name: 'Merge into main' }));
    expect(await screen.findByTestId('merge-build-note')).toHaveTextContent(message);
    expect(screen.getByTestId('merge-build-conflict')).toHaveTextContent('packages/ui/src/Drill.tsx');
    await userEvent.click(screen.getByRole('button', { name: 'Ask the thread to rebase' }));
    expect(fake.calls.filter((c) => c.call === 'askRebase').map((c) => c.args)).toEqual([['S4', 'build', ['packages/ui/src/Drill.tsx']]]);
    expect(await screen.findByText('Asked @thread:thr_build4 to rebase. Merge again when it says it is done.')).toBeInTheDocument();
    expect(screen.queryByTestId('merge-build-conflict')).toBeNull();
  });

  it('no thread of the kind (409) or a serve without the route (404): no panel and no error', async () => {
    const api: MergeApi = { summary: async () => ({ kind: 'error', status: 409, message: 'Story S4 has no thread.' }), merge: vi.fn(), askRebase: vi.fn() };
    const { container } = render(<MergePanel storyId="S4" kind="build" api={api} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('goes to rehearse serve with the session token: GET the summary, POST the merge', async () => {
    let s = summary();
    const server = mockServer({
      epic: () => reviewEpic(),
      threadMerge: (method, path, body) => {
        if (method === 'GET') return { status: 200, body: s };
        expect(path).toBe('merge');
        expect(body).toEqual({ story: 'S4', kind: 'build' });
        const done = merged(s);
        s = done.summary;
        return { status: 200, body: done };
      },
    });
    render(<MergePanel storyId="S4" kind="build" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Merge into main' }));
    await userEvent.click(within(screen.getByTestId('merge-build-confirm')).getByRole('button', { name: 'Merge into main' }));
    expect(await screen.findByTestId('merge-build-note')).toHaveTextContent('Merged bb/build-s4 into main');
    expect(server.gets('api/thread/merge?story=S4&kind=build')[0]!.headers['x-rehearse-token']).toBe(SESSION.token);
    expect(server.posts('api/thread/merge')[0]!.headers['x-rehearse-token']).toBe(SESSION.token);
  });
});

describe('T48 the merge panel in the story column and the Tests tab', () => {
  it('the build thread of the story column has the panel', async () => {
    const view: StoryThreadView = {
      brief: { slug: 'shop', storyId: 'S4', want: 'w', soThat: 's', role: 'r', boxes: [], scenarios: [] },
      threadId: 'thr_build4',
      bb: { ok: true, status: 'idle', statusText: 'idle', title: 'Build S4' },
      messages: [],
      earlier: [],
      build: { status: 'signed', buildable: true, hash: `sha256:${'a'.repeat(64)}` },
      link: { kind: 'build', at: '2026-11-05T14:00:00.000Z' },
      planChanged: null,
    };
    const fake = fakeMerge(summary());
    render(<StoryThread storyId="S4" context="" api={{ load: async () => ok(view), post: vi.fn(), merge: fake.api }} storage={localStorage} />);
    expect(await screen.findByTestId('merge-build-text')).toHaveTextContent('2 commits in the thread, not in main yet');
    expect(fake.calls[0]!.args).toEqual(['S4', 'build']);
  });

  it('after a test merge the rows say not run and one button plays the new tests in Birdview', async () => {
    const sc = (id: string): Scenario => ({ id, story: 'S1', title: `Title of ${id}`, steps: [] }) as unknown as Scenario;
    const test1 = (name: string, line: number): PlaylistTest => ({ file: 'tests/S1.spec.ts', line, name, about: name, steps: {} });
    let tests: PlaylistTest[] = [];
    const info = (): BirdviewInfo =>
      ({ port: 3298, playerUrl: 'http://127.0.0.1:3298/', projectDir: '/repo/e2e', playlistsDir: '/repo/e2e/birdview/playlists', storyId: 'S1', playlist: { name: 'S1 · to pay', tests }, player: { kind: 'ours', results: {}, status: 'idle' } }) as unknown as BirdviewInfo;
    const tv: TestThreadView = {
      storyId: 'S1',
      missing: ['S1-new'],
      notApproved: [],
      thread: { id: 'thr_tests1', scenarios: ['S1-new'], bb: { ok: true, status: 'idle', statusText: 'idle', title: 'Tests: S1 S1-new', branch: 'bb/tests-s1' }, running: false },
    };
    const first = summary({ storyId: 'S1', kind: 'tests', threadId: 'thr_tests1', title: 'Tests: S1 S1-new', branch: 'bb/tests-s1', commits: [{ sha: 'd'.repeat(40), subject: 'tests of S1-new', files: ['e2e/tests/S1.spec.ts'] }], files: ['e2e/tests/S1.spec.ts'], scenarios: ['S1-new'], text: '1 commit in the thread, not in main yet' });
    const merge = fakeMerge(first);
    merge.api.merge = async () => {
      // The merge put the spec in the checkout: the player now lists the test, with no result yet.
      tests = [test1('S1-new', 24)];
      return ok(merged(first, [{ scenario: 'S1-new', key: 'tests/S1.spec.ts:24' }]));
    };
    const calls: { action: string; body: unknown }[] = [];
    const api: TestsApi = {
      birdview: async () => info(),
      call: async (action, body) => {
        calls.push({ action, body });
        return { ok: true, body: {} };
      },
      testThread: async () => ok(tv),
      merge: merge.api,
    };
    render(<StoryTests storyId="S1" scenarios={[sc('S1-new')]} statuses={{ 'S1-new': 'approved' }} api={api} />);
    expect(await screen.findByTestId('merge-tests-scenarios')).toHaveTextContent('Fills the rows of S1-new.');
    expect(screen.getByTestId('story-test-status-S1-new')).toHaveTextContent('no test');
    await userEvent.click(screen.getByRole('button', { name: 'Merge into main' }));
    expect(screen.getByTestId('merge-tests-confirm')).toHaveTextContent('and adding the tests of S1-new');
    await userEvent.click(within(screen.getByTestId('merge-tests-confirm')).getByRole('button', { name: 'Merge into main' }));
    await waitFor(() => expect(screen.getByTestId('story-test-status-S1-new')).toHaveTextContent('not run'));
    await userEvent.click(screen.getByRole('button', { name: '▶ Play the new tests in Birdview' }));
    expect(calls).toEqual([{ action: 'play-test', body: { story: 'S1', test: ['tests/S1.spec.ts:24'] } }]);
    expect(await screen.findByTestId('story-tests-msg')).toHaveTextContent('Birdview plays S1-new.');
  });
});
