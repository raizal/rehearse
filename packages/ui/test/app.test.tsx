// The shell and the box drawer (T38). There is no Flow tab: a box opens in a drawer over the
// page the reader is on, and the URL keeps the page and adds `?box=<path>`.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodeIndex } from '@rehearse/server';
import { App } from '../src/App.js';
import { CodeApiContext, type CodeApi } from '../src/code-api.js';
import type { ReviewEpicView } from '../src/contract.js';
import { boxAt } from '../src/model/diagram.js';
import { reviewEpic } from './fixture.js';
import { mockServer } from './mock-server.js';

const ref = (n: string, subject: string) => ({ sha: n.repeat(40), short: n.repeat(7), subject, date: '2026-11-05T10:00:00Z' });
const INDEX: CodeIndex = {
  ok: true,
  head: ref('9', 'Head'),
  boxes: { pay: { commits: [ref('1', 'Charge the card'), ref('2', 'Retry a declined card')], files: ['src/pay.ts'] } },
};
const codeApi: CodeApi = { index: async () => INDEX, box: async () => ({ ok: false, error: 'not in this test' }) };

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

async function start(view: ReviewEpicView = reviewEpic(), hash?: string) {
  if (hash) window.history.replaceState(null, '', hash);
  mockServer({ epic: () => view });
  const user = userEvent.setup();
  render(
    <CodeApiContext.Provider value={codeApi}>
      <App />
    </CodeApiContext.Provider>,
  );
  await screen.findByTestId('epic-slug');
  return { user, view };
}

const drawer = () => screen.getByTestId('box-drawer');
const back = () => act(() => window.history.back());

describe('the shell', () => {
  it('T38 no Flow tab in the nav: the app fills the window and the nav opens every view', async () => {
    await start();
    await screen.findByTestId('big-picture');
    expect(screen.getByTestId('app')).toHaveClass('app');
    expect(screen.getByTestId('epic-title')).toHaveTextContent('Shop checkout');
    expect(screen.getAllByTestId(/^nav-/).map((el) => el.textContent)).toEqual(['PRD', 'Tech spec', 'Big picture', 'Code map', 'Stories', 'Use cases', 'Readiness', 'Sign off', 'Status']);
    expect(screen.queryByTestId('nav-flow')).toBeNull();
    for (const tab of ['bigpicture', 'code', 'stories', 'usecases', 'readiness', 'signoff', 'status']) expect(screen.getByTestId(`nav-${tab}`)).toBeEnabled();
    expect(screen.getByTestId('report-status')).toHaveTextContent('validate: OK');
  });

  it('shows a load error', async () => {
    render(<App load={() => Promise.reject(new Error('HTTP 500'))} />);
    expect(await screen.findByTestId('load-error')).toHaveTextContent('HTTP 500');
  });
});

describe('T38 the drawer opens from each entry point, over the page', () => {
  it('T38 entry: Big picture process → drawer; the Big picture stays the page', async () => {
    const { user } = await start();
    await user.click(await screen.findByTestId('bp-process-pay'));
    expect(drawer()).toHaveAttribute('data-box', 'pay');
    expect(screen.getByTestId('big-picture')).toBeInTheDocument();
    expect(screen.getByTestId('nav-bigpicture')).toHaveAttribute('aria-current', 'page');
    expect(window.location.hash).toBe('#/bigpicture?box=pay');
  });

  it('T38 entry: a story HOW box → drawer over the story page', async () => {
    const { user } = await start();
    await user.click(await screen.findByTestId('bp-story-S1'));
    const how = await screen.findByTestId('story-how');
    await user.click(within(how).getByTestId('story-how-box-cart'));
    expect(drawer()).toHaveAttribute('data-box', 'cart');
    expect(screen.getByTestId('story-view')).toBeInTheDocument();
    expect(window.location.hash).toMatch(/^#\/stories\/S1\/[a-z]+\?box=cart$/);
  });

  it('T38 entry: an id link to a box (PRD) and a use case each open the drawer', async () => {
    const { user } = await start();
    await user.click(screen.getByTestId('nav-prd'));
    await user.click(within(await screen.findByTestId('prd-story-S1')).getByTestId('link-box-pay'));
    expect(drawer()).toHaveAttribute('data-box', 'pay');
    expect(screen.getByTestId('nav-prd')).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByTestId('nav-usecases'));
    expect(screen.queryByTestId('box-drawer')).toBeNull();
    await user.click(screen.getByTestId('usecase-cart'));
    expect(drawer()).toHaveAttribute('data-box', 'cart');
    expect(screen.getByTestId('nav-usecases')).toHaveAttribute('aria-current', 'page');
  });

  it('T38 the drawer: title, kind, lane chip, contract, stories, decisions as id links, code', async () => {
    const view = reviewEpic();
    boxAt(view.flow, 'pay')!.decisions = ['D1'];
    await start(view, '#/bigpicture?box=pay');
    const d = await screen.findByTestId('box-drawer');
    expect(within(d).getByTestId('drawer-title')).toHaveTextContent('Charge the buyer');
    expect(within(d).getByTestId('drawer-kind')).toHaveTextContent('▭ process');
    expect(within(d).getByTestId('drawer-lane')).toHaveTextContent('System lane');
    expect(within(d).getByTestId('contract-inputs')).toHaveTextContent('orderId');
    expect(within(d).getByTestId('contract-outputs')).toHaveTextContent('orderId');
    expect(within(d).getByTestId('contract-reads')).toHaveTextContent('Order.status');
    expect(within(d).getByTestId('contract-writes')).toHaveTextContent('Order.status:draft->paid');
    expect(within(d).getByTestId('contract-side-effects')).toHaveTextContent('charges the card');
    expect(within(d).getByTestId('drawer-stories')).toHaveTextContent('S1');
    expect(within(within(d).getByTestId('drawer-decisions')).getByTestId('link-decision-D1')).toHaveClass('id-link', 'id-decision');
    expect(await within(d).findByTestId('drawer-code-words')).toHaveTextContent('2 commits name this box in a Flow-Box trailer, 1 file.');
    expect(within(d).getByTestId('drawer-code')).toHaveTextContent('Retry a declined card');
    expect(within(d).getByTestId('drawer-scenarios')).toHaveTextContent('S1-buy');
    // The story's Code tab, under Stories; the drawer closes.
    await userEvent.setup().click(within(d).getByTestId('drawer-code-story-S1'));
    expect(await screen.findByTestId('story-view')).toHaveTextContent('Click a box to see its code.');
    expect(window.location.hash).toBe('#/stories/S1/code');
    expect(screen.queryByTestId('box-drawer')).toBeNull();
  });

  it('T38 a decision box: ◆ decision, its branches, no code', async () => {
    await start(reviewEpic(), '#/bigpicture?box=in-stock');
    const d = await screen.findByTestId('box-drawer');
    expect(within(d).getByTestId('drawer-kind')).toHaveTextContent('◆ decision');
    expect(within(d).getByTestId('drawer-edge-out-ship-label')).toHaveTextContent('yes');
    expect(within(d).getByTestId('drawer-edge-out-failed-label')).toHaveTextContent('no');
    expect(within(d).getByTestId('drawer-code-words')).toHaveTextContent('A decision box has no code');
  });

  it('T38 a box with no commits says it has no code yet', async () => {
    await start(reviewEpic(), '#/bigpicture?box=cart');
    expect(await within(await screen.findByTestId('box-drawer')).findByTestId('drawer-code-words')).toHaveTextContent('This box has no code yet.');
  });
});

describe('T38 edges as links', () => {
  it('T38 edges: incoming and outgoing with their labels; each opens that box in the same drawer', async () => {
    const { user } = await start(reviewEpic(), '#/bigpicture?box=cart');
    const d = await screen.findByTestId('box-drawer');
    expect(within(within(d).getByTestId('drawer-edges-in')).getByTestId('drawer-edge-in-start')).toHaveTextContent(/./);
    expect(within(d).getByTestId('drawer-edge-out-failed-label')).toHaveTextContent('⚠ empty-cart');
    expect(within(d).getByTestId('contract-error-exits')).toHaveTextContent('empty-cart');
    await user.click(within(d).getByTestId('drawer-edge-out-pay'));
    expect(drawer()).toHaveAttribute('data-box', 'pay');
    expect(within(drawer()).getByTestId('drawer-edge-in-cart')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/bigpicture?box=pay');
  });
});

describe('T38 nested drill and breadcrumb', () => {
  it('T38 drill: a box with children shows its sub-steps; a child opens in the same drawer; the breadcrumb goes back up', async () => {
    const { user } = await start(reviewEpic(), '#/bigpicture?box=ship');
    const d = await screen.findByTestId('box-drawer');
    const steps = within(d).getByTestId('drawer-steps');
    expect(within(steps).getByTestId('box-diagram')).toBeInTheDocument();
    expect(await within(steps).findByTestId('box-ship/pack')).toBeInTheDocument();
    expect(within(steps).getByTestId('box-ship/send')).toBeInTheDocument();
    expect(within(steps).queryByTestId('box-cart')).toBeNull();

    await user.click(within(steps).getByTestId('drawer-child-ship/pack'));
    expect(drawer()).toHaveAttribute('data-box', 'ship/pack');
    const crumb = within(drawer()).getByTestId('drawer-breadcrumb');
    expect(within(crumb).getByTestId('drawer-crumb-ship')).toHaveTextContent('Ship the order');
    expect(within(crumb).getByTestId('drawer-crumb-current')).toHaveTextContent('ship/pack');
    expect(within(drawer()).getByTestId('drawer-edge-out-ship/send')).toBeInTheDocument();

    await user.click(within(crumb).getByTestId('drawer-crumb-ship'));
    expect(drawer()).toHaveAttribute('data-box', 'ship');
  });

  it('T38 drill: a click on a box in the sub-step diagram opens it', async () => {
    await start(reviewEpic(), '#/bigpicture?box=ship');
    // d3-zoom's mousedown handler needs event.view, which user-event leaves null in jsdom.
    fireEvent.click(await screen.findByTestId('box-ship/send'));
    expect(drawer()).toHaveAttribute('data-box', 'ship/send');
  });
});

describe('T38 deep link and Back', () => {
  it('T38 deep link: #/stories/S1/how?box=ship/pack opens the story page with the drawer on that box', async () => {
    await start(reviewEpic(), '#/stories/S1/how?box=ship/pack');
    expect(await screen.findByTestId('box-drawer')).toHaveAttribute('data-box', 'ship/pack');
    expect(screen.getByTestId('story-view')).toHaveTextContent('S1 ·');
    expect(screen.getByTestId('story-how')).toBeInTheDocument();
  });

  it('T38 Back: Back from a drilled box goes up a level, then closes the drawer, page unchanged', async () => {
    const { user } = await start();
    await user.click(await screen.findByTestId('bp-process-ship'));
    await user.click(within(drawer()).getByTestId('drawer-child-ship/send'));
    expect(window.location.hash).toBe('#/bigpicture?box=ship/send');
    await back();
    await waitFor(() => expect(drawer()).toHaveAttribute('data-box', 'ship'));
    await back();
    await waitFor(() => expect(screen.queryByTestId('box-drawer')).toBeNull());
    expect(screen.getByTestId('big-picture')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/bigpicture');
  });
});

describe('T38 Esc, ✕, click outside and focus', () => {
  it('T38 focus: the title takes focus, Tab stays inside, Esc closes and focus goes back to the opener', async () => {
    const { user } = await start();
    const opener = await screen.findByTestId('bp-process-pay');
    await user.click(opener);
    expect(within(drawer()).getByTestId('drawer-title')).toHaveFocus();
    expect(drawer()).toHaveAttribute('role', 'dialog');
    expect(drawer()).toHaveAttribute('aria-modal', 'true');
    expect(drawer()).toHaveAccessibleName('Charge the buyer');
    for (let i = 0; i < 30; i++) {
      await user.tab();
      expect(drawer()).toContainElement(document.activeElement as HTMLElement);
    }
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('box-drawer')).toBeNull();
    expect(opener).toHaveFocus();
    expect(window.location.hash).toBe('#/bigpicture');
  });

  it('T38 close: ✕ closes; a click outside the panel closes', async () => {
    const { user } = await start();
    await user.click(await screen.findByTestId('bp-process-pay'));
    await user.click(screen.getByTestId('box-drawer-close'));
    expect(screen.queryByTestId('box-drawer')).toBeNull();
    await user.click(screen.getByTestId('bp-process-cart'));
    fireEvent.mouseDown(within(drawer()).getByTestId('drawer-title'));
    expect(drawer()).toHaveAttribute('data-box', 'cart');
    fireEvent.mouseDown(screen.getByTestId('box-drawer-backdrop'));
    expect(screen.queryByTestId('box-drawer')).toBeNull();
  });
});

describe('T38 old #/flow URLs', () => {
  it('T38 redirect: #/flow/ship/pack opens the Big picture with the drawer on ship/pack', async () => {
    await start(reviewEpic(), '#/flow/ship/pack');
    expect(await screen.findByTestId('box-drawer')).toHaveAttribute('data-box', 'ship/pack');
    expect(screen.getByTestId('nav-bigpicture')).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/bigpicture.*\?box=ship\/pack$/));
  });

  it('T38 redirect: #/flow alone opens the Big picture, no drawer', async () => {
    await start(reviewEpic(), '#/flow');
    expect(await screen.findByTestId('big-picture')).toBeInTheDocument();
    expect(screen.getByTestId('nav-bigpicture')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByTestId('box-drawer')).toBeNull();
  });
});
