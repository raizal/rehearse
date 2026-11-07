// The storyboard under Stories (S6-A1). One page per scenario (story, criterion, path map, the
// path as a flowchart with the picked step's detail and playback (S5-A1), end state, Approve),
// the review queue grouped by story, and the "seen every step" gate on Approve: a step is seen
// when the panel shows it. Seen state is browser-only and never sent.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import type { ScenarioView } from '../src/api.js';
import { PLAY_MS, StoryCard } from '../src/components/Storyboard.js';
import type { ReviewEpicView } from '../src/contract.js';
import { boxAt } from '../src/model/diagram.js';
import { approveReason } from '../src/model/review.js';
import { realEpic, reviewEpic, seeAll } from './fixture.js';
import { mockServer, type MockRoutes } from './mock-server.js';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

async function start(routes: Partial<MockRoutes> = {}, view: ReviewEpicView = reviewEpic()) {
  const server = mockServer({ epic: () => view, ...routes });
  const user = userEvent.setup();
  render(<App />);
  // The review opens on the big picture (D42); Stories opens on the story page (design page 2),
  // with the scenario cards under the story; each card opens its storyboard (page 3).
  await screen.findByTestId('big-picture');
  await user.click(screen.getByTestId('nav-stories'));
  await screen.findByTestId('story-view');
  await screen.findByTestId('approve-signer-key');
  return { server, user, view };
}

/** Open the storyboard of scenario `id`: its story in the queue, then "Open storyboard" on its card. */
const open = async (user: ReturnType<typeof userEvent.setup>, id: string) => {
  await user.click(screen.getByTestId(`queue-story-${id.split('-')[0]}`));
  await user.click(await screen.findByTestId(`story-scenario-open-${id}`));
  await waitFor(() => expect(screen.getByTestId('story-card')).toHaveTextContent(id));
};

/** Step 1 is shown on open; "Next step" shows the rest. */
async function stepThrough(user: ReturnType<typeof userEvent.setup>) {
  const total = Number(/of (\d+) steps seen/.exec(screen.getByTestId('card-seen').textContent ?? '')![1]);
  for (let i = 1; i < total; i++) await user.click(screen.getByTestId('card-next-step'));
}

/** Approve controls of a StoryCard rendered on its own. */
const approveFor = (view: ReviewEpicView) => ({
  reasonFor: (s: ScenarioView) => approveReason(s, view.approvals),
  approvals: view.approvals,
  selected: new Set<string>(),
  onToggle: () => {},
  onApprove: () => {},
  disabled: false,
});

describe('storyboard under Stories (S6-A1)', () => {
  it('S6-A1: Stories opens on the story page, with progress, one queue row per story and the scenario cards', async () => {
    const { user } = await start();
    expect(screen.getByTestId('nav-stories')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('queue-progress')).toHaveTextContent('1 / 3 approved with a valid signature');
    // One compact row per story: id, want, and the scenario count with the signed state in words.
    const s1 = screen.getByTestId('queue-story-S1');
    expect(s1).toHaveTextContent('S1');
    expect(s1).toHaveTextContent('2 scenarios · 1 of 2 approvals signed');
    expect(screen.getByTestId('queue-story-S2')).toHaveTextContent('1 scenario · approvals not signed');
    // The story of the first scenario with no valid signed approval is open.
    expect(s1).toHaveAttribute('aria-current', 'true');
    // The scenario cards under the story, with the status in words.
    expect(screen.getAllByTestId(/^story-scenario-S\d+-[a-z-]+$/).map((el) => el.dataset.testid)).toEqual(['story-scenario-S1-buy', 'story-scenario-S1-empty']);
    expect(screen.getByTestId('story-scenario-status-S1-buy')).toHaveTextContent('approved, signature valid');
    expect(screen.getByTestId('story-scenario-status-S1-empty')).toHaveTextContent('draft, not approved');
    await user.click(screen.getByTestId('queue-story-S2'));
    expect(await screen.findByTestId('story-scenario-status-S2-out-of-stock')).toHaveTextContent('stale, changed since it was approved');
    // "Open storyboard" opens the storyboard page, with a breadcrumb back to the story.
    await user.click(screen.getByTestId('story-scenario-open-S2-out-of-stock'));
    expect(screen.getByTestId('story-card')).toHaveTextContent('S2-out-of-stock');
    expect(screen.queryByTestId('queue')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('card-back'));
    expect(screen.getByTestId('story-view')).toHaveTextContent('S2 ·');
  });

  it('S6-A1: the card shows story, criterion, the end state, and the picked step in the detail panel', async () => {
    const { user } = await start();
    await open(user, 'S1-buy');
    const story = screen.getByTestId('card-story');
    expect(story).toHaveTextContent('S1');
    expect(within(story).getByTestId('card-role')).toHaveTextContent('Builder');
    expect(story).toHaveTextContent('to pay for my cart');
    const crit = screen.getByTestId('card-criterion');
    expect(crit).toHaveTextContent('S1-A1');
    expect(crit).toHaveTextContent('a cart with items');
    expect(crit).toHaveTextContent('the buyer pays');
    expect(crit).toHaveTextContent('the order is shipped');

    // Step 1 is open in the panel: GIVEN / THEN of its example, the lane, the contract.
    expect(screen.getByTestId('card-detail-lane')).toHaveTextContent('lane: Builder');
    expect(screen.getByTestId('card-detail-example')).toHaveTextContent('GIVEN · cart-ok');
    expect(screen.getByTestId('card-detail-example')).toHaveTextContent('items');
    expect(screen.getByTestId('card-detail-example')).toHaveTextContent('o1');
    await user.click(screen.getByTestId('card-step-2'));
    expect(screen.getByTestId('card-detail-title')).toHaveTextContent('Charge the buyer');
    expect(screen.getByTestId('card-detail-lane')).toHaveTextContent('lane: System');
    expect(screen.getByTestId('card-detail-example')).toHaveTextContent('STATE AFTER');
    expect(screen.getByTestId('card-detail-example')).toHaveTextContent('paid');
    expect(screen.getByTestId('card-detail-contract')).toHaveTextContent('orderId');
    expect(screen.getByTestId('card-detail-contract')).toHaveTextContent('Order.status:draft->paid');
    await user.click(screen.getByTestId('card-step-3'));
    expect(screen.getByTestId('card-detail-branch')).toHaveTextContent('branch taken: yes');
    expect(screen.getByTestId('card-detail-example')).toHaveTextContent('Passes through. No example on this step.');
    // The last step shows where the path ends: the expected end state.
    expect(screen.queryByTestId('card-detail-expect')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('card-step-4'));
    expect(screen.getByTestId('card-detail-expect')).toHaveTextContent('Order.status = shipped');

    const result = screen.getByTestId('card-result');
    expect(result).toHaveTextContent('checked against S1-A1');
    expect(result).toHaveTextContent('shipped');
    expect(screen.getByTestId('card-approval-state')).toHaveTextContent('approved, signature valid');
    expect(screen.queryByTestId('card-approve')).not.toBeInTheDocument();
  });

  it('S6-A1: the path map draws the diagrams of the path, path boxes coloured, the taken branch labelled', async () => {
    const { user } = await start();
    await open(user, 'S1-buy');
    const cart = await screen.findByTestId('card-map-root-box-cart');
    expect(cart).toHaveAttribute('data-on-path', 'true');
    expect(screen.getByTestId('card-map-root-box-notify')).toHaveAttribute('data-on-path', 'false');
    expect(screen.getByTestId('card-map-root-taken-in-stock-ship')).toHaveTextContent('yes');
    expect(await screen.findByTestId('card-map-ship-box-pack')).toHaveAttribute('data-on-path', 'true');
    expect(screen.getByTestId('card-map-ship-box-send')).toHaveAttribute('data-on-path', 'false');
  });
});

describe('the storyboard as a flowchart (S6-A1, T37)', () => {
  it('S6-A1: one node per step in its role lane; a decision is a diamond; the taken branch is a labelled edge', async () => {
    const { user } = await start();
    await open(user, 'S1-buy');
    const chart = screen.getByTestId('card-flow');
    expect(within(chart).getByTestId('card-lane-builder')).toHaveTextContent('Builder');
    expect(within(chart).getByTestId('card-lane-system')).toHaveTextContent('System');
    expect([1, 2, 3, 4].map((n) => screen.getByTestId(`card-node-title-${n}`).textContent)).toEqual(['Check out the cart', 'Charge the buyer', 'Item in stock?', 'Pack']);
    expect(screen.getByTestId('card-step-3')).toHaveClass('is-decision');
    expect(screen.getByTestId('card-step-3').querySelector('.sf-diamond')).not.toBeNull();
    expect(screen.getByTestId('card-step-2')).toHaveClass('is-step');
    expect(screen.getByTestId('card-step-3')).toHaveAccessibleName('Step 3 of 4: Item in stock? (System decision), takes "yes"');
    // The step inside a nested diagram says where it is.
    expect(screen.getByTestId('card-step-4')).toHaveTextContent('in Ship the order');
  });

  it('S6-A1: a branch not taken leads, faded, to the box it would go to; the panel lists it with a box link', () => {
    const onOpenBox = vi.fn();
    const view = reviewEpic();
    const sv = view.scenarios.find((s) => s.scenario.id === 'S1-buy')!;
    render(<StoryCard view={view} sv={sv} seen={{}} onSeen={() => {}} approve={approveFor(view)} onOpenBox={onOpenBox} />);
    const ghosts = screen.getAllByTestId(/^card-ghost-3-/);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]).toHaveClass('sf-ghost');
    expect(ghosts[0]).toHaveAttribute('aria-hidden', 'true');
    const target = ghosts[0]!.dataset.testid!.replace('card-ghost-3-', '');
    fireEvent.click(screen.getByTestId('card-step-3'));
    const others = screen.getByTestId('card-detail-not-taken');
    expect(others).toHaveTextContent('no →');
    fireEvent.click(within(others).getByRole('button'));
    expect(onOpenBox).toHaveBeenLastCalledWith(target);
  });

  it('S6-A1: box links in the panel call onOpenBox with the box path; there is no "Open in flow"', () => {
    const onOpenBox = vi.fn();
    const view = reviewEpic();
    const sv = view.scenarios.find((s) => s.scenario.id === 'S1-buy')!;
    render(<StoryCard view={view} sv={sv} seen={{}} onSeen={() => {}} approve={approveFor(view)} onOpenBox={onOpenBox} />);
    expect(screen.queryByTestId('card-open-flow')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('card-detail-open-box'));
    expect(onOpenBox).toHaveBeenLastCalledWith('cart');
    fireEvent.click(screen.getByTestId('card-step-4'));
    expect(screen.getByTestId('card-detail-path')).toHaveTextContent('ship/pack');
    fireEvent.click(screen.getByTestId('card-detail-open-box'));
    expect(onOpenBox).toHaveBeenLastCalledWith('ship/pack');
    fireEvent.click(within(screen.getByTestId('card-detail-path')).getByRole('button', { name: /\(ship\)$/ }));
    expect(onOpenBox).toHaveBeenLastCalledWith('ship');
  });

  it('S5-A1: Next and Prev step along the path; the picked node is highlighted', async () => {
    const { user } = await start();
    await open(user, 'S1-buy');
    expect(screen.getByTestId('card-step-1')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('card-step-count')).toHaveTextContent('Step 1 of 4');
    expect(screen.getByTestId('card-prev-step')).toBeDisabled();
    await user.click(screen.getByTestId('card-next-step'));
    await user.click(screen.getByTestId('card-next-step'));
    expect(screen.getByTestId('card-step-count')).toHaveTextContent('Step 3 of 4');
    expect(screen.getByTestId('card-step-3')).toHaveClass('is-current');
    expect(screen.getByTestId('card-step-3')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('card-step-1')).not.toHaveAttribute('aria-current');
    // Only the current step is in the tab order.
    expect(screen.getByTestId('card-step-3')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('card-step-1')).toHaveAttribute('tabindex', '-1');
    await user.click(screen.getByTestId('card-prev-step'));
    expect(screen.getByTestId('card-detail-title')).toHaveTextContent('Charge the buyer');
    await user.click(screen.getByTestId('card-next-step'));
    await user.click(screen.getByTestId('card-next-step'));
    expect(screen.getByTestId('card-next-step')).toBeDisabled();
  });

  it('S5-A1: Play moves along the path one step at a time and stops at the end; Pause and picking a step stop it', () => {
    const view = reviewEpic();
    const sv = view.scenarios.find((s) => s.scenario.id === 'S1-buy')!;
    vi.useFakeTimers();
    try {
      render(<StoryCard view={view} sv={sv} seen={{}} onSeen={() => {}} approve={approveFor(view)} />);
      const play = screen.getByTestId('card-play');
      fireEvent.click(play);
      expect(play).toHaveAttribute('aria-pressed', 'true');
      expect(play).toHaveTextContent('Pause');
      act(() => vi.advanceTimersByTime(PLAY_MS));
      expect(screen.getByTestId('card-step-count')).toHaveTextContent('Step 2 of 4');
      act(() => vi.advanceTimersByTime(PLAY_MS));
      act(() => vi.advanceTimersByTime(PLAY_MS));
      expect(screen.getByTestId('card-step-count')).toHaveTextContent('Step 4 of 4');
      expect(play).toHaveAttribute('aria-pressed', 'false');
      // Play at the end starts again from step 1; Pause holds the step.
      fireEvent.click(play);
      expect(screen.getByTestId('card-step-count')).toHaveTextContent('Step 1 of 4');
      act(() => vi.advanceTimersByTime(PLAY_MS));
      fireEvent.click(play);
      act(() => vi.advanceTimersByTime(PLAY_MS * 3));
      expect(screen.getByTestId('card-step-count')).toHaveTextContent('Step 2 of 4');
      fireEvent.click(play);
      fireEvent.click(screen.getByTestId('card-step-4'));
      expect(play).toHaveAttribute('aria-pressed', 'false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('S5-A1: left and right arrows step anywhere on the page, but not in a form field', async () => {
    const { user } = await start();
    await open(user, 'S1-buy');
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(screen.getByTestId('card-step-count')).toHaveTextContent('Step 2 of 4');
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(screen.getByTestId('card-step-count')).toHaveTextContent('Step 1 of 4');
    const input = document.createElement('input');
    document.body.append(input);
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(screen.getByTestId('card-step-count')).toHaveTextContent('Step 1 of 4');
    input.remove();
  });
});

describe('approve only after every step was seen (S6-A1)', () => {
  it('S6-A1: a step counts as seen when the panel shows it; step 1 opens shown; Approve is off until all are seen', async () => {
    const { server, user } = await start();
    await open(user, 'S1-empty');
    const approve = screen.getByTestId('card-approve');
    expect(approve).toBeDisabled();
    expect(approve).toHaveAccessibleName('Approve S1-empty (see every step first)');
    expect(screen.getByTestId('card-seen')).toHaveTextContent('1 of 3 steps seen');
    expect(screen.getByTestId('card-approve-why')).toHaveTextContent('1 of 3 seen');
    expect(screen.getByTestId('card-step-2')).not.toHaveClass('is-seen');

    await user.click(screen.getByTestId('card-next-step'));
    expect(screen.getByTestId('card-seen')).toHaveTextContent('2 of 3 steps seen');
    expect(screen.getByTestId('card-step-2')).toHaveClass('is-seen');
    expect(screen.getByTestId('card-approve')).toBeDisabled();
    await user.click(screen.getByTestId('card-next-step'));
    expect(screen.getByTestId('card-seen')).toHaveTextContent('3 of 3 steps seen');
    expect(screen.queryByTestId('card-approve-why')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-next-unseen')).not.toBeInTheDocument();
    expect(screen.getByTestId('card-approve')).toBeEnabled();
    expect(screen.getByTestId('card-approve')).toHaveAccessibleName('Approve S1-empty (draft)');

    await user.click(screen.getByTestId('card-approve'));
    expect(server.posts('api/approve')[0]!.body).toEqual({ scenarioIds: ['S1-empty'] });
  });

  it('S6-A1: the shown step is marked seen again when the seen state is loaded after the page opened', () => {
    const view = reviewEpic();
    const sv = view.scenarios.find((s) => s.scenario.id === 'S1-empty')!;
    const onSeen = vi.fn();
    const { rerender } = render(<StoryCard view={view} sv={sv} seen={{}} onSeen={onSeen} approve={approveFor(view)} />);
    expect(onSeen).toHaveBeenCalledTimes(1);
    expect(onSeen).toHaveBeenLastCalledWith(sv, 0);
    // The stored seen state of the tab, loaded later, replaces the state the first mark went into.
    rerender(<StoryCard view={view} sv={sv} seen={{ 'S1-buy': { hash: 'h', steps: [0] } }} onSeen={onSeen} approve={approveFor(view)} />);
    expect(onSeen).toHaveBeenCalledTimes(2);
    expect(onSeen).toHaveBeenLastCalledWith(sv, 0);
    // Once the step is in the seen state, a new state does not mark it again.
    rerender(<StoryCard view={view} sv={sv} seen={{ 'S1-empty': { hash: sv.hash, steps: [0] } }} onSeen={onSeen} approve={approveFor(view)} />);
    rerender(<StoryCard view={view} sv={sv} seen={{ 'S1-empty': { hash: sv.hash, steps: [0, 1] } }} onSeen={onSeen} approve={approveFor(view)} />);
    expect(onSeen).toHaveBeenCalledTimes(2);
    expect(onSeen).toHaveBeenLastCalledWith(sv, 0);
  });

  it('S6-A1: picking nodes in any order counts; "not seen yet" jumps to the next step not seen', async () => {
    const { user } = await start();
    await open(user, 'S1-buy');
    await user.click(screen.getByTestId('card-step-3'));
    expect(screen.getByTestId('card-seen')).toHaveTextContent('2 of 4 steps seen');
    expect(screen.getByTestId('card-next-unseen')).toHaveTextContent('Step 4, not seen yet');
    await user.click(screen.getByTestId('card-next-unseen'));
    expect(screen.getByTestId('card-step-4')).toHaveFocus();
    expect(screen.getByTestId('card-next-unseen')).toHaveTextContent('Step 2, not seen yet');
    await user.click(screen.getByTestId('card-next-unseen'));
    expect(screen.getByTestId('card-seen')).toHaveTextContent('4 of 4 steps seen');
  });

  it('S6-A1: arrow keys on a node move along the path and mark each step seen', async () => {
    const { user } = await start();
    await open(user, 'S2-out-of-stock');
    act(() => screen.getByTestId('card-step-1').focus());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('card-step-2')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('card-step-3')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByTestId('card-step-2')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByTestId('card-step-1')).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByTestId('card-step-3')).toHaveFocus();
    expect(screen.getByTestId('card-seen')).toHaveTextContent('3 of 3 steps seen');
    expect(screen.getByTestId('card-approve')).toBeEnabled();
  });

  it('S6-A1: seen state stays in sessionStorage and is never sent to the server', async () => {
    const { server, user } = await start();
    await open(user, 'S1-empty');
    await stepThrough(user);
    expect(sessionStorage.getItem('rehearse:seen')).toContain('S1-empty');
    for (const call of server.calls) {
      expect(call.method).toBe('GET');
      expect(JSON.stringify(call)).not.toContain('seen');
    }
  });

  it('S6-A1: seen state survives a reload of the page in the same tab', async () => {
    const view = reviewEpic();
    seeAll(view, ['S1-empty']);
    const { user } = await start({}, view);
    await open(user, 'S1-empty');
    expect(screen.getByTestId('card-seen')).toHaveTextContent('3 of 3 steps seen');
    expect(screen.getByTestId('card-approve')).toBeEnabled();
  });

  it('S6-A1: steps seen before the scenario changed do not count', async () => {
    const view = reviewEpic();
    seeAll(view, ['S1-empty']);
    view.scenarios.find((s) => s.scenario.id === 'S1-empty')!.hash = `sha256:${'1'.repeat(64)}`;
    const { user } = await start({}, view);
    await open(user, 'S1-empty');
    expect(screen.getByTestId('card-approve')).toBeDisabled();
  });
});

describe('review queue', () => {
  it('"Next" goes to the next scenario with no valid signed approval', async () => {
    const { user } = await start();
    // S1-empty, the first scenario to approve, is the current one; Next is the one after it.
    expect(screen.getByTestId('queue-next')).toHaveTextContent('Next to approve: S2-out-of-stock');
    await user.click(screen.getByTestId('queue-next'));
    expect(screen.getByTestId('story-card')).toHaveTextContent('S2-out-of-stock');
    await user.click(screen.getByTestId('card-back'));
    expect(screen.getByTestId('queue-next')).toHaveTextContent('Next to approve: S1-empty');
    await user.click(screen.getByTestId('queue-next'));
    expect(screen.getByTestId('story-card')).toHaveTextContent('S1-empty');
  });

  it('up and down arrows move through the queue', async () => {
    const { user } = await start();
    act(() => screen.getByTestId('queue-story-S1').focus());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('queue-story-S2')).toHaveFocus();
    expect(screen.getByTestId('queue-story-S2')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('story-view')).toHaveTextContent('S2 ·');
    await user.keyboard('{ArrowUp}');
    expect(screen.getByTestId('queue-story-S1')).toHaveFocus();
    expect(screen.getByTestId('story-view')).toHaveTextContent('S1 ·');
  });

  it('S6-A1: "approve the selected ones" takes only scenarios seen in full', async () => {
    const view = reviewEpic();
    seeAll(view, ['S1-empty']);
    const { server, user } = await start({}, view);
    expect(screen.getByTestId('story-scenario-select-S1-empty')).toBeEnabled();
    expect(screen.getByTestId('story-scenario-seen-S1-empty')).toHaveTextContent('3 of 3 seen');
    expect(screen.getByTestId('story-select-seen-S1')).toHaveTextContent('Select seen (1)');
    await user.click(screen.getByTestId('queue-story-S2'));
    expect(await screen.findByTestId('story-scenario-select-S2-out-of-stock')).toBeDisabled();
    expect(screen.getByTestId('story-select-seen-S2')).toBeDisabled();
    await user.click(screen.getByTestId('queue-story-S1'));
    await user.click(await screen.findByTestId('story-select-seen-S1'));
    expect(screen.getByTestId('approve-selected')).toHaveTextContent('Approve selected (1)');
    await user.click(screen.getByTestId('approve-selected'));
    expect(server.posts('api/approve')[0]!.body).toEqual({ scenarioIds: ['S1-empty'] });
  });
});

describe('the real EPIC', () => {
  const real = realEpic();

  it('S6-A1: renders the flowchart of every real scenario, and every step node shows its box title', () => {
    expect(real.scenarios.length).toBeGreaterThan(0);
    for (const sv of real.scenarios) {
      const { unmount } = render(
        <StoryCard
          view={real}
          sv={sv}
          seen={{}}
          onSeen={() => {}}
          approve={approveFor(real)}
          onOpenBox={() => {}}
        />,
      );
      const steps = sv.scenario.steps;
      expect(steps.length, sv.scenario.id).toBeGreaterThan(0);
      steps.forEach((step, i) => {
        const title = boxAt(real.flow, step.name)?.title;
        expect(title, `${sv.scenario.id} step ${i + 1}: ${step.name}`).toBeTruthy();
        expect(screen.getByTestId(`card-node-title-${i + 1}`)).toHaveTextContent(title!);
        expect(screen.getByTestId(`card-steps-text-${i + 1}`)).toHaveTextContent(title!);
      });
      // The bootstrap approvals of the real EPIC are not signed (D41).
      expect(screen.getByTestId('card-approval-state')).not.toHaveTextContent('signature valid');
      unmount();
    }
  });

  it('S6-A1: the queue lists stories S1 to S13 and S15, and no real approval counts until it is signed', async () => {
    await start({}, realEpic());
    const groups = screen.getAllByTestId(/^queue-group-/).map((el) => el.dataset.testid!.replace('queue-group-', ''));
    expect(groups).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12', 'S13', 'S15']);
    expect(screen.getByTestId('queue-progress')).toHaveTextContent(`0 / ${realEpic().scenarios.length} approved with a valid signature`);
  });
});

describe('accessibility', () => {
  it('queue items and card buttons have names; the status mark is in words', async () => {
    const { user } = await start();
    expect(screen.getByTestId('story-scenario-select-S1-empty')).toHaveAccessibleName('Select S1-empty to approve');
    expect(screen.getByTestId('queue-story-S1')).toHaveAccessibleName('Open story S1: to pay for my cart; 2 scenarios · 1 of 2 approvals signed');
    expect(screen.getByTestId('story-scenario-open-S1-empty')).toHaveAccessibleName('Open the storyboard of S1-empty: Buyer checks out an empty cart (draft, not approved)');
    expect(screen.getByRole('navigation', { name: 'Review queue' })).toBeInTheDocument();
    await open(user, 'S1-empty');
    expect(screen.getByTestId('card-step-1')).toHaveAccessibleName(/^Step 1 of 3: .*, seen$/);
    expect(screen.getByTestId('card-step-2')).not.toHaveAccessibleName(/, seen$/);
    expect(screen.getByTestId('card-step-1').tagName).toBe('BUTTON');
    expect(screen.getByTestId('card-flow')).toHaveAttribute('role', 'group');
    expect(screen.getByTestId('card-flow')).toHaveAccessibleName(/^Flowchart of S1-empty: 3 steps/);
    fireEvent.keyDown(screen.getByTestId('card-step-1'), { key: 'ArrowDown' });
    expect(screen.getByTestId('card-step-2')).toHaveFocus();
    expect(screen.getByTestId('card-step-2')).toHaveAccessibleName(/, seen$/);
    expect(screen.getByTestId('card-detail-title')).toHaveAttribute('aria-live', 'polite');
  });

  it('S6-A1: a visually hidden ordered list reads the path in words: steps, lanes, branches, seen', async () => {
    const { user } = await start();
    await open(user, 'S1-buy');
    const list = screen.getByTestId('card-steps-text');
    expect(list.tagName).toBe('OL');
    expect(list).toHaveClass('sr-only');
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByTestId('card-steps-text-1')).toHaveTextContent('Step 1: Check out the cart, lane Builder, seen.');
    expect(screen.getByTestId('card-steps-text-3')).toHaveTextContent('Step 3: Item in stock?, lane System, a decision, branch taken: yes; not taken: no to No order.');
  });
});
