// T39, box `sign-off`: the sign-off confirmation shows what the owner agrees to, per story, and
// what changed since the story's last sign-off; the story page opens the same preview, read only.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import type { SignOffPreview, SinceSignOff, StorySignOffPreview } from '../src/api.js';
import type { ReviewEpicView } from '../src/contract.js';
import { SIGN_OFF_MEANING } from '../src/components/SignOffPreview.js';
import { reviewEpic, seeAll } from './fixture.js';
import { mockServer, type MockRoutes } from './mock-server.js';

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

/** The fixture with only the findings about S2: S1 can be signed off. */
function s1Clean(): ReviewEpicView {
  const view = reviewEpic();
  view.gate!.findings = view.gate!.findings.filter((f) => f.refs.includes('S2'));
  return view;
}

function story(id: string, since: SinceSignOff): StorySignOffPreview {
  return {
    id,
    found: true,
    since,
    counts: { requirements: 1, criteria: 1, scenarios: 1, boxes: 2 },
    content: {
      story: { id, role: 'buyer', want: 'to pay for my cart', soThat: 'I get my items' },
      requirements: [{ id: 'R1', kind: 'functional', text: 'The buyer pays for an order.' }],
      criteria: [{ id: `${id}-A1`, given: 'a cart with items', when: 'the buyer pays', then: 'the order is paid and shipped' }],
      scenarios: [{ id: `${id}-buy`, title: 'Buy a cart', steps: ['start', 'cart', 'pay', 'done'] }],
      boxes: [
        { path: 'cart', title: 'Check out the cart', kind: 'input', lane: 'buyer', relation: 'serves' },
        { path: 'pay', title: 'Charge the buyer', kind: 'process', lane: 'shop', relation: 'serves' },
      ],
      roles: [
        { id: 'buyer', name: 'Buyer' },
        { id: 'shop', name: 'Shop' },
      ],
    },
  };
}

const AT = { at: '2026-11-05T02:00:00Z', by: 'builder@example.com', hashRule: 2 };
const CHANGED: SinceSignOff = {
  kind: 'changed',
  ...AT,
  commit: { sha: 'a'.repeat(40), short: 'aaaaaaa', subject: 'sign off S1', date: '2026-11-05T02:00:00Z' },
  exact: true,
  changes: [
    {
      part: 'criterion',
      id: 'S1-A1',
      change: 'changed',
      field: 'then',
      before: 'the order is shipped',
      after: 'the order is paid and shipped',
      words: [
        { kind: 'same', text: 'the order is ' },
        { kind: 'added', text: 'paid and ' },
        { kind: 'same', text: 'shipped' },
      ],
      text: 'criterion S1-A1 "then" changed',
    },
    { part: 'scenario', id: 'S1-empty', change: 'removed', text: 'scenario S1-empty removed' },
  ],
};

const reply = (stories: StorySignOffPreview[]) => ({ status: 200, body: { ok: true, stories } satisfies SignOffPreview });

async function start(routes: Partial<MockRoutes>, view: ReviewEpicView = s1Clean()) {
  seeAll(view);
  const server = mockServer({ epic: () => view, ...routes });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId('big-picture');
  return { server, user, view };
}

async function openConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('nav-signoff'));
  await screen.findByTestId('signoff-signer-key');
  await user.click(screen.getByTestId('signoff-story-S1'));
  await user.click(screen.getByTestId('signoff-button'));
  return screen.getByRole('dialog', { name: 'Confirm the sign-off' });
}

describe('T39 the sign-off confirmation shows what you agree to', () => {
  it('says what a sign-off means and the button reads "I agree — sign off S1"', async () => {
    const { user } = await start({ signOffPreview: () => reply([story('S1', { kind: 'first' })]) });
    const dialog = await openConfirm(user);
    expect(within(dialog).getByTestId('signoff-meaning')).toHaveTextContent(SIGN_OFF_MEANING);
    expect(within(dialog).getByTestId('signoff-confirm')).toHaveTextContent('I agree — sign off S1');
    expect(within(dialog).getByTestId('signoff-confirm')).toHaveFocus();
    expect(within(dialog).getByTestId('signoff-cancel')).toBeInTheDocument();
  });

  it('lists per story the sentence, requirements, criteria, scenarios with approval, and boxes, with the counts line', async () => {
    const { server, user } = await start({ signOffPreview: () => reply([story('S1', { kind: 'first' })]) });
    const dialog = await openConfirm(user);
    const s1 = await within(dialog).findByTestId('signoff-preview-S1');
    expect(server.gets('api/sign-off/preview?stories=S1')).toHaveLength(1);
    expect(within(s1).getByTestId('signoff-preview-summary-S1')).toHaveTextContent('You agree to 1 requirement, 1 criterion, 1 scenario and 2 boxes.');
    expect(within(s1).getByTestId('signoff-preview-sentence-S1')).toHaveTextContent('As a Buyer, I want to pay for my cart, so that I get my items.');
    expect(within(s1).getByTestId('signoff-preview-requirements-S1')).toHaveTextContent('R1 The buyer pays for an order.');
    const criteria = within(s1).getByTestId('signoff-preview-criteria-S1');
    expect(criteria).toHaveTextContent('GIVENa cart with items');
    expect(criteria).toHaveTextContent('THENthe order is paid and shipped');
    const scenario = within(s1).getByTestId('signoff-preview-scenario-S1-buy');
    expect(scenario).toHaveTextContent('Buy a cart');
    expect(scenario).toHaveTextContent(/approved by .+ on \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
    expect(within(s1).getByTestId('signoff-preview-sig-S1-buy')).toBeInTheDocument();
    const boxes = within(s1).getByTestId('signoff-preview-boxes-S1');
    expect(boxes).toHaveTextContent('Charge the buyer');
    expect(boxes).toHaveTextContent('Shop · process · serves the story');
    expect(within(s1).getByTestId('signoff-preview-since-S1')).toHaveTextContent('First sign-off of this story.');
  });

  it('a box of the preview opens the box drawer', async () => {
    const { user } = await start({ signOffPreview: () => reply([story('S1', { kind: 'first' })]) });
    const dialog = await openConfirm(user);
    await user.click(await within(dialog).findByTestId('signoff-preview-box-pay'));
    expect(await screen.findByTestId('box-drawer')).toBeInTheDocument();
    expect(window.location.hash).toMatch(/\?box=pay$/);
  });

  it('a changed story lists the changes in plain words with the words added and removed', async () => {
    const { user } = await start({ signOffPreview: () => reply([story('S1', CHANGED)]) });
    const dialog = await openConfirm(user);
    const since = await within(dialog).findByTestId('signoff-preview-since-S1');
    // The session signs as builder@example.com, so the sign-off is "yours".
    expect(since).toHaveTextContent('2 changes since your sign-off on 2026-11-05 02:00 UTC (commit aaaaaaa)');
    const changes = within(since).getByTestId('signoff-preview-changes-S1');
    expect(changes).toHaveTextContent('criterion S1-A1 "then" changed');
    expect(changes).toHaveTextContent('scenario S1-empty removed');
    expect(changes.querySelector('ins')).toHaveTextContent('paid and');
    expect(within(since).queryByTestId('signoff-preview-inexact-S1')).toBeNull();
  });

  it('unchanged, git unavailable, and several stories each in its own collapsible section', async () => {
    const { user, view } = await start({
      signOffPreview: (ids) =>
        reply(ids.map((id) => (id === 'S1' ? story('S1', { kind: 'unchanged', ...AT, by: 'owner@example.com' }) : story(id, { kind: 'unavailable', ...AT, reason: 'the EPIC folder is not in a git repo' })))),
    });
    // Let S2 be selectable too.
    view.gate!.findings = [];
    await user.click(screen.getByTestId('nav-signoff'));
    await screen.findByTestId('signoff-signer-key');
    await user.click(screen.getByTestId('signoff-story-S1'));
    await user.click(screen.getByTestId('signoff-story-S2'));
    await user.click(screen.getByTestId('signoff-button'));
    const dialog = screen.getByRole('dialog', { name: 'Confirm the sign-off' });
    expect(within(dialog).getByTestId('signoff-confirm')).toHaveTextContent('I agree — sign off S1, S2');
    const s1 = await within(dialog).findByTestId('signoff-preview-S1');
    const s2 = within(dialog).getByTestId('signoff-preview-S2');
    expect(s1.tagName).toBe('DETAILS');
    expect(s1).toHaveAttribute('open');
    expect(s2).not.toHaveAttribute('open');
    expect(within(s1).getByTestId('signoff-preview-since-S1')).toHaveTextContent('No change since the sign-off by owner@example.com on 2026-11-05 02:00 UTC.');
    expect(within(s2).getByTestId('signoff-preview-since-S2')).toHaveTextContent('What changed cannot be shown: the EPIC folder is not in a git repo. The content below is the content now.');
  });

  it('a preview that cannot load does not block the sign-off', async () => {
    const { server, user } = await start({
      signOffPreview: () => ({ status: 500, body: { ok: false, error: 'boom' } }),
      signOff: () => ({ status: 200, body: { ok: true, signOff: { by: 'builder@example.com', threadId: 't', at: AT.at, hashRule: 2, storyHashes: {}, sigStatus: 'valid' } } }),
    });
    const dialog = await openConfirm(user);
    expect(await within(dialog).findByTestId('signoff-preview-error')).toBeInTheDocument();
    await user.click(within(dialog).getByTestId('signoff-confirm'));
    await waitFor(() => expect(server.posts('api/sign-off')).toHaveLength(1));
  });
});

describe('T39 the story page opens the sign-off preview, read only', () => {
  it('"What changed" on a stale story shows the preview with no confirm button', async () => {
    const view = s1Clean();
    const { server, user } = await start({ signOffPreview: () => reply([story('S1', CHANGED)]) }, view);
    await user.click(screen.getByTestId('nav-stories'));
    await screen.findByTestId('story-scenarios');
    const link = screen.getByTestId('story-signoff-preview-link');
    expect(link).toHaveAttribute('aria-expanded', 'false');
    await user.click(link);
    const section = await screen.findByTestId('story-signoff-preview');
    expect(await within(section).findByTestId('signoff-preview-changes-S1')).toHaveTextContent('criterion S1-A1 "then" changed');
    expect(within(section).queryByTestId('signoff-confirm')).toBeNull();
    expect(server.posts('api/sign-off')).toHaveLength(0);
    await user.click(within(section).getByTestId('story-signoff-preview-close'));
    expect(screen.queryByTestId('story-signoff-preview')).toBeNull();
  });
});

/** T62: S1 with a small change C1 (a criterion, a scenario and a box) that no sign-off covers. */
function withNewChange(since: SinceSignOff): StorySignOffPreview {
  const s = story('S1', since);
  const c = s.content!;
  c.criteria.push({ id: 'S1-A2', given: 'a declined card', when: 'the buyer pays again', then: 'the order is paid', change: 'C1' });
  c.scenarios.push({ id: 'S1-retry', title: 'Pay again', steps: ['start', 'cart', 'retry', 'done'], change: 'C1' });
  c.boxes.push({ path: 'retry', title: 'Charge the card again', kind: 'process', lane: 'shop', relation: 'serves', change: 'C1' });
  c.changes = [{ id: 'C1', title: 'Pay again after a declined card', why: 'Some cards fail the first time.', file: 'changes/C1.yaml' }];
  return s;
}

describe('T62 the sign-off of a small change shows only what is new', () => {
  it('shows "New in C1" with only the change items, and the rest of the story folded', async () => {
    const { user } = await start({ signOffPreview: () => reply([withNewChange({ ...CHANGED, newChanges: ['C1'] })]) });
    const dialog = await openConfirm(user);
    const s1 = await within(dialog).findByTestId('signoff-preview-S1');
    const added = within(s1).getByTestId('signoff-preview-new-C1');
    expect(within(added).getByRole('heading')).toHaveTextContent('New in C1: Pay again after a declined card');
    expect(added).toHaveTextContent('Some cards fail the first time.');
    expect(within(added).getByTestId('signoff-preview-new-criteria-C1')).toHaveTextContent('S1-A2');
    expect(within(added).getByTestId('signoff-preview-scenario-S1-retry')).toHaveTextContent('Pay again');
    expect(within(added).getByTestId('signoff-preview-new-boxes-C1')).toHaveTextContent('Charge the card again');
    expect(added).not.toHaveTextContent('S1-A1');
    expect(within(added).queryByTestId('signoff-preview-scenario-S1-buy')).toBeNull();
    const rest = within(s1).getByTestId('signoff-preview-rest-S1');
    expect(rest.tagName).toBe('DETAILS');
    expect(rest).not.toHaveAttribute('open');
    expect(within(rest).getByText('The rest of the story is as signed')).toBeInTheDocument();
    expect(within(rest).getByTestId('signoff-preview-criteria-S1')).toHaveTextContent('S1-A1');
    expect(within(rest).getByTestId('signoff-preview-criteria-S1')).not.toHaveTextContent('S1-A2');
    expect(within(rest).getByTestId('signoff-preview-scenario-S1-buy')).toBeInTheDocument();
    expect(within(rest).queryByTestId('signoff-preview-scenario-S1-retry')).toBeNull();
    expect(within(rest).getByTestId('signoff-preview-boxes-S1')).not.toHaveTextContent('Charge the card again');
  });

  it('the since line names the new change when the diff has no other change', async () => {
    const { user } = await start({ signOffPreview: () => reply([withNewChange({ ...CHANGED, changes: [], newChanges: ['C1'] })]) });
    const dialog = await openConfirm(user);
    expect(await within(dialog).findByTestId('signoff-preview-since-S1')).toHaveTextContent('No sign-off covers C1. The rest of the story is as signed.');
  });

  it('with no new change, the change items show in the full story and nothing is folded', async () => {
    const { user } = await start({ signOffPreview: () => reply([withNewChange({ kind: 'first' })]) });
    const dialog = await openConfirm(user);
    const s1 = await within(dialog).findByTestId('signoff-preview-S1');
    expect(within(s1).queryByTestId('signoff-preview-new-C1')).toBeNull();
    expect(within(s1).queryByTestId('signoff-preview-rest-S1')).toBeNull();
    expect(within(s1).getByTestId('signoff-preview-criteria-S1')).toHaveTextContent('S1-A2');
  });

  it('a sign-off under hash rule 3 with no content change is trusted', async () => {
    const same = (hashRule: number): SinceSignOff => ({ ...CHANGED, hashRule, changes: [] });
    const { user } = await start({ signOffPreview: (ids) => reply(ids.map((id) => story(id, same(3)))) });
    const dialog = await openConfirm(user);
    const since = await within(dialog).findByTestId('signoff-preview-since-S1');
    expect(since).toHaveTextContent('No difference in the content was found against that commit.');
    expect(since).not.toHaveTextContent('hash rule 1');
  });

  it('a sign-off under hash rule 1 with no content change asks to sign again for the boxes', async () => {
    const { user } = await start({ signOffPreview: () => reply([story('S1', { ...CHANGED, hashRule: 1, changes: [] })]) });
    const dialog = await openConfirm(user);
    expect(await within(dialog).findByTestId('signoff-preview-since-S1')).toHaveTextContent('that sign-off used hash rule 1, which did not cover the boxes');
  });
});
