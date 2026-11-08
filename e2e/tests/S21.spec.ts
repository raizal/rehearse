// The e2e tests of story S21 ("a Next button on the storyboard that takes me to the next scenario to approve, and to the next story when this one is done"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S21.yaml. Each step title
// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.
// Work only from the scenarios and the product that runs (the UI and the CLI), not from the code of the boxes.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI, expect, stop, test } from './serve.js';

const SHOP = fileURLToPath(new URL('../../packages/core/test/fixtures/shop', import.meta.url));

/**
 * A copy of the shop record in a new git repo that can sign: a new SSH key with no passphrase, the
 * repo's git config signs with it, and .rehearse/allowed_signers lists it. The test does not use the
 * owner's ssh-agent or global git config, and the key is removed with the folder.
 */
function signedShop(): { tmp: string; repo: string; epicDir: string; env: NodeJS.ProcessEnv; remove: () => void } {
  const tmp = mkdtempSync(join(tmpdir(), 'rehearse-e2e-s21-'));
  const repo = join(tmp, 'repo');
  const epicDir = join(repo, 'docs/epics/shop');
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: join(tmp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  delete env.SSH_AUTH_SOCK;
  writeFileSync(join(tmp, 'gitconfig'), '');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' });
  mkdirSync(repo);
  git('init', '-q');
  cpSync(SHOP, epicDir, { recursive: true });
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'e2e', '-f', join(tmp, 'key')], { env });
  git('config', 'user.name', 'e2e');
  git('config', 'user.email', 'e2e@example.com');
  git('config', 'gpg.format', 'ssh');
  git('config', 'user.signingkey', join(tmp, 'key'));
  mkdirSync(join(repo, '.rehearse'));
  writeFileSync(join(repo, '.rehearse/allowed_signers'), `e2e@example.com namespaces="rehearse" ${readFileSync(join(tmp, 'key.pub'), 'utf8')}`);
  git('add', '-A');
  git('commit', '-q', '--no-gpg-sign', '-m', 'shop record');
  return { tmp, repo, epicDir, env, remove: () => rmSync(tmp, { recursive: true, force: true }) };
}

/** Start `rehearse serve` in `repo` with `env`, and wait for its URL and its signing line. */
function serveSigned(repo: string, epicDir: string, env: NodeJS.ProcessEnv): Promise<{ child: ChildProcess; url: string; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, 'serve', epicDir, '--port', '0'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`rehearse serve printed no URL and no signing line in 15 s:\n${out}`));
    }, 15_000);
    const read = (c: Buffer) => {
      out += c.toString();
      const m = /http:\/\/127\.0\.0\.1:\d+\/\S*/.exec(out);
      if (m && /Approve and sign-off as/.test(out)) {
        clearTimeout(timer);
        resolve({ child, url: m[0], out });
      }
    };
    child.stdout!.on('data', read);
    child.stderr!.on('data', read);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`rehearse serve exited with ${code}:\n${out}`));
    });
  });
}

/** The YAML block of one scenario in scenarios/<story>.yaml. */
function scenarioBlock(epicDir: string, story: string, id: string): string {
  const text = readFileSync(join(epicDir, 'scenarios', `${story}.yaml`), 'utf8');
  const start = text.indexOf(`- id: ${id}\n`);
  expect(start, `${id} in scenarios/${story}.yaml`).toBeGreaterThanOrEqual(0);
  const next = text.indexOf('\n  - id: ', start + 1);
  return text.slice(start, next < 0 ? undefined : next);
}

test('S21-focus-after-approve: After a successful approval focus moves to Next scenario, and Enter follows it', async ({ page }) => {
  // The main path of S21: "done" needs this test passed on the real screens.
  // Checks S21-A3: given a scenario whose steps were all seen; when the builder approves it and the approval succeeds; then focus moves to "Next scenario →" (or to the next action when the story is done), and Enter follows it; nothing opens by itself.
  // The shop record: story S1 has S1-buy (7 steps, the main path) and S1-empty (3 steps). Both are drafts.
  // The builder approves S1-buy; the next scenario to approve in S1 is S1-empty.
  const shop = signedShop();
  const { child, url, out } = await serveSigned(shop.repo, shop.epicDir, shop.env);
  const approveButton = page.getByRole('button', { name: /^Approve\b/ });
  const nextScenario = page.getByRole('button', { name: /Next scenario/ });
  try {
    await test.step('review/readiness: Readiness chain and correction counts', async () => {
      // Step 1 of 8.
      await page.goto(url);
      await page.getByTestId('nav-readiness').click();
      await expect(page.getByTestId('readiness-summary')).toContainText('EPIC status: draft');
      await expect(page.getByTestId('readiness-scenario-R1-S1-buy')).toContainText('draft');
      await expect(page.getByTestId('readiness-scenario-R1-S1-empty')).toContainText('draft');
    });

    await test.step('happy: Design correct?', async () => {
      // Step 2 of 8, the branch "approve".
      // The builder opens the storyboard of S1-buy and plays every step, so the scenario is seen in full.
      await page.getByTestId('readiness-story-link-R1-S1').click();
      await expect(page.getByRole('heading', { level: 1 })).toContainText('S1');
      await expect(page.getByTestId('story-scenario-seen-S1-buy')).toContainText('0 of 7 seen');
      await page.getByTestId('story-scenario-open-S1-buy').click();
      await expect(page.getByRole('heading', { name: /Buyer pays and the order ships/ }).first()).toBeVisible();
      await expect(approveButton).toBeDisabled();
      // Guess: the arrow keys play the storyboard step by step (S5-A1: "Prev, Next, Play or the arrow keys").
      for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
      await expect(approveButton).toBeEnabled();
    });

    await test.step('signing-key: Signing key?', async () => {
      // Step 3 of 8, the branch "yes".
      expect(out).toMatch(/Approve and sign-off as e2e@example\.com, key SHA256:/);
      await expect(page.getByTestId('signing-chip')).toContainText('Signing: key SHA256:');
    });

    await test.step('approve: Approve scenarios (UI button only)', async () => {
      // Step 4 of 8.
      // Example approve-one: given {"scenarioIds":["S16-link-page"]}; then {"approvals":[{"scenario":"S16-link-page","sigStatus":"valid"}]}.
      await approveButton.click();
      await expect.poll(() => scenarioBlock(shop.epicDir, 'S1', 'S1-buy')).toMatch(/status: approved/);
      const block = scenarioBlock(shop.epicDir, 'S1', 'S1-buy');
      expect(block).toContain('by: e2e@example.com');
      expect(block).toContain('BEGIN SSH SIGNATURE');
      expect(scenarioBlock(shop.epicDir, 'S1', 'S1-empty')).toContain('status: draft');
    });

    await test.step('after-approve: Move focus to Next after an approval', async () => {
      // Step 5 of 8.
      // Example focus: given {"outcome":"ok"}; then {"scenarioId":"S16-link-page","focus":"Next scenario →"}.
      await expect(nextScenario).toBeFocused();
      await expect(nextScenario).toContainText('Next scenario →');
      // Nothing opens by itself: the storyboard of S1-buy stays open.
      await page.waitForTimeout(1_000);
      await expect(page.getByRole('heading', { name: /Buyer pays and the order ships/ }).first()).toBeVisible();
      await expect(page.getByRole('heading', { name: /Buyer checks out an empty cart/ })).toHaveCount(0);
    });

    await test.step('next-scenario: Next scenario beside Approve', async () => {
      // Step 6 of 8.
      // Example enter: given {"scenarioId":"S16-link-page","key":"Enter"}; then {"scenarioId":"S16-link-frame","storyId":"S16","place":"3 of 8 in S16"}.
      // The button names the next scenario and its place before the builder follows it.
      await expect(page.getByText(/\d of 2 in S1/).first()).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: /Buyer checks out an empty cart/ }).first()).toBeVisible();
      await expect(page).toHaveURL(/S1-empty/);
    });

    await test.step('review/swimlanes: Swimlanes', async () => {
      // Step 7 of 8.
      // Guess: the storyboard draws its lanes with test ids that end with "lane-<role>", as the box drawer does.
      await expect(page.getByTestId(/lane-buyer$/).first()).toBeVisible();
    });

    await test.step('review/playback: Play a scenario step by step', async () => {
      // Step 8 of 8.
      // The storyboard of S1-empty starts at its first step, and the next scenario is not approved by itself.
      await expect(page.getByText(/step 1 of 3/i).first()).toBeVisible();
      await expect(approveButton).toBeDisabled();
      expect(scenarioBlock(shop.epicDir, 'S1', 'S1-empty')).toContain('status: draft');
    });
  } finally {
    await stop(child);
    shop.remove();
  }

  // Expect at the end: {"focus":"Next scenario →","openedByItself":false,"open":"S16-link-frame"}.
});
