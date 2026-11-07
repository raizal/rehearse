// One map per story (S22, T57): the union of a story's scenario paths, the active one highlighted,
// the branch marker and header, the collapsed shared opening and how its steps count as seen, and
// the review order that follows the map.

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import type { ScenarioView } from '../src/api.js';
import { StoryCard } from '../src/components/Storyboard.js';
import { branchMarkers, mapElements, REJOIN_TEXT } from '../src/components/StoryMapChart.js';
import type { ReviewEpicView } from '../src/contract.js';
import { branchesOf, layoutStoryMap, mapOf, seenContext, sharedRowText, sharedSeenText } from '../src/model/branches.js';
import { approveReason } from '../src/model/review.js';
import { allSeen, markSeen, seenOnMain, seenSteps, stepKey, type SeenState } from '../src/model/seen.js';
import { nextToApprove, queueOf } from '../src/model/storyboard.js';
import { realEpic, reviewEpic } from './fixture.js';
import { mockServer } from './mock-server.js';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const NO = 'the answer to "Item in stock?" is no';

/**
 * The shop EPIC with two more scenarios of S1: S1-nostock goes the main path's first two steps
 * (same examples) and leaves it at "Item in stock?"; S1-otherpay pays with another example.
 */
function shop(mainPath?: string): ReviewEpicView {
  const view = reviewEpic();
  const buy = view.scenarios.find((s) => s.scenario.id === 'S1-buy')!;
  const variant = (id: string, title: string, edit: (sv: ScenarioView) => void): ScenarioView => {
    const sv = structuredClone(buy);
    sv.scenario.id = id;
    sv.scenario.title = title;
    sv.scenario.status = 'draft';
    delete sv.scenario.approval;
    sv.status = 'draft';
    sv.hash = `sha256:${id}`;
    edit(sv);
    return sv;
  };
  const nostock = variant('S1-nostock', 'The item is out of stock', (sv) => {
    sv.scenario.steps = [sv.scenario.steps[0]!, sv.scenario.steps[1]!, { name: 'in-stock', branch: 'no' }, { name: 'failed' }];
  });
  const otherpay = variant('S1-otherpay', 'The buyer pays another order', (sv) => {
    sv.scenario.steps[1] = { ...sv.scenario.steps[1]!, example: { id: 'pay-other', given: { orderId: 'o2' }, then: { orderId: 'o2' } } };
  });
  const at = view.scenarios.findIndex((s) => s.scenario.id === 'S1-empty');
  view.scenarios.splice(at + 1, 0, nostock, otherpay);
  if (mainPath) view.review = { mainPath: { S1: mainPath } };
  return view;
}

const svOf = (view: ReviewEpicView, id: string) => view.scenarios.find((s) => s.scenario.id === id)!;

const approveFor = (view: ReviewEpicView) => ({
  reasonFor: (s: ScenarioView) => approveReason(s, view.approvals),
  approvals: view.approvals,
  selected: new Set<string>(),
  onToggle: () => {},
  onApprove: () => {},
  disabled: false,
});

/** The seen state with steps `indexes` of `sv` seen on its own storyboard. */
const seenOn = (state: SeenState, sv: ScenarioView, indexes: number[]): SeenState => indexes.reduce((s, i) => markSeen(s, sv, i), state);

describe('the story map: one map per story (S22)', () => {
  it('draws a box many scenarios cross once, and every scenario path on it', () => {
    const view = shop();
    const map = mapOf(view, 'S1');
    const paths = map.nodes.map((n) => n.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const id of ['S1-buy', 'S1-empty', 'S1-nostock', 'S1-otherpay']) {
      const sv = svOf(view, id);
      expect(map.steps[id]!.map((n) => map.nodes.find((x) => x.id === n)!.path), id).toEqual(sv.scenario.steps.map((s) => s.name));
    }
    // Cart is crossed by the four scenarios and drawn once.
    expect(map.nodes.find((n) => n.path === 'cart')!.scenarios.sort()).toEqual(['S1-buy', 'S1-empty', 'S1-nostock', 'S1-otherpay']);
    // The main path is the spine: S1-buy, the path the others follow the furthest.
    expect(map.branches.mainId).toBe('S1-buy');
    expect(map.nodes.filter((n) => n.main).map((n) => n.path)).toEqual(['cart', 'pay', 'in-stock', 'ship/pack']);
    // Every path is a line: each scenario has its own edge out of the box where it leaves.
    const { edges } = mapElements({ map, layout: layoutStoryMap(map), prefix: 'x' });
    const no = edges.find((e) => e.label === 'no' && (e.data as { scenarios: string[] }).scenarios.includes('S1-nostock'))!;
    expect(no.className).toContain('is-taken');
    expect(no.className).not.toContain('is-main');
  });

  it('on a storyboard the active path is in full colour; the others are faded, not hidden, and out of the tab order', () => {
    const view = shop();
    render(<StoryCard view={view} sv={svOf(view, 'S1-empty')} seen={{}} onSeen={() => {}} approve={approveFor(view)} />);
    const chart = screen.getByTestId('card-flow');
    // S1-empty's own steps are buttons; S1-buy's pay is on the map, faded.
    expect(within(chart).getByTestId('card-step-1').tagName).toBe('BUTTON');
    const pay = within(chart).getByTestId('card-map-node-pay');
    expect(pay).toHaveClass('is-faded');
    expect(pay).toHaveAttribute('aria-hidden', 'true');
    expect(pay.tagName).toBe('DIV');
    expect(pay).not.toHaveAttribute('tabindex');
    expect(pay.closest('button')).toBeNull();
    // The model: lines of the active path are is-active, the rest is-faded.
    const map = mapOf(view, 'S1');
    const { edges } = mapElements({
      map,
      layout: layoutStoryMap(map),
      prefix: 'card',
      active: { scenarioId: 'S1-empty', steps: [], current: 0, seen: new Set(), onPick: () => {}, onKey: () => {}, refFn: () => {} },
    });
    const mine = edges.filter((e) => e.className!.includes('is-active'));
    expect(mine).toHaveLength(2);
    expect(edges.filter((e) => !e.className!.includes('is-active')).every((e) => e.className!.includes('is-faded'))).toBe(true);
  });

  it('a box no scenario of the story reaches is still a ghost, as on the one-path chart', () => {
    const real = realEpic();
    const story = real.prd!.stories.find((s) => mapOf(real, s.id).ghosts.length > 0)!;
    const map = mapOf(real, story.id);
    const { nodes } = mapElements({ map, layout: layoutStoryMap(map), prefix: 'glance' });
    expect(nodes.filter((n) => n.type === 'smghost')).toHaveLength(map.ghosts.length);
  });
});

describe('branch marker and header (S22)', () => {
  it('the header says "Main path" or "Branch of the main path at <step>: when <condition>"', () => {
    const view = shop();
    const { unmount } = render(<StoryCard view={view} sv={svOf(view, 'S1-buy')} seen={{}} onSeen={() => {}} approve={approveFor(view)} />);
    expect(screen.getByTestId('card-branch')).toHaveTextContent(/^Main path$/);
    expect(screen.queryByTestId('card-marker-branch')).toBeNull();
    unmount();
    render(<StoryCard view={view} sv={svOf(view, 'S1-nostock')} seen={{}} onSeen={() => {}} approve={approveFor(view)} />);
    expect(screen.getByTestId('card-branch')).toHaveTextContent(`Branch of the main path at Item in stock?: when ${NO}`);
  });

  it('"Branches here: when <condition>" marks the branch point; "Joins the main path again" marks where it comes back', () => {
    const view = shop();
    const { unmount } = render(<StoryCard view={view} sv={svOf(view, 'S1-nostock')} seen={{}} onSeen={() => {}} approve={approveFor(view)} />);
    const marker = screen.getByTestId('card-marker-branch');
    expect(marker).toHaveTextContent(`Branches here: when ${NO}`);
    expect(marker.parentElement).toContainElement(screen.getByTestId('card-step-3'));
    expect(screen.getByTestId('card-step-3')).toHaveAccessibleName(new RegExp(`Branches here: when ${NO.replace(/[?"]/g, '.')}$`));
    expect(screen.queryByTestId('card-marker-rejoin')).toBeNull();
    unmount();
    // S1-empty starts at another box and joins the main path at the cart.
    render(<StoryCard view={view} sv={svOf(view, 'S1-empty')} seen={{}} onSeen={() => {}} approve={approveFor(view)} />);
    expect(screen.getByTestId('card-marker-rejoin')).toHaveTextContent(REJOIN_TEXT);
    expect(screen.getByTestId('card-marker-rejoin').parentElement).toContainElement(screen.getByTestId('card-step-2'));
    expect(REJOIN_TEXT).toBe('Joins the main path again');
  });

  it('the markers come from the branch: none on the main path, both on a branch that comes back', () => {
    const view = shop();
    const b = branchesOf(view, 'S1').branches;
    expect(branchMarkers(b.find((x) => x.scenarioId === 'S1-buy'))).toEqual({});
    expect(branchMarkers(b.find((x) => x.scenarioId === 'S1-nostock'))).toEqual({ branchAt: 'in-stock', branchText: `Branches here: when ${NO}` });
  });
});

describe('the collapsed opening and how its steps count as seen (S22)', () => {
  it('the shared opening is one row; playback starts at the branch point', async () => {
    const view = shop();
    const user = userEvent.setup();
    render(<StoryCard view={view} sv={svOf(view, 'S1-nostock')} seen={{}} onSeen={() => {}} approve={approveFor(view)} />);
    expect(screen.getByTestId('card-shared-toggle')).toHaveTextContent('Same as the main path up to Charge the buyer (2 steps)');
    expect(screen.getByTestId('card-shared-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('card-step-count')).toHaveTextContent('Step 3 of 4');
    expect(screen.getByTestId('card-prev-step')).toBeDisabled();
    await user.click(screen.getByTestId('card-next-step'));
    expect(screen.getByTestId('card-step-count')).toHaveTextContent('Step 4 of 4');
    // Play from the end starts again at the branch point, not at step 1.
    await user.click(screen.getByTestId('card-play'));
    expect(screen.getByTestId('card-step-count')).toHaveTextContent('Step 3 of 4');
  });

  it('the main path and a branch that shares no step have no collapsed row', () => {
    const view = shop();
    const { unmount } = render(<StoryCard view={view} sv={svOf(view, 'S1-buy')} seen={{}} onSeen={() => {}} approve={approveFor(view)} />);
    expect(screen.queryByTestId('card-shared')).toBeNull();
    unmount();
    render(<StoryCard view={view} sv={svOf(view, 'S1-empty')} seen={{}} onSeen={() => {}} approve={approveFor(view)} />);
    expect(screen.queryByTestId('card-shared')).toBeNull();
    expect(screen.getByTestId('card-step-count')).toHaveTextContent('Step 1 of 3');
  });

  it('a shared step seen on the main path counts as seen: same name, branch and example', () => {
    const view = shop();
    const buy = svOf(view, 'S1-buy');
    const nostock = svOf(view, 'S1-nostock');
    const opening = seenContext(view, nostock)!;
    expect(opening).toEqual({ main: buy, shared: 2 });
    let seen = seenOn({}, buy, [0, 1]);
    expect(seenOnMain(seen, nostock, opening)).toEqual(new Set([0, 1]));
    expect(allSeen(seen, nostock, opening)).toBe(false);
    seen = seenOn(seen, nostock, [2, 3]);
    expect(allSeen(seen, nostock, opening)).toBe(true);
    // Without the opening (the rule off), only the steps seen here count.
    expect(allSeen(seen, nostock)).toBe(false);
    // A step with the same box but another example is another step: S1-otherpay shares one step.
    const otherpay = svOf(view, 'S1-otherpay');
    const other = seenContext(view, otherpay)!;
    expect(other.shared).toBe(1);
    expect(stepKey(otherpay.scenario.steps[1])).not.toBe(stepKey(buy.scenario.steps[1]));
    expect(seenOnMain(seen, otherpay, other)).toEqual(new Set([0]));
  });

  it('seen on the main path at an old version does not count; seen on another branch does not count', () => {
    const view = shop();
    const buy = svOf(view, 'S1-buy');
    const nostock = svOf(view, 'S1-nostock');
    const opening = seenContext(view, nostock)!;
    const old = seenOn({}, buy, [0, 1]);
    const changed = { ...old, 'S1-buy': { ...old['S1-buy']!, hash: 'sha256:before' } };
    expect(seenOnMain(changed, nostock, opening).size).toBe(0);
    const viaBranch = seenOn({}, svOf(view, 'S1-otherpay'), [0]);
    expect(seenOnMain(viaBranch, nostock, opening).size).toBe(0);
    // The steps of the main path also live by index, as before (an entry with no content keys).
    const legacy: SeenState = { 'S1-buy': { hash: buy.hash, steps: [0, 1] } };
    expect(seenSteps(legacy, nostock, opening)).toEqual(new Set([0, 1]));
  });

  it('seen on the main path: the row says so and Approve turns on after the different part', () => {
    const view = shop();
    const nostock = svOf(view, 'S1-nostock');
    const seen = seenOn(seenOn({}, svOf(view, 'S1-buy'), [0, 1]), nostock, [2, 3]);
    render(<StoryCard view={view} sv={nostock} seen={seen} onSeen={() => {}} approve={approveFor(view)} />);
    expect(screen.getByTestId('card-shared-seen')).toHaveTextContent('seen on the main path');
    expect(screen.getByTestId('card-seen')).toHaveTextContent('4 of 4 steps seen.');
    expect(screen.getByTestId('card-approve')).toBeEnabled();
  });

  it('not seen on the main path: the row says so and Approve stays off', () => {
    const view = shop();
    const nostock = svOf(view, 'S1-nostock');
    const seen = seenOn({}, nostock, [2, 3]);
    render(<StoryCard view={view} sv={nostock} seen={seen} onSeen={() => {}} approve={approveFor(view)} />);
    expect(screen.getByTestId('card-shared-seen')).toHaveTextContent('not seen yet on the main path — expand to see 2 steps');
    expect(screen.getByTestId('card-seen')).toHaveTextContent('2 of 4 steps seen.');
    expect(screen.getByTestId('card-approve')).toBeDisabled();
  });

  it('expanding shows the shared steps and marks them seen here; Approve turns on', () => {
    const view = shop();
    const nostock = svOf(view, 'S1-nostock');
    let seen = seenOn({}, nostock, [2, 3]);
    const onSeen = vi.fn((sv: ScenarioView, i: number) => {
      seen = markSeen(seen, sv, i);
    });
    const { rerender } = render(<StoryCard view={view} sv={nostock} seen={seen} onSeen={onSeen} approve={approveFor(view)} />);
    fireEvent.click(screen.getByTestId('card-shared-toggle'));
    expect(screen.getByTestId('card-shared-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('card-shared-1-title')).toHaveTextContent('Check out the cart');
    expect(screen.getByTestId('card-shared-2-title')).toHaveTextContent('Charge the buyer');
    expect(onSeen.mock.calls.map((c) => c[1])).toEqual([0, 1]);
    rerender(<StoryCard view={view} sv={nostock} seen={seen} onSeen={onSeen} approve={approveFor(view)} />);
    expect(screen.getByTestId('card-shared-seen')).toHaveTextContent(/^seen$/);
    expect(screen.getByTestId('card-approve')).toBeEnabled();
    // Expanded, playback covers the whole path again.
    expect(screen.getByTestId('card-prev-step')).toBeEnabled();
  });

  it('the row texts', () => {
    expect(sharedRowText('Charge the buyer', 2)).toBe('Same as the main path up to Charge the buyer (2 steps)');
    expect(sharedRowText('Check out the cart', 1)).toBe('Same as the main path up to Check out the cart (1 step)');
    expect(sharedSeenText(2, false)).toBe('not seen yet on the main path — expand to see 2 steps');
    expect(sharedSeenText(0, true)).toBe('seen on the main path');
  });
});

describe('the review order follows the map (S22)', () => {
  it('the queue lists the main path first, then the branches in the order they leave it; the owner pick changes it', () => {
    const order = (v: ReviewEpicView) => queueOf(v).find((g) => g.storyId === 'S1')!.scenarios.map((s) => s.scenario.id);
    // S1-otherpay leaves at step 2, S1-nostock at step 3; S1-empty starts apart.
    expect(order(shop())).toEqual(['S1-buy', 'S1-otherpay', 'S1-nostock', 'S1-empty']);
    expect(order(shop('S1-nostock'))[0]).toBe('S1-nostock');
  });

  it('Next follows the map order', () => {
    const view = shop();
    const queue = queueOf(view).flatMap((g) => g.scenarios);
    // S1-buy is approved; next after it is the first branch, not file order (S1-empty).
    expect(nextToApprove(queue, 'S1-buy', view.approvals)).toBe('S1-otherpay');
    expect(nextToApprove(queue, 'S1-otherpay', view.approvals)).toBe('S1-nostock');
  });

  it('the story page shows the map under "The story at a glance", and the cards in map order with their branch', async () => {
    const view = shop();
    mockServer({ epic: () => view });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('big-picture');
    await user.click(screen.getByTestId('nav-stories'));
    await user.click(await screen.findByTestId('queue-story-S1'));
    const glance = await screen.findByTestId('story-glance');
    expect(within(glance).getByRole('heading', { name: 'The story at a glance' })).toBeInTheDocument();
    expect(within(glance).getByTestId('glance-map')).toBeInTheDocument();
    // Above the scenario cards.
    expect(glance.compareDocumentPosition(screen.getByTestId('story-scenario-S1-buy')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const cards = screen.getAllByTestId(/^story-scenario-S1-[a-z]+$/).map((el) => el.dataset.testid!.replace('story-scenario-', ''));
    expect(cards).toEqual(['S1-buy', 'S1-otherpay', 'S1-nostock', 'S1-empty']);
    expect(screen.getByTestId('story-scenario-branch-S1-buy')).toHaveTextContent('Main path');
    expect(screen.getByTestId('story-scenario-branch-S1-nostock')).toHaveTextContent(`Branch at Item in stock?: ${NO}`);
    // Each branch opens its scenario.
    await act(async () => {
      await user.click(within(glance).getByTestId('glance-branch-S1-nostock'));
    });
    expect(await screen.findByTestId('story-card')).toHaveTextContent('S1-nostock');
    expect(screen.getByTestId('card-branch')).toHaveTextContent(`Branch of the main path at Item in stock?: when ${NO}`);
  });
});
