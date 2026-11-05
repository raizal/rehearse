// The PRD page and the Tech spec page (T15), drawn in the app. The numbers behind them are tested
// in document-model.test.ts; here: the nav, the legend, that each id link opens its place, the box
// chip contract, filters and show-more, the right panels, and that the real EPIC renders.

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { PrdView } from '../src/components/PrdView.js';
import { TechSpecView } from '../src/components/TechSpecView.js';
import type { ReviewEpicView } from '../src/contract.js';
import { flowPaths } from '../src/model/features.js';
import { realEpic, reviewEpic } from './fixture.js';
import { mockServer } from './mock-server.js';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

async function start(view: ReviewEpicView = reviewEpic(), tab: 'prd' | 'techspec' = 'prd') {
  mockServer({ epic: () => view });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId('big-picture');
  await user.click(screen.getByTestId(`nav-${tab}`));
  await screen.findByTestId(tab === 'prd' ? 'prd-view' : 'techspec-view');
  return { user, view };
}

describe('T15 feature 1: nav', () => {
  it('T15 1 PRD and Tech spec come first in the top nav; the review still opens on the big picture', async () => {
    mockServer({ epic: () => reviewEpic() });
    render(<App />);
    await screen.findByTestId('big-picture');
    expect(screen.getAllByTestId(/^nav-/).map((el) => el.textContent).slice(0, 3)).toEqual(['PRD', 'Tech spec', 'Big picture']);
    expect(screen.getByTestId('nav-bigpicture')).toHaveAttribute('aria-current', 'page');
  });
});

describe('T15 feature 2: links', () => {
  it('T15 2 one legend under each page title says what each colour opens', async () => {
    const { user } = await start();
    const legend = screen.getByTestId('link-legend');
    // Each item is a sample chip from the record, its kind in words for screen readers, and where it goes.
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'requirement R1 → Readiness row',
      'story S1 → Story view',
      'box cart → Flow / Tech spec contract',
      'scenario S1-buy → Storyboard',
      'entity Order → Tech spec entity',
      'decision D1 → Decision log',
    ]);
    expect(screen.getByTestId('doc-source')).toHaveTextContent('Source: prd.yaml');
    await user.click(screen.getByTestId('nav-techspec'));
    expect(within(await screen.findByTestId('techspec-view')).getByTestId('link-legend')).toBeInTheDocument();
  });

  it('T15 2 every id link has its kind colour and a name for screen readers', async () => {
    await start();
    const r1 = within(screen.getByTestId('prd-req-R1')).getByTestId('link-requirement-R1');
    expect(r1).toHaveClass('id-link', 'id-requirement');
    expect(r1).toHaveAccessibleName('Requirement R1: open its Readiness row');
    for (const link of screen.getAllByRole('button').filter((b) => b.classList.contains('id-link'))) expect(link.getAttribute('aria-label')).toMatch(/^(Requirement|Story|Acceptance criterion|Box|Scenario|Entity|Decision|Correction) /);
  });

  it('T15 2 a requirement opens its Readiness row; a story the Story view; a scenario the Storyboard; a box the Flow', async () => {
    const { user } = await start();
    await user.click(within(screen.getByTestId('prd-req-R1')).getByTestId('link-requirement-R1'));
    expect(await screen.findByTestId('readiness-req-R1')).toBeInTheDocument();
    expect(screen.getByTestId('nav-readiness')).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByTestId('nav-prd'));
    await user.click(within(screen.getByTestId('prd-req-R2')).getByTestId('link-story-S2'));
    expect(await screen.findByTestId('story-view')).toHaveTextContent('Story S2');

    await user.click(screen.getByTestId('nav-prd'));
    await user.click(within(screen.getByTestId('prd-story-S1')).getAllByTestId('link-scenario-S1-buy')[0]!);
    expect(await screen.findByTestId('story-card')).toHaveTextContent('S1-buy');

    await user.click(screen.getByTestId('nav-prd'));
    await user.click(within(screen.getByTestId('prd-story-S1')).getByTestId('link-box-pay'));
    expect(await screen.findByTestId('flow-view')).toBeInTheDocument();
    expect(screen.getByTestId('detail-pane')).toHaveTextContent('pay');
  });

  it('T15 2 an entity and a decision open the Tech spec at that item', async () => {
    const view = reviewEpic();
    view.prd!.requirements[0]!.text = 'The buyer pays. (D1)';
    const { user } = await start(view);
    await user.click(within(screen.getByTestId('prd-req-R1')).getByTestId('link-decision-D1'));
    expect(screen.getByTestId('nav-techspec')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('ts-decision-D1')).toHaveClass('is-selected');
    await user.click(within(screen.getByTestId('ts-lifecycle-Order')).getByTestId('link-entity-Order'));
    expect(screen.getByTestId('ts-entity-Order')).toHaveClass('is-selected');
  });

  it('T15 2 hovering or focusing a box chip shows its contract, with Open in Flow and Contract in Tech spec', async () => {
    const { user } = await start();
    const card = screen.getByTestId('prd-story-S1');
    await user.hover(within(card).getByTestId('link-box-pay'));
    const pop = within(card).getByRole('group', { name: 'Contract of box pay' });
    expect(pop).toHaveTextContent('System lane');
    expect(pop).toHaveTextContent('in orderId → out orderId');
    expect(pop).toHaveTextContent(/writes\s*Order\.status: draft → paid/);
    await user.unhover(within(card).getByTestId('link-box-pay'));
    expect(within(card).queryByRole('group', { name: 'Contract of box pay' })).toBeNull();

    // The keyboard reaches it too: focus opens, Escape closes.
    act(() => within(card).getByTestId('link-box-cart').focus());
    expect(within(card).getByRole('group', { name: 'Contract of box cart' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(within(card).queryByRole('group', { name: 'Contract of box cart' })).toBeNull();

    act(() => within(card).getByTestId('link-box-pay').focus());
    await user.click(within(card).getByRole('button', { name: 'Contract in Tech spec' }));
    expect(await screen.findByTestId('ts-panel-pay')).toBeInTheDocument();
  });
});

describe('T15 feature 3: PRD page', () => {
  it('T15 3 contents with counts, the EPIC title, goal, roles with kinds', async () => {
    await start();
    expect(within(screen.getByTestId('prd-contents')).getAllByRole('link').map((a) => a.textContent)).toEqual(['Goal', 'Roles2', 'Requirements3', 'Stories2', 'Out of scope0', 'Resolved questions0']);
    const page = screen.getByTestId('prd-view');
    expect(within(page).getByRole('heading', { level: 1 })).toHaveTextContent('PRD');
    expect(within(page).getByRole('heading', { level: 2, name: 'Shop checkout' })).toBeInTheDocument();
    expect(page).toHaveTextContent(/Builder · human/);
  });

  it('T15 3 the requirements table: kind, text, stories and proof with whether approvals are signed', async () => {
    await start();
    const r1 = screen.getByTestId('prd-req-R1');
    expect(r1).toHaveTextContent('1/2 scenarios approved');
    expect(r1).toHaveTextContent('all approvals signed');
    expect(screen.getByTestId('prd-req-R3')).toHaveTextContent('none');
    expect(screen.getByTestId('prd-req-R3')).toHaveTextContent('no scenarios');
  });

  it('T15 3 kind filters and show N more', async () => {
    const view = reviewEpic();
    for (let i = 4; i <= 9; i++) view.prd!.requirements.push({ id: `R${i}`, kind: 'performance', text: `Fast ${i}.`, provenBy: 'benchmark' });
    const { user } = await start(view);
    const table = screen.getByTestId('prd-requirements');
    expect(within(table).getAllByTestId(/^prd-req-/)).toHaveLength(6);
    await user.click(screen.getByRole('button', { name: 'Show 3 more requirements' }));
    expect(within(table).getAllByTestId(/^prd-req-/)).toHaveLength(9);
    await user.click(screen.getByRole('button', { name: 'functional 3' }));
    expect(screen.getByRole('button', { name: 'functional 3' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(table).getAllByTestId(/^prd-req-/).map((r) => r.dataset.testid)).toEqual(['prd-req-R1', 'prd-req-R2', 'prd-req-R3']);
  });

  it('T15 3 story cards show each acceptance criterion and the scenario that proves it, with its status in words', async () => {
    await start();
    const s1 = screen.getByTestId('prd-story-S1');
    expect(s1).toHaveTextContent('S1-A1');
    expect(within(s1).getAllByTestId('link-scenario-S1-buy').length).toBeGreaterThan(0);
    expect(s1).toHaveTextContent('approved, signature valid');
  });

  it('T15 3 the right panel: text, cited decisions, trace tree, open in rehearse, and a gate note when not proved', async () => {
    const view = reviewEpic();
    view.prd!.requirements[1]!.text = 'Out of stock is caught. (D1)';
    const { user } = await start(view);
    expect(screen.getByTestId('prd-panel-R1')).toBeInTheDocument();
    expect(screen.queryByTestId('gate-note')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Select R2' }));
    const panel = screen.getByTestId('prd-panel-R2');
    expect(within(panel).getByTestId('gate-note')).toHaveTextContent('The scenario of R2 is not approved yet.');
    expect(within(panel).getAllByTestId('link-decision-D1').length).toBeGreaterThan(0);
    const trace = within(panel).getByTestId('trace');
    expect(within(trace).getByTestId('link-story-S2')).toBeInTheDocument();
    expect(within(trace).getByTestId('link-scenario-S2-out-of-stock')).toBeInTheDocument();
    expect(trace).toHaveTextContent('stale');
    await user.click(within(panel).getByRole('button', { name: /^Open in Readiness/ }));
    expect(await screen.findByTestId('readiness-req-R2')).toBeInTheDocument();
  });

  it('T15 3 the real EPIC: every requirement and story on the PRD', () => {
    const view = realEpic();
    render(<PrdView view={view} onGo={() => undefined} />);
    for (const s of view.prd!.stories) expect(screen.getByTestId(`prd-story-${s.id}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Show \d+ more requirements$/ })).toBeInTheDocument();
  });
});

describe('T15 feature 4: Tech spec page', () => {
  it('T15 4 contents, box contracts with decisions, start and end boxes behind show N more', async () => {
    const { user } = await start(reviewEpic(), 'techspec');
    expect(within(screen.getByTestId('ts-contents')).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Box contracts10',
      'Entity model1',
      'Lifecycles1',
      'Non-functional0',
      'Decisions2',
      'Corrections4',
    ]);
    const table = screen.getByTestId('ts-contracts-table');
    expect(within(table).queryByTestId('ts-box-start')).toBeNull();
    expect(within(table).getByTestId('ts-box-pay')).toHaveTextContent('orderId → orderId');
    expect(within(table).getByTestId('ts-box-pay')).toHaveTextContent('Order.status: draft → paid');
    await user.click(screen.getByRole('button', { name: /^Show \d+ more boxes/ }));
    expect(within(table).getByTestId('ts-box-start')).toBeInTheDocument();
  });

  it('T15 4 entity cards, lifecycle diagram with the box for each transition, decisions and corrections', async () => {
    await start(reviewEpic(), 'techspec');
    expect(screen.getByTestId('ts-entity-Order')).toHaveTextContent('status');
    const lc = screen.getByTestId('ts-lifecycle-Order');
    expect(within(lc).getByRole('img')).toHaveAccessibleName('Lifecycle of Order.status: states draft, paid, shipped');
    expect(within(lc).getByRole('list', { name: 'Transitions of Order' })).toHaveTextContent('draft → paid by system');
    expect(within(lc).getAllByTestId('link-box-pay').length).toBeGreaterThan(0);
    expect(screen.getByTestId('ts-decision-log')).toHaveTextContent('D1');
    expect(screen.getByTestId('ts-decision-log')).toHaveTextContent('Cart, pay and ship.');
    expect(screen.getByTestId('ts-corrections')).toHaveTextContent('C1');
  });

  it('T15 4 the right panel for the selected box: contract, traces to, proved by, shown in, change rule', async () => {
    const { user } = await start(reviewEpic(), 'techspec');
    expect(screen.getByTestId('ts-panel-cart')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select box pay' }));
    const panel = screen.getByTestId('ts-panel-pay');
    const contract = within(panel).getByRole('group', { name: 'Contract' });
    expect(contract).toHaveTextContent('inputsorderId');
    expect(contract).toHaveTextContent('outputsorderId');
    expect(contract).toHaveTextContent('Order.status: draft → paid');
    expect(within(panel).getByTestId('link-requirement-R1')).toBeInTheDocument();
    expect(within(panel).getByTestId('link-scenario-S1-buy')).toBeInTheDocument();
    expect(within(panel).getByTestId('change-rule')).toHaveTextContent('makes S1 and its scenarios stale');
    await user.click(within(within(panel).getByRole('list', { name: 'Shown in the tool' })).getByRole('button', { name: /^Open in Flow/ }));
    expect(await screen.findByTestId('flow-view')).toBeInTheDocument();
  });

  it('T15 4 the real EPIC: every box, entity and lifecycle on the Tech spec', async () => {
    const view = realEpic();
    const user = userEvent.setup();
    render(<TechSpecView view={view} onGo={() => undefined} />);
    await user.click(screen.getByRole('button', { name: /^Show \d+ more/ }));
    for (const p of flowPaths(view.flow)) expect(screen.getByTestId(`ts-box-${p}`)).toBeInTheDocument();
    for (const e of view.entities!.entities) expect(screen.getByTestId(`ts-entity-${e.id}`)).toBeInTheDocument();
    for (const id of ['Epic', 'Story', 'Scenario']) expect(screen.getByTestId(`ts-lifecycle-${id}`)).not.toHaveTextContent('no box makes this transition');
    expect(screen.getByTestId('ts-decision-log')).toHaveTextContent('D41');
  });
});
