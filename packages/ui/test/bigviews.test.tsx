// The big picture views (D42, design pages 5–7) in the app: the view switcher, and that a click
// or a key on any node of the user flow, data flow or system flowchart opens its box in the flow
// view. The graphs and their layout are tested in bigviews-model.test.ts; here the real EPIC
// renders all three diagrams with no error.

import { render, screen, within } from '@testing-library/react';
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

async function start(view: ReviewEpicView = reviewEpic()) {
  mockServer({ epic: () => view });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId('big-picture');
  return { user, view };
}

async function pick(user: ReturnType<typeof userEvent.setup>, id: string, testid: string, prefix: string) {
  await user.click(screen.getByTestId(`bpv-${id}`));
  const page = await screen.findByTestId(testid);
  await within(page).findByTestId(`${prefix}-svg`);
  return page;
}

async function expectOpened(path: string) {
  expect(screen.getByTestId('nav-flow')).toHaveAttribute('aria-current', 'page');
  expect(await screen.findByTestId('contract-path')).toHaveTextContent(path);
}

describe('view switcher', () => {
  it('T14 1: Feature map, User flow, Data flow, System flowchart; the feature map first', async () => {
    const { user } = await start();
    const nav = screen.getByRole('navigation', { name: 'Big picture views' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Feature map', 'User flow', 'Data flow', 'System flowchart']);
    expect(screen.getByTestId('bpv-features')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('bpv-userflow')).toHaveAttribute('aria-pressed', 'false');
    await pick(user, 'userflow', 'user-flow', 'uf');
    expect(screen.getByTestId('bpv-userflow')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('bp-process-pay')).toBeNull();
  });

  it('T14 1: the chosen view stays when the reviewer comes back to Big picture', async () => {
    const { user } = await start();
    await pick(user, 'dataflow', 'data-flow', 'df');
    await user.click(screen.getByTestId('nav-flow'));
    await user.click(screen.getByTestId('nav-bigpicture'));
    expect(await screen.findByTestId('data-flow')).toBeInTheDocument();
    expect(screen.getByTestId('bpv-dataflow')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('user flow (design page 5)', () => {
  it('T14 2: shapes, branch labels and a legend', async () => {
    const { user } = await start();
    const page = await pick(user, 'userflow', 'user-flow', 'uf');
    expect(within(page).getByTestId('uf-node-start')).toHaveAttribute('data-shape', 'start');
    expect(within(page).getByTestId('uf-node-cart')).toHaveAttribute('data-shape', 'action');
    expect(within(page).getByTestId('uf-node-in-stock')).toHaveAttribute('data-shape', 'decision');
    expect(within(page).getByTestId('uf-node-fold:ship')).toHaveAttribute('data-shape', 'fold');
    expect(within(page).getByTestId('uf-node-done')).toHaveAttribute('data-shape', 'end');
    expect(within(page).getByTestId('uf-edge-in-stock-failed')).toHaveTextContent('no');
    expect(within(page).getByTestId('uf-edge-cart-failed')).toHaveClass('edge-error');
    expect(within(page).getByRole('list', { name: 'Legend' })).toHaveTextContent('Decision');
  });

  it('T14 5: a click on a human box opens it in the flow view', async () => {
    const { user } = await start();
    await pick(user, 'userflow', 'user-flow', 'uf');
    await user.click(screen.getByTestId('uf-node-cart'));
    await expectOpened('cart');
  });

  it('T14 5: each box in a folded step is its own button, reached by the keyboard', async () => {
    const { user } = await start();
    await pick(user, 'userflow', 'user-flow', 'uf');
    const row = screen.getByTestId('uf-node-fold:ship-row-notify');
    expect(row).toHaveAttribute('role', 'button');
    expect(row).toHaveAttribute('tabindex', '0');
    expect(row).toHaveAccessibleName(/Email the receipt/);
    row.focus();
    await user.keyboard('{Enter}');
    await expectOpened('notify');
  });
});

describe('data flow (design page 6)', () => {
  it('T14 3: numbered processes, stores, labelled flows and the box with no data', async () => {
    const { user } = await start();
    const page = await pick(user, 'dataflow', 'data-flow', 'df');
    expect(within(page).getByTestId('df-node-p:pay')).toHaveAccessibleName(/2\.0 Charge the buyer/);
    expect(within(page).getByTestId('df-node-d:Order')).toHaveTextContent('D1');
    expect(within(page).getByTestId('df-node-x:builder')).toHaveAttribute('data-shape', 'entity');
    expect(within(page).getByTestId('df-edge-p:pay-d:Order')).toHaveTextContent('status: draft→paid');
    expect(within(page).getByTestId('df-no-data')).toHaveTextContent('Email the receipt');
    expect(within(page).queryByTestId('df-only-writers')).toBeNull();
  });

  it('T14 5: Enter on a process opens it in the flow view', async () => {
    const { user } = await start();
    await pick(user, 'dataflow', 'data-flow', 'df');
    screen.getByTestId('df-node-p:pay').focus();
    await user.keyboard('{Enter}');
    await expectOpened('pay');
  });
});

describe('system flowchart (design page 7)', () => {
  it('T14 4: a column per system lane, the frame of a box with children, checks and documents', async () => {
    const { user } = await start();
    const page = await pick(user, 'sysflow', 'system-flowchart', 'sf');
    expect(within(page).getByTestId('sf-group-col:system')).toHaveTextContent('System');
    expect(within(page).getByTestId('sf-group-col:outside')).toHaveTextContent('Other lanes');
    expect(within(page).getByTestId('sf-node-in-stock')).toHaveAttribute('data-shape', 'decision');
    expect(within(page).getByTestId('sf-node-ship/send')).toHaveAttribute('data-shape', 'document');
    expect(within(page).getByTestId('sf-edge-in-stock-o:failed')).toHaveTextContent('no');
  });

  it('T14 5: a nested step, its frame and a box of another lane each open in the flow view', async () => {
    const { user } = await start();
    await pick(user, 'sysflow', 'system-flowchart', 'sf');
    await user.click(screen.getByTestId('sf-node-ship/pack'));
    await expectOpened('ship/pack');

    await user.click(screen.getByTestId('nav-bigpicture'));
    await screen.findByTestId('sf-svg');
    screen.getByTestId('sf-node-ship').focus();
    await user.keyboard('{Enter}');
    await expectOpened('ship');

    await user.click(screen.getByTestId('nav-bigpicture'));
    await screen.findByTestId('sf-svg');
    await user.click(screen.getByTestId('sf-node-o:cart'));
    await expectOpened('cart');
  });
});

describe('the real EPIC', () => {
  it('T14 5: renders the user flow, data flow and system flowchart with no error', async () => {
    const { user } = await start(realEpic());
    for (const [id, testid, prefix] of [
      ['userflow', 'user-flow', 'uf'],
      ['dataflow', 'data-flow', 'df'],
      ['sysflow', 'system-flowchart', 'sf'],
    ] as const) {
      const page = await pick(user, id, testid, prefix);
      expect(page.querySelector('.gd-status')).toBeNull();
      expect(page.querySelectorAll('[role="button"]').length).toBeGreaterThan(5);
      for (const b of page.querySelectorAll('[role="button"]')) expect(b).toHaveAttribute('tabindex', '0');
      if (id === 'dataflow') expect(within(page).getByTestId('df-only-writers')).toHaveTextContent('Approval');
    }
  });
});
