// The e2e tests of story S13 ("to hand a scenario that has no e2e test to an agent from the Tests tab"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S13.yaml. Each step title
// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.
// Work only from the scenarios and the product that runs (the UI and the CLI), not from the code of the boxes.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { CLI, expect, stop, test } from './serve.js';

const SHOP = fileURLToPath(new URL('../../packages/core/test/fixtures/shop', import.meta.url));
const EPIC = 'docs/epics/2026-11-05-shop';

/**
 * A fake `bb` for the test: it writes each call to bb.log, keeps the prompt of each spawned
 * thread in prompt-<thread>.txt, and answers in the JSON shapes of `bb guide json`. The test
 * never starts a real bb thread.
 */
function fakeBb(dir: string, repo: string): void {
  const script = `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const dir = ${JSON.stringify(dir)};
const repo = ${JSON.stringify(repo)};
const args = process.argv.slice(2);
appendFileSync(dir + '/bb.log', JSON.stringify(args) + '\\n');
const json = args.includes('--json');
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const file = dir + '/bb-state.json';
const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { threads: {} };
const say = (o, text) => { process.stdout.write((json ? JSON.stringify(o) : (text ?? JSON.stringify(o))) + '\\n'); };
const [a, b, c] = args;
if (a === 'thread' && b === 'spawn') {
  const pf = val('--prompt-file');
  const prompt = pf ? readFileSync(pf === '-' ? 0 : pf, 'utf8') : (val('--prompt') ?? '');
  const id = 'thr_e2e' + (Object.keys(state.threads).length + 1);
  const title = val('--title') ?? '';
  state.threads[id] = { id, title, status: 'active', branch: 'bb/e2e-' + id };
  writeFileSync(dir + '/prompt-' + id + '.txt', prompt + '\\n' + args.join(' '));
  writeFileSync(file, JSON.stringify(state));
  say({ id, status: 'active', title, projectId: 'proj_e2e', environmentId: 'env_' + id }, id);
} else if (a === 'thread' && b === 'show') {
  const t = state.threads[c] ?? { id: c, title: '', status: 'idle', branch: 'bb/e2e-' + c };
  say({ thread: { id: t.id, status: t.status, title: t.title, projectId: 'proj_e2e', environmentId: 'env_' + t.id },
    environment: { id: 'env_' + t.id, path: repo, branchName: t.branch }, pendingTodos: [] });
} else if (a === 'thread' && b === 'list') {
  say(Object.values(state.threads).map((t) => ({ id: t.id, title: t.title, status: t.status, projectId: 'proj_e2e' })));
} else if (a === 'thread' && b === 'tell') {
  say({ threadId: c, ok: true });
} else if (a === 'status') {
  say({ project: { id: 'proj_e2e', name: 'repo' } }, 'Project: repo (proj_e2e)');
} else if (a === 'project' && b === 'list') {
  say([{ id: 'proj_e2e', name: 'repo', path: repo, rootPath: repo }]);
} else if (a === '--version') {
  process.stdout.write('bb 0.0.0-e2e\\n');
} else {
  say({ ok: true }, '');
}
`;
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'bin/bb'), script);
  chmodSync(join(dir, 'bin/bb'), 0o755);
}

/**
 * A git repo in a temp folder with the shop record, a test SSH key that signs approvals and
 * sign-offs, and the fake bb on PATH. The box `cart` names a decision, so the brief has a
 * Decisions section. The test does not use the owner's key or the owner's bb.
 */
function signingShop() {
  const tmp = mkdtempSync(join(tmpdir(), 'rehearse-e2e-s13-'));
  const repo = join(tmp, 'repo');
  const epicDir = join(repo, EPIC);
  mkdirSync(join(repo, '.rehearse'), { recursive: true });
  cpSync(SHOP, epicDir, { recursive: true });
  const flow = readFileSync(join(epicDir, 'flow.yaml'), 'utf8');
  writeFileSync(join(epicDir, 'flow.yaml'), flow.replace('      title: Check out the cart\n', '      title: Check out the cart\n      decisions: [D1]\n'));
  writeFileSync(join(epicDir, 'brainstorm.md'), '# Brainstorm\n\n## Decisions\n\n- **D1 One cart per buyer**: A buyer has one open cart. The shop keeps no second cart.\n');
  const key = join(tmp, 'key');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'e2e', '-f', key]);
  writeFileSync(join(repo, '.rehearse/allowed_signers'), `e2e@example.com namespaces="rehearse" ${readFileSync(`${key}.pub`, 'utf8')}`);
  writeFileSync(join(tmp, 'gitconfig'), `[user]\n\tname = e2e\n\temail = e2e@example.com\n\tsigningkey = ${key}\n[gpg]\n\tformat = ssh\n[commit]\n\tgpgsign = false\n`);
  fakeBb(tmp, repo);
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: join(tmp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', PATH: `${join(tmp, 'bin')}:${process.env.PATH}`, REHEARSE_BB_PROJECT: 'proj_e2e' };
  for (const k of Object.keys(env)) if (k.startsWith('BB_')) delete env[k];
  delete env.SSH_AUTH_SOCK;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'the shop record');
  const rehearse = (...args: string[]) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const bbCalls = (): string[][] =>
    existsSync(join(tmp, 'bb.log')) ? readFileSync(join(tmp, 'bb.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]) : [];
  const prompts = (): string[] => readdirSync(tmp).filter((f) => f.startsWith('prompt-')).map((f) => readFileSync(join(tmp, f), 'utf8'));
  return { tmp, repo, epicDir, env, rehearse, bbCalls, prompts, remove: () => rmSync(tmp, { recursive: true, force: true }) };
}

/** Start `rehearse serve` in the repo with its env, and wait for the URL and the signing line. */
function serveIn(repo: string, env: NodeJS.ProcessEnv): Promise<{ child: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, 'serve', EPIC, '--port', '0'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
        resolve({ child, url: m[0] });
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
  const next = text.indexOf('\n  - id: ', start + 1);
  return start < 0 ? '' : text.slice(start, next < 0 ? undefined : next);
}

/** Open story S1 from the Stories list. */
async function openStory(page: Page): Promise<void> {
  await page.getByTestId('nav-stories').click();
  await page.getByTestId('queue-story-S1').click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('to pay for my cart');
}

/** Play every step of a scenario on its storyboard, then press Approve. */
async function approve(page: Page, id: string): Promise<void> {
  await page.getByTestId(`glance-branch-${id}`).click(); // The path button on the story map: the "Open storyboard" button of a card can be under the next card.
  const approveButton = page.getByTestId('card-approve');
  for (let i = 0; i < 12 && !(await approveButton.isEnabled()); i++) await page.getByTestId('card-next-step').click();
  await expect(approveButton).toBeEnabled();
  await approveButton.click();
}

test('S13-all: The summary line writes all K missing tests in one thread', async ({ page }) => {
  // The main path of S13: "done" needs this test passed on the real screens.
  // Checks S13-A2: given a story with K approved scenarios without an e2e test; when the builder presses "Write the K missing tests with an agent" on the summary line; then one thread starts with the test brief of all K scenarios.
  // The shop record: the builder approves both scenarios of S1 (S1-buy and S1-empty). The repo has a
  // test project with no test yet, so K is 2.
  test.setTimeout(180_000);
  const shop = signingShop();
  mkdirSync(join(shop.repo, 'e2e/tests'), { recursive: true });
  writeFileSync(join(shop.repo, 'e2e/playwright.config.ts'), "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './tests' });\n");
  execFileSync('git', ['add', '-A'], { cwd: shop.repo, env: shop.env });
  execFileSync('git', ['commit', '-q', '-m', 'an empty test project'], { cwd: shop.repo, env: shop.env });
  const { child, url } = await serveIn(shop.repo, shop.env);
  const writeMissing = page.getByRole('button', { name: /Write the 2 missing tests with an agent/ });
  const spawns = () => shop.bbCalls().filter((a) => a[0] === 'thread' && a[1] === 'spawn');
  try {
    await test.step('test-rows: No-test rows and the story\'s test thread on the Tests tab', async () => {
      // Step 1 of 4.
      // Example all-missing: given {"storyId":"S4","missing":["S4-drill","S4-back"]}; then {"summaryButton":"Write the 2 missing tests with an agent","decision":"write-missing"}.
      await page.goto(url);
      await openStory(page);
      await approve(page, 'S1-buy');
      await expect.poll(() => scenarioBlock(shop.epicDir, 'S1', 'S1-buy')).toMatch(/status: approved/);
      // The storyboard has no review queue: start again from the first page.
      await page.goto(url);
      await openStory(page);
      await approve(page, 'S1-empty');
      await expect.poll(() => scenarioBlock(shop.epicDir, 'S1', 'S1-empty')).toMatch(/status: approved/);
      // The storyboard has no review queue: start again from the first page.
      await page.goto(url);
      await openStory(page);
      // Guess: the Tests tab of the story has the test id story-tab-tests, as the Design tab has story-tab-design.
      await page.getByTestId('story-tab-tests').click();
      await expect(page.getByText(/S1-buy/).first()).toBeVisible();
      await expect(page.getByText(/S1-empty/).first()).toBeVisible();
      await expect(page.getByText(/no test/i).first()).toBeVisible();
      await expect(writeMissing).toBeVisible();
      await expect(writeMissing).toBeEnabled();
    });

    await test.step('start-test-thread: Start the story\'s test thread, or send it more scenarios', async () => {
      // Step 2 of 4.
      // Example spawn-all: given {"storyId":"S4","scenarios":["S4-drill","S4-back"]}; then {"title":"Tests: S4 S4-drill S4-back"}.
      expect(spawns()).toHaveLength(0);
      await writeMissing.click();
      await expect.poll(() => spawns().length).toBe(1);
      const args = spawns()[0]!;
      expect(args[args.indexOf('--title') + 1]).toBe('Tests: S1 S1-buy S1-empty');
    });

    await test.step('test-brief: Make the test brief of approved scenarios', async () => {
      // Step 3 of 4.
      // The one thread got the test brief of both scenarios.
      const prompts = shop.prompts();
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toMatch(/Test brief/);
      expect(prompts[0]).toContain('S1-buy');
      expect(prompts[0]).toContain('S1-empty');
      // `rehearse brief --tests` gives the same brief: one test for each scenario, in one spec file.
      const r = shop.rehearse('brief', EPIC, 'S1', '--tests');
      expect(r.code, r.err).toBe(0);
      expect(r.out).toMatch(/^# Test brief: e2e tests for S1-buy, S1-empty/);
      expect(prompts[0]).toContain(r.out.split('\n')[0]!);
    });

    await test.step('test-rows: No-test rows and the story\'s test thread on the Tests tab', async () => {
      // Step 4 of 4.
      // The Tests tab shows the story's test thread with its 2 scenarios, and no second thread starts.
      await expect(page.getByText('thr_e2e1').first()).toBeVisible();
      await expect(writeMissing).toHaveCount(0);
      expect(spawns()).toHaveLength(1);
    });
  } finally {
    await stop(child);
    shop.remove();
  }

  // Expect at the end: {"threads":1,"scenarios":["S4-drill","S4-back"]}.
});
