// T13 feature 3 and T45: the Tests tab of the story view. One row per scenario with status in
// words, the story playlist shown before anything plays, one "Play in Birdview" button and a ▶
// per test through the rehearse server, the Birdview line, the other-project notice with "Switch
// back", busy and not running in plain words, and the player embedded only when it plays this repo.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BirdviewInfo, PlayerView } from '@rehearse/server';
import { App } from '../src/App.js';
import { StoryTests } from '../src/components/StoryTests.js';
import { reviewEpic } from './fixture.js';
import { mockServer, SESSION, type MockRoutes } from './mock-server.js';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const KEY = 'tests/S1.spec.ts:5';
function info(player: PlayerView): BirdviewInfo {
  return {
    port: 3298,
    playerUrl: 'http://127.0.0.1:3298/',
    projectDir: '/repo/e2e',
    playlistsDir: '/repo/e2e/birdview/playlists',
    storyId: 'S1',
    playlist: { name: 'S1 · to pay for my cart', tests: [{ file: 'tests/S1.spec.ts', line: 5, name: 'S1-buy', about: 'Buyer pays', steps: { 'cart: Buyer checks out': 'cart' } }] },
    player,
    ...(player.kind === 'ours' ? { active: { projectDir: '/repo/e2e', playlist: { id: 's1-to-pay-for-my-cart', name: 'S1 · to pay for my cart' } } } : {}),
    ...(player.kind === 'other' ? { active: { projectDir: player.projectDir } } : {}),
    defaultProject: { projectDir: '/elsewhere/eudr-fe' },
  };
}
const ours = (p: Partial<Extract<PlayerView, { kind: 'ours' }>> = {}): PlayerView => ({ kind: 'ours', status: 'idle', results: {}, playlistsDir: '/repo/e2e/birdview/playlists', ...p });

async function openTests(routes: Partial<MockRoutes>) {
  const server = mockServer({ epic: () => reviewEpic(), ...routes });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId('big-picture');
  await user.click(screen.getByTestId('nav-stories'));
  await screen.findByTestId('story-view');
  expect(screen.getByTestId('story-tab-what')).toHaveAttribute('aria-selected', 'true');
  await user.click(screen.getByTestId('story-tab-tests'));
  await screen.findByTestId('story-tests');
  return { server, user };
}

describe('T13 3 the story Tests tab', () => {
  it('T13 3.17 the tab bar: the story page keeps WHAT/HOW/OUTPUT and the scenario cards; Tests hides them', async () => {
    const { user } = await openTests({ birdview: () => ({ status: 200, body: info({ kind: 'off', reason: 'ECONNREFUSED' }) }) });
    expect(screen.getByTestId('story-tab-tests')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('story-what')).toBeNull();
    expect(screen.queryByTestId('story-scenarios')).toBeNull();
    await user.click(screen.getByTestId('story-tab-what'));
    expect(screen.getByTestId('story-what')).toBeInTheDocument();
    expect(screen.getByTestId('story-scenarios')).toBeInTheDocument();
  });

  it('T13 3.18 the player is off: rows "not run" / "no test", no iframe, not running in words, and the failure note', async () => {
    const { server } = await openTests({ birdview: () => ({ status: 200, body: info({ kind: 'off', reason: 'ECONNREFUSED' }) }) });
    await waitFor(() => expect(screen.getByTestId('story-test-status-S1-buy')).toHaveTextContent('not run'));
    expect(screen.getByTestId('story-test-status-S1-empty')).toHaveTextContent('no test');
    expect(screen.getByTestId('story-test-S1-buy')).toHaveTextContent(KEY);
    expect(screen.queryByTestId('story-tests-frame')).toBeNull();
    expect(screen.getByTestId('story-tests-birdview')).toHaveTextContent('Birdview is not running; open it from the bb sidebar.');
    expect(screen.getByTestId('story-tests-play')).toBeDisabled();
    expect(screen.getByTestId('story-test-play-S1-buy')).toBeDisabled();
    expect(screen.getByTestId('story-tests-notice')).toHaveTextContent('Open Birdview from the bb sidebar');
    expect(screen.getByTestId('story-tests-failure-note')).toHaveTextContent('goes to the Birdview chat thread, not to the thread of this story');
    // The call carries the session token.
    expect(server.gets('api/birdview?story=S1')[0]!.headers['x-rehearse-token']).toBe(SESSION.token);
  });

  it('T13 3.19 the player plays another project: it says which, that Play will switch it, and does not embed it', async () => {
    await openTests({ birdview: () => ({ status: 200, body: info({ kind: 'other', projectDir: '/elsewhere/eudr-fe' }) }) });
    expect(await screen.findByTestId('story-tests-other')).toHaveTextContent('Birdview is on eudr-fe. Play will switch it to this repo.');
    expect(screen.getByTestId('story-tests-play')).toBeEnabled();
    expect(screen.queryByTestId('story-tests-frame')).toBeNull();
  });

  it('T13 3.20 the player plays this project: status from its results, the embedded player and Big screen', async () => {
    await openTests({
      birdview: () => ({ status: 200, body: info(ours({ results: { [KEY]: { last: 'failed', failedStep: 'cart: Buyer checks out', reason: 'expected shipped' } } })) }),
    });
    const frame = await screen.findByTestId('story-tests-frame');
    expect(frame).toHaveAttribute('src', 'http://127.0.0.1:3298/?embed=1&view=active');
    expect(frame).toHaveAttribute('title', 'Birdview e2e player');
    expect(screen.getByTestId('story-test-status-S1-buy')).toHaveTextContent('failed at cart');
    expect(screen.getByTestId('story-test-S1-buy')).toHaveTextContent('expected shipped');
    expect(screen.getByTestId('story-tests-summary')).toHaveTextContent('0 of 1 tests pass, 1 scenario without a test');
    const big = screen.getByRole('link', { name: /Open the Birdview player on a big screen/ });
    expect(big).toHaveAttribute('href', 'http://127.0.0.1:3298/');
    expect(big).toHaveTextContent('↗ Big screen');
    expect(screen.queryByTestId('story-tests-other')).toBeNull();
  });

  it('T13 3.21 a scenario without a test has no ▶; a story without tests cannot be played', async () => {
    await openTests({ birdview: () => ({ status: 200, body: { ...info(ours()), playlist: { name: 'S1 · to pay for my cart', tests: [] } } }) });
    await waitFor(() => expect(screen.getByTestId('story-tests-play')).toBeDisabled());
    expect(screen.getByTestId('story-tests-blocked')).toHaveTextContent('No e2e test of this story yet');
    expect(screen.queryByTestId('story-test-play-S1-empty')).toBeNull();
  });

  it('T13 3.22 a server error is shown in words, and every row still has a status', async () => {
    await openTests({ birdview: () => ({ status: 500, body: { error: 'x' } }) });
    expect(await screen.findByTestId('story-tests-error')).toHaveTextContent('HTTP 500');
    const rows = within(screen.getByTestId('story-tests-rows')).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
  });
});

describe('T45 play a story in Birdview from the Tests tab', () => {
  it('T45 ui 1 the story playlist and the Birdview line show on open, before anything plays', async () => {
    const { server } = await openTests({ birdview: () => ({ status: 200, body: info(ours()) }) });
    await waitFor(() => expect(screen.getByTestId('story-tests-playlist')).toHaveTextContent('playlist S1 · to pay for my cart · 1 test'));
    expect(screen.getByTestId('story-tests-birdview')).toHaveTextContent('Birdview: repo/e2e · playlist S1 · to pay for my cart');
    expect(screen.getByTestId('story-tests-play')).toHaveTextContent('Play in Birdview');
    expect(screen.getByTestId('story-tests-play')).toBeEnabled();
    expect(server.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('T45 ui 2 Play in Birdview: one POST with the token, disabled while it waits, then the answer in words', async () => {
    const { user, server } = await openTests({
      birdview: () => ({ status: 200, body: info(ours()) }),
      birdviewCall: () => ({ status: 200, body: { ok: true } }),
    });
    const play = await screen.findByTestId('story-tests-play');
    await waitFor(() => expect(play).toBeEnabled());
    await user.click(play);
    await waitFor(() => expect(screen.getByTestId('story-tests-msg')).toHaveTextContent('Birdview plays the S1 · to pay for my cart playlist.'));
    const posts = server.calls.filter((c) => c.method === 'POST');
    expect(posts.map((c) => c.url)).toEqual(['api/birdview/play-story']);
    expect(posts[0]!.body).toEqual({ story: 'S1' });
    expect(posts[0]!.headers['x-rehearse-token']).toBe(SESSION.token);
  });

  it('T45 ui 3 the button and ▶ are disabled while a call waits', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockServer({ epic: () => reviewEpic(), birdview: () => ({ status: 200, body: info(ours()) }) });
    const api = {
      birdview: async () => info(ours()),
      call: async () => {
        await gate;
        return { ok: true as const, body: {} };
      },
    };
    const user = userEvent.setup();
    render(<StoryTests storyId="S1" scenarios={reviewEpic().scenarios.map((sv) => sv.scenario).filter((s) => s.story === 'S1')} api={api} />);
    const play = await screen.findByTestId('story-tests-play');
    await waitFor(() => expect(play).toBeEnabled());
    await user.click(play);
    expect(play).toBeDisabled();
    expect(screen.getByTestId('story-test-play-S1-buy')).toBeDisabled();
    expect(screen.getByTestId('story-tests-msg')).toHaveTextContent('Asking Birdview…');
    release();
    await waitFor(() => expect(play).toBeEnabled());
  });

  it('T45 ui 4 ▶ on a row plays that test only', async () => {
    const { user, server } = await openTests({
      birdview: () => ({ status: 200, body: info(ours()) }),
      birdviewCall: () => ({ status: 200, body: { ok: true } }),
    });
    const one = await screen.findByTestId('story-test-play-S1-buy');
    await waitFor(() => expect(one).toBeEnabled());
    await user.click(one);
    await waitFor(() => expect(screen.getByTestId('story-tests-msg')).toHaveTextContent(`Birdview plays ${KEY}.`));
    expect(server.posts('api/birdview/play-test').map((c) => c.body)).toEqual([{ story: 'S1', test: KEY }]);
  });

  it('T45 ui 5 another project: the notice, and Switch back asks for the default project', async () => {
    const { user, server } = await openTests({
      birdview: () => ({ status: 200, body: { ...info({ kind: 'other', projectDir: '/other/shop/e2e' }), defaultProject: { projectDir: '/home/me/eudr-fe' } } }),
      birdviewCall: () => ({ status: 200, body: { ok: true, project: { projectDir: '/home/me/eudr-fe' } } }),
    });
    const other = await screen.findByTestId('story-tests-other');
    expect(other).toHaveTextContent('Birdview is on shop/e2e. Play will switch it to this repo.');
    expect(screen.getByTestId('story-tests-birdview')).toHaveTextContent('Birdview: shop/e2e · playlist none');
    await user.click(within(other).getByTestId('story-tests-switch-back'));
    await waitFor(() => expect(screen.getByTestId('story-tests-msg')).toHaveTextContent('Birdview is back on its default project.'));
    expect(server.posts('api/birdview/use-project').map((c) => c.body)).toEqual([{ to: 'default' }]);
  });

  it('T45 ui 6 on this repo while the default is another: Switch back sits on the Birdview line', async () => {
    await openTests({ birdview: () => ({ status: 200, body: info(ours()) }) });
    const back = await screen.findByTestId('story-tests-switch-back');
    expect(back).toHaveTextContent('Switch back to eudr-fe');
    expect(screen.getByTestId('story-tests-birdview')).toContainElement(back);
  });

  it('T45 ui 7 busy and not running are said in plain words, and nothing is retried', async () => {
    let reply = { status: 409, body: { ok: false, reason: 'busy', error: 'Birdview is busy, try again. (a test is running)' } };
    const { user, server } = await openTests({ birdview: () => ({ status: 200, body: info(ours()) }), birdviewCall: () => reply });
    const play = await screen.findByTestId('story-tests-play');
    await waitFor(() => expect(play).toBeEnabled());
    await user.click(play);
    const msg = await screen.findByTestId('story-tests-msg');
    await waitFor(() => expect(msg).toHaveTextContent('Birdview is busy, try again. (a test is running)'));
    expect(msg).toHaveClass('warn');
    expect(server.posts('api/birdview/play-story')).toHaveLength(1);
    reply = { status: 503, body: { ok: false, reason: 'off', error: 'Birdview is not running; open it from the bb sidebar.' } };
    await waitFor(() => expect(play).toBeEnabled());
    await user.click(play);
    await waitFor(() => expect(screen.getByTestId('story-tests-msg')).toHaveTextContent('Birdview is not running; open it from the bb sidebar.'));
    expect(server.posts('api/birdview/play-story')).toHaveLength(2);
  });
});
