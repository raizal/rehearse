// The e2e tests of story S6 ("to approve the scenarios that agents drafted"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S6.yaml. Each step title
// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.
// Work only from the scenarios and the product that runs (the UI and the CLI), not from the code of the boxes.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI, expect, stop, test } from './serve.js';
import { rehearse } from './cli.js';

const SHOP = fileURLToPath(new URL('../../packages/core/test/fixtures/shop', import.meta.url));
const EPIC = 'docs/epics/2026-11-05-shop';

type Finding = { kind: string; file: string; path: string; message: string; refs: string[] };
type Report = { command: string; ok: boolean; findings: Finding[] };

test('S6-approve: Builder approves a draft scenario, gate still fails', async ({ page }) => {
  // The main path of S6: "done" needs this test passed on the real screens.
  // Checks S6-A1: given a draft scenario; when the builder approves it; then the scenario records approvedBy, approvedAt and a content hash.
  // Given: the shop record with one draft scenario only, S1-buy (7 steps). Story S2 has no scenario,
  // so the gate still fails after the approval. Git signs with a test key for a@b.c.
  test.setTimeout(180_000);
  const shop = signedShop();
  const s1 = join(shop.epicDir, 'scenarios/S1.yaml');
  let server: { child: ChildProcess; url: string } | undefined;
  let gate: { code: number | null; out: string; err: string } | undefined;
  let report: Report | undefined;
  /** Run the gate in the repo after the approval, one time. */
  const gateAfter = (): Report => {
    if (!report) {
      gate = rehearse(shop.repo, 'gate', 'check', EPIC, '--json');
      report = JSON.parse(gate.out) as Report;
    }
    return report;
  };
  try {
    server = await shop.serve();
    const url = server.url;

    await test.step('review/readiness: Readiness chain and correction counts', async () => {
      // Step 1 of 11.
      await page.goto(url);
      await page.getByTestId('nav-readiness').click();
      await expect(page.getByTestId('readiness-summary')).toContainText('EPIC status: draft');
      await expect(page.getByTestId('readiness-gate-ok')).toHaveText('fails');
      await expect(page.getByTestId('readiness-scenario-R1-S1-buy')).toContainText('draft');
    });

    await test.step('happy: Design correct?', async () => {
      // Step 2 of 11, the branch "approve".
      // Example approve: given {"decision":"approve"}; then {"branch":"approve"}.
      // The builder opens the storyboard of S1-buy and sees each step. Then Approve is on.
      await page.getByTestId('nav-stories').click();
      await page.getByTestId('queue-story-S1').click();
      await page.getByTestId('glance-branch-S1-buy').click();
      await expect(page.getByRole('heading', { name: /Buyer pays and the order ships/ }).first()).toBeVisible();
      await expect(page.getByTestId('card-step-count')).toHaveText('Step 1 of 7');
      await expect(page.getByTestId('card-approve')).toBeDisabled();
      for (let n = 2; n <= 7; n++) {
        await page.getByTestId('card-next-step').click();
        await expect(page.getByTestId('card-step-count')).toHaveText(`Step ${n} of 7`);
      }
      await expect(page.getByTestId('card-approve')).toBeEnabled();
    });

    await test.step('signing-key: Signing key?', async () => {
      // Step 3 of 11, the branch "yes".
      // Example key-set: given {"signingKey":"~/.ssh/id_ed25519.pub"}; then {"branch":"yes"}.
      await expect(page.getByTestId('signing-chip')).toContainText('Signing: key SHA256:');
      await expect(page.getByTestId('approve-signer-by')).toHaveText('a@b.c');
      await expect(page.getByTestId('approve-signer-key')).toHaveText(shop.fingerprint);
    });

    await test.step('approve: Approve scenarios (UI button only)', async () => {
      // Step 4 of 11.
      // Example approve-1: given {"scenarioIds":["shop-1"],"user":"a@b.c","threadId":"thr_x"}; then {"approvals":[{"by":"a@b.c","threadId":"thr_x","hash":"h1"}]}.
      await page.getByTestId('card-approve').click();
      // S6-A1: the scenario records who approved it, when, and a content hash, with a signature.
      await expect.poll(() => scenarioBlock(readFileSync(s1, 'utf8'), 'S1-buy')).toMatch(/status: approved/);
      const block = scenarioBlock(readFileSync(s1, 'utf8'), 'S1-buy');
      expect(block).toContain('by: a@b.c');
      expect(block).toMatch(/at: '?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(block).toMatch(/hash: '?sha256:[0-9a-f]{64}/);
      expect(block).toContain('BEGIN SSH SIGNATURE');
      await expect(page.getByTestId('card-approval-state')).not.toContainText('draft');
    });

    await test.step('more-scenarios: More scenarios to approve?', async () => {
      // Step 5 of 11, the branch "no".
      // No scenario is left to approve: the panel says so, and it does not open another scenario.
      await expect(page.getByTestId('story-finish-text')).toContainText('The scenario of S1 is approved.');
      await expect(page.getByTestId('story-finish-epic-done')).toHaveText('Every scenario of this EPIC is approved.');
      await expect(page.getByTestId('card-next-scenario')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Back to the EPIC' })).toBeVisible();
    });

    await test.step('gate/traced: Every requirement has a story, and every story has an approved scenario', async () => {
      // Step 6 of 11.
      // Example traced-gap: given {"requirements":["R1","R2"],"stories":{"S1":["R1"]}}; then {"findings":[{"kind":"reference","message":"R2 has no story"}]}.
      // S1 has an approved scenario now. S2 (requirement R2) has none, so the gate names it.
      const r = gateAfter();
      expect(gate!.err).toBe('');
      expect(r.findings).toContainEqual(expect.objectContaining({ file: 'prd.yaml', path: 'S2', message: 'S2 has no approved scenario that is not stale' }));
      expect(r.findings.filter((f) => f.path === 'S1' && f.message.includes('no approved scenario'))).toEqual([]);
      await page.getByTestId('nav-readiness').click();
      await expect(page.getByTestId('readiness-gate-S2')).toContainText('S2 has no approved scenario that is not stale');
    });

    await test.step('gate/sim-clean: Simulation has no findings', async () => {
      // Step 7 of 11.
      // The simulation still has findings: no approved scenario takes the empty-cart exit of cart.
      const r = gateAfter();
      expect(r.findings).toContainEqual(expect.objectContaining({ kind: 'coverage', path: 'cart', message: 'error exit empty-cart of cart (to failed): no approved scenario takes it' }));
      // The approved S1-buy checks S1-A1 and takes the branch "yes" of in-stock: those findings went.
      expect(r.findings.filter((f) => f.message.includes('S1-A1') || f.message.startsWith('branch yes of decision in-stock'))).toEqual([]);
    });

    await test.step('gate/no-stale: No stale scenario', async () => {
      // Step 8 of 11.
      const r = gateAfter();
      expect(r.findings.filter((f) => / is stale|changed since/.test(f.message))).toEqual([]);
      await expect(page.getByTestId('readiness-scenario-R1-S1-buy')).toContainText('approved');
      await expect(page.getByTestId('readiness-scenario-R1-S1-buy')).not.toContainText('stale');
    });

    await test.step('gate/report: Gate report', async () => {
      // Step 9 of 11.
      const r = gateAfter();
      expect(r.command).toBe('gate');
      expect(r.ok).toBe(false);
      expect(r.findings.length).toBeGreaterThan(0);
      await expect(page.getByTestId('readiness-gate')).toBeVisible();
    });

    await test.step('gate-ok: Gate passes?', async () => {
      // Step 10 of 11, the branch "no".
      expect(gate!.code).toBe(1);
      await expect(page.getByTestId('readiness-gate-ok')).toHaveText('fails');
    });

    await test.step('review/swimlanes: Swimlanes', async () => {
      // Step 11 of 11.
      // Back to the review: the storyboard of S1-buy shows its lanes, and the scenario is approved.
      await page.getByTestId('nav-stories').click({ timeout: 10_000 });
      // Stories goes back to the last place, the board of S1-buy. If it shows the glance, open the board.
      const glance = page.getByTestId('glance-branch-S1-buy');
      const steps = page.getByRole('list', { name: 'Steps of S1-buy' });
      await expect(glance.or(steps).first()).toBeVisible();
      if (await glance.isVisible()) await glance.click({ timeout: 10_000 });
      await expect(page.getByRole('group', { name: /Flowchart of S1-buy: 7 steps down the lanes Buyer, Shop/ })).toBeVisible();
      await expect(steps.getByText(/^Step 1: Buyer opens the cart, lane Buyer\b/)).toBeVisible();
      await expect(steps.getByText(/^Step 3: Charge the buyer, lane Shop\b/)).toBeVisible();
      await expect(page.getByText('Approval: approved, signature valid')).toBeVisible();
    });
  } finally {
    if (server) await stop(server.child);
    shop.remove();
  }

  // Expect at the end: {"Scenario.status":"approved","Approval.by":"a@b.c"}.
  // Step 4 checked the status and Approval.by; the gate still fails.
  expect(report!.ok).toBe(false);
});

/** The text of one scenario in a scenario file, from its "- id:" line to the next. */
function scenarioBlock(yaml: string, id: string): string {
  const start = yaml.indexOf(`- id: ${id}\n`);
  if (start < 0) return '';
  const next = yaml.indexOf('\n  - id: ', start + 1);
  return yaml.slice(start, next < 0 ? undefined : next);
}

/**
 * A git repo in a temp folder with a copy of the shop record: S1-buy is the only scenario, and S2 has
 * none. Git signs with a new test key (no passphrase), and `.rehearse/allowed_signers` lists it for
 * a@b.c. The global git config and the ssh-agent are not used, so the owner's key never signs.
 */
function signedShop() {
  const tmp = mkdtempSync(join(tmpdir(), 'rehearse-e2e-s6-'));
  const key = join(tmp, 'key');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'e2e', '-f', key]);
  const fingerprint = execFileSync('ssh-keygen', ['-l', '-f', `${key}.pub`], { encoding: 'utf8' }).split(' ')[1]!;
  writeFileSync(join(tmp, 'gitconfig'), `[user]\n\temail = a@b.c\n\tname = e2e\n\tsigningkey = ${key}\n[gpg]\n\tformat = ssh\n[commit]\n\tgpgsign = false\n`);
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: join(tmp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  delete env.SSH_AUTH_SOCK;
  const repo = join(tmp, 'repo');
  const epicDir = join(repo, EPIC);
  execFileSync('git', ['init', '-q', repo], { env });
  mkdirSync(join(repo, '.rehearse'));
  writeFileSync(join(repo, '.rehearse/allowed_signers'), `a@b.c namespaces="rehearse" ${readFileSync(`${key}.pub`, 'utf8')}`);
  cpSync(SHOP, epicDir, { recursive: true });
  // One draft only: keep S1-buy, and remove S1-empty and the scenarios of S2.
  const s1 = join(epicDir, 'scenarios/S1.yaml');
  const text = readFileSync(s1, 'utf8');
  const cut = text.indexOf('  - id: S1-empty\n');
  expect(cut).toBeGreaterThan(0);
  writeFileSync(s1, text.slice(0, cut));
  rmSync(join(epicDir, 'scenarios/S2.yaml'));
  execFileSync('git', ['add', '-A'], { cwd: repo, env });
  execFileSync('git', ['commit', '-q', '-m', 'the shop record with one draft'], { cwd: repo, env });
  return {
    repo,
    epicDir,
    fingerprint,
    /** `rehearse serve` in the repo, with the test git config. */
    serve: () =>
      new Promise<{ child: ChildProcess; url: string }>((resolve, reject) => {
        const child = spawn(process.execPath, [CLI, 'serve', EPIC, '--port', '0'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error(`rehearse serve printed no URL in 15 s:\n${out}`));
        }, 15_000);
        const read = (c: Buffer) => {
          out += c.toString();
          const m = /http:\/\/127\.0\.0\.1:\d+\/\S*/.exec(out);
          if (m && out.includes(fingerprint)) {
            clearTimeout(timer);
            resolve({ child, url: m[0] });
          }
        };
        child.stdout!.on('data', read);
        child.stderr!.on('data', read);
        child.on('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`rehearse serve exited with ${code}:\n${out}`));
        });
      }),
    remove: () => rmSync(tmp, { recursive: true, force: true }),
  };
}
