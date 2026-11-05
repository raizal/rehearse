// The storyboard: the default view for approval (S6-A1). One card per scenario (story,
// criterion, path map, step panels, end state, Approve), the review queue grouped by story,
// and the "seen every step" gate on Approve. Seen state is browser-only and never sent.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { StoryCard } from '../src/components/Storyboard.js';
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
  await screen.findByTestId('story-card');
  await screen.findByTestId('approve-signer-key');
  return { server, user, view };
}

const open = async (user: ReturnType<typeof userEvent.setup>, id: string) => {
  await user.click(screen.getByTestId(`queue-item-${id}`));
  await waitFor(() => expect(screen.getByTestId('story-card')).toHaveTextContent(id));
};

/** Step through every panel with the "Step through" button. */
async function stepThrough(user: ReturnType<typeof userEvent.setup>) {
  const total = Number(/of (\d+) steps seen/.exec(screen.getByTestId('card-seen').textContent ?? '')![1]);
  for (let i = 0; i < total; i++) await user.click(screen.getByTestId('card-next-step'));
}

describe('storyboard is the default view (S6-A1)', () => {
  it('S6-A1: opens on the storyboard, with progress and the queue grouped by story', async () => {
    await start();
    expect(screen.getByTestId('nav-storyboard')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('queue-progress')).toHaveTextContent('1 / 3 approved with a valid signature');
    const s1 = screen.getByTestId('queue-group-S1');
    expect(within(s1).getAllByTestId(/^queue-item-/).map((el) => el.dataset.testid)).toEqual(['queue-item-S1-buy', 'queue-item-S1-empty']);
    expect(within(screen.getByTestId('queue-group-S2')).getByTestId('queue-item-S2-out-of-stock')).toBeInTheDocument();
    // Status in words.
    expect(screen.getByTestId('queue-status-S1-buy')).toHaveTextContent('approved, signature valid');
    expect(screen.getByTestId('queue-status-S1-empty')).toHaveTextContent('draft, not approved');
    expect(screen.getByTestId('queue-status-S2-out-of-stock')).toHaveTextContent('stale, changed since it was approved');
    // The first card is the first scenario with no valid signed approval.
    expect(screen.getByTestId('story-card')).toHaveTextContent('S1-empty');
  });

  it('S6-A1: the card shows story, criterion, step panels and the end state', async () => {
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

    expect(screen.getByTestId('card-step-title-2')).toHaveTextContent('Charge the buyer');
    expect(screen.getByTestId('card-step-lane-2')).toHaveTextContent('lane: System');
    expect(screen.getByTestId('card-step-lane-1')).toHaveTextContent('lane: Builder');
    expect(screen.getByTestId('card-step-example-1')).toHaveTextContent('items');
    expect(screen.getByTestId('card-step-example-1')).toHaveTextContent('o1');
    expect(screen.getByTestId('card-step-example-2')).toHaveTextContent('paid');
    expect(screen.getByTestId('card-step-branch-3')).toHaveTextContent('branch taken: yes');
    expect(screen.getByTestId('card-step-example-3')).toHaveTextContent('no example: passes through');
    expect(screen.getByTestId('card-step-contract-2')).toHaveTextContent('orderId');
    expect(screen.getByTestId('card-step-contract-2')).toHaveTextContent('Order.status:draft->paid');

    const result = screen.getByTestId('card-result');
    expect(result).toHaveTextContent('End state for criterion S1-A1');
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

describe('approve only after every step was seen (S6-A1)', () => {
  it('S6-A1: Approve is off until every step panel was seen; stepping through turns it on', async () => {
    const { server, user } = await start();
    const approve = screen.getByTestId('card-approve');
    expect(approve).toBeDisabled();
    expect(approve).toHaveAccessibleName('Approve S1-empty (see every step first)');
    expect(screen.getByTestId('card-approve-why')).toHaveTextContent('0 of 3 seen');

    await user.click(screen.getByTestId('card-next-step'));
    expect(screen.getByTestId('card-seen')).toHaveTextContent('1 of 3 steps seen');
    expect(screen.getByTestId('card-step-1')).toHaveFocus();
    expect(screen.getByTestId('card-approve')).toBeDisabled();
    await user.click(screen.getByTestId('card-next-step'));
    await user.click(screen.getByTestId('card-next-step'));
    expect(screen.getByTestId('card-seen')).toHaveTextContent('3 of 3 steps seen');
    expect(screen.queryByTestId('card-approve-why')).not.toBeInTheDocument();
    expect(screen.getByTestId('card-approve')).toBeEnabled();
    expect(screen.getByTestId('card-approve')).toHaveAccessibleName('Approve S1-empty (draft)');

    await user.click(screen.getByTestId('card-approve'));
    expect(server.posts('api/approve')[0]!.body).toEqual({ scenarioIds: ['S1-empty'] });
  });

  it('S6-A1: a panel that gets focus is seen; up and down arrows move between the panels', async () => {
    const { user } = await start();
    await open(user, 'S2-out-of-stock');
    act(() => screen.getByTestId('card-step-1').focus());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('card-step-2')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('card-step-3')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByTestId('card-step-2')).toHaveFocus();
    expect(screen.getByTestId('card-seen')).toHaveTextContent('3 of 3 steps seen');
    expect(screen.getByTestId('card-approve')).toBeEnabled();
  });

  it('S6-A1: seen state stays in sessionStorage and is never sent to the server', async () => {
    const { server, user } = await start();
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
    await start({}, view);
    expect(screen.getByTestId('card-seen')).toHaveTextContent('3 of 3 steps seen');
    expect(screen.getByTestId('card-approve')).toBeEnabled();
  });

  it('S6-A1: steps seen before the scenario changed do not count', async () => {
    const view = reviewEpic();
    seeAll(view, ['S1-empty']);
    view.scenarios.find((s) => s.scenario.id === 'S1-empty')!.hash = `sha256:${'1'.repeat(64)}`;
    await start({}, view);
    expect(screen.getByTestId('card-approve')).toBeDisabled();
  });

  it('S6-A1: in the flow view, Approve is off too until playback stepped through every step', async () => {
    const { user } = await start();
    await user.click(screen.getByTestId('nav-flow'));
    await screen.findByTestId('box-cart');
    expect(screen.getByTestId('approve-S2-out-of-stock')).toBeDisabled();
    expect(screen.getByTestId('select-S2-out-of-stock')).toBeDisabled();
    expect(screen.getByTestId('approve-reason-S2-out-of-stock')).toHaveTextContent('see every step first');
    await user.click(screen.getByTestId('scenario-S2-out-of-stock'));
    expect(screen.getByTestId('playback-approve')).toBeDisabled();
    await user.click(screen.getByTestId('playback-next'));
    await user.click(screen.getByTestId('playback-next'));
    expect(screen.getByTestId('playback-approve')).toBeEnabled();
    expect(screen.getByTestId('approve-S2-out-of-stock')).toBeEnabled();
  });
});

describe('review queue', () => {
  it('"Next" goes to the next scenario with no valid signed approval', async () => {
    const { user } = await start();
    expect(screen.getByTestId('queue-next')).toHaveTextContent('Next to approve: S2-out-of-stock');
    await user.click(screen.getByTestId('queue-next'));
    expect(screen.getByTestId('story-card')).toHaveTextContent('S2-out-of-stock');
    await user.click(screen.getByTestId('queue-next'));
    expect(screen.getByTestId('story-card')).toHaveTextContent('S1-empty');
  });

  it('up and down arrows move through the queue', async () => {
    const { user } = await start();
    act(() => screen.getByTestId('queue-item-S1-buy').focus());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('queue-item-S1-empty')).toHaveFocus();
    expect(screen.getByTestId('queue-item-S1-empty')).toHaveAttribute('aria-current', 'true');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('queue-item-S2-out-of-stock')).toHaveFocus();
    expect(screen.getByTestId('story-card')).toHaveTextContent('S2-out-of-stock');
    await user.keyboard('{ArrowUp}');
    expect(screen.getByTestId('story-card')).toHaveTextContent('S1-empty');
  });

  it('S6-A1: "approve the selected ones" takes only scenarios seen in full', async () => {
    const view = reviewEpic();
    seeAll(view, ['S1-empty']);
    const { server, user } = await start({}, view);
    expect(screen.getByTestId('queue-select-S1-empty')).toBeEnabled();
    expect(screen.getByTestId('queue-select-S2-out-of-stock')).toBeDisabled();
    expect(screen.getByTestId('queue-select-seen-S2')).toBeDisabled();
    expect(screen.getByTestId('queue-select-seen-S1')).toHaveTextContent('Select seen (1)');
    await user.click(screen.getByTestId('queue-select-seen-S1'));
    expect(screen.getByTestId('approve-selected')).toHaveTextContent('Approve selected (1)');
    await user.click(screen.getByTestId('approve-selected'));
    expect(server.posts('api/approve')[0]!.body).toEqual({ scenarioIds: ['S1-empty'] });
  });

  it('"Open in flow" opens playback of the scenario in the flow view', async () => {
    const { user } = await start();
    await open(user, 'S1-buy');
    await user.click(screen.getByTestId('card-open-flow'));
    expect(screen.getByTestId('nav-flow')).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByTestId('playback-step')).toHaveTextContent('Step 1 of 4');
    expect(screen.getByTestId('scenario-S1-buy')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.getByTestId('box-cart')).toHaveAttribute('data-highlighted', 'true'));
  });
});

describe('the real EPIC', () => {
  const real = realEpic();

  it('S6-A1: renders the card of every real scenario, and every step shows its box title', () => {
    expect(real.scenarios.length).toBeGreaterThan(0);
    for (const sv of real.scenarios) {
      const { unmount } = render(
        <StoryCard
          view={real}
          sv={sv}
          seen={{}}
          onSeen={() => {}}
          approve={{ reasonFor: (s) => approveReason(s, real.approvals), approvals: real.approvals, selected: new Set(), onToggle: () => {}, onApprove: () => {}, disabled: false }}
          onOpenFlow={() => {}}
        />,
      );
      const steps = sv.scenario.steps;
      expect(steps.length, sv.scenario.id).toBeGreaterThan(0);
      steps.forEach((step, i) => {
        const title = boxAt(real.flow, step.name)?.title;
        expect(title, `${sv.scenario.id} step ${i + 1}: ${step.name}`).toBeTruthy();
        expect(screen.getByTestId(`card-step-title-${i + 1}`)).toHaveTextContent(title!);
      });
      // The bootstrap approvals of the real EPIC are not signed (D41).
      expect(screen.getByTestId('card-approval-state')).not.toHaveTextContent('signature valid');
      unmount();
    }
  });

  it('S6-A1: the queue lists stories S1 to S10, and no real approval counts until it is signed', async () => {
    await start({}, realEpic());
    const groups = screen.getAllByTestId(/^queue-group-/).map((el) => el.dataset.testid!.replace('queue-group-', ''));
    expect(groups).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10']);
    expect(screen.getByTestId('queue-progress')).toHaveTextContent(`0 / ${realEpic().scenarios.length} approved with a valid signature`);
  });
});

describe('accessibility', () => {
  it('queue items and card buttons have names; the status mark is in words', async () => {
    const { user } = await start();
    expect(screen.getByTestId('card-open-flow')).toHaveAccessibleName('Open S1-empty in the flow view, in playback');
    expect(screen.getByTestId('queue-select-S1-empty')).toHaveAccessibleName('Select S1-empty to approve');
    expect(screen.getByRole('navigation', { name: 'Review queue' })).toBeInTheDocument();
    expect(screen.getByTestId('card-step-1')).toHaveAccessibleName(/^Step 1 of 3: /);
    await user.click(screen.getByTestId('card-next-step'));
    expect(screen.getByTestId('card-step-1')).toHaveAccessibleName(/, seen$/);
    fireEvent.keyDown(screen.getByTestId('card-step-1'), { key: 'ArrowDown' });
    expect(screen.getByTestId('card-step-2')).toHaveFocus();
  });
});
