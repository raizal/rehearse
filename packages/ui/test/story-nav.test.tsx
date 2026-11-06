// T23: story navigation. Every crumb on a story page is a link, "Stories" lists the stories,
// a story named on another story's page opens it, and Back (the browser's, or the in-app
// "← Back") returns to the place before. The place lives in the URL hash.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import type { ReviewEpicView } from '../src/contract.js';
import { realEpic, reviewEpic } from './fixture.js';
import { mockServer } from './mock-server.js';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

async function start(view: ReviewEpicView = reviewEpic(), hash?: string) {
  if (hash) window.history.replaceState(null, '', hash);
  const server = mockServer({ epic: () => view });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId('app');
  await screen.findByTestId('epic-slug');
  return { server, user };
}

/** Big picture, then the Stories tab (the story page of S1, the first story to approve). */
async function toStories(view?: ReviewEpicView) {
  const r = await start(view);
  await screen.findByTestId('big-picture');
  await r.user.click(screen.getByTestId('nav-stories'));
  await screen.findByTestId('story-view');
  return r;
}

const crumbs = () => within(screen.getAllByRole('navigation', { name: 'Breadcrumb' })[0]!);
const crumbText = () => (screen.getAllByRole('navigation', { name: 'Breadcrumb' })[0]!.textContent ?? '').replace('← Back', '').trim();
const storyTitle = () => screen.getByTestId('story-view').querySelector('h1')?.textContent ?? '';

describe('story breadcrumbs (T23)', () => {
  it('on the story page Big picture and Stories are links and the story id is the current page', async () => {
    const { user } = await toStories();
    expect(crumbText()).toBe('Big picture/Stories/S1');
    const here = crumbs().getByTestId('crumb-story');
    expect(here).toHaveAttribute('aria-current', 'page');
    expect(here.tagName).toBe('SPAN');
    // Stories: the list, one row per story (id, want, "n scenarios · signed state").
    await user.click(crumbs().getByTestId('crumb-stories'));
    const list = await screen.findByTestId('story-list');
    expect(within(list).getAllByTestId(/^story-list-row-/).map((el) => el.dataset.testid)).toEqual(['story-list-row-S1', 'story-list-row-S2']);
    expect(screen.getByTestId('story-list-row-S1')).toHaveTextContent('2 scenarios · 1 of 2 approvals signed');
    expect(within(list).getByText('Stories', { selector: '[aria-current="page"]' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/stories');
    // A row opens that story.
    await user.click(screen.getByTestId('story-list-row-S2'));
    expect(await screen.findByTestId('story-view')).toHaveTextContent('S2 ·');
    expect(window.location.hash).toBe('#/stories/S2/what');
    // Big picture.
    await user.click(crumbs().getByTestId('crumb-bigpicture'));
    expect(await screen.findByTestId('big-picture')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/bigpicture');
  });

  it('pages 12–15 read Big picture / Stories / S1 / <tab>; the story id opens the WHAT page', async () => {
    const { user } = await toStories();
    await user.click(screen.getByTestId('story-tab-code'));
    expect(crumbText()).toBe('Big picture/Stories/S1/Code');
    expect(crumbs().getByText('Code')).toHaveAttribute('aria-current', 'page');
    expect(window.location.hash).toBe('#/stories/S1/code');
    await user.click(crumbs().getByTestId('crumb-story'));
    expect(screen.getByTestId('story-tab-what')).toHaveAttribute('aria-selected', 'true');
    expect(window.location.hash).toBe('#/stories/S1/what');
    await user.click(screen.getByTestId('story-tab-tests'));
    await user.click(crumbs().getByTestId('crumb-stories'));
    expect(await screen.findByTestId('story-list')).toBeInTheDocument();
    await user.click(screen.getByTestId('nav-back'));
    await waitFor(() => expect(screen.getByTestId('story-tab-tests')).toHaveAttribute('aria-selected', 'true'));
  });

  it('the storyboard crumbs: Stories is the list, the story id is the story page, the scenario is current', async () => {
    const { user } = await toStories();
    await user.click(screen.getByTestId('queue-story-S2'));
    await user.click(await screen.findByTestId('story-scenario-open-S2-out-of-stock'));
    expect(screen.getByTestId('story-card')).toHaveTextContent('S2-out-of-stock');
    expect(window.location.hash).toBe('#/stories/S2/board/S2-out-of-stock');
    expect(crumbText()).toBe('Big picture/Stories/S2/S2-out-of-stock');
    expect(crumbs().getByText('S2-out-of-stock')).toHaveAttribute('aria-current', 'page');
    await user.click(crumbs().getByTestId('crumb-stories'));
    expect(await screen.findByTestId('story-list')).toBeInTheDocument();
    await user.click(screen.getByTestId('nav-back'));
    expect(await screen.findByTestId('story-card')).toHaveTextContent('S2-out-of-stock');
    await user.click(crumbs().getByTestId('crumb-bigpicture'));
    expect(await screen.findByTestId('big-picture')).toBeInTheDocument();
  });
});

describe('back history (T23)', () => {
  it('storyboard → story crumb → Back returns to the storyboard; Back again to the story page', async () => {
    const { user } = await toStories();
    await user.click(screen.getByTestId('story-scenario-open-S1-empty'));
    expect(screen.getByTestId('story-card')).toHaveTextContent('S1-empty');
    await user.click(screen.getByTestId('card-back'));
    expect(storyTitle()).toMatch(/^S1 ·/);
    expect(window.location.hash).toBe('#/stories/S1/what');
    await user.click(screen.getByTestId('nav-back'));
    await waitFor(() => expect(screen.getByTestId('story-card')).toHaveTextContent('S1-empty'));
    expect(window.location.hash).toBe('#/stories/S1/board/S1-empty');
    // Forward goes to the story page again.
    window.history.forward();
    await waitFor(() => expect(screen.queryByTestId('story-card')).not.toBeInTheDocument());
    expect(storyTitle()).toMatch(/^S1 ·/);
  });

  it('S4 → S6 (a shared box in HOW) → Back returns to S4 on the same tab', async () => {
    const { user } = await toStories(realEpic());
    await user.click(screen.getByTestId('queue-story-S4'));
    await user.click(screen.getByTestId('story-tab-how'));
    expect(window.location.hash).toBe('#/stories/S4/how');
    await user.click(screen.getByTestId('story-how-also-review-S6'));
    await waitFor(() => expect(storyTitle()).toMatch(/^S6 ·/));
    expect(screen.getByTestId('story-tab-what')).toHaveAttribute('aria-selected', 'true');
    expect(window.location.hash).toBe('#/stories/S6/what');
    await user.click(screen.getByTestId('nav-back'));
    await waitFor(() => expect(storyTitle()).toMatch(/^S4 ·/));
    expect(screen.getByTestId('story-tab-how')).toHaveAttribute('aria-selected', 'true');
    expect(window.location.hash).toBe('#/stories/S4/how');
  });

  it('a story in the readiness chain opens that story; Back returns to readiness', async () => {
    const { user } = await start();
    await screen.findByTestId('big-picture');
    await user.click(screen.getByTestId('nav-readiness'));
    const link = (await screen.findAllByTestId(/^readiness-story-link-/))[0]!;
    const story = link.dataset.testid!.split('-').at(-1)!;
    await user.click(link);
    await waitFor(() => expect(storyTitle()).toMatch(new RegExp(`^${story} ·`)));
    await user.click(screen.getByTestId('nav-back'));
    expect(await screen.findByTestId('readiness-chain')).toBeInTheDocument();
  });

  it('Back is off on the first place and on after a move', async () => {
    const { user } = await start(reviewEpic(), '#/stories/S1/what');
    await screen.findByTestId('story-view');
    expect(screen.getByTestId('nav-back')).toBeDisabled();
    await user.click(screen.getByTestId('queue-story-S2'));
    expect(screen.getByTestId('nav-back')).toBeEnabled();
    await user.click(screen.getByTestId('nav-back'));
    await waitFor(() => expect(storyTitle()).toMatch(/^S1 ·/));
    expect(screen.getByTestId('nav-back')).toBeDisabled();
  });
});

describe('the place in the URL hash (T23)', () => {
  it('a story tab in the hash opens that story on that tab', async () => {
    await start(reviewEpic(), '#/stories/S2/tests');
    await waitFor(() => expect(screen.getByTestId('story-tab-tests')).toHaveAttribute('aria-selected', 'true'));
    expect(crumbText()).toBe('Big picture/Stories/S2/Tests');
    expect(window.location.hash).toBe('#/stories/S2/tests');
  });

  it('a storyboard in the hash opens that storyboard', async () => {
    await start(reviewEpic(), '#/stories/S2/board/S2-out-of-stock');
    expect(await screen.findByTestId('story-card')).toHaveTextContent('S2-out-of-stock');
  });

  it('the story list, and other tabs, in the hash', async () => {
    await start(reviewEpic(), '#/stories');
    expect(await screen.findByTestId('story-list')).toBeInTheDocument();
    expect(screen.getByTestId('nav-stories')).toHaveAttribute('aria-current', 'page');
  });

  it('readiness in the hash', async () => {
    await start(reviewEpic(), '#/readiness');
    expect(await screen.findByTestId('readiness-chain')).toBeInTheDocument();
  });

  it('no hash opens the big picture and writes its hash without a new history entry', async () => {
    await start();
    await screen.findByTestId('big-picture');
    await waitFor(() => expect(window.location.hash).toBe('#/bigpicture'));
  });
});
