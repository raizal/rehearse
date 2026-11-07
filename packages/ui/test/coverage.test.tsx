// S12 (EPIC 2026-11-05-code-graph, T43): unit test coverage on the boxes. The badge text and colour,
// the folder sum, the gutter mark words; the box drawer header, its swimlane boxes, the Big picture
// feature map and the story flow chart read `GET api/graph?verb=coverage` once (the mock server answers it).

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoxesCoverage, CoverageStats } from '@rehearse/server';
import { App } from '../src/App.js';
import { badgeText, badgeTitle, coverageTone, lineMark, sumStats } from '../src/model/coverage.js';
import { reviewEpic } from './fixture.js';
import { mockServer } from './mock-server.js';

const st = (covered: number, lines: number, tests: number, stale = false): CoverageStats => ({
  lines, covered, branches: 0, branchesCovered: 0, percent: lines === 0 ? null : Math.floor((covered * 100) / lines), tests, stale,
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  window.history.replaceState(null, '', '#/');
});

describe('S12-A1 the badge', () => {
  it('says percent and tests; green from 80%, orange from 50%, red below, grey with no data', () => {
    expect(badgeText(st(72, 100, 3))).toBe('72% · 3 tests');
    expect(badgeText(st(1, 1, 1))).toBe('100% · 1 test');
    expect(badgeText(undefined)).toBe('no coverage data');
    expect(badgeText(st(0, 0, 0))).toBe('no coverage data');
    expect([st(80, 100, 0), st(79, 100, 0), st(50, 100, 0), st(49, 100, 0), undefined].map(coverageTone)).toEqual(['good', 'fair', 'fair', 'poor', 'none']);
    expect(badgeTitle(st(7, 10, 2, true))).toBe('Unit tests run 7 of 10 lines; 2 tests call it. coverage is older than this code; run the tests again');
  });

  it('a folder adds up its files: lines, branches, tests, stale', () => {
    expect(sumStats([st(9, 10, 1), st(1, 10, 0, true), undefined])).toEqual({ lines: 20, covered: 10, branches: 0, branchesCovered: 0, percent: 50, tests: 1, stale: true });
    expect(sumStats([undefined])).toBeUndefined();
    expect(sumStats([st(0, 0, 0)])?.percent).toBeNull();
  });

  it('S12-A2 the gutter mark words', () => {
    expect(lineMark({ n: 1, state: 'run', hits: 4 })).toEqual({ cls: 'cov-run', label: 'run 4×' });
    expect(lineMark({ n: 1, state: 'missed', branch: 'none', branches: { found: 2, hit: 0 } })).toEqual({ cls: 'cov-missed cov-branch', label: 'not run · no branch taken (0 of 2)' });
    expect(lineMark({ n: 1, state: 'none' })).toBeUndefined();
  });
});

const COVERAGE: BoxesCoverage = {
  ok: true,
  boxes: { ship: st(15, 20, 4), 'ship/pack': st(9, 10, 3), 'ship/send': st(6, 10, 1, true), cart: st(2, 10, 1) },
  info: { found: true, reports: [{ path: 'coverage/lcov.info', mtimeMs: 1, files: 3 }] },
};

function start(coverage: BoxesCoverage | undefined, hash: string) {
  window.history.replaceState(null, '', hash);
  const asked: string[] = [];
  mockServer({
    epic: () => reviewEpic(),
    graph: (q) => (asked.push(q.toString()), q.get('verb') === 'coverage' && coverage ? { status: 200, body: coverage } : { status: 404, body: { ok: false, error: 'no route' } }),
  });
  render(<App />);
  return { asked, user: userEvent.setup() };
}

describe('S12-A1 the boxes carry their coverage', () => {
  it('the box drawer header has the badge; a box with children totals its children; its swimlane boxes have theirs', async () => {
    const { asked } = start(COVERAGE, '#/bigpicture?box=ship');
    const d = await screen.findByTestId('box-drawer');
    const badge = await within(d).findByTestId('drawer-coverage');
    expect(badge).toHaveTextContent('75% · 4 tests');
    expect(badge).toHaveAttribute('data-tone', 'fair');
    const steps = within(d).getByTestId('drawer-steps');
    expect(await within(steps).findByTestId('box-coverage-ship/pack')).toHaveTextContent('90%');
    expect(within(steps).getByTestId('box-coverage-ship/pack')).toHaveAttribute('data-tone', 'good');
    expect(within(steps).getByTestId('box-coverage-ship/send')).toHaveTextContent('⟳');
    expect(within(steps).getByTestId('box-coverage-ship/send').getAttribute('title')).toContain('run the tests again');
    expect(asked.filter((q) => q === 'verb=coverage')).toHaveLength(1);
  });

  it('a box with no code says "no coverage data" in grey in the drawer, and nothing on the diagrams', async () => {
    start(COVERAGE, '#/bigpicture?box=pay');
    const badge = await screen.findByTestId('drawer-coverage');
    expect(badge).toHaveTextContent('no coverage data');
    expect(badge).toHaveAttribute('data-tone', 'none');
  });

  it('S12-A5 no coverage file: the drawer has the one plain line on how to make one, the diagrams no badge', async () => {
    // serve still sends the boxes with code, with no numbers
    const none: BoxesCoverage = { ok: true, boxes: { ship: st(0, 0, 0), 'ship/pack': st(0, 0, 0) }, info: { found: false, reports: [], hint: 'No coverage file yet. Run `pnpm coverage` to write coverage/lcov.info in each package.' } };
    start(none, '#/bigpicture?box=ship');
    expect(await screen.findByTestId('drawer-coverage-hint')).toHaveTextContent('No coverage file yet. Run `pnpm coverage`');
    expect(screen.getByTestId('drawer-coverage')).toHaveTextContent('no coverage data');
    // no grey pill on every box of the diagrams
    expect(screen.queryByTestId('box-coverage-ship/pack')).toBeNull();
    expect(screen.queryByTestId('bp-coverage-ship')).toBeNull();
  });

  it('no graph on the server: no badge and no hint', async () => {
    start(undefined, '#/bigpicture?box=ship');
    await screen.findByTestId('box-drawer');
    await waitFor(() => expect(screen.queryByTestId('drawer-coverage')).toBeNull());
    expect(screen.queryByTestId('drawer-coverage-hint')).toBeNull();
  });

  it('the Big picture feature map: each process with code has its badge, a box with no code none', async () => {
    start(COVERAGE, '#/bigpicture');
    await screen.findByTestId('big-picture');
    const ship = await screen.findByTestId('bp-coverage-ship');
    expect(ship).toHaveTextContent('75%');
    expect(ship).toHaveAttribute('data-tone', 'fair');
    expect(screen.getByTestId('bp-coverage-cart')).toHaveAttribute('data-tone', 'poor');
    expect(screen.queryByTestId('bp-coverage-pay')).toBeNull();
  });

  it('the story flow chart: each step with code has its badge', async () => {
    const { user } = start(COVERAGE, '#/');
    await screen.findByTestId('big-picture');
    await user.click(screen.getByTestId('nav-stories'));
    await user.click(await screen.findByTestId('queue-story-S1'));
    await user.click(await screen.findByTestId('story-scenario-open-S1-buy'));
    const flow = await screen.findByTestId('card-flow');
    expect(await within(flow).findByTestId('card-coverage-1')).toHaveTextContent('20%');
    expect(within(flow).getByTestId('card-coverage-1')).toHaveAttribute('data-tone', 'poor');
  });
});
