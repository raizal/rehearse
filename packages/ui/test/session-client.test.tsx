// T24: the server makes a new session token at every start. The UI reads the session again after
// a token 403 and sends the request once more; a second token 403 says "reload" in plain words,
// and the Origin 403 is never retried.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { fetchBirdview, postApprove, postSignOff } from '../src/api.js';
import { httpCodeApi } from '../src/code-api.js';
import { StoryTests } from '../src/components/StoryTests.js';
import { createSessionClient, SERVER_RESTARTED, TOKEN_ERROR } from '../src/session-client.js';
import { shortKey } from '../src/model/text.js';
import { FIXTURE_KEY, reviewEpic, seeAll } from './fixture.js';
import { approveOk, mockServer, SESSION } from './mock-server.js';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

interface Sent {
  url: string;
  method: string;
  token: string | undefined;
}

/**
 * A fake `rehearse serve`: `api/session` gives the current token; every other route answers 403
 * with the token error unless the request sends it. `restart()` makes a new token, like a new
 * server start; `restartOnRead` does that after every session read. `origin: true` refuses every token request with the Origin 403.
 */
function fakeServer(opts: { origin?: boolean; restartOnRead?: boolean; reply?: (url: string) => unknown } = {}) {
  let n = 1;
  const sent: Sent[] = [];
  const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const token = (init?.headers as Record<string, string> | undefined)?.['x-rehearse-token'];
      sent.push({ url, method: init?.method ?? 'GET', token });
      if (url === 'api/session') return json(200, { ...SESSION, token: `tok-${opts.restartOnRead ? n++ : n}` });
      if (opts.origin) return json(403, { error: 'Origin does not match Host' });
      if (token !== `tok-${n}`) return json(403, { error: TOKEN_ERROR });
      return json(200, opts.reply?.(url) ?? approveOk(['S1-empty']));
    }),
  );
  return {
    sent,
    sessions: () => sent.filter((s) => s.url === 'api/session').length,
    to: (prefix: string) => sent.filter((s) => s.url.startsWith(prefix)),
    restart: () => n++,
  };
}

describe('T24 session client', () => {
  it('a token change between two requests reads the session once more and sends the request once more', async () => {
    const server = fakeServer({ reply: () => ({ ok: true, commits: [] }) });
    const api = httpCodeApi(createSessionClient());
    expect(await api.index()).toEqual({ ok: true, commits: [] });
    server.restart();
    expect(await api.index()).toEqual({ ok: true, commits: [] });
    expect(server.sessions()).toBe(2);
    expect(server.to('api/code-index').map((s) => s.token)).toEqual(['tok-1', 'tok-1', 'tok-2']);
  });

  it('parallel requests after a restart share one fresh session read', async () => {
    const server = fakeServer({ reply: () => ({ ok: true, commits: [] }) });
    const api = httpCodeApi(createSessionClient());
    await api.index();
    server.restart();
    await Promise.all([api.index(), api.box({ box: 'cart' })]);
    expect(server.sessions()).toBe(2);
  });

  it('two token 403s in a row give the plain message, after one fresh session read', async () => {
    // A server that restarts at every session read: the token read is already old when it is used.
    const server = fakeServer({ restartOnRead: true });
    const client = createSessionClient();
    expect(await httpCodeApi(client).index()).toEqual({ ok: false, reason: SERVER_RESTARTED });
    expect(server.sessions()).toBe(2);
    expect(server.to('api/code-index')).toHaveLength(2);
    await expect(fetchBirdview('S1', createSessionClient())).rejects.toThrow(SERVER_RESTARTED);
    expect(await postApprove(['S1-empty'], createSessionClient())).toEqual({ kind: 'restarted' });
  });

  it('the Origin 403 is not retried and keeps its words', async () => {
    const server = fakeServer({ origin: true });
    expect(await postSignOff(['S1'], createSessionClient())).toEqual({ kind: 'forbidden', message: 'Origin does not match Host' });
    expect(server.sessions()).toBe(1);
    expect(server.to('api/sign-off')).toHaveLength(1);
    expect(await httpCodeApi(createSessionClient()).index()).toEqual({ ok: false, reason: 'Origin does not match Host' });
    expect(server.to('api/code-index')).toHaveLength(1);
  });

  it('approve after a token change succeeds, sent once with the old token and once with the new one', async () => {
    const server = fakeServer();
    const client = createSessionClient();
    await client.session();
    server.restart();
    expect(await postApprove(['S1-empty'], client)).toEqual({ kind: 'ok', body: approveOk(['S1-empty']) });
    const posts = server.to('api/approve');
    expect(posts.map((p) => [p.method, p.token])).toEqual([
      ['POST', 'tok-1'],
      ['POST', 'tok-2'],
    ]);
    expect(server.sessions()).toBe(2);
  });
});

describe('T24 in the app', () => {
  const NEW_KEY = 'SHA256:newServerKeyAfterTheRestart0000000000000';

  it('approve after a restart succeeds, and the signing chip shows the new server session', async () => {
    const view = reviewEpic();
    seeAll(view);
    let current = SESSION;
    const server = mockServer({
      epic: () => view,
      session: () => ({ status: 200, body: current }),
      approve: (body) =>
        server.calls.at(-1)!.headers['x-rehearse-token'] === current.token ? { status: 200, body: approveOk(body.scenarioIds) } : { status: 403, body: { error: TOKEN_ERROR } },
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('nav-stories'));
    await screen.findByTestId('approve-signer-key');
    expect(screen.getByTestId('signing-chip')).toHaveTextContent(shortKey(FIXTURE_KEY));

    // The server restarts: a new token and a new key.
    current = { ...SESSION, token: 'tok-new', signing: { ok: true, keyFingerprint: NEW_KEY } };
    await user.click(screen.getByTestId('story-scenario-select-S1-empty'));
    await user.click(screen.getByTestId('approve-selected'));
    expect(await screen.findByText('Approved S1-empty.')).toBeInTheDocument();
    expect(server.posts('api/approve').map((p) => p.headers['x-rehearse-token'])).toEqual(['tok-123', 'tok-new']);
    expect(server.gets('api/session')).toHaveLength(2);
    await waitFor(() => expect(screen.getByTestId('signing-chip')).toHaveTextContent(shortKey(NEW_KEY)));
  });

  it('when the token is still refused, approve says the server restarted, with a Reload button', async () => {
    const view = reviewEpic();
    seeAll(view);
    mockServer({ epic: () => view, approve: () => ({ status: 403, body: { error: TOKEN_ERROR } }) });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('nav-stories'));
    await screen.findByTestId('approve-signer-key');
    await user.click(screen.getByTestId('story-scenario-select-S1-empty'));
    await user.click(screen.getByTestId('approve-selected'));
    const msg = await screen.findByText(/The rehearse server restarted\. Reload the page\./);
    expect(msg).not.toHaveTextContent('x-rehearse-token');
    expect(screen.getByTestId('server-restarted-reload')).toHaveTextContent('Reload');
  });

  it('the Tests tab says the server restarted, not the header text', async () => {
    mockServer({ epic: () => reviewEpic(), birdview: () => ({ status: 403, body: { error: TOKEN_ERROR } }) });
    render(<StoryTests storyId="S1" scenarios={[]} />);
    const err = await screen.findByTestId('story-tests-error');
    expect(err).toHaveTextContent(SERVER_RESTARTED);
    expect(err).not.toHaveTextContent('x-rehearse-token');
    expect(screen.getByTestId('server-restarted-reload')).toBeInTheDocument();
  });
});
