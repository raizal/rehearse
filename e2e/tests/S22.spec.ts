// The e2e tests of story S22 ("every scenario shown as a branch of the story's main path on one map, with the active one highlighted and only its different part to play"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S22.yaml. Each step title
// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.
// Work only from the scenarios and the product that runs (the UI and the CLI), not from the code of the boxes.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page } from '@playwright/test';
import { CLI, expect, stop, test } from './serve.js';

const NO_STOCK = `  - id: S1-no-stock
    title: Buyer pays and the item is not in stock
    status: draft
    steps:
      - { name: start }
      - { name: cart, example: { id: cart-ok, given: { items: [a] }, then: { orderId: o1 } } }
      - { name: pay }
      - { name: in-stock, branch: "no" }
      - { name: failed }
`;

const SHOP = fileURLToPath(new URL('../../packages/core/test/fixtures/shop', import.meta.url));

/**
 * A copy of the shop record, with the scenario S1-no-stock added, in a new git repo that can sign: a new SSH key with no passphrase, the
 * repo's git config signs with it, and .rehearse/allowed_signers lists it. The test does not use the
 * owner's ssh-agent or global git config, and the key is removed with the folder.
 */
function signedShop(): { tmp: string; repo: string; epicDir: string; env: NodeJS.ProcessEnv; remove: () => void } {
  const tmp = mkdtempSync(join(tmpdir(), 'rehearse-e2e-s22-'));
  const repo = join(tmp, 'repo');
  const epicDir = join(repo, 'docs/epics/shop');
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: join(tmp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  delete env.SSH_AUTH_SOCK;
  writeFileSync(join(tmp, 'gitconfig'), '');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' });
  mkdirSync(repo);
  git('init', '-q');
  cpSync(SHOP, epicDir, { recursive: true });
  // A second branch that shares 3 steps with the main path S1-buy: start, cart and pay.
  const s1 = join(epicDir, 'scenarios/S1.yaml');
  writeFileSync(s1, readFileSync(s1, 'utf8').replace('  - id: S1-empty\n', NO_STOCK + '  - id: S1-empty\n'));
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

const approveButton = (page: Page) => page.getByRole('button', { name: /^Approve\b/ });

test('S22-collapsed-seen: The shared opening is one row; steps seen on the main path count, and Approve turns on after the different part', async ({ page }) => {
  // The main path of S22: "done" needs this test passed on the real screens.
  // Checks S22-A7: given a branch that shares its opening with the main path; when its storyboard opens; then the opening is one row, "Same as the main path up to <step> (N steps)", that can be expanded, and playback starts at the branch point; a collapsed step counts as seen only when the owner saw the same step on the main path's storyboard in this browser, else the row says "not seen yet on the main path — expand to see N steps" and Approve stays off until the steps are seen here or there.
  const shop = signedShop();
  const { child, url } = await serveSigned(shop.repo, shop.epicDir, shop.env);
  try {
    await test.step('review/readiness: Readiness chain and correction counts', async () => {
      await page.goto(url);
      await page.getByTestId('nav-readiness').click();
      await expect(page.getByTestId('readiness-summary')).toContainText('EPIC status: draft');
      await expect(page.getByTestId('readiness-scenario-R1-S1-buy')).toBeVisible();
      // Guess: the test id of the added scenario follows the pattern of S1-buy.
      await expect(page.getByTestId('readiness-scenario-R1-S1-no-stock')).toBeVisible();
    });

    await test.step('main-path: Find the story\'s main path', async () => {
      // No review.yaml: S1-buy takes no error edge and walks the most boxes, so it is the main path.
      await page.getByTestId('readiness-story-link-R1-S1').click();
      await page.getByTestId('glance-branch-S1-buy').click(); // The path button on the story map. The "Open storyboard" button of S1-buy is under the next card.
      // Guess: the storyboard header of the main path is the text "Main path".
      await expect(page.getByText('Main path', { exact: true }).first()).toBeVisible();
      // The owner sees each step of the main path in this browser. Guess: ArrowRight plays the next step.
      for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
      await expect(approveButton(page)).toBeEnabled();
    });

    await test.step('branch-point: Find where each scenario leaves the main path', async () => {
      // S1-no-stock leaves the main path at "Item in stock?", after 3 shared steps.
      await page.goto(`${url.replace(/#.*$/, '')}#/stories/S1/what`);
      await expect(page.getByTestId('story-scenario-seen-S1-buy')).toContainText('7 of 7 seen');
      await expect(page.getByTestId('story-scenario-open-S1-no-stock')).toBeVisible();
    });

    await test.step('review-order: Order the scenarios along the map', async () => {
      // The main path is first. Guess: the scenario cards keep the order of the map.
      const cards = page.locator('[data-testid^="story-scenario-open-"]');
      await expect(cards).toHaveCount(3);
      await expect(cards.first()).toHaveAttribute('data-testid', 'story-scenario-open-S1-buy');
    });

    await test.step('story-map: The story at a glance, one map per story', async () => {
      await expect(page.getByText('The story at a glance').first()).toBeVisible();
      await page.getByTestId('story-scenario-open-S1-no-stock').click();
      await expect(page.getByText('Buyer pays and the item is not in stock').first()).toBeVisible();
    });

    await test.step('highlight-scenario: Highlight the open scenario on the map', async () => {
      // Example: the header "Branch of the main path at <box>: when <condition>" and the marker "Branches here: when <condition>".
      await expect(page.getByText(/Branch of the main path at Item in stock\?: when /).first()).toBeVisible();
      await expect(page.getByText(/Branches here: when /).first()).toBeVisible();
    });

    await test.step('collapse-shared: Collapse the opening shared with the main path', async () => {
      // Example seen-on-main: shared 3, playback starts at step 4, and the 3 steps count as seen.
      const row = page.getByText(/Same as the main path up to Charge the buyer \(3 steps\)/).first();
      await expect(row).toBeVisible();
      await expect(page.getByText(/seen on the main path/).first()).toBeVisible();
      await expect(page.getByText(/not seen yet on the main path/)).toHaveCount(0);
      // Guess: the storyboard shows the step number as "step N of M".
      await expect(page.getByText(/step 4 of 5/i).first()).toBeVisible();
      // Approve stays off until the different part (steps 4 and 5) is seen.
      await expect(approveButton(page)).toBeDisabled();
      await page.keyboard.press('ArrowRight');
      await expect(approveButton(page)).toBeEnabled();
    });

    await test.step('approve: Approve scenarios (UI button only)', async () => {
      // Example approve-branch: the approval of the branch has a valid signature.
      await approveButton(page).click();
      await expect
        .poll(() => scenarioBlock(shop.epicDir, 'S1', 'S1-no-stock'), { timeout: 15_000 })
        .toMatch(/status: approved/);
      const block = scenarioBlock(shop.epicDir, 'S1', 'S1-no-stock');
      expect(block).toContain('e2e@example.com');
      expect(block).toContain('BEGIN SSH SIGNATURE');
      expect(scenarioBlock(shop.epicDir, 'S1', 'S1-empty')).toMatch(/status: draft/);
    });
  } finally {
    await stop(child);
    shop.remove();
  }

  // Expect at the end: {"row":"Same as the main path up to Build the slides in plain words (3 steps)","rowSays":"seen on the main path","playbackStartsAt":4,"approve":"on after every step was seen"}.
});
