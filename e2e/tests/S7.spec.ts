// The e2e tests of story S7 ("to see who may change which data, as a use case diagram"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S7.yaml. Each step title
// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.
// Work only from the scenarios and the product that runs (the UI and the CLI), not from the code of the boxes.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { CLI, expect, stop, test } from './serve.js';

const SHOP = fileURLToPath(new URL('../../packages/core/test/fixtures/shop', import.meta.url));
const EPIC = 'docs/epics/2026-11-05-shop';

type Report = { command: string; ok: boolean; findings: { kind: string; path: string; message: string }[]; permissionMatrix: Record<string, Record<string, string[]>> };

test('S7-matrix: A buyer box writes Order.status', async ({ page }) => {
  // The main path of S7: "done" needs this test passed on the real screens.
  // Checks S7-A1: given a box in the buyer lane writes Order.status; when the builder opens the use case diagram; then actor buyer links to the use case of that box, the use case is tagged "writes Order.status", and it links to the box (D42).
  // The shop record: the box cart is in the buyer lane and writes Order.status (->draft).
  test.setTimeout(180_000);
  const shop = signedShop({});
  let server: { child: ChildProcess; url: string } | undefined;
  let run: { code: number | null; out: string };
  let report: Report;
  try {
    server = await shop.serve();
    const url = server.url;
    // Given: the builder approved each scenario of the shop record with a test key, so simulate has no design errors.
    await approve(page, url, shop.fingerprint, 'S1', 'S1-buy', 7, join(shop.epicDir, 'scenarios/S1.yaml'));
    await approve(page, url, shop.fingerprint, 'S1', 'S1-empty', 3, join(shop.epicDir, 'scenarios/S1.yaml'));
    await approve(page, url, shop.fingerprint, 'S2', 'S2-out-of-stock', 3, join(shop.epicDir, 'scenarios/S2.yaml'));
    expect(readFileSync(join(shop.epicDir, 'flow.yaml'), 'utf8')).toMatch(/- id: cart\n\s+kind: input\n\s+lane: buyer\n(?:.*\n)*?\s+writes: \[Order\.id, "Order\.status:->draft"\]/);
    const simulate = () => {
      const r = spawnSync(process.execPath, [CLI, 'simulate', EPIC, '--json'], { cwd: shop.repo, encoding: 'utf8' });
      return { code: r.status, out: r.stdout };
    };
    run = simulate();
    report = JSON.parse(run.out) as Report;

    await test.step('simulate/permissions: Build permission matrix', async () => {
      // Step 1 of 6.
      // Example perm-buyer: given {"boxes":{"checkout":{"lane":"buyer","writes":["Order.status"]}}}; then {"matrix":{"buyer":{"Order":["write"]}}}.
      expect(report.permissionMatrix.buyer?.Order).toContain('write');
      expect(report.permissionMatrix.shop?.Order).toContain('write');
    });

    await test.step('simulate/report: Write sorted, deterministic report', async () => {
      // Step 2 of 6.
      expect(report.command).toBe('simulate');
      expect(simulate().out).toBe(run.out);
    });

    await test.step('design-errors: Design errors found?', async () => {
      // Step 3 of 6, the branch "no".
      expect(report.findings).toEqual([]);
      expect(report.ok).toBe(true);
      expect(run.code).toBe(0);
      await page.goto(url);
      await expect(page.getByTestId('report-status')).toHaveText(/validate: OK/);
    });

    await test.step('review/swimlanes: Swimlanes', async () => {
      // Step 4 of 6.
      await page.getByTestId('nav-bigpicture').click();
      await expect(page.getByTestId('bp-role-buyer')).toBeVisible();
      await page.getByTestId('bp-process-cart').click();
      await expect(page.getByTestId('box-drawer')).toHaveAttribute('data-box', 'cart');
      await expect(page.getByTestId('drawer-lane')).toContainText(/buyer/i);
      await page.getByTestId('box-drawer-close').click();
      await expect(page.getByTestId('box-drawer')).toHaveCount(0);
    });

    await test.step('review/playback: Play a scenario step by step', async () => {
      // Step 5 of 6.
      // The buyer step of S1-buy writes Order.status.
      await page.getByTestId('nav-stories').click();
      await page.getByTestId('queue-story-S1').click();
      await page.getByTestId('glance-branch-S1-buy').click();
      await page.getByTestId('card-next-step').click();
      await expect(page.getByTestId('card-step-count')).toHaveText('Step 2 of 7');
      const step = page.getByRole('region', { name: 'Step 2 of 7: Check out the cart' });
      await expect(step).toContainText('lane: Buyer');
      await expect(step.getByRole('definition').filter({ hasText: 'Order.status:->draft' })).toHaveCount(1);
    });

    await test.step('review/matrix: Use case diagram (permissions)', async () => {
      // Step 6 of 6.
      // Example uc-buyer: given {"matrix":{"buyer":{"Order":["write"]}}}; then {"actor":"buyer","useCase":"checkout","tag":"writes Order.status","link":"checkout"}.
      await page.getByTestId('nav-usecases').click();
      await expect(page.getByTestId('usecase-view')).toBeVisible();
      // The actor buyer links to the use case of the box cart.
      await expect(page.getByTestId('usecase-actor-buyer')).toContainText('Buyer');
      await expect(page.getByTestId('usecase-link-buyer-cart')).toBeAttached();
      // The use case is tagged with the data it writes: Order.status.
      await expect(page.getByTestId('usecase-cart')).toContainText('Check out the cart');
      await expect(page.getByTestId('usecase-cart')).toHaveAccessibleName(/Buyer; writes [^;]*Order\.status/);
      await expect(page.getByTestId('usecase-data-link-cart-Order')).toBeAttached();
      // The use case links to its box.
      await page.getByTestId('usecase-cart').click();
      await expect(page.getByTestId('box-drawer')).toHaveAttribute('data-box', 'cart');
    });

    // Expect at the end: {"actor":"buyer","useCase":"checkout","tag":"writes Order.status","linkedBox":"checkout"}.
    // In the shop record the use case and the linked box are cart.
    expect(report.permissionMatrix.buyer?.Order).toContain('write');
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
  const tmp = mkdtempSync(join(tmpdir(), 'rehearse-e2e-s7-'));
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
  // The path button on the story map opens the storyboard. The "Open storyboard" button of a card can be under the next card.
  await page.getByTestId(`glance-branch-${id}`).click();
  // A branch opens at its first own step: the shared opening counts as seen on the main path (S22).
  await expect(page.getByTestId('card-step-count')).toHaveText(new RegExp(`^Step \\d+ of ${steps}$`));
  const first = Number(/Step (\d+)/.exec((await page.getByTestId('card-step-count').textContent()) ?? '')![1]);
  for (let n = first + 1; n <= steps; n++) {
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
