// T13 feature 3: the Tests tab of the story view. One row per scenario with status in words,
// the Birdview player embedded only when it plays this EPIC's test project, the setup commands
// when it does not, and the "select this story's playlist" button through the rehearse server.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BirdviewInfo, PlayerView } from '@rehearse/server';
import { App } from '../src/App.js';
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
    playlistId: 'S1',
    playlist: { name: 'S1 · to pay for my cart', tests: [{ file: 'tests/S1.spec.ts', line: 5, name: 'S1-buy', about: 'Buyer pays', steps: { 'cart: Buyer checks out': 'cart' } }] },
    player,
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
  expect(screen.getByTestId('story-tab-overview')).toHaveAttribute('aria-selected', 'true');
  await user.click(screen.getByTestId('story-tab-tests'));
  await screen.findByTestId('story-tests');
  return { server, user };
}

describe('T13 3 the story Tests tab', () => {
  it('T13 3.17 the tab bar: Overview keeps WHAT/HOW/OUTPUT and the scenario cards; Tests hides them', async () => {
    const { user } = await openTests({ birdview: () => ({ status: 200, body: info({ kind: 'off', reason: 'ECONNREFUSED' }) }) });
    expect(screen.getByTestId('story-tab-tests')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('story-what')).toBeNull();
    expect(screen.queryByTestId('story-scenarios')).toBeNull();
    await user.click(screen.getByTestId('story-tab-overview'));
    expect(screen.getByTestId('story-what')).toBeInTheDocument();
    expect(screen.getByTestId('story-scenarios')).toBeInTheDocument();
  });

  it('T13 3.18 the player is off: rows "not run" / "no test", no iframe, the setup steps, and the failure note', async () => {
    const { server } = await openTests({ birdview: () => ({ status: 200, body: info({ kind: 'off', reason: 'ECONNREFUSED' }) }) });
    await waitFor(() => expect(screen.getByTestId('story-test-status-S1-buy')).toHaveTextContent('not run'));
    expect(screen.getByTestId('story-test-status-S1-empty')).toHaveTextContent('no test');
    expect(screen.getByTestId('story-test-S1-buy')).toHaveTextContent(KEY);
    expect(screen.queryByTestId('story-tests-frame')).toBeNull();
    expect(screen.queryByTestId('story-tests-select')).toBeNull();
    const notice = screen.getByTestId('story-tests-notice');
    expect(notice).toHaveTextContent('The Birdview player is not running on port 3298');
    expect(notice).toHaveTextContent('bb plugin config birdview-e2e set projectDir /repo/e2e');
    expect(notice).toHaveTextContent('bb plugin config birdview-e2e set playlistsDir /repo/e2e/birdview/playlists');
    expect(screen.getByTestId('story-tests-failure-note')).toHaveTextContent('goes to the Birdview chat thread, not to the thread of this story');
    // The call carries the session token.
    expect(server.gets('api/birdview?story=S1')[0]!.headers['x-rehearse-token']).toBe(SESSION.token);
  });

  it('T13 3.19 the player plays another project: it says which, and does not embed it', async () => {
    await openTests({ birdview: () => ({ status: 200, body: info({ kind: 'other', projectDir: '/elsewhere/eudr-fe' }) }) });
    const notice = await screen.findByTestId('story-tests-notice');
    expect(notice).toHaveTextContent('The Birdview player plays another project');
    expect(notice).toHaveTextContent('/elsewhere/eudr-fe');
    expect(screen.queryByTestId('story-tests-frame')).toBeNull();
  });

  it('T13 3.20 the player plays this project: status from its results, the embedded player, Big screen, and select', async () => {
    let selected: string | undefined;
    const { user, server } = await openTests({
      birdview: () => ({ status: 200, body: info(ours({ selected, results: { [KEY]: { last: 'failed', failedStep: 'cart: Buyer checks out', reason: 'expected shipped' } } })) }),
      birdviewAction: (body) => {
        selected = body.storyId;
        return { status: 200, body: { ok: true } };
      },
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
    const select = screen.getByRole('button', { name: 'Show the S1 playlist in the Birdview player' });
    select.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('story-tests-select-msg')).toHaveTextContent('The player shows the S1 playlist.'));
    const post = server.posts('api/birdview/action')[0]!;
    expect(post.body).toEqual({ action: 'playlist-select', storyId: 'S1' });
    expect(post.headers['x-rehearse-token']).toBe(SESSION.token);
    await waitFor(() => expect(screen.getByTestId('story-tests-select')).toHaveTextContent('Playing S1 playlist'));
  });

  it('T13 3.21 a refused select says why in words', async () => {
    await openTests({
      birdview: () => ({ status: 200, body: info(ours()) }),
      birdviewAction: () => ({ status: 409, body: { ok: false, error: 'the player plays another project (/x)' } }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('story-tests-select'));
    await waitFor(() => expect(screen.getByTestId('story-tests-select-msg')).toHaveTextContent('The player did not switch: the player plays another project (/x)'));
  });

  it('T13 3.22 a server error is shown in words, and every row still has a status', async () => {
    await openTests({ birdview: () => ({ status: 500, body: { error: 'x' } }) });
    expect(await screen.findByTestId('story-tests-error')).toHaveTextContent('HTTP 500');
    const rows = within(screen.getByTestId('story-tests-rows')).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
  });
});
