// The e2e tests of story S5 ("to play a scenario step by step"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S5.yaml. Each step title
// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.
// Work only from the scenarios and the product that runs (the UI and the CLI), not from the code of the boxes.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { CLI, expect, stop, test } from './serve.js';

const SHOP = fileURLToPath(new URL('../../packages/core/test/fixtures/shop', import.meta.url));
const EPIC = 'docs/epics/2026-11-05-shop';

// The approved scenario with 3 steps of S5-A1. Step 2 is the box pay.
const SHOP_1 = `story: S1
scenarios:
  - id: shop-1
    title: Buyer pays
    status: draft
    steps:
      - name: cart
        example: { id: cart-ok, given: { items: [a] }, then: { orderId: o1 } }
      - { name: pay }
      - { name: in-stock, branch: "yes" }
`;

test('S5-playback: Builder steps through a 3-step scenario', async ({ page }) => {
  // The main path of S5: "done" needs this test passed on the real screens.
  // Checks S5-A1: given an approved scenario with 3 steps; when the builder plays it on its storyboard (Prev, Next, Play or the arrow keys) and moves to step 2; then the storyboard highlights the box of step 2 and shows its input, output and state change.
  test.setTimeout(120_000);
  const shop = signedShop({ 'scenarios/shop-1.yaml': SHOP_1 });
  let server: { child: ChildProcess; url: string } | undefined;
  let highlighted = '';
  try {
    server = await shop.serve();
    const url = server.url;
    // Given: the builder saw each step of shop-1 and approved it with a valid signature (a test key, not the owner's key).
    await approve(page, url, shop.fingerprint, 'S1', 'shop-1', 3, join(shop.epicDir, 'scenarios/shop-1.yaml'));

    await test.step('review/swimlanes: Swimlanes', async () => {
      // Step 1 of 6.
      await page.goto(url);
      await page.getByTestId('nav-bigpicture').click();
      await expect(page.getByTestId('bp-role-buyer')).toBeVisible();
      await expect(page.getByTestId('bp-role-shop')).toBeVisible();
      await page.getByTestId('bp-story-S1').click();
      await expect(page.getByTestId('story-scenario-shop-1')).toBeVisible();
      await expect(page.getByTestId('story-scenario-status-shop-1')).not.toContainText('draft');
    });

    await test.step('review/playback: Play a scenario step by step', async () => {
      // Step 2 of 6.
      // Example play-step-2: given {"scenario":"shop-1","step":2}; then {"highlighted":"pay","shows":["input","output","stateChange"]}.
      await page.getByTestId('story-scenario-open-shop-1').click();
      await expect(page.getByTestId('card-step-count')).toHaveText('Step 1 of 3');
      await expect(page.getByTestId('card-prev-step')).toBeDisabled();

      // Next moves to step 2.
      await page.getByTestId('card-next-step').click();
      await expect(page.getByTestId('card-step-count')).toHaveText('Step 2 of 3');
      const step2 = page.getByRole('region', { name: 'Step 2 of 3: Charge the buyer' });
      await expect(step2).toBeVisible();
      // The box of step 2 is pay, in the lane Shop.
      await expect(step2.locator('code').first()).toHaveText('pay');
      await expect(step2).toContainText('lane: Shop');
      // Its input, output and state change.
      for (const term of ['in', 'out', 'writes']) await expect(step2.getByRole('term').filter({ hasText: new RegExp(`^${term}$`) })).toHaveCount(1);
      await expect(step2.getByRole('definition').filter({ hasText: 'orderId: string' })).toHaveCount(2);
      await expect(step2.getByRole('definition').filter({ hasText: 'Order.status:draft->paid' })).toHaveCount(1);
      // The flowchart marks step 2 of the path as the box Charge the buyer.
      await expect(page.getByTestId('card-step-2')).toContainText('Charge the buyer');
      highlighted = (await step2.locator('code').first().textContent()) ?? '';

      // The arrow keys and Prev move along the path, and come back to step 2.
      await page.keyboard.press('ArrowRight');
      await expect(page.getByTestId('card-step-count')).toHaveText('Step 3 of 3');
      await page.keyboard.press('ArrowLeft');
      await expect(page.getByTestId('card-step-count')).toHaveText('Step 2 of 3');
      await page.getByTestId('card-prev-step').click();
      await expect(page.getByTestId('card-step-count')).toHaveText('Step 1 of 3');
      await page.getByTestId('card-next-step').click();
      await expect(page.getByTestId('card-step-count')).toHaveText('Step 2 of 3');
      await expect(page.getByRole('region', { name: 'Step 2 of 3: Charge the buyer' }).locator('code').first()).toHaveText('pay');
    });

    await test.step('review/matrix: Use case diagram (permissions)', async () => {
      // Step 3 of 6.
      await page.getByTestId('nav-usecases').click();
      await expect(page.getByTestId('usecase-actor-shop')).toBeVisible();
      await expect(page.getByTestId('usecase-pay')).toContainText('Charge the buyer');
      await expect(page.getByTestId('usecase-pay')).toHaveAccessibleName(/Order\.status draft → paid/);
      await expect(page.getByTestId('usecase-link-shop-pay')).toBeAttached();
    });

    await test.step('review/readiness: Readiness chain and correction counts', async () => {
      // Step 4 of 6.
      await page.getByTestId('nav-readiness').click();
      await expect(page.getByTestId('readiness-req-R1')).toContainText('R1');
      await expect(page.getByTestId('readiness-scenario-R1-shop-1')).toBeVisible();
      await expect(page.getByTestId('readiness-caught-in-simulation')).toBeVisible();
      await expect(page.getByTestId('readiness-caught-after-build')).toBeVisible();
    });

    await test.step('happy: Design correct?', async () => {
      // Step 5 of 6, the branch "change".
      // Example change: given {"decision":"change"}; then {"branch":"change"}.
      // The design is not correct yet: the gate fails, and the readiness view lists the findings to change.
      await expect(page.getByTestId('readiness-summary')).toContainText(/gate:\s*fails/);
      await expect(page.getByTestId('readiness-gate-epic-list')).toContainText('branch no of decision in-stock (to failed): no approved scenario takes it');
    });

    await test.step('draft-record: Draft or fix record files', async () => {
      // Step 6 of 6.
      // The builder fixes the record: a draft scenario for the branch "no". The UI shows it after Reload.
      writeFileSync(
        join(shop.epicDir, 'scenarios/shop-2.yaml'),
        'story: S2\nscenarios:\n  - id: shop-2\n    title: Item not in stock\n    status: draft\n    steps:\n      - { name: pay }\n      - { name: in-stock, branch: "no" }\n      - { name: failed }\n',
      );
      await page.getByTestId('reload').click();
      await page.getByTestId('nav-readiness').click();
      await expect(page.getByTestId('readiness-scenario-R2-shop-2')).toBeVisible();
      // The approved scenario does not change, so it stays approved.
      await page.getByTestId('nav-bigpicture').click();
      await page.getByTestId('bp-story-S1').click();
      await expect(page.getByTestId('story-scenario-status-shop-1')).not.toContainText(/draft|stale/);
    });

    // Expect at the end: {"highlighted":"pay"}.
    expect(highlighted).toBe('pay');
  } finally {
    if (server) await stop(server.child);
    shop.remove();
  }
});

/** The text of one scenario in a scenario file, from its "- id:" line to the next. */
function scenarioBlock(yaml: string, id: string): string {
  const start = yaml.indexOf(`- id: ${id}\n`);
  if (start < 0) return '';
  const next = yaml.indexOf('\n  - id: ', start + 1);
  return yaml.slice(start, next < 0 ? undefined : next);
}

/**
 * A git repo in a temp folder with a copy of the shop record and the extra files. Git signs with a new
 * test key (no passphrase), and `.rehearse/allowed_signers` lists it for a@b.c. The global git config
 * and the ssh-agent are not used, so the owner's key never signs.
 */
function signedShop(extra: Record<string, string>) {
  const tmp = mkdtempSync(join(tmpdir(), 'rehearse-e2e-s5-'));
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
  for (const [file, text] of Object.entries(extra)) writeFileSync(join(epicDir, file), text);
  execFileSync('git', ['add', '-A'], { cwd: repo, env });
  execFileSync('git', ['commit', '-q', '-m', 'the shop record'], { cwd: repo, env });
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

/** See each step of a scenario on its storyboard, then approve it with the test key. */
async function approve(page: Page, url: string, fingerprint: string, story: string, id: string, steps: number, file: string) {
  await page.goto(url);
  await page.getByTestId('nav-stories').click();
  await page.getByTestId(`queue-story-${story}`).click();
  await page.getByTestId(`story-scenario-open-${id}`).click();
  await expect(page.getByTestId('card-step-count')).toHaveText(`Step 1 of ${steps}`);
  for (let n = 2; n <= steps; n++) {
    await page.getByTestId('card-next-step').click();
    await expect(page.getByTestId('card-step-count')).toHaveText(`Step ${n} of ${steps}`);
  }
  await expect(page.getByTestId('approve-signer-by')).toHaveText('a@b.c');
  await expect(page.getByTestId('approve-signer-key')).toHaveText(fingerprint);
  await page.getByTestId('card-approve').click();
  // The record keeps the approval: who, and a signature.
  await expect.poll(() => scenarioBlock(readFileSync(file, 'utf8'), id)).toMatch(/status: approved[\s\S]*by: a@b\.c[\s\S]*sig:/);
  await expect(page.getByTestId('card-approval-state')).not.toContainText('draft');
}
