// T16: the architecture view (page 8), the before / after of the system (page 11) and a story's
// before / after tab (page 12), drawn in the app. Layout and diff numbers are tested in
// architecture-model.test.ts; here: what shows, what the toggles and tabs do, by mouse and key.

import { fireEvent, render, screen, within } from '@testing-library/react';
import { compareSystem } from '@rehearse/core';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { ArchitectureView } from '../src/components/ArchitectureView.js';
import { BeforeAfterView } from '../src/components/BeforeAfterView.js';
import { StoryView } from '../src/components/StoryView.js';
import type { ReviewEpicView } from '../src/contract.js';
import { codeGraphEpic, codeGraphNoPrd, realEpic, reviewEpic } from './fixture.js';
import { mockServer } from './mock-server.js';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

async function start(view: ReviewEpicView) {
  mockServer({ epic: () => view });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId('big-picture');
  return user;
}

describe('T16 2 architecture view (page 8)', () => {
  it('T16 2 Big picture has the T14 views plus Architecture · Before / after; Feature map stays the default', async () => {
    const user = await start(realEpic());
    const views = screen.getByTestId('bpv-switch');
    expect(within(views).getAllByRole('button').map((b) => b.textContent)).toEqual(['Feature map', 'User flow', 'Data flow', 'System flowchart', 'Architecture', 'Before / after']);
    expect(screen.getByTestId('bpv-features')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByTestId('bpv-architecture'));
    expect(screen.getByTestId('architecture-view')).toBeInTheDocument();
    expect(screen.queryByTestId('big-picture')).toBeNull();
    expect(screen.getByTestId('bpv-architecture')).toHaveAttribute('aria-pressed', 'true');
  });

  it('T16 2 the keyboard reaches the switcher: Tab to it, Enter opens Architecture', async () => {
    const user = await start(realEpic());
    screen.getByTestId('bpv-architecture').focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('architecture-view')).toBeInTheDocument();
    await user.tab();
    expect(screen.getByTestId('bpv-before-after')).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByTestId('before-after')).toBeInTheDocument();
  });

  it('T16 2 the real docs/system/ draws its zones with names, the parts, the labelled links, a legend and the notes', () => {
    render(<ArchitectureView view={realEpic()} />);
    for (const z of ['bb', 'agent', 'repo', 'ci']) expect(screen.getByTestId(`arch-zone-${z}`)).toBeInTheDocument();
    expect(screen.getByTestId('arch-zone-repo').textContent).toMatch(/\w/);
    expect(screen.getByTestId('arch-part-cli')).toHaveTextContent('serve');
    expect(screen.getByTestId('arch-part-builder')).toBeInTheDocument();
    expect(screen.getByTestId('arch-part-graph')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^arch-link-/).length).toBe(20);
    expect(screen.getAllByTestId(/^arch-link-/).some((l) => (l.querySelector('.arch-link-label')?.textContent ?? '') !== '')).toBe(true);
    expect(within(screen.getByTestId('arch-legend')).getByText(/trust zone/)).toBeInTheDocument();
    const notes = screen.getByTestId('arch-notes');
    expect(within(notes).getByText('Trust')).toBeInTheDocument();
    expect(within(notes).getByText('Warning')).toBeInTheDocument();
    expect(screen.queryByTestId('arch-findings')).toBeNull();
    expect(screen.getByRole('group', { name: /System architecture: 4 zones/ })).toBeInTheDocument();
  });

  it('T16 2 with an EPIC change it draws the to-be: the new part stands in its zone, said in words', () => {
    render(<ArchitectureView view={codeGraphEpic()} />);
    expect(screen.getByText(/This is the to-be/)).toBeInTheDocument();
    const graph = screen.getByTestId('arch-part-graph');
    expect(graph).toHaveTextContent('@rehearse/graph');
    expect(screen.getByRole('group', { name: /\(to-be\)/ })).toBeInTheDocument();
  });

  it('T16 2 with no docs/system/architecture.yaml it says so in words and shows how to add one', () => {
    const view = reviewEpic();
    delete view.system;
    delete view.compare;
    render(<ArchitectureView view={view} />);
    const empty = screen.getByTestId('arch-empty');
    expect(empty).toHaveTextContent('This repo has no docs/system/architecture.yaml');
    expect(within(empty).getByLabelText('Example docs/system/architecture.yaml')).toHaveTextContent('zones:');
    expect(screen.queryByTestId('arch-map')).toBeNull();
  });
});

describe('T16 3 before / after of the system (page 11)', () => {
  it('T16 3 side by side: before has no new part; after shows it added, in words and colour', () => {
    render(<BeforeAfterView view={codeGraphEpic()} />);
    const before = screen.getByTestId('ba-arch-before');
    const after = screen.getByTestId('ba-arch-after');
    expect(within(before).queryByTestId('arch-part-graph')).toBeNull();
    const graph = within(after).getByTestId('arch-part-graph');
    expect(graph).toHaveAttribute('data-status', 'added');
    expect(graph).toHaveClass('is-added');
    expect(graph).toHaveTextContent('added');
    expect(within(after).getByTestId('arch-part-cli')).toHaveTextContent('changed');
    expect(within(after).getByTestId('arch-link-cli-graph')).toHaveTextContent('new link');
    expect(within(screen.getByTestId('arch-legend')).getByText('New link')).toBeInTheDocument();
    expect(within(screen.getByTestId('arch-legend')).getByText('Removed (dashed)')).toBeInTheDocument();
  });

  it('T16 3 the toggles are pressed buttons; the keyboard switches mode and subject', async () => {
    const user = userEvent.setup();
    render(<BeforeAfterView view={codeGraphEpic()} />);
    expect(within(screen.getByRole('group', { name: 'What to compare' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Architecture', 'Flow', 'Entities']);
    expect(within(screen.getByRole('group', { name: 'How to show it' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Side by side', 'After with diff', 'Before only']);
    expect(screen.getByTestId('ba-mode-side')).toHaveAttribute('aria-pressed', 'true');

    screen.getByTestId('ba-mode-diff').focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('ba-mode-diff')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('ba-mode-side')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('ba-arch-diff')).toBeInTheDocument();
    expect(screen.queryByTestId('ba-arch-after')).toBeNull();

    await user.tab();
    await user.keyboard(' ');
    expect(screen.getByTestId('ba-arch-before')).toBeInTheDocument();
    expect(screen.queryByTestId('ba-arch-diff')).toBeNull();

    await user.click(screen.getByTestId('ba-subject-flow'));
    await user.click(screen.getByTestId('ba-mode-diff'));
    const flow = await screen.findByTestId('ba-flow-diff');
    expect(within(flow).getByTestId('ba-box-grep-code')).toHaveTextContent('removed');
    expect(within(flow).getByTestId('ba-box-grep-code')).toHaveClass('is-removed');
    expect(within(flow).getByTestId('ba-box-ask-context')).toHaveTextContent('added');

    await user.click(screen.getByTestId('ba-subject-entities'));
    await user.click(screen.getByTestId('ba-mode-side'));
    expect(within(screen.getByTestId('ba-entities-before')).queryByTestId('ba-entities-before-GraphNode')).toBeNull();
    expect(within(screen.getByTestId('ba-entities-after')).getByTestId('ba-entities-after-GraphNode')).toHaveTextContent('added');
  });

  it('T16 3 Changes in this EPIC: change, part, before, after, why, story; counts in words', () => {
    render(<BeforeAfterView view={codeGraphEpic()} />);
    const table = screen.getByTestId('ba-changes');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Change', 'Part', 'Before', 'After', 'Why', 'Story']);
    expect(screen.getByTestId('ba-counts')).toHaveTextContent(/added/);
    const graph = screen.getByTestId('ba-row-part graph');
    expect(graph).toHaveTextContent('added');
    expect(graph).toHaveTextContent('G2');
    expect(graph).toHaveTextContent('S1');
    expect(screen.queryByText('no story yet')).toBeNull();
  });

  it('T16 3 before prd.yaml the story column says no story yet', () => {
    render(<BeforeAfterView view={codeGraphNoPrd()} />);
    const rows = within(screen.getByTestId('ba-changes')).getAllByRole('row').slice(1);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r).toHaveTextContent('no story yet');
  });

  it('T16 3 an EPIC with no change says so and shows how to add one', () => {
    render(<BeforeAfterView view={realEpic()} />);
    const empty = screen.getByTestId('ba-empty');
    expect(empty).toHaveTextContent('This EPIC has no architecture.yaml');
    expect(within(empty).getByLabelText('Example architecture.yaml of an EPIC')).toHaveTextContent('change: added');
    expect(screen.queryByRole('group', { name: 'What to compare' })).toBeNull();
  });
});

describe('T42 2 before / after → Flow is a flow chart', () => {
  const boxIn = (side: HTMLElement, path: string) => within(side).queryByTestId(`ba-box-${path}`);
  const nodeOf = (side: HTMLElement, path: string) => side.querySelector(`.react-flow__node[data-id="box:${path}"]`) as HTMLElement;

  it('T42 2 side by side: the as-is root on the left, the EPIC root on the right, each a chart of its boxes', async () => {
    const user = userEvent.setup();
    render(<BeforeAfterView view={codeGraphEpic()} />);
    await user.click(screen.getByTestId('ba-subject-flow'));
    const before = await screen.findByTestId('ba-flow-before');
    const after = screen.getByTestId('ba-flow-after');
    // Before: the flow as built, no status; the boxes this EPIC adds are not there.
    expect(boxIn(before, 'draft-record')).toHaveAttribute('data-status', '');
    expect(boxIn(before, 'ask-context')).toBeNull();
    // After: each box and edge in its status look.
    expect(boxIn(after, 'ask-context')).toHaveAttribute('data-status', 'added');
    expect(boxIn(after, 'ask-context')).toHaveClass('is-added');
    expect(boxIn(after, 'draft-record')).toHaveAttribute('data-status', 'changed');
    expect(boxIn(after, 'validate')).toHaveAttribute('data-status', 'same');
    expect(boxIn(after, 'grep-code')).toBeNull();
    // Cards are gone from the Flow subject.
    expect(screen.queryByTestId('ba-flow-diff-ask-context')).toBeNull();
  });

  it('T42 2 after with diff: one chart with every box and edge, the removed ones dashed red', async () => {
    const user = userEvent.setup();
    render(<BeforeAfterView view={codeGraphEpic()} />);
    await user.click(screen.getByTestId('ba-subject-flow'));
    await user.click(screen.getByTestId('ba-mode-diff'));
    const diff = await screen.findByTestId('ba-flow-diff');
    expect(screen.queryByTestId('ba-flow-before')).toBeNull();
    expect(boxIn(diff, 'grep-code')).toHaveAttribute('data-status', 'removed');
    expect(boxIn(diff, 'ask-context')).toHaveAttribute('data-status', 'added');
    expect(boxIn(diff, 'draft-record')).toHaveAttribute('data-status', 'changed');
  });

  it('T42 2 before only: the as-is chart alone, without status', async () => {
    const user = userEvent.setup();
    render(<BeforeAfterView view={codeGraphEpic()} />);
    await user.click(screen.getByTestId('ba-subject-flow'));
    await user.click(screen.getByTestId('ba-mode-before'));
    const before = await screen.findByTestId('ba-flow-before');
    expect(screen.queryByTestId('ba-flow-after')).toBeNull();
    expect(within(before).getAllByTestId(/^ba-box-/).map((b) => b.dataset.testid)).toEqual(['ba-box-start', 'ba-box-draft-record', 'ba-box-validate', 'ba-box-sign-off', 'ba-box-done']);
    expect(before.querySelector('.ba-box.is-added, .ba-box.is-changed, .ba-box.is-removed')).toBeNull();
  });

  it('T42 2 a click on a box of the EPIC opens the box drawer; a box only the as-is flow has does not', async () => {
    const user = userEvent.setup();
    const onOpenBox = vi.fn();
    render(<BeforeAfterView view={codeGraphEpic()} onOpenBox={onOpenBox} />);
    await user.click(screen.getByTestId('ba-subject-flow'));
    await user.click(screen.getByTestId('ba-mode-diff'));
    const diff = await screen.findByTestId('ba-flow-diff');
    // A plain click: user-event's mousedown trips d3-zoom in jsdom.
    fireEvent.click(within(diff).getByTestId('ba-box-draft-record'));
    expect(onOpenBox).toHaveBeenCalledWith('draft-record');
    fireEvent.click(within(diff).getByTestId('ba-box-grep-code'));
    expect(onOpenBox).toHaveBeenCalledTimes(1);
  });

  it('T42 2 a box stands in the same place on both sides', async () => {
    const user = userEvent.setup();
    render(<BeforeAfterView view={codeGraphEpic()} />);
    await user.click(screen.getByTestId('ba-subject-flow'));
    const before = await screen.findByTestId('ba-flow-before');
    const after = screen.getByTestId('ba-flow-after');
    for (const path of ['start', 'draft-record', 'validate', 'sign-off', 'done']) {
      expect(nodeOf(before, path).style.transform).toBeTruthy();
      expect(nodeOf(before, path).style.transform).toBe(nodeOf(after, path).style.transform);
    }
  });

  it('T42 2 no docs/system/flow.yaml: the Before side says so, the After side draws the EPIC', async () => {
    const user = userEvent.setup();
    const view = codeGraphEpic();
    const system = { ...view.system!, flow: undefined };
    render(<BeforeAfterView view={{ ...view, system, compare: compareSystem(system, view) }} />);
    await user.click(screen.getByTestId('ba-subject-flow'));
    expect(await screen.findByTestId('ba-flow-before-none')).toHaveTextContent('no docs/system/flow.yaml');
    expect(boxIn(screen.getByTestId('ba-flow-after'), 'draft-record')).toBeInTheDocument();
  });
});

describe('T16 4 story before / after tab (page 12)', () => {
  it('T16 4 the story view has WHAT and Before / after tabs; WHAT (the story page) is the default and holds the scenario cards', async () => {
    const user = userEvent.setup();
    render(
      <StoryView view={codeGraphEpic()} storyId="S1" onOpenBox={() => undefined}>
        <p data-testid="scenario-cards">cards</p>
      </StoryView>,
    );
    expect(screen.getByTestId('story-tab-what')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('story-what')).toBeInTheDocument();
    expect(screen.getByTestId('scenario-cards')).toBeInTheDocument();
    screen.getByTestId('story-tab-before-after').focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('story-tab-before-after')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('story-ba')).toBeInTheDocument();
    expect(screen.queryByTestId('story-what')).toBeNull();
    expect(screen.queryByTestId('scenario-cards')).toBeNull();
  });

  it('T16 4 the story boxes before and after, in lanes, with status in words', async () => {
    const user = userEvent.setup();
    render(<StoryView view={codeGraphEpic()} storyId="S1" onOpenBox={() => undefined} />);
    await user.click(screen.getByTestId('story-tab-before-after'));
    const before = screen.getByTestId('story-ba-before');
    const after = screen.getByTestId('story-ba-after');
    expect(within(before).getByTestId('story-ba-before-grep-code')).toHaveAttribute('data-status', 'removed');
    expect(within(before).queryByTestId('story-ba-before-ask-context')).toBeNull();
    expect(within(after).getByTestId('story-ba-after-ask-context')).toHaveTextContent('added');
    expect(within(after).queryByTestId('story-ba-after-grep-code')).toBeNull();
    expect(within(after).getByTestId('story-ba-after-part:graph-db')).toHaveTextContent('added');
    expect(within(after).getByText('Files')).toBeInTheDocument();
    expect(screen.getByTestId('story-ba-summary')).toHaveTextContent('added: 4 boxes, 2 entities, 1 NFR, 1 file');
  });

  it('T16 4 What changes in this story: a table with links to the boxes', async () => {
    const user = userEvent.setup();
    const onOpenBox = vi.fn();
    render(<StoryView view={codeGraphEpic()} storyId="S1" onOpenBox={onOpenBox} />);
    await user.click(screen.getByTestId('story-tab-before-after'));
    const table = screen.getByTestId('story-ba-changes');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Change', 'Item', 'Before', 'After', 'Why']);
    expect(screen.getByTestId('story-ba-row-requirement R2')).toHaveTextContent('less than 100 ms');
    await user.click(within(table).getByRole('button', { name: /Open box check freshness/ }));
    expect(onOpenBox).toHaveBeenCalledWith('check-freshness');
    // A step outside the record has no box to open.
    expect(within(screen.getByTestId('story-ba-row-box grep-code')).queryByRole('button')).toBeNull();
  });

  it('T16 4 Impact on the current system: the as-is boxes, the frozen stories and the scenarios still to write', async () => {
    const user = userEvent.setup();
    render(<StoryView view={codeGraphEpic()} storyId="S1" onOpenBox={() => undefined} />);
    await user.click(screen.getByTestId('story-tab-before-after'));
    const impact = screen.getByTestId('story-ba-impact');
    expect(screen.getByTestId('story-ba-frozen')).toHaveTextContent('stays valid');
    expect(screen.getByTestId('story-ba-frozen')).toHaveTextContent('2026-11-05-rehearse story S2, which is frozen');
    expect(within(screen.getByTestId('story-ba-touches')).getByRole('button', { name: /Open box draft-record/ })).toBeInTheDocument();
    expect(within(impact).getByText('2026-11-05-rehearse S2')).toBeInTheDocument();
    expect(screen.getByTestId('story-ba-scenarios')).toHaveTextContent('Scenarios: 0 written, 4 new boxes.');
    expect(screen.getByTestId('story-ba-scenarios')).toHaveClass('impact-warn');
  });

  it('T16 4 an EPIC with no change says so on the tab', async () => {
    const user = userEvent.setup();
    render(<StoryView view={reviewEpic()} storyId="S1" onOpenBox={() => undefined} />);
    await user.click(screen.getByTestId('story-tab-before-after'));
    expect(screen.getByTestId('story-ba-empty')).toHaveTextContent('This EPIC has no architecture.yaml');
  });
});
