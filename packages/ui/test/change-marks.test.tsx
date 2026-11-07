// T62: a small change (`changes/C1.yaml`) adds criteria, scenarios and boxes to a signed story.
// Each item that the change added says "New in C1" on the story page, the review queue, the story
// map, the storyboard and the Status page; the mark holds the change title.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import type { StatusRow, StatusTable } from '../src/api.js';
import type { ReviewEpicView } from '../src/contract.js';
import { changeRef, storyChanges } from '../src/model/changes.js';
import { queueRows, scenarioSummary } from '../src/model/storypage.js';
import { storyDetail } from '../src/model/storyview.js';
import { CHANGE_TITLE, reviewEpic, withChange } from './fixture.js';
import { mockServer } from './mock-server.js';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  window.history.replaceState(null, '', '#/');
});

async function start(view: ReviewEpicView = withChange(reviewEpic())) {
  mockServer({ epic: () => view });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId('big-picture');
  await user.click(screen.getByTestId('nav-stories'));
  await screen.findByTestId('story-scenarios');
  return { user, view };
}

function expectMark(el: HTMLElement) {
  expect(el).toHaveTextContent('New in C1');
  expect(el).toHaveClass('change-mark');
  expect(el).toHaveAttribute('title', CHANGE_TITLE);
}

describe('model: the change of an item (T62)', () => {
  it('a marked criterion and scenario name their change with its title; the others have none', () => {
    const view = withChange(reviewEpic());
    const criteria = storyDetail(view, 'S1').criteria;
    expect(criteria.find((c) => c.criterion.id === 'S1-A2')?.change).toEqual({ id: 'C1', title: CHANGE_TITLE });
    expect(criteria.find((c) => c.criterion.id === 'S1-A1')?.change).toBeUndefined();
    const retry = view.scenarios.find((sv) => sv.scenario.id === 'S1-retry')!;
    expect(scenarioSummary(view, retry).change).toEqual({ id: 'C1', title: CHANGE_TITLE });
    expect(queueRows(view).map((r) => [r.storyId, r.changes.map((c) => c.id)])).toEqual([
      ['S1', ['C1']],
      ['S2', []],
    ]);
  });

  it('a change that the view does not list has no title, and a view with no changes gives none', () => {
    expect(changeRef({}, { change: 'C9' })).toEqual({ id: 'C9' });
    expect(changeRef({}, {})).toBeUndefined();
    expect(storyChanges({}, 'S1')).toEqual([]);
  });
});

describe('"New in C1" in the review (T62)', () => {
  it('the story page marks the change criterion and the change scenario card', async () => {
    await start();
    expectMark(screen.getByTestId('story-criterion-change-S1-A2'));
    expect(screen.queryByTestId('story-criterion-change-S1-A1')).toBeNull();
    expectMark(screen.getByTestId('story-scenario-change-S1-retry'));
    expect(screen.queryByTestId('story-scenario-change-S1-buy')).toBeNull();
  });

  it('the review queue marks the story that has the change, and says it in the row name', async () => {
    await start();
    expectMark(screen.getByTestId('queue-change-S1-C1'));
    expect(screen.queryByTestId('queue-change-S2-C1')).toBeNull();
    expect(screen.getByTestId('queue-story-S1')).toHaveAccessibleName(/; new in C1$/);
  });

  it('the story map marks the change scenario beside its path and the change box on the map', async () => {
    await start();
    const glance = screen.getByTestId('story-glance');
    expectMark(within(glance).getByTestId('glance-change-S1-retry'));
    expect(within(glance).queryByTestId('glance-change-S1-buy')).toBeNull();
    expectMark(within(glance).getByTestId('glance-map-node-pay-change'));
  });

  it('the storyboard of the change scenario marks the scenario and its criterion', async () => {
    const { user } = await start();
    await user.click(screen.getByTestId('story-scenario-open-S1-retry'));
    await waitFor(() => expect(screen.getByTestId('story-card')).toHaveTextContent('S1-retry'));
    expectMark(screen.getByTestId('card-change'));
    expectMark(screen.getByTestId('card-criterion-change'));
  });

  it('the storyboard of a signed scenario has no change mark', async () => {
    const { user } = await start();
    await user.click(screen.getByTestId('story-scenario-open-S1-buy'));
    await waitFor(() => expect(screen.getByTestId('story-card')).toHaveTextContent('S1-buy'));
    expect(screen.queryByTestId('card-change')).toBeNull();
    expect(screen.queryByTestId('card-criterion-change')).toBeNull();
  });

  it('the Status page marks the row of the story that has the change', async () => {
    const view = withChange(reviewEpic());
    const row = (id: string): StatusRow => ({
      id,
      title: `Story ${id}`,
      signed: { state: 'changed', text: 'changed since signed' },
      built: { built: 0, boxes: 2, text: '0 of 2 boxes', evidence: [] },
      e2e: { approved: 0, passed: 0, failed: 0, notRun: 0, notWritten: 0, text: 'none yet', tone: 'muted' },
      unit: { text: 'not run', tone: 'muted' },
      done: { state: 'in-progress', text: 'not done' },
      seenWorking: false,
      missing: [],
    });
    const table: StatusTable = {
      slug: view.slug,
      title: 'Shop',
      header: '0 of 2 stories done · 0 seen working on the real screens · 2 not done',
      counts: { stories: 2, done: 0, seen: 0, notDone: 2, doneNotSeen: 0, checked: 0 },
      rows: [row('S1'), row('S2')],
      sources: { commit: 'main', graph: 'none', e2e: 'none', unit: 'none' },
    };
    window.history.replaceState(null, '', '#/status');
    mockServer({ epic: () => view, status: () => ({ status: 200, body: { ok: true, status: table } }) });
    render(<App />);
    expectMark(await screen.findByTestId('status-change-S1-C1'));
    expect(within(screen.getByTestId('status-row-S1')).getByRole('rowheader')).toHaveTextContent('S1 Story S1New in C1');
    expect(screen.queryByTestId('status-change-S2-C1')).toBeNull();
  });

  it('a view with no changes shows no mark', async () => {
    await start(reviewEpic());
    expect(document.querySelector('.change-mark')).toBeNull();
  });
});
