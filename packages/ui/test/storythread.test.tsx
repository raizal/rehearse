// The story thread panel (T12, design pages 13 and 15), drawn against a fake server API; and once
// through the App, where the mock server has no story-thread route.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadMessage } from '@rehearse/server';
import { App } from '../src/App.js';
import type { StoryThreadView, ThreadOutcome } from '../src/api.js';
import { StoryThread, type StoryThreadApi } from '../src/components/StoryThread.js';
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
    ...over,
  };
}

const ok = <T,>(body: T): ThreadOutcome<T> => ({ kind: 'ok', body });

function fakeApi(first: StoryThreadView) {
  let current = first;
  const posts: { action: string; body: Record<string, string> }[] = [];
  const api: StoryThreadApi = {
    load: vi.fn(async () => ok(current)),
    post: vi.fn(async (_t, action, body) => {
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
      <StoryThread storyId="S1" token="tok-123" context={context} api={fake.api} storage={localStorage} now={() => NOW} />
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
    await userEvent.click(await screen.findByRole('button', { name: 'Start a thread' }));
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
    await screen.findByTestId('story-card');
    expect(await screen.findByTestId('story-thread-error')).toHaveTextContent('this rehearse serve has no story thread API; update rehearse');
    expect(screen.getByTestId('story-scenarios')).toBeInTheDocument();
  });
});
