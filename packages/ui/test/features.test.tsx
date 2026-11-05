// Review from big to small (D42): the big picture (S4-A4), the story view (S4-A5) and the use
// case diagram (S7-A1), drawn in the app. Layout numbers are tested in features-model.test.ts;
// here: what shows, what a click or a key opens, and that the real EPIC renders every story,
// process and role with no error.

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { StoryView } from '../src/components/StoryView.js';
import type { ReviewEpicView } from '../src/contract.js';
import { boxAt } from '../src/model/diagram.js';
import { MAIN_KINDS } from '../src/model/features.js';
import { storiesOf } from '../src/model/review.js';
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

/** The shop with box ship serving S1 too (through its child pack): ship is shared. */
function sharedShop(): ReviewEpicView {
  const view = reviewEpic();
  boxAt(view.flow, 'ship/pack')!.stories = ['S1'];
  return view;
}

const mainProcesses = (view: ReviewEpicView) => (view.flow?.root.boxes ?? []).filter((b) => MAIN_KINDS.includes(b.kind)).map((b) => b.id);
const roles = (view: ReviewEpicView) => (view.prd?.roles ?? []).map((r) => r.id);

describe('big picture (S4-A4)', () => {
  it('S4-A4: the review opens on the big picture: roles in rows, processes, one line per story, a legend', async () => {
    await start();
    expect(screen.getByTestId('nav-bigpicture')).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByTestId(/^nav-/).map((el) => el.textContent)).toEqual(['PRD', 'Tech spec', 'Big picture', 'Stories', 'Use cases', 'Readiness', 'Sign off', 'Flow']);
    const builder = screen.getByTestId('bp-role-builder');
    expect(builder).toHaveTextContent('Builder');
    expect(builder).toHaveTextContent('human');
    expect(screen.getByTestId('bp-role-system')).toHaveTextContent('system');
    // Main processes only: no start, end or decision box.
    expect(screen.getAllByTestId(/^bp-process-/).map((el) => el.dataset.testid)).toEqual(['bp-process-cart', 'bp-process-pay', 'bp-process-ship', 'bp-process-notify']);
    expect(screen.queryByTestId('bp-process-start')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bp-process-in-stock')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bp-process-failed')).not.toBeInTheDocument();
    // S1 runs through cart and pay; S2 has one process: a dot.
    expect(screen.getByTestId('bp-line-S1')).toHaveAttribute('data-points', '2');
    expect(screen.getByTestId('bp-line-S2')).toHaveAttribute('data-points', '1');
    expect(screen.getByTestId('bp-line-S1')).toHaveTextContent('S1');
    const legend = screen.getByTestId('bp-legend');
    expect(within(legend).getByTestId('bp-story-S1')).toHaveTextContent('S1');
    expect(within(legend).getByTestId('bp-story-S1')).toHaveTextContent('2 processes');
    expect(screen.getByTestId('bp-shared-list')).toHaveTextContent('No process serves two stories.');
  });

  it('S4-A4: a process two stories use is marked "shared" with the story ids, in words', async () => {
    await start(sharedShop());
    expect(screen.getByTestId('bp-shared-ship')).toHaveTextContent('shared: S1, S2');
    expect(screen.queryByTestId('bp-shared-cart')).not.toBeInTheDocument();
    expect(screen.getByTestId('bp-process-ship')).toHaveAccessibleName('Open process Ship the order (ship) in the flow view; process; serves S1, S2; shared');
    expect(screen.getByTestId('bp-line-S1')).toHaveAttribute('data-points', '3');
    expect(screen.getByTestId('bp-shared-list')).toHaveTextContent('ship shared by S1S2');
  });

  it('S4-A4: a click on a story opens its story view under Stories', async () => {
    const { user } = await start();
    await user.click(screen.getByTestId('bp-story-S2'));
    expect(screen.getByTestId('nav-stories')).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByTestId('story-view')).toHaveTextContent('Story S2');
    expect(screen.getByTestId('queue-story-S2')).toHaveAttribute('aria-current', 'true');
    // The story opens on its first scenario to approve.
    expect(screen.getByTestId('story-card')).toHaveTextContent('S2-out-of-stock');
  });

  it('S4-A4: a click on a process opens it in the flow view', async () => {
    const { user } = await start();
    await user.click(screen.getByTestId('bp-process-pay'));
    expect(screen.getByTestId('nav-flow')).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByTestId('box-pay')).toBeInTheDocument();
    expect(screen.getByTestId('contract-path')).toHaveTextContent('pay');
  });

  it('S4-A4: the keyboard reaches every process and opens it with Enter', async () => {
    const { user } = await start();
    for (const id of ['cart', 'pay', 'ship', 'notify']) expect(screen.getByTestId(`bp-process-${id}`)).toHaveAttribute('tabindex', '0');
    screen.getByTestId('bp-process-ship').focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByTestId('box-ship')).toBeInTheDocument();
  });

  it('S4-A4: the real EPIC shows every role, every main process and every story', async () => {
    const view = realEpic();
    await start(view);
    for (const role of roles(view)) expect(screen.getByTestId(`bp-role-${role}`)).toBeInTheDocument();
    for (const id of mainProcesses(view)) expect(screen.getByTestId(`bp-process-${id}`)).toBeInTheDocument();
    for (const s of storiesOf(view.prd)) expect(screen.getByTestId(`bp-story-${s.id}`)).toBeInTheDocument();
    expect(screen.getByTestId('bp-shared-review')).toHaveTextContent('shared');
  });
});

describe('story view (S4-A5)', () => {
  it('S4-A5: WHAT: role, wants … so that …, the criteria as a checklist checked by signed scenarios', async () => {
    const { user } = await start();
    await user.click(screen.getByTestId('bp-story-S1'));
    const what = await screen.findByTestId('story-what');
    expect(within(what).getByTestId('story-role')).toHaveTextContent('Builder');
    expect(what).toHaveTextContent('I want');
    expect(what).toHaveTextContent('so that');
    const c = within(what).getByTestId('story-criterion-S1-A1');
    expect(c).toHaveAttribute('data-checked', 'true');
    expect(c).toHaveTextContent('checked');
    expect(c).toHaveTextContent('Proved by S1-buy');
  });

  it('S4-A5: a criterion with no signed scenario says "not checked" in words', async () => {
    const { user } = await start();
    await user.click(screen.getByTestId('bp-story-S2'));
    const c = await screen.findByTestId('story-criterion-S2-A1');
    expect(c).toHaveAttribute('data-checked', 'false');
    expect(c).toHaveTextContent('not checked');
  });

  it('S4-A5: HOW: only the serving boxes, with parents, in flow order; a click opens the box', async () => {
    const { user } = await start(sharedShop());
    await user.click(screen.getByTestId('bp-story-S1'));
    const how = await screen.findByTestId('story-how');
    expect(within(how).getAllByTestId(/^story-how-box-/).map((el) => el.dataset.testid)).toEqual(['story-how-box-cart', 'story-how-box-pay', 'story-how-box-ship', 'story-how-box-ship/pack']);
    expect(within(how).getByTestId('story-how-box-ship/pack')).toHaveAccessibleName('Open box Pack (ship/pack) in the flow view, inside Ship the order');
    // The decision in-stock serves no story: the edge passes through it, dashed, and says so.
    const edge = within(how).getByTestId('story-how-edge-pay-ship');
    expect(edge).toHaveClass('is-via');
    expect(edge).toHaveTextContent('via Item in stock?');
    screen.getByTestId('story-how-box-ship/pack').focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByTestId('box-ship/pack')).toBeInTheDocument();
    expect(screen.getByTestId('contract-path')).toHaveTextContent('ship/pack');
  });

  it('S4-A5: OUTPUT: data changes as from → to, side effects and what the user sees', async () => {
    const { user } = await start();
    await user.click(screen.getByTestId('bp-story-S1'));
    const changes = await screen.findByTestId('story-changes');
    expect(within(changes).getAllByRole('listitem').map((li) => li.querySelector('code')?.textContent)).toEqual([
      'Order.id: written',
      'Order.status: new → draft',
      'Order.status: draft → paid',
    ]);
    expect(screen.getByTestId('story-side-effects')).toHaveTextContent('charges the card');
    expect(screen.getByTestId('story-sees')).toHaveTextContent('S1-buy ends with Order.status = shipped');
  });

  it('S4-A5: below the story view, the story’s scenarios as storyboard cards; the queue stays on the left', async () => {
    const { user } = await start();
    await user.click(screen.getByTestId('nav-stories'));
    expect(await screen.findByTestId('queue')).toBeInTheDocument();
    expect(screen.getByTestId('story-scenarios')).toHaveTextContent('Scenarios of S1 (2)');
    expect(screen.getByTestId('story-card')).toHaveTextContent('S1-empty');
    await user.click(screen.getByTestId('story-scenario-S1-buy'));
    expect(screen.getByTestId('story-card')).toHaveTextContent('S1-buy');
    expect(screen.getByTestId('story-scenario-S1-empty')).toBeInTheDocument();
    // A story picked in the queue opens its story view.
    await user.click(screen.getByTestId('queue-story-S2'));
    expect(screen.getByTestId('story-view')).toHaveTextContent('Story S2');
    expect(screen.getByTestId('story-card')).toHaveTextContent('S2-out-of-stock');
  });

  it('S4-A5: the real EPIC: every story renders its story view with each criterion', () => {
    const view = realEpic();
    for (const s of storiesOf(view.prd)) {
      const { unmount } = render(<StoryView view={view} storyId={s.id} onOpenBox={() => undefined} />);
      expect(screen.getByTestId('story-view')).toHaveTextContent(`Story ${s.id}`);
      for (const c of s.acceptance) expect(screen.getByTestId(`story-criterion-${c.id}`)).toBeInTheDocument();
      unmount();
    }
  });
});

describe('use cases (S7-A1)', () => {
  it('S7-A1: actors on the left, one use case per writing box, grouped by story, with tags', async () => {
    const { user } = await start();
    await user.click(screen.getByTestId('nav-usecases'));
    expect(screen.getByTestId('usecase-show-diagram')).toHaveAttribute('aria-pressed', 'true');
    const builder = screen.getByTestId('usecase-actor-builder');
    expect(builder).toHaveTextContent('Builder');
    expect(builder).toHaveTextContent('human');
    expect(within(screen.getByTestId('usecase-group-S1')).getByText(/^S1 · /)).toBeInTheDocument();
    expect(screen.getAllByTestId(/^usecase-(cart|pay|ship)$/).map((el) => el.dataset.testid)).toEqual(['usecase-cart', 'usecase-pay', 'usecase-ship']);
    expect(screen.getByTestId('usecase-tag-cart-0')).toHaveTextContent('writes Order.id');
    expect(screen.getByTestId('usecase-tag-cart-1')).toHaveTextContent('Order.status new → draft');
    expect(screen.getByTestId('usecase-tag-ship-0')).toHaveTextContent('Order.status paid → shipped');
    expect(screen.getByTestId('usecase-link-builder-cart')).toBeInTheDocument();
    expect(screen.getByTestId('usecase-link-system-ship')).toBeInTheDocument();
    expect(screen.queryByTestId('usecase-link-builder-pay')).not.toBeInTheDocument();
  });

  it('S7-A1: a role that writes nothing shows "read only"', async () => {
    const view = reviewEpic();
    view.simulation!.permissionMatrix.auditor = { Order: ['read'] };
    view.simulation!.permissionBoxes.auditor = { Order: { read: ['pay'] } };
    const { user } = await start(view);
    await user.click(screen.getByTestId('nav-usecases'));
    expect(screen.getByTestId('usecase-readonly-auditor')).toHaveTextContent('read only: Order');
    expect(screen.queryByTestId('usecase-readonly-builder')).not.toBeInTheDocument();
  });

  it('S7-A1: a click or Enter on a use case opens its box', async () => {
    const { user } = await start();
    await user.click(screen.getByTestId('nav-usecases'));
    const pay = screen.getByTestId('usecase-pay');
    expect(pay).toHaveAccessibleName('Open box Charge the buyer (pay); System; Order.status draft → paid');
    pay.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('nav-flow')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('contract-path')).toHaveTextContent('pay');
  });

  it('S7-A1: the old matrix stays behind the "Table" toggle', async () => {
    const { user } = await start();
    await user.click(screen.getByTestId('nav-usecases'));
    expect(screen.queryByTestId('matrix-cell-builder-Order')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('usecase-show-table'));
    expect(screen.getByTestId('usecase-show-table')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('matrix-cell-builder-Order')).toBeInTheDocument();
    await user.click(screen.getByTestId('usecase-show-diagram'));
    expect(screen.getByTestId('usecase-cart')).toBeInTheDocument();
  });

  it('S7-A1: the real EPIC shows every role as an actor and every writing box as a use case', async () => {
    const view = realEpic();
    const { user } = await start(view);
    await user.click(screen.getByTestId('nav-usecases'));
    for (const role of roles(view)) expect(screen.getByTestId(`usecase-actor-${role}`)).toBeInTheDocument();
    const writers = new Set(Object.values(view.simulation!.permissionBoxes).flatMap((byEntity) => Object.values(byEntity ?? {}).flatMap((a) => [...(a?.write ?? []), ...(a?.transition ?? [])])));
    expect(writers.size).toBeGreaterThan(0);
    for (const path of writers) expect(screen.getByTestId(`usecase-${path}`)).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('usecase-readonly-ci')).toHaveTextContent('read only');
    expect(screen.getByTestId('usecase-sign-off')).toHaveTextContent('Story.status draft → signed');
  });
});
