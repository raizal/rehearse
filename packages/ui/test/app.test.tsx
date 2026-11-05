// The shell, swimlanes, drill-down, detail pane and playback, rendered with React Flow in jsdom.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App.js';
import { reviewEpic } from './fixture.js';

// Clicks on boxes use fireEvent: d3-zoom's mousedown handler needs event.view, which user-event leaves null in jsdom.
function renderApp() {
  const view = reviewEpic();
  render(<App load={() => Promise.resolve(view)} />);
  return { view, user: userEvent.setup() };
}

describe('review panel: swimlanes and drill-down (S4)', () => {
  it('S4-A1: the panel shows two lanes in lane order, and each box is in the lane of its role', async () => {
    renderApp();
    await screen.findByTestId('box-cart');
    const lanes = screen.getAllByTestId(/^lane-/).map((el) => el.dataset.testid);
    expect(lanes).toEqual(['lane-builder', 'lane-system']);
    expect(within(screen.getByTestId('lane-builder')).getByText('Builder')).toBeInTheDocument();
    expect(screen.getByTestId('box-cart')).toHaveAttribute('data-lane', 'builder');
    expect(screen.getByTestId('box-pay')).toHaveAttribute('data-lane', 'system');
    expect(screen.getByTestId('box-ship')).toHaveAttribute('data-lane', 'system');
    // Kind and title on the box; error exits are named.
    expect(screen.getByTestId('box-kind-pay')).toHaveTextContent('process');
    expect(screen.getByTestId('box-pay')).toHaveTextContent('Charge the buyer');
    expect(screen.getByTestId('box-cart')).toHaveTextContent('empty-cart');
  });

  it('S4-A2: clicking a box with children shows the nested diagram and a breadcrumb back to the parent', async () => {
    const { user } = renderApp();
    fireEvent.click(await screen.findByTestId('box-ship'));
    expect(await screen.findByTestId('box-ship/pack')).toBeInTheDocument();
    expect(screen.getByTestId('box-ship/send')).toBeInTheDocument();
    expect(screen.queryByTestId('box-cart')).not.toBeInTheDocument();
    const crumb = screen.getByTestId('breadcrumb');
    expect(within(crumb).getByTestId('breadcrumb-root')).toHaveTextContent('root');
    expect(within(crumb).getByTestId('breadcrumb-ship')).toHaveTextContent('ship');
    // The detail pane shows the opened box's contract.
    expect(screen.getByTestId('contract-path')).toHaveTextContent('ship');

    await user.click(within(crumb).getByTestId('breadcrumb-root'));
    expect(await screen.findByTestId('box-cart')).toBeInTheDocument();
    expect(screen.queryByTestId('box-ship/pack')).not.toBeInTheDocument();
  });

  it('S4-A3: the app fills the window, with room for the wave-2 views in the nav', async () => {
    renderApp();
    await screen.findByTestId('box-cart');
    expect(screen.getByTestId('app')).toHaveClass('app');
    expect(screen.getByTestId('epic-title')).toHaveTextContent('Shop checkout');
    expect(screen.getByTestId('nav-flow')).toHaveAttribute('aria-current', 'page');
    for (const tab of ['matrix', 'readiness', 'signoff']) expect(screen.getByTestId(`nav-${tab}`)).toBeDisabled();
    expect(screen.getByTestId('report-status')).toHaveTextContent('validate: OK');
  });

  it('the detail pane shows the box contract', async () => {
    const { user } = renderApp();
    fireEvent.click(await screen.findByTestId('box-pay'));
    const pane = screen.getByTestId('detail-pane');
    expect(within(pane).getByTestId('contract-path')).toHaveTextContent('pay');
    expect(within(pane).getByTestId('contract-inputs')).toHaveTextContent('orderId');
    expect(within(pane).getByTestId('contract-outputs')).toHaveTextContent('orderId');
    expect(within(pane).getByTestId('contract-reads')).toHaveTextContent('Order.status');
    expect(within(pane).getByTestId('contract-writes')).toHaveTextContent('Order.status:draft->paid');
    expect(within(pane).getByTestId('contract-side-effects')).toHaveTextContent('charges the card');
    expect(within(pane).getByTestId('contract-stories')).toHaveTextContent('S1');
    fireEvent.click(screen.getByTestId('box-cart'));
    expect(within(pane).getByTestId('contract-error-exits')).toHaveTextContent('empty-cart');
  });

  it('shows a load error', async () => {
    render(<App load={() => Promise.reject(new Error('HTTP 500'))} />);
    expect(await screen.findByTestId('load-error')).toHaveTextContent('HTTP 500');
  });
});

describe('review panel: playback (S5)', () => {
  it('S5-A1: playing an approved scenario and moving to step 2 highlights its box and shows input, output and state change', async () => {
    const { user } = renderApp();
    await screen.findByTestId('box-cart');
    expect(screen.getByTestId('scenario-status-S1-buy')).toHaveTextContent('approved');
    await user.click(screen.getByTestId('scenario-S1-buy'));
    expect(screen.getByTestId('playback-step')).toHaveTextContent('Step 1 of 4');
    expect(screen.getByTestId('box-cart')).toHaveAttribute('data-highlighted', 'true');
    expect(screen.getByTestId('playback-prev')).toBeDisabled();

    await user.click(screen.getByTestId('playback-next'));
    expect(screen.getByTestId('playback-step')).toHaveTextContent('Step 2 of 4');
    await waitFor(() => expect(screen.getByTestId('box-pay')).toHaveAttribute('data-highlighted', 'true'));
    expect(screen.getByTestId('box-cart')).toHaveAttribute('data-highlighted', 'false');
    expect(screen.getByTestId('step-path')).toHaveTextContent('pay');
    expect(screen.getByTestId('step-input')).toHaveTextContent('orderId');
    expect(screen.getByTestId('step-input')).toHaveTextContent('o1');
    expect(screen.getByTestId('step-output')).toHaveTextContent('o1');
    expect(screen.getByTestId('step-state')).toHaveTextContent('Order.status');
    expect(screen.getByTestId('step-state')).toHaveTextContent('paid');
    expect(screen.getByTestId('contract-path')).toHaveTextContent('pay');

    await user.click(screen.getByTestId('playback-prev'));
    await waitFor(() => expect(screen.getByTestId('box-cart')).toHaveAttribute('data-highlighted', 'true'));
  });

  it('R21: a step on a leaf box inside a box with children opens the nested diagram and highlights the leaf', async () => {
    const { user } = renderApp();
    await user.click(await screen.findByTestId('scenario-S1-buy'));
    await user.click(screen.getByTestId('playback-step-4'));
    expect(await screen.findByTestId('box-ship/pack')).toHaveAttribute('data-highlighted', 'true');
    expect(screen.getByTestId('breadcrumb-ship')).toBeInTheDocument();
    expect(screen.getByTestId('playback-next')).toBeDisabled();
    expect(screen.getByTestId('step-expect')).toHaveTextContent('shipped');
    // Back up to the root: the parent box shows that the current step is inside it.
    await user.click(screen.getByTestId('breadcrumb-root'));
    expect(await screen.findByTestId('box-ship')).toHaveClass('contains-current');
  });

  it('scenarios show a clear approved, draft or stale badge', async () => {
    renderApp();
    await screen.findByTestId('box-cart');
    expect(screen.getByTestId('scenario-status-S1-buy')).toHaveTextContent('approved');
    expect(screen.getByTestId('scenario-status-S1-empty')).toHaveTextContent('draft');
    expect(screen.getByTestId('scenario-status-S2-out-of-stock')).toHaveTextContent('stale');
    expect(screen.getByTestId('scenario-status-S2-out-of-stock')).toHaveClass('status-stale');
  });

  it('arrow keys step through the scenario', async () => {
    const { user } = renderApp();
    await user.click(await screen.findByTestId('scenario-S1-buy'));
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByTestId('playback-step')).toHaveTextContent('Step 3 of 4');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByTestId('playback-step')).toHaveTextContent('Step 2 of 4');
  });
});
