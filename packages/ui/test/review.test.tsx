// Approve, permission matrix, readiness and sign-off against a mock fetch of the HTTP contract
// (S6-A1, S7-A1, S8-A1..A3, S9-A1, S9-A2). The real server side is T6.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import type { ReviewEpicView, SignOffView } from '../src/contract.js';
import { FIXTURE_KEY, reviewEpic, seeAll } from './fixture.js';
import { mockServer, SESSION, type MockRoutes } from './mock-server.js';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

/**
 * The app on the flow view, with every step of every scenario seen (Approve is off until then;
 * the gate itself is tested in storyboard.test.tsx).
 */
async function start(routes: Partial<MockRoutes> = {}, view: ReviewEpicView = reviewEpic()) {
  seeAll(view);
  const server = mockServer({ epic: () => view, ...routes });
  const user = userEvent.setup();
  render(<App />);
  fireEvent.click(screen.getByTestId('nav-flow'));
  await screen.findByTestId('box-cart');
  return { server, user, view };
}

const NO_SIGNING = { status: 200, body: { ...SESSION, signing: { ok: false, reason: 'git user.signingkey is not set' } } };

describe('approve (S6-A1)', () => {
  it('S6-A1: draft and stale scenarios have an Approve button; a well-signed approved one shows its signature status', async () => {
    await start();
    await screen.findByTestId('approve-signer-key');
    expect(screen.getByTestId('approve-S1-empty')).toBeEnabled();
    expect(screen.getByTestId('approve-reason-S1-empty')).toHaveTextContent('draft');
    expect(screen.getByTestId('approve-S2-out-of-stock')).toBeEnabled();
    expect(screen.getByTestId('approve-reason-S2-out-of-stock')).toHaveTextContent('stale');
    expect(screen.queryByTestId('approve-S1-buy')).not.toBeInTheDocument();
    expect(screen.getByTestId('sig-status-S1-buy')).toHaveTextContent('signature valid');
    expect(screen.getByTestId('sig-status-S1-buy')).toHaveAttribute('title', `signer key ${FIXTURE_KEY}`);
  });

  it('S6-A1: shows who signs, from the session identity and the key fingerprint', async () => {
    await start();
    expect(await screen.findByTestId('approve-signer-by')).toHaveTextContent('builder@example.com');
    expect(screen.getByTestId('approve-signer')).toHaveTextContent('thr_test');
    expect(screen.getByTestId('approve-signer-key')).toHaveTextContent(FIXTURE_KEY);
  });

  it('S6-A1: Approve posts the scenario id with the session token as JSON, then loads the EPIC again', async () => {
    const view = reviewEpic();
    const { server, user } = await start({}, view);
    await screen.findByTestId('approve-signer-key');
    expect(server.gets('api/epic')).toHaveLength(1);
    // After the approval the record on disk has S1-empty approved and signed.
    const draft = view.scenarios.find((s) => s.scenario.id === 'S1-empty')!;
    draft.status = 'approved';
    view.approvals!['S1-empty'] = { by: 'builder@example.com', at: '2026-11-05T01:00:00Z', signer: FIXTURE_KEY, sigStatus: 'valid' };

    await user.click(screen.getByTestId('approve-S1-empty'));
    const [post] = server.posts('api/approve');
    expect(post!.body).toEqual({ scenarioIds: ['S1-empty'] });
    expect(post!.headers['x-rehearse-token']).toBe('tok-123');
    expect(post!.headers['content-type']).toBe('application/json');
    expect(await screen.findByText('Approved S1-empty.')).toBeInTheDocument();
    await waitFor(() => expect(server.gets('api/epic')).toHaveLength(2));
    await waitFor(() => expect(screen.getByTestId('scenario-status-S1-empty')).toHaveTextContent('approved'));
    expect(screen.queryByTestId('approve-S1-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('sig-status-S1-empty')).toHaveTextContent('signature valid');
  });

  it('S6-A1: approve the selected ones posts every checked scenario', async () => {
    const { server, user } = await start();
    await screen.findByTestId('approve-signer-key');
    expect(screen.getByTestId('approve-selected')).toBeDisabled();
    await user.click(screen.getByTestId('select-S2-out-of-stock'));
    await user.click(screen.getByTestId('select-S1-empty'));
    expect(screen.getByTestId('approve-selected')).toHaveTextContent('Approve selected (2)');
    await user.click(screen.getByTestId('approve-selected'));
    expect(server.posts('api/approve')[0]!.body).toEqual({ scenarioIds: ['S1-empty', 'S2-out-of-stock'] });
    await waitFor(() => expect(screen.getByTestId('approve-selected')).toHaveTextContent('Approve selected (0)'));
  });

  it('S6-A1: playback has an Approve button for the scenario it plays', async () => {
    const { server, user } = await start();
    await screen.findByTestId('approve-signer-key');
    await user.click(screen.getByTestId('scenario-S2-out-of-stock'));
    await user.click(screen.getByTestId('playback-approve'));
    expect(server.posts('api/approve')[0]!.body).toEqual({ scenarioIds: ['S2-out-of-stock'] });
    await user.click(screen.getByTestId('scenario-S1-buy'));
    expect(screen.queryByTestId('playback-approve')).not.toBeInTheDocument();
  });

  it('S6-A1: an approved scenario with a bad, missing or unknown signature can be approved again', async () => {
    const view = reviewEpic();
    view.approvals!['S1-buy']!.sigStatus = 'invalid';
    await start({}, view);
    expect(await screen.findByTestId('sig-status-S1-buy')).toHaveTextContent('bad signature');
    expect(screen.getByTestId('approve-S1-buy')).toHaveAccessibleName('Approve S1-buy (bad signature)');
  });

  it('S6-A1 (C29): when signing is off, the buttons are disabled and the setup steps are shown, with the guide path as text', async () => {
    const { server } = await start({ session: () => NO_SIGNING });
    const blocked = await screen.findByTestId('approve-signer-blocked');
    expect(blocked).toHaveTextContent('git user.signingkey is not set');
    const help = screen.getByTestId('approve-signer-doc');
    expect(help).toHaveTextContent('docs/signing.md');
    expect(help).toHaveTextContent('git config --global gpg.format ssh');
    expect(help).toHaveTextContent('.rehearse/allowed_signers');
    // serve does not serve docs/ (R20): no link that would 404.
    expect(within(help).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByTestId('approve-S1-empty')).toBeDisabled();
    expect(screen.getByTestId('select-S1-empty')).toBeDisabled();
    expect(screen.getByTestId('approve-selected')).toBeDisabled();
    expect(server.posts('api/approve')).toHaveLength(0);
  });

  it('S6-A1: a session that does not load keeps the buttons disabled and says why', async () => {
    await start({ session: () => ({ status: 500, body: {} }) });
    expect(await screen.findByTestId('approve-signer-blocked')).toHaveTextContent('HTTP 500');
    expect(screen.getByTestId('approve-S1-empty')).toBeDisabled();
  });

  it('S6-A1: 409 lists the findings, and the EPIC is not loaded again', async () => {
    const finding = { kind: 'reference', file: 'scenarios', path: 'S1-empty', message: 'scenario S1-empty unknown', refs: [] };
    const { server, user } = await start({ approve: () => ({ status: 409, body: { ok: false, findings: [finding] } }) });
    await screen.findByTestId('approve-signer-key');
    await user.click(screen.getByTestId('approve-S1-empty'));
    expect(await screen.findByTestId('approve-outcome-findings')).toHaveTextContent('scenario S1-empty unknown');
    expect(screen.getByTestId('approve-outcome')).toHaveTextContent('Refused: 1 finding');
    expect(server.gets('api/epic')).toHaveLength(1);
  });

  it('S6-A1: 503 shows the reason with the signing guide; 403 says the request was refused', async () => {
    let reply: { status: number; body: unknown } = { status: 503, body: { ok: false, reason: 'ssh-agent has no key' } };
    const { user } = await start({ approve: () => reply });
    await screen.findByTestId('approve-signer-key');
    await user.click(screen.getByTestId('approve-S1-empty'));
    const outcome = screen.getByTestId('approve-outcome');
    await waitFor(() => expect(outcome).toHaveTextContent('Signing is not available: ssh-agent has no key'));
    expect(within(outcome).getByTestId('approve-outcome-doc')).toHaveTextContent('docs/signing.md');
    expect(within(outcome).queryByRole('link')).not.toBeInTheDocument();

    reply = { status: 403, body: { error: 'bad token' } };
    await user.click(screen.getByTestId('approve-S1-empty'));
    await waitFor(() => expect(outcome).toHaveTextContent('Forbidden: bad token'));
  });
});

/** The permission matrix is the "Table" of the use case view (D42). */
async function openMatrix(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('nav-usecases'));
  await user.click(screen.getByTestId('usecase-show-table'));
}

describe('permission matrix (S7-A1)', () => {
  it('S7-A1: the cell builder × Order × write is marked, with a link to box cart that opens it in the flow view', async () => {
    const { user } = await start();
    await openMatrix(user);
    expect(screen.getByTestId('nav-usecases')).toHaveAttribute('aria-current', 'page');
    const cell = screen.getByTestId('matrix-cell-builder-Order');
    expect(within(cell).getByTestId('matrix-action-builder-Order-write')).toHaveTextContent('write');
    expect(within(cell).getByTestId('matrix-action-builder-Order-transition')).toBeInTheDocument();
    expect(within(cell).queryByTestId('matrix-action-builder-Order-read')).not.toBeInTheDocument();
    expect(screen.getByTestId('matrix-role-builder')).toHaveTextContent('Builder');
    expect(screen.getByTestId('matrix-action-system-Order-read')).toHaveTextContent('pay');

    const link = within(cell).getByTestId('matrix-box-builder-Order-write-cart');
    expect(link).toHaveAccessibleName('Open box cart (builder can write Order)');
    await user.click(link);
    expect(screen.getByTestId('nav-flow')).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByTestId('box-cart')).toBeInTheDocument();
    expect(screen.getByTestId('contract-path')).toHaveTextContent('cart');
  });

  it('S7-A1: a link to a nested box opens its diagram', async () => {
    const view = reviewEpic();
    view.simulation!.permissionBoxes.system!.Order!.write = ['pay', 'ship/send'];
    const { user } = await start({}, view);
    await openMatrix(user);
    await user.click(screen.getByTestId('matrix-box-system-Order-write-ship/send'));
    expect(await screen.findByTestId('box-ship/send')).toBeInTheDocument();
    expect(screen.getByTestId('breadcrumb-ship')).toBeInTheDocument();
    expect(screen.getByTestId('contract-path')).toHaveTextContent('ship/send');
  });

  it('a role with no access to an entity says so in words', async () => {
    const view = reviewEpic();
    view.simulation!.permissionMatrix.system!.Parcel = ['read'];
    view.simulation!.permissionBoxes.system!.Parcel = { read: ['ship/pack'] };
    const { user } = await start({}, view);
    await openMatrix(user);
    expect(screen.getByTestId('matrix-cell-builder-Parcel')).toHaveTextContent('no access');
  });
});

describe('readiness (S8)', () => {
  async function openReadiness() {
    const ctx = await start();
    await ctx.user.click(screen.getByTestId('nav-readiness'));
    return ctx;
  }

  it('S8-A1: a requirement with no story shows "no proof" and the reason', async () => {
    await openReadiness();
    expect(screen.getByTestId('readiness-req-status-R3')).toHaveTextContent('no proof');
    expect(screen.getByTestId('readiness-req-status-R3')).toHaveTextContent('no story links R3');
    expect(screen.getByTestId('readiness-no-proof-R3')).toHaveTextContent('no story links R3');
    expect(screen.getByTestId('readiness-no-proof-R2')).toHaveTextContent('no approved scenario that is not stale for S2');
    expect(screen.getByTestId('readiness-req-status-R1')).toHaveTextContent('proven');
  });

  it('S8-A1 (C28): an approval without a valid signature is not proof, and the view says "approval not signed"', async () => {
    const view = reviewEpic();
    view.approvals!['S1-buy']!.sigStatus = 'missing';
    const { user } = await start({}, view);
    await user.click(screen.getByTestId('nav-readiness'));
    expect(screen.getByTestId('readiness-req-status-R1')).toHaveTextContent('no proof: approval not signed');
    expect(screen.getByTestId('readiness-req-status-R1')).toHaveTextContent('S1-buy (signature missing)');
    expect(screen.getByTestId('readiness-no-proof-reason-R1')).toHaveTextContent('approval not signed');
    expect(screen.getByTestId('readiness-scenario-sig-R1-S1-buy')).toHaveTextContent('not signed');
    // A reason that does not depend on signatures is kept, in words.
    expect(screen.getByTestId('readiness-no-proof-reason-R3')).toHaveTextContent('no story');
  });

  it('S8-A1 (C28): with a valid signature the requirement is proven', async () => {
    const { user } = await start();
    await user.click(screen.getByTestId('nav-readiness'));
    expect(screen.getByTestId('readiness-req-status-R1')).toHaveTextContent('proven');
    expect(screen.getByTestId('readiness-scenario-sig-R1-S1-buy')).toHaveTextContent('signature valid');
    expect(screen.queryByTestId('readiness-no-proof-R1')).not.toBeInTheDocument();
  });

  it('S8-A1: the chain shows requirement → stories → boxes → scenarios → status', async () => {
    const { user } = await openReadiness();
    const story = screen.getByTestId('readiness-story-R1-S1');
    expect(within(story).getByTestId('readiness-box-R1-S1-cart')).toBeInTheDocument();
    expect(within(story).getByTestId('readiness-box-R1-S1-pay')).toBeInTheDocument();
    expect(within(story).getByTestId('readiness-scenario-R1-S1-buy')).toHaveTextContent('approved');
    expect(within(story).getByTestId('readiness-scenario-R1-S1-empty')).toHaveTextContent('draft');
    await user.click(within(story).getByTestId('readiness-box-R1-S1-pay'));
    expect(await screen.findByTestId('box-pay')).toBeInTheDocument();
    expect(screen.getByTestId('contract-path')).toHaveTextContent('pay');
  });

  it('S8-A2: a box that serves no requirement is in the list "no requirement"', async () => {
    await openReadiness();
    const list = screen.getByTestId('readiness-no-requirement');
    expect(within(list).getByTestId('readiness-no-req-notify')).toHaveTextContent('notify');
    expect(within(list).queryByTestId('readiness-no-req-cart')).not.toBeInTheDocument();
  });

  it('S8-A3: corrections.md with 3 caught-in-simulation and 1 caught-after-build shows 3 and 1', async () => {
    await openReadiness();
    expect(screen.getByTestId('readiness-caught-in-simulation')).toHaveTextContent('3');
    expect(screen.getByTestId('readiness-caught-after-build')).toHaveTextContent('1');
  });

  it('S8-A1: gate findings are grouped by story, with EPIC-wide findings on their own', async () => {
    await openReadiness();
    expect(screen.getByTestId('readiness-gate-ok')).toHaveTextContent('fails');
    expect(screen.getByTestId('readiness-gate-epic')).toHaveTextContent('R3 has no story');
    expect(screen.getByTestId('readiness-gate-epic')).toHaveTextContent('branch no of decision in-stock');
    expect(screen.getByTestId('readiness-gate-S1')).toHaveTextContent('error exit empty-cart of cart');
    const s2 = screen.getByTestId('readiness-gate-S2-list');
    expect(within(s2).getAllByRole('listitem')).toHaveLength(3);
    expect(s2).toHaveTextContent('S2 has no approved scenario');
    expect(s2).toHaveTextContent('scenario is stale');
  });
});

describe('sign-off (S9)', () => {
  /** The fixture with only the findings about S2: S1 can be signed off. */
  function s1Clean(): ReviewEpicView {
    const view = reviewEpic();
    view.gate!.findings = view.gate!.findings.filter((f) => f.refs.includes('S2'));
    return view;
  }

  const SIGNED: SignOffView = { by: 'builder@example.com', threadId: 'thr_test', at: '2026-11-05T02:00:00Z', hashRule: 2, storyHashes: { S1: `sha256:${'1'.repeat(64)}` }, signer: FIXTURE_KEY, sigStatus: 'valid' };

  it('S9-A1: with a gate finding for the selected story, Sign off is disabled and lists the finding', async () => {
    const { user } = await start({}, s1Clean());
    await user.click(screen.getByTestId('nav-signoff'));
    expect(screen.getByTestId('signoff-gate-findings')).toHaveTextContent('S2 has no approved scenario');
    expect(screen.getByTestId('signoff-button')).toBeDisabled();
    expect(screen.getByTestId('signoff-why')).toHaveTextContent('select at least one story');
    expect(screen.getByTestId('signoff-story-findings-S2')).toHaveTextContent('3 findings');
    expect(screen.getByTestId('signoff-story-findings-S1')).toHaveTextContent('no findings');

    await user.click(screen.getByTestId('signoff-story-S2'));
    expect(screen.getByTestId('signoff-button')).toBeDisabled();
    expect(screen.getByTestId('signoff-why')).toHaveTextContent('3 gate findings for the selected stories');
    expect(screen.getByTestId('signoff-blocking-list')).toHaveTextContent('scenario is stale');
  });

  it('S9-A1: an EPIC-wide finding blocks every story', async () => {
    const { user } = await start();
    await user.click(screen.getByTestId('nav-signoff'));
    await user.click(screen.getByTestId('signoff-story-S1'));
    expect(screen.getByTestId('signoff-button')).toBeDisabled();
    expect(screen.getByTestId('signoff-blocking-list')).toHaveTextContent('R3 has no story');
    expect(screen.getByTestId('signoff-blocking-list')).not.toHaveTextContent('scenario is stale');
  });

  it('S9-A1: when the server answers 409, the sign-off fails and lists the findings', async () => {
    const error = { kind: 'contract', file: 'flow.yaml', path: 'pay', message: 'output orderId does not fit input', refs: ['S1'] };
    const { server, user } = await start({ signOff: () => ({ status: 409, body: { ok: false, findings: [error] } }) }, s1Clean());
    await user.click(screen.getByTestId('nav-signoff'));
    await user.click(screen.getByTestId('signoff-story-S1'));
    await user.click(screen.getByTestId('signoff-button'));
    await user.click(screen.getByTestId('signoff-confirm'));
    expect(server.posts('api/sign-off')).toHaveLength(1);
    expect(await screen.findByTestId('signoff-outcome-findings')).toHaveTextContent('flow.yaml: pay: output orderId does not fit input');
    expect(screen.getByTestId('signoff-outcome')).toHaveTextContent('Refused: 1 finding');
    expect(server.gets('api/epic')).toHaveLength(1);
  });

  it('S9-A2: with no findings, Sign off asks to confirm the stories and the identity, posts them, and the record keeps who, when and a hash', async () => {
    const view = s1Clean();
    const { server, user } = await start({ signOff: () => ({ status: 200, body: { ok: true, signOff: SIGNED } }) }, view);
    await user.click(screen.getByTestId('nav-signoff'));
    await screen.findByTestId('signoff-signer-key');
    expect(screen.getByTestId('signoff-history')).toHaveTextContent('No sign-offs yet.');
    await user.click(screen.getByTestId('signoff-story-S1'));
    expect(screen.getByTestId('signoff-why')).toHaveTextContent('Ready to sign off S1');
    await user.click(screen.getByTestId('signoff-button'));

    const dialog = screen.getByRole('dialog', { name: 'Confirm the sign-off' });
    expect(within(dialog).getByTestId('signoff-confirm-stories')).toHaveTextContent('S1');
    expect(within(dialog).getByTestId('signoff-confirm-identity')).toHaveTextContent('builder@example.com');
    expect(within(dialog).getByTestId('signoff-confirm-identity')).toHaveTextContent(FIXTURE_KEY);
    expect(within(dialog).getByTestId('signoff-confirm')).toHaveFocus();
    expect(server.posts('api/sign-off')).toHaveLength(0);

    view.signOffs = [SIGNED];
    await user.click(within(dialog).getByTestId('signoff-confirm'));
    const [post] = server.posts('api/sign-off');
    expect(post!.body).toEqual({ storyIds: ['S1'] });
    expect(post!.headers['x-rehearse-token']).toBe('tok-123');
    expect(await screen.findByText('Signed off S1.')).toBeInTheDocument();
    await waitFor(() => expect(server.gets('api/epic')).toHaveLength(2));
    const entry = await screen.findByTestId('signoff-entry-0');
    expect(entry).toHaveTextContent('builder@example.com at 2026-11-05T02:00:00Z');
    expect(entry).toHaveTextContent('S1');
    expect(screen.getByTestId('signoff-sig-0')).toHaveTextContent('signature valid');
    expect(screen.getByTestId('signoff-story-S1')).not.toBeChecked();
  });

  it('S9-A2: Cancel closes the confirmation without a request and gives focus back to Sign off', async () => {
    const { server, user } = await start({}, s1Clean());
    await user.click(screen.getByTestId('nav-signoff'));
    await screen.findByTestId('signoff-signer-key');
    await user.click(screen.getByTestId('signoff-story-S1'));
    await user.click(screen.getByTestId('signoff-button'));
    await user.click(screen.getByTestId('signoff-cancel'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('signoff-button')).toHaveFocus();
    expect(server.posts('api/sign-off')).toHaveLength(0);
  });

  it('S9-A2: a stale-story finding does not block a new sign-off of that story', async () => {
    const view = s1Clean();
    view.gate!.findings = [{ kind: 'gate', file: 'signoff.yaml', path: 'S1', message: 'story is stale: content changed since sign-off (hash rule 2); must be signed again', refs: ['S1'] }];
    const { user } = await start({}, view);
    await user.click(screen.getByTestId('nav-signoff'));
    await screen.findByTestId('signoff-signer-key');
    await user.click(screen.getByTestId('signoff-story-S1'));
    expect(screen.getByTestId('signoff-button')).toBeEnabled();
  });

  it('S9-A2: 503 and signing off: the button stays off when signing is not available, and a 503 shows its reason', async () => {
    const off = await start({ session: () => NO_SIGNING }, s1Clean());
    await off.user.click(screen.getByTestId('nav-signoff'));
    await screen.findByTestId('signoff-signer-blocked');
    await off.user.click(screen.getByTestId('signoff-story-S1'));
    expect(screen.getByTestId('signoff-button')).toBeDisabled();
    expect(screen.getByTestId('signoff-why')).toHaveTextContent('signing is not available');
    expect(screen.getByTestId('signoff-signer-doc')).toHaveTextContent('docs/signing.md');
  });

  it('S9-A2: a 503 from the server shows the reason', async () => {
    const { user } = await start({ signOff: () => ({ status: 503, body: { ok: false, reason: 'ssh-keygen failed' } }) }, s1Clean());
    await user.click(screen.getByTestId('nav-signoff'));
    await screen.findByTestId('signoff-signer-key');
    await user.click(screen.getByTestId('signoff-story-S1'));
    await user.click(screen.getByTestId('signoff-button'));
    await user.click(screen.getByTestId('signoff-confirm'));
    expect(await screen.findByText(/Signing is not available: ssh-keygen failed/)).toBeInTheDocument();
  });
});

describe('accessibility', () => {
  it('review buttons have names, and status is in words, not only color', async () => {
    const { user } = await start();
    await screen.findByTestId('approve-signer-key');
    expect(screen.getByTestId('approve-S1-empty')).toHaveAccessibleName('Approve S1-empty (draft)');
    expect(screen.getByTestId('select-S1-empty')).toHaveAccessibleName('Select S1-empty to approve');
    expect(screen.getByTestId('approve-selected')).toHaveAccessibleName('Approve the selected scenarios (none selected)');
    await user.click(screen.getByTestId('nav-signoff'));
    expect(screen.getByTestId('signoff-story-S1')).toHaveAccessibleName(/S1/);
    expect(within(screen.getByTestId('signoff-view')).getByRole('button', { name: 'Sign off' })).toBe(screen.getByTestId('signoff-button'));
    await user.click(screen.getByTestId('nav-readiness'));
    for (const el of screen.getAllByText(/^(proven|no proof)$/)) expect(el.textContent).toMatch(/proven|no proof/);
  });

  it('focus order in the scenario list: the scenario, its checkbox, then its Approve button', async () => {
    const { user } = await start();
    await screen.findByTestId('approve-signer-key');
    screen.getByTestId('scenario-S1-empty').focus();
    await user.tab();
    expect(screen.getByTestId('select-S1-empty')).toHaveFocus();
    await user.tab();
    expect(screen.getByTestId('approve-S1-empty')).toHaveFocus();
    await user.tab();
    expect(screen.getByTestId('scenario-S2-out-of-stock')).toHaveFocus();
  });

  it('arrow keys do not step playback while another view is open', async () => {
    const { user } = await start();
    await user.click(screen.getByTestId('scenario-S1-buy'));
    await openMatrix(user);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await user.click(screen.getByTestId('nav-flow'));
    expect(await screen.findByTestId('playback-step')).toHaveTextContent('Step 1 of 4');
  });
});
