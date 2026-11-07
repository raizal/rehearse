// The story thread panel (T12, design pages 13 and 15), drawn against a fake server API; and once
// through the App, where the mock server has no story-thread route.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadMessage } from '@rehearse/server';
import { App } from '../src/App.js';
import type { StoryThreadView, ThreadOutcome } from '../src/api.js';
import { StoryThread, type StoryThreadApi } from '../src/components/StoryThread.js';
import type { StoryProgress } from '../src/api.js';
import { POLL_COLLAPSED_MS } from '../src/model/storythread.js';
import { mockServer } from './mock-server.js';
import { reviewEpic } from './fixture.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

const NOW = new Date(2026, 10, 5, 15, 0).getTime();
const msg = (seq: number, from: ThreadMessage['from'], text: string): ThreadMessage => ({ seq, from, at: NOW - 60_000, text });

function viewOf(over: Partial<StoryThreadView> = {}): StoryThreadView {
  return {
    brief: { slug: 'shop', storyId: 'S1', want: 'to pay for my cart', soThat: 'I get my goods', role: 'buyer', boxes: [{ path: 'checkout', title: 'Checkout' }, { path: 'checkout/pay', title: 'Pay' }], scenarios: ['S1-buy', 'S1-empty'] },
    threadId: 'thr_story1',
    bb: { ok: true, status: 'idle', statusText: 'idle', title: 'S1 · to pay for my cart' },
    messages: [msg(1, 'you', 'Context: overview\n\nWhy does pay fail?'), msg(4, 'agent', 'Because the card is declined.\nA second line that wraps.')],
    earlier: [],
    build: { status: 'signed', buildable: true, hash: `sha256:${'a'.repeat(64)}` },
    link: { kind: 'question', at: '2026-11-05T14:00:00.000Z' },
    planChanged: null,
    ...over,
  };
}

const ok = <T,>(body: T): ThreadOutcome<T> => ({ kind: 'ok', body });

function fakeApi(first: StoryThreadView) {
  let current = first;
  const posts: { action: string; body: Record<string, string> }[] = [];
  const api: StoryThreadApi = {
    load: vi.fn(async () => ok(current)),
    post: vi.fn(async (action, body) => {
      posts.push({ action, body });
      if (action === 'link') current = { ...current, threadId: body.threadId!, messages: [] };
      if (action === 'start') current = { ...current, threadId: 'thr_newstory1', bb: { ok: true, status: 'active', statusText: 'working', title: null }, messages: [] };
      if (action === 'send') current = { ...current, messages: [...current.messages, msg(9, 'you', `Context: ${body.context}\n\n${body.text}`)] };
      return ok(current);
    }),
  };
  return { api, posts, set: (v: StoryThreadView) => (current = v) };
}

function draw(view: StoryThreadView, context = 'overview · S1-buy') {
  const fake = fakeApi(view);
  render(
    <main className="storyboard">
      <button type="button">elsewhere</button>
      <StoryThread storyId="S1" context={context} api={fake.api} storage={localStorage} now={() => NOW} />
    </main>,
  );
  return fake;
}

describe('T12 story thread panel', () => {
  it('T12 panel 1: header with the status in words, Open in bb, and the » button', async () => {
    const { posts } = draw(viewOf());
    expect(await screen.findByRole('heading', { name: 'Story thread' })).toBeInTheDocument();
    expect(screen.getByTestId('story-thread-status')).toHaveTextContent('idle');
    const hide = screen.getByRole('button', { name: /hide the story thread/i });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Open the story thread in bb' }));
    expect(posts).toEqual([{ action: 'open', body: { story: 'S1' } }]);
  });

  it('T12 panel 2: brief chips, then messages oldest first with who and time; no earlier work section without data', async () => {
    draw(viewOf());
    const brief = await screen.findByTestId('story-thread-brief');
    expect(within(brief).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['S1', 'checkout', 'checkout/pay', '2 scenarios']);
    const items = within(screen.getByTestId('story-thread-messages')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('You');
    expect(items[1]).toHaveTextContent('Agent 14:59Because the card is declined.');
    expect(screen.queryByTestId('story-thread-earlier')).toBeNull();
  });

  it('T12 panel 3: earlier work lists task threads from Flow-Box trailers', async () => {
    draw(viewOf({ earlier: [{ threadId: 'thr_task7', subject: 'Pay with a saved card', sha: 'abc1234', boxes: ['checkout/pay'] }] }));
    const earlier = await screen.findByTestId('story-thread-earlier');
    expect(within(earlier).getByRole('heading', { name: 'Earlier work on this story' })).toBeInTheDocument();
    expect(earlier).toHaveTextContent('Pay with a saved card');
    expect(earlier).toHaveTextContent('thr_task7');
  });

  it('T12 panel 4: Send posts the text with the context; the chip shows the context', async () => {
    const { posts } = draw(viewOf());
    expect(await screen.findByTestId('story-thread-context')).toHaveTextContent('context: overview · S1-buy');
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Message to the story thread'), 'Is S1-buy done?');
    await userEvent.click(send);
    expect(posts).toEqual([{ action: 'send', body: { story: 'S1', text: 'Is S1-buy done?', context: 'overview · S1-buy' } }]);
    await waitFor(() => expect(screen.getByLabelText('Message to the story thread')).toHaveValue(''));
    expect(screen.getByTestId('story-thread-msg-9')).toHaveTextContent('Is S1-buy done?');
  });

  it('T12 panel 5: no thread yet: link a pasted thread id', async () => {
    const { posts } = draw(viewOf({ threadId: null, bb: null, messages: [] }));
    expect(await screen.findByTestId('story-thread-none')).toHaveTextContent('No thread for this story');
    expect(screen.getByTestId('story-thread-status')).toHaveTextContent('no thread');
    const link = screen.getByRole('button', { name: 'Link a thread' });
    await userEvent.type(screen.getByLabelText('Thread id'), 'not an id');
    expect(link).toBeDisabled();
    expect(screen.getByText('A thread id looks like thr_abc123.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Thread id'));
    await userEvent.type(screen.getByLabelText('Thread id'), '@thread:thr_pasted9');
    await userEvent.click(link);
    expect(posts).toEqual([{ action: 'link', body: { story: 'S1', threadId: 'thr_pasted9' } }]);
    await waitFor(() => expect(screen.queryByTestId('story-thread-none')).toBeNull());
  });

  it('T12 panel 5: no thread yet: Start a thread asks the server to spawn one', async () => {
    const { posts } = draw(viewOf({ threadId: null, bb: null, messages: [] }));
    await userEvent.click(await screen.findByRole('button', { name: 'Start a question thread' }));
    expect(posts).toEqual([{ action: 'start', body: { story: 'S1' } }]);
    await waitFor(() => expect(screen.getByTestId('story-thread-status')).toHaveTextContent('working'));
  });

  it('T12 collapse 1: » makes a strip with «, the unread count, and the status in words', async () => {
    draw(viewOf());
    await userEvent.click(await screen.findByRole('button', { name: /hide the story thread/i }));
    const strip = screen.getByTestId('story-thread');
    expect(strip).toHaveClass('is-collapsed');
    expect(screen.getByRole('button', { name: /show the story thread/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('story-thread-strip-status')).toHaveTextContent('Status: idle');
    expect(strip).toHaveTextContent('Story thread');
    expect(screen.queryByTestId('story-thread-unread')).toBeNull();
    expect(localStorage.getItem('rehearse:story-thread-collapsed')).toBe('true');
  });

  it('T12 collapse 2: ] toggles the panel, but not while typing in a field', async () => {
    draw(viewOf());
    await screen.findByTestId('story-thread-messages');
    fireEvent.keyDown(screen.getByRole('button', { name: 'elsewhere' }), { key: ']' });
    expect(screen.getByTestId('story-thread')).toHaveClass('is-collapsed');
    fireEvent.keyDown(document.body, { key: ']' });
    expect(screen.getByTestId('story-thread')).not.toHaveClass('is-collapsed');
    fireEvent.keyDown(screen.getByLabelText('Message to the story thread'), { key: ']' });
    expect(screen.getByTestId('story-thread')).not.toHaveClass('is-collapsed');
  });

  it('T12 collapse 3: the collapsed choice is remembered for every story', async () => {
    localStorage.setItem('rehearse:story-thread-collapsed', 'true');
    draw(viewOf());
    expect(screen.getByTestId('story-thread')).toHaveClass('is-collapsed');
    await userEvent.click(screen.getByRole('button', { name: /show the story thread/i }));
    expect(localStorage.getItem('rehearse:story-thread-collapsed')).toBe('false');
  });

  it('T12 collapse 4: a new agent message while collapsed counts as unread and shows a toast that opens the panel', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.setItem('rehearse:story-thread-collapsed', 'true');
    const fake = draw(viewOf());
    await waitFor(() => expect(fake.api.load).toHaveBeenCalledTimes(1));
    await act(async () => {}); // the first answer sets the read mark
    expect(screen.queryByTestId('story-thread-toast')).toBeNull();
    fake.set(viewOf({ messages: [...viewOf().messages, msg(12, 'agent', 'Pay works now.\nDetails follow.')] }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_COLLAPSED_MS);
    });
    expect(screen.getByTestId('story-thread-unread')).toHaveTextContent('1 unread');
    const toast = screen.getByTestId('story-thread-toast');
    expect(toast).toHaveTextContent('New in the story thread: Pay works now.');
    // The toast sits in its own grid row, not over the content.
    expect(toast.parentElement).toHaveClass('thread-toast-row');
    fireEvent.click(toast);
    expect(screen.getByTestId('story-thread')).not.toHaveClass('is-collapsed');
    expect(screen.queryByTestId('story-thread-toast')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /hide the story thread/i }), { delay: null });
    expect(screen.queryByTestId('story-thread-unread')).toBeNull();
  });

  it('T12 no bb 1: without bb the panel says so in words and shows only the thread id', async () => {
    draw(viewOf({ bb: { ok: false, error: 'bb is not available here (spawn bb ENOENT)' }, messages: [] }));
    const note = await screen.findByTestId('story-thread-no-bb');
    expect(note).toHaveTextContent('bb is not available, so the thread cannot be shown here');
    expect(note).toHaveTextContent('thr_story1');
    expect(screen.getByTestId('story-thread-status')).toHaveTextContent('bb not available');
    expect(screen.queryByTestId('story-thread-messages')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open the story thread in bb' })).toBeDisabled();
    expect(screen.getByLabelText('Message to the story thread')).toBeDisabled();
  });

  it('T12 no bb 2: a server error is in words; the rest of the stories page works', async () => {
    mockServer({ epic: () => reviewEpic() });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('big-picture');
    await user.click(screen.getByTestId('nav-stories'));
    await screen.findByTestId('story-view');
    // The thread rail is on the Code and Tests tabs (design pages 13–15), not on the story page.
    await user.click(screen.getByTestId('story-tab-code'));
    expect(await screen.findByTestId('story-thread-error')).toHaveTextContent('this rehearse serve has no story thread API; update rehearse');
    await user.click(screen.getByTestId('story-tab-what'));
    expect(screen.getByTestId('story-scenarios')).toBeInTheDocument();
  });
});

describe('T46 a thread that cannot start says why in plain words', () => {
  const none = () => viewOf({ threadId: null, bb: null, messages: [], link: null });
  const NO_PROJECT = 'rehearse could not tell which bb project this repo is in. Open rehearse from the bb panel, or start serve with REHEARSE_BB_PROJECT=<id>.';

  it('no bb project: the plain error shows in the story column, with no details toggle', async () => {
    const { api } = draw(none());
    (api.post as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({ kind: 'error', status: 503, message: NO_PROJECT }));
    await userEvent.click(await screen.findByRole('button', { name: 'Start a question thread' }));
    const error = await screen.findByTestId('story-thread-action-error');
    expect(error).toHaveTextContent(NO_PROJECT);
    expect(error).not.toHaveTextContent('--project');
    expect(within(screen.getByTestId('story-thread')).getByRole('alert')).toBe(error);
    expect(screen.queryByTestId('story-thread-action-details')).toBeNull();
  });

  it('another spawn failure: plain words, and bb\'s own message under a "details" toggle', async () => {
    const { api } = draw(none());
    (api.post as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({ kind: 'error', status: 502, message: 'bb could not start the thread.', details: 'HTTP 500: the daemon is down' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Build with an agent' }));
    const error = await screen.findByTestId('story-thread-action-error');
    expect(within(error).getByText('bb could not start the thread.')).toBeInTheDocument();
    const details = screen.getByTestId('story-thread-action-details');
    expect(details).not.toHaveAttribute('open');
    await userEvent.click(within(details).getByText('details'));
    expect(details).toHaveAttribute('open');
    expect(within(details).getByText('HTTP 500: the daemon is down')).toBeVisible();
  });
});

describe('T44 build with an agent, the plan-changed notice, the progress block', () => {
  const none = (over: Partial<StoryThreadView> = {}) => viewOf({ threadId: null, bb: null, messages: [], link: null, ...over });

  it('a signed story offers "Build with an agent", which posts build', async () => {
    const { posts, api, set } = draw(none());
    (api.post as ReturnType<typeof vi.fn>).mockImplementationOnce(async (action: string, body: Record<string, string>) => {
      posts.push({ action, body });
      const v = viewOf({ threadId: 'thr_build1', messages: [], link: { kind: 'build', hash: `sha256:${'b'.repeat(64)}`, at: '2026-11-05T14:02:00.000Z' } });
      set(v);
      return ok(v);
    });
    const build = await screen.findByRole('button', { name: 'Build with an agent' });
    expect(screen.getByTestId('story-thread-none')).toHaveTextContent('new worktree on this branch');
    expect(screen.queryByTestId('story-thread-refusal')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start a question thread' })).toBeInTheDocument();
    await userEvent.click(build);
    expect(posts).toEqual([{ action: 'build', body: { story: 'S1' } }]);
    expect(await screen.findByTestId('story-thread-link-info')).toHaveTextContent('A build thread: it started from the build brief on 2026-11-05 14:02, plan bbbbbbbbbbbb.');
  });

  it('an unsigned or stale story says why, and offers a question thread only', async () => {
    const { posts } = draw(none({ build: { status: 'stale', buildable: false, hash: 'sha256:x', refusal: 'story S1 changed since it was signed off on 2026-11-05' } }));
    expect(await screen.findByTestId('story-thread-refusal')).toHaveTextContent('Not ready to build: story S1 changed since it was signed off on 2026-11-05.');
    expect(screen.queryByRole('button', { name: 'Build with an agent' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Start a question thread' }));
    expect(posts).toEqual([{ action: 'start', body: { story: 'S1' } }]);
  });

  it('the plan changed: the notice lists the changes and "Send the change" posts send-change', async () => {
    const changed = viewOf({ link: { kind: 'build', hash: 'sha256:old' }, planChanged: { changes: ['R1 text changed', 'S1-A1 then changed'] } });
    const { posts, api, set } = draw(changed);
    (api.post as ReturnType<typeof vi.fn>).mockImplementationOnce(async (action: string, body: Record<string, string>) => {
      posts.push({ action, body });
      const v = { ...changed, planChanged: null, link: { kind: 'build' as const, hash: 'sha256:new', changedAt: '2026-11-05T15:00:00.000Z' } };
      set(v);
      return ok(v);
    });
    const notice = await screen.findByTestId('story-thread-plan-changed');
    expect(notice).toHaveTextContent('The plan changed since this thread started.');
    expect(within(notice).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['R1 text changed', 'S1-A1 then changed']);
    await userEvent.click(within(notice).getByRole('button', { name: 'Send the change' }));
    expect(posts).toEqual([{ action: 'send-change', body: { story: 'S1' } }]);
    await waitFor(() => expect(screen.queryByTestId('story-thread-plan-changed')).toBeNull());
  });

  it('the progress block: summary, thread, boxes with coverage, scenarios in words, gate and sign-off', async () => {
    const progress: StoryProgress = {
      slug: 'shop',
      storyId: 'S1',
      thread: { id: 'thr_story1', status: 'idle', statusText: 'idle', updatedAt: NOW - 120_000, branch: 'bb/build-s1', kind: 'build' },
      boxes: [
        { path: 'checkout', title: 'Checkout', built: true, commits: 3, onThreadBranch: 2, branches: ['bb/build-s1', 'main'], coverage: { lines: 10, covered: 8, branches: 0, branchesCovered: 0, percent: 80, tests: 4, stale: false } },
        { path: 'checkout/pay', title: 'Pay', built: false, commits: 0, onThreadBranch: 0, branches: [] },
      ],
      scenarios: [
        { id: 'S1-buy', title: 'Buy', state: 'failing', test: 'shop.spec.ts:3', failedStep: 'pay: card' },
        { id: 'S1-empty', title: 'Empty', state: 'not-run', test: 'shop.spec.ts:9' },
        { id: 'S1-late', title: 'Late', state: 'missing' },
      ],
      draftScenarios: ['S1-later'],
      gate: [{ check: 'traced', message: 'S1-A2 has no scenario' }],
      signOff: { status: 'signed', valid: true },
      planChanged: false,
      counts: { boxes: 2, boxesWithCode: 1, scenarios: 3, scenariosTested: 2, scenariosPassing: 0 },
      summary: '1 of 2 boxes have code · 2 of 3 scenarios tested',
    };
    const fake = fakeApi(viewOf());
    fake.api.progress = vi.fn(async () => ok(progress));
    render(<StoryThread storyId="S1" context="" api={fake.api} storage={localStorage} now={() => NOW} />);
    const block = await screen.findByTestId('story-progress');
    expect(within(block).getByTestId('story-progress-summary')).toHaveTextContent('1 of 2 boxes have code · 2 of 3 scenarios tested');
    expect(within(block).getByTestId('story-progress-thread')).toHaveTextContent('Thread idle, last activity 14:58, branch bb/build-s1');
    expect(within(block).getByTestId('story-progress-box-checkout')).toHaveTextContent('built · 3 commits, 2 on bb/build-s1');
    expect(within(block).getByTestId('story-progress-cov-checkout')).toHaveTextContent('80%');
    expect(within(block).getByTestId('story-progress-box-checkout/pay')).toHaveTextContent('not yet');
    expect(within(block).getByTestId('story-progress-scenario-S1-buy')).toHaveTextContent('failing at pay: card shop.spec.ts:3');
    expect(within(block).getByTestId('story-progress-scenario-S1-empty')).toHaveTextContent('test found, not run yet');
    expect(within(block).getByTestId('story-progress-scenario-S1-late')).toHaveTextContent('no e2e test yet');
    expect(within(block).getByTestId('story-progress-drafts')).toHaveTextContent('Not approved, not counted: S1-later');
    expect(within(block).getByTestId('story-progress-gate')).toHaveTextContent('Gate: 1 finding for this story');
    expect(within(block).getByTestId('story-progress-signoff')).toHaveTextContent('Signed off, the sign-off holds');
    // Above the messages.
    expect(block.compareDocumentPosition(screen.getByTestId('story-thread-messages')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fake.api.progress).toHaveBeenCalledWith('S1');
  });

  it('no progress route (an older serve): no block and no error', async () => {
    const fake = fakeApi(viewOf());
    fake.api.progress = vi.fn(async () => ({ kind: 'error' as const, status: 404, message: 'this rehearse serve has no progress API; update rehearse' }));
    render(<StoryThread storyId="S1" context="" api={fake.api} storage={localStorage} now={() => NOW} />);
    await screen.findByTestId('story-thread-messages');
    expect(screen.queryByTestId('story-progress')).toBeNull();
    expect(screen.queryByTestId('story-thread-error')).toBeNull();
  });
});
