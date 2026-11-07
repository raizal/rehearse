// T58 (S23, boxes status-view, status-table, whats-missing, status-sources, status-page): the
// Status page. One row per story, not done first; the seven columns; what is missing says who
// acts; the filters count; a row opens the story's progress; the sources say where facts come from.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import type { StatusRow, StatusTable, StoryProgress, ThreadOutcome } from '../src/api.js';
import { StatusPage, type StatusPageApi } from '../src/components/StatusPage.js';
import { mockServer } from './mock-server.js';
import { reviewEpic } from './fixture.js';
import { builtTone, doneTone, filterCount, filterStatusRows, signedTone } from '../src/model/status.js';

const NOW = new Date(2026, 10, 8, 12, 0).getTime();
const ok = <T,>(body: T): ThreadOutcome<T> => ({ kind: 'ok', body });

function row(id: string, over: Partial<StatusRow> = {}): StatusRow {
  return {
    id,
    title: `Story ${id}`,
    signed: { state: 'yes', text: 'yes' },
    built: { built: 3, boxes: 3, text: '3 of 3 boxes', evidence: [] },
    e2e: { approved: 2, passed: 2, failed: 0, notRun: 0, notWritten: 0, text: '2 of 2 passed', tone: 'good' },
    unit: { text: '4 of 4 passed', tone: 'good', tests: 4, passed: 4, failed: 0 },
    done: { state: 'done', text: 'done · seen working on the real screens' },
    seenWorking: true,
    missing: [],
    ...over,
  };
}

/** Not done first (S2, S5), then done but not seen working (S3), then seen working (S1). */
const TABLE: StatusTable = {
  slug: '2026-11-05-shop',
  title: 'Shop',
  header: '2 of 4 stories done · 1 seen working on the real screens · 2 not done',
  counts: { stories: 4, done: 2, seen: 1, notDone: 2, doneNotSeen: 1, checked: 0 },
  rows: [
    row('S2', {
      signed: { state: 'no', text: 'no' },
      built: { built: 2, boxes: 3, text: '2 of 3 — 1 left', evidence: [] },
      e2e: { approved: 1, passed: 0, failed: 0, notRun: 0, notWritten: 1, text: 'none yet', tone: 'muted' },
      unit: { text: 'not run', tone: 'muted' },
      done: { state: 'in-progress', text: 'not done' },
      seenWorking: false,
      missing: [
        { text: '1 box not built (checkout/pay)', who: 'builders', blocking: true },
        { text: 'sign off', who: 'you', blocking: true },
      ],
    }),
    row('S5', {
      signed: { state: 'changed', text: 'changed since signed' },
      unit: { text: '1 failed, 2 of 3 passed', tone: 'bad', tests: 3, passed: 2, failed: 1 },
      done: { state: 'in-progress', text: 'not done' },
      seenWorking: false,
      missing: [{ text: 'an automated test fails', who: 'builders', blocking: true }],
    }),
    row('S3', {
      e2e: { approved: 2, passed: 0, failed: 0, notRun: 0, notWritten: 2, text: 'none yet', tone: 'muted' },
      done: { state: 'done', text: 'done · checked by automated tests' },
      seenWorking: false,
      missing: [{ text: 'no real-screen test yet', who: 'test thread', blocking: false }],
    }),
    row('S1'),
  ],
  sources: {
    commit: 'main @ abc1234, 2026-11-07',
    graph: 'the code graph, updated 2026-11-07 10:30, and Flow-Box commits',
    e2e: 'Birdview results not found: no data folder',
    unit: 'no unit report: run pnpm test:report',
  },
};

const PROGRESS: StoryProgress = {
  slug: '2026-11-05-shop',
  storyId: 'S2',
  boxes: [
    { path: 'checkout/pay', title: 'Pay', built: false, state: 'not-built', evidence: { path: 'checkout/pay', title: 'Pay', kind: 'process', state: 'not-built', commits: [], code: [], text: 'not built: no Flow-Box commit names it or a box inside it' }, commits: 0, onThreadBranch: 0, branches: [] },
  ],
  scenarios: [{ id: 'S2-buy', title: 'Buy', state: 'missing' }],
  draftScenarios: [],
  gate: [],
  signOff: { status: 'none', valid: false },
  planChanged: false,
  counts: { boxes: 1, boxesWithCode: 0, scenarios: 1, scenariosTested: 0, scenariosPassing: 0 },
  summary: '0 of 1 boxes have code · 0 of 1 scenarios tested',
} as unknown as StoryProgress;

function fakeApi(table: ThreadOutcome<StatusTable> = ok(TABLE)) {
  const api: StatusPageApi = { status: vi.fn(async () => table), progress: vi.fn(async () => ok(PROGRESS)) };
  return api;
}

const ids = () => within(screen.getByTestId('status-table')).getAllByRole('row').slice(1).map((r) => r.getAttribute('data-testid'));

describe('StatusPage', () => {
  it('shows the header, the seven columns, not done first, and who acts', async () => {
    const api = fakeApi();
    render(<StatusPage slug="2026-11-05-shop" onOpenStory={() => {}} api={api} now={NOW} />);
    expect(screen.getByTestId('status-loading')).toHaveTextContent('rehearse reads signatures, commits, the code graph and test results');
    expect(await screen.findByTestId('status-header')).toHaveTextContent('2 of 4 stories done · 1 seen working on the real screens · 2 not done');
    expect(api.status).toHaveBeenCalledWith('2026-11-05-shop');
    const heads = within(screen.getByTestId('status-table')).getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual(['Story', 'Signed', 'Built', 'Tests on the real screens', 'Automated tests', 'Done', "What's missing — who acts"]);
    expect(ids()).toEqual(['status-row-S2', 'status-row-S5', 'status-row-S3', 'status-row-S1']);
    expect(screen.getByTestId('status-signed-S2')).toHaveTextContent('no');
    expect(screen.getByTestId('status-built-S2')).toHaveTextContent('2 of 3 — 1 left');
    expect(screen.getByTestId('status-e2e-S2')).toHaveTextContent('none yet');
    expect(screen.getByTestId('status-unit-S5')).toHaveTextContent('1 failed, 2 of 3 passed');
    expect(screen.getByTestId('status-done-S2')).toHaveTextContent('not done');
    expect(within(screen.getByTestId('status-missing-S2')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1 box not built (checkout/pay): builders', 'sign off: you']);
    expect(screen.getByTestId('status-missing-S3')).toHaveTextContent('no real-screen test yet: test thread');
    expect(screen.getByTestId('status-missing-S1')).toHaveTextContent('—');
    // Tones follow the row.
    expect(screen.getByTestId('status-done-S2')).toHaveClass('tone-bad');
    expect(screen.getByTestId('status-done-S3')).toHaveClass('tone-warn');
    expect(screen.getByTestId('status-done-S1')).toHaveClass('tone-good');
  });

  it('names where the facts come from, with their dates', async () => {
    render(<StatusPage slug="2026-11-05-shop" onOpenStory={() => {}} api={fakeApi()} now={NOW} />);
    expect(await screen.findByTestId('status-source-commit')).toHaveTextContent('Commit: main @ abc1234, 2026-11-07');
    expect(screen.getByTestId('status-source-graph')).toHaveTextContent('Built: the code graph, updated 2026-11-07 10:30, and Flow-Box commits');
    expect(screen.getByTestId('status-source-e2e')).toHaveTextContent('Tests on the real screens: Birdview results not found: no data folder');
    expect(screen.getByTestId('status-source-unit')).toHaveTextContent('Automated tests: no unit report: run pnpm test:report');
  });

  it('filters: All, Not done, Done but not seen working, with their counts', async () => {
    render(<StatusPage slug="2026-11-05-shop" onOpenStory={() => {}} api={fakeApi()} now={NOW} />);
    await screen.findByTestId('status-table');
    expect(screen.getByTestId('status-filter-all')).toHaveTextContent('All (4)');
    expect(screen.getByTestId('status-filter-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('status-filter-not-done')).toHaveTextContent('Not done (2)');
    expect(screen.getByTestId('status-filter-done-not-seen')).toHaveTextContent('Built but not seen working (1)');
    await userEvent.click(screen.getByTestId('status-filter-not-done'));
    expect(screen.getByTestId('status-filter-not-done')).toHaveAttribute('aria-pressed', 'true');
    expect(ids()).toEqual(['status-row-S2', 'status-row-S5']);
    await userEvent.click(screen.getByTestId('status-filter-done-not-seen'));
    expect(ids()).toEqual(['status-row-S3']);
    await userEvent.click(screen.getByTestId('status-filter-all'));
    expect(ids()).toHaveLength(4);
  });

  it('an empty filter says so', async () => {
    const allDone: StatusTable = { ...TABLE, header: '1 of 1 stories done · 1 seen working on the real screens · 0 not done', counts: { stories: 1, done: 1, seen: 1, notDone: 0, doneNotSeen: 0, checked: 0 }, rows: [row('S1')] };
    render(<StatusPage slug="2026-11-05-shop" onOpenStory={() => {}} api={fakeApi(ok(allDone))} now={NOW} />);
    await userEvent.click(await screen.findByTestId('status-filter-not-done'));
    expect(screen.getByTestId('status-empty')).toHaveTextContent('Every story is done.');
    await userEvent.click(screen.getByTestId('status-filter-done-not-seen'));
    expect(screen.getByTestId('status-empty')).toHaveTextContent('No story is built but not seen working.');
  });

  it('a row opens the story progress view, and "Open story" opens the story', async () => {
    const api = fakeApi();
    const onOpenStory = vi.fn();
    render(<StatusPage slug="2026-11-05-shop" onOpenStory={onOpenStory} api={api} now={NOW} />);
    await userEvent.click(await screen.findByTestId('status-row-S2'));
    expect(screen.getByTestId('status-row-S2')).toHaveAttribute('aria-expanded', 'true');
    const detail = screen.getByTestId('status-detail-S2');
    expect(await within(detail).findByTestId('story-progress-evidence-checkout/pay')).toHaveTextContent('not built: no Flow-Box commit names it');
    expect(api.progress).toHaveBeenCalledWith('S2');
    await userEvent.click(within(detail).getByTestId('status-open-S2'));
    expect(onOpenStory).toHaveBeenCalledWith('S2');
    // Clicking again closes it; Enter opens another.
    await userEvent.click(screen.getByTestId('status-row-S2'));
    expect(screen.queryByTestId('status-detail-S2')).toBeNull();
    fireEvent.keyDown(screen.getByTestId('status-row-S5'), { key: 'Enter' });
    expect(screen.getByTestId('status-detail-S5')).toBeInTheDocument();
  });

  it('a progress that cannot be read says so, and Open story still works', async () => {
    const api = fakeApi();
    api.progress = vi.fn(async () => ({ kind: 'error', status: 500, message: 'boom' }) as const);
    render(<StatusPage slug="2026-11-05-shop" onOpenStory={() => {}} api={api} now={NOW} />);
    await userEvent.click(await screen.findByTestId('status-row-S1'));
    expect(await within(screen.getByTestId('status-detail-S1')).findByText('The progress of S1 could not be read: boom')).toBeInTheDocument();
    expect(screen.getByTestId('status-open-S1')).toHaveTextContent('Open story S1');
  });

  it('an error says the page could not be made; Read again asks again', async () => {
    const api = fakeApi({ kind: 'error', status: 500, message: 'the EPIC could not be read' });
    render(<StatusPage slug="2026-11-05-shop" onOpenStory={() => {}} api={api} now={NOW} />);
    expect(await screen.findByTestId('status-error')).toHaveTextContent('The Status page could not be made: the EPIC could not be read');
    const good = fakeApi();
    const { unmount } = render(<StatusPage slug="2026-11-05-shop" onOpenStory={() => {}} api={good} now={NOW} />);
    await userEvent.click(await screen.findByTestId('status-reload'));
    await waitFor(() => expect(good.status).toHaveBeenCalledTimes(2));
    unmount();
  });
});

describe('model/status', () => {
  it('filterStatusRows keeps the server order', () => {
    expect(filterStatusRows(TABLE.rows, 'not-done').map((r) => r.id)).toEqual(['S2', 'S5']);
    expect(filterStatusRows(TABLE.rows, 'done-not-seen').map((r) => r.id)).toEqual(['S3']);
    expect(filterStatusRows(TABLE.rows, 'all').map((r) => r.id)).toEqual(['S2', 'S5', 'S3', 'S1']);
  });
  it('filterCount reads the counts', () => {
    expect([filterCount(TABLE, 'all'), filterCount(TABLE, 'not-done'), filterCount(TABLE, 'done-not-seen')]).toEqual([4, 2, 1]);
  });
  it('tones: done, signed, built', () => {
    const [s2, s5, s3, s1] = TABLE.rows as [StatusRow, StatusRow, StatusRow, StatusRow];
    expect([doneTone(s2), doneTone(s3), doneTone(s1)]).toEqual(['bad', 'warn', 'good']);
    expect([signedTone(s2), signedTone(s5), signedTone(s1)]).toEqual(['bad', 'warn', 'good']);
    expect([builtTone(s2), builtTone(s1), builtTone(row('S9', { built: { built: 0, boxes: 0, text: 'nothing planned', evidence: [] } }))]).toEqual(['bad', 'good', 'muted']);
  });
});

describe('the Status tab in the app', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '#/');
  });

  it('#/status GETs api/status for this EPIC; Open story goes to the story', async () => {
    const view = reviewEpic();
    const asked: string[] = [];
    const s1 = { ...TABLE, slug: view.slug, rows: [row('S1', { done: { state: 'in-progress', text: 'not done' }, seenWorking: false })], counts: { stories: 1, done: 0, seen: 0, notDone: 1, doneNotSeen: 0, checked: 0 }, header: '0 of 1 stories done · 0 seen working on the real screens · 1 not done' };
    window.history.replaceState(null, '', '#/status');
    mockServer({
      epic: () => view,
      status: (epic) => (asked.push(epic), { status: 200, body: { ok: true, status: s1 } }),
      progress: () => ({ status: 200, body: { ok: true, progress: { ...PROGRESS, storyId: 'S1' } } }),
    });
    render(<App />);
    expect(await screen.findByTestId('status-header')).toHaveTextContent('0 of 1 stories done · 0 seen working on the real screens · 1 not done');
    expect(screen.getByTestId('nav-status')).toHaveAttribute('aria-current', 'page');
    expect(asked).toEqual([view.slug]);
    await userEvent.click(screen.getByTestId('status-row-S1'));
    await userEvent.click(await screen.findByTestId('status-open-S1'));
    await waitFor(() => expect(window.location.hash).toBe('#/stories/S1/how'));
  });
});
