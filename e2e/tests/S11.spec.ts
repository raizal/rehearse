// The e2e tests of story S11 ("to hand a signed story to an agent thread and watch its work in rehearse"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S11.yaml. Each step title
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
  const tmp = mkdtempSync(join(tmpdir(), 'rehearse-e2e-s11-'));
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
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: join(tmp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', PATH: `${join(tmp, 'bin')}:${process.env.PATH}` };
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
  await page.getByTestId(`story-scenario-open-${id}`).click();
  const approveButton = page.getByTestId('card-approve');
  for (let i = 0; i < 12 && !(await approveButton.isEnabled()); i++) await page.getByTestId('card-next-step').click();
  await expect(approveButton).toBeEnabled();
  await approveButton.click();
}

test('S11-brief: The brief of a signed story holds everything the agent builds to', async ({ page }) => {
  // The main path of S11: "done" needs this test passed on the real screens.
  // Checks S11-A1: given a signed story that is not stale; when rehearse makes its build brief; then the brief says who signed it, when, the rule-2 hash and that it matches; it holds the story, its requirements and criteria, the approved scenarios (drafts apart), the serving boxes with contracts, children and edges, the decisions, the entities, and how to work; it stays under about 6k tokens.
  // The shop record: story S1 has S1-buy and S1-empty. The builder approves S1-buy and keeps S1-empty a draft.
  test.setTimeout(180_000);
  const shop = signingShop();
  const { child, url } = await serveIn(shop.repo, shop.env);
  const buildButton = page.getByRole('button', { name: /Build with an agent/ });
  try {
    await test.step('sign-off: Sign off (UI button only)', async () => {
      // Step 1 of 5.
      await page.goto(url);
      await openStory(page);
      await approve(page, 'S1-buy');
      await expect.poll(() => scenarioBlock(shop.epicDir, 'S1', 'S1-buy')).toMatch(/status: approved/);
      expect(scenarioBlock(shop.epicDir, 'S1', 'S1-empty')).toMatch(/status: draft/);
      // Guess: the Sign-off page lists the stories with a check box each and a "Sign off" button.
      await page.getByTestId('nav-signoff').click();
      const s1 = page.getByRole('checkbox', { name: /S1\b/ });
      if ((await s1.count()) > 0) await s1.first().check();
      await page.getByRole('button', { name: /^Sign off/ }).first().click();
      await expect.poll(() => (JSON.parse(shop.rehearse('brief', EPIC, 'S1', '--json').out || '{}') as { sign?: { status?: string } }).sign?.status).toBe('signed');
    });

    await test.step('watch-build: The story\'s build panel - Build button, plan-changed notice and progress', async () => {
      // Step 2 of 5.
      // Example signed-story: given {"storyId":"S1","signed":true,"stale":false}; then {"button":"Build with an agent"}.
      await openStory(page);
      // Guess: the build panel is on the story page, or on a story tab named after the thread or the build.
      if (!(await buildButton.isVisible())) {
        const tab = page.locator('[data-testid^="story-tab-"]').filter({ hasText: /thread|build/i });
        if ((await tab.count()) > 0) await tab.first().click();
      }
      await expect(buildButton).toBeVisible();
      await expect(buildButton).toBeEnabled();
    });

    await test.step('start-build: Start a build thread, or send it the change', async () => {
      // Step 3 of 5.
      expect(shop.bbCalls().filter((a) => a[0] === 'thread' && a[1] === 'spawn')).toHaveLength(0);
      await buildButton.click();
      await expect.poll(() => shop.bbCalls().filter((a) => a[0] === 'thread' && a[1] === 'spawn').length).toBe(1);
    });

    await test.step('build-brief: Make the build brief of a signed story', async () => {
      // Step 4 of 5.
      // Example brief-content: given {"storyId":"S1"}; then {"header":["signed by","signed at","rule-2 hash","matches the signed story"],"sections":["Story","Approved scenarios","Boxes","Decisions","Entities","How to work in this repo"],"draftsApart":true,"underTokens":6000}.
      // The new thread got the brief of S1.
      const told = shop.prompts().join('\n');
      expect(told).toContain('Build brief: story S1');
      // The same brief, as `rehearse brief` prints it.
      const r = shop.rehearse('brief', EPIC, 'S1');
      expect(r.code, r.err).toBe(0);
      const brief = r.out;
      // The header: who signed, when, the rule-2 hash, and that it matches.
      expect(brief).toMatch(/Signed off by e2e@example\.com on \d{4}-\d\d-\d\dT[\d:]+Z, at story hash sha256:[0-9a-f]+… \(rule 2\)\./);
      expect(brief).toContain('This brief matches the signed story.');
      // The six sections, in this order.
      const sections = ['## Story', '## Approved scenarios', '## Boxes', '## Decisions', '## Entities', '## How to work in this repo'];
      const at = sections.map((s) => brief.indexOf(`\n${s}`));
      for (const [i, s] of sections.entries()) expect(at[i], s).toBeGreaterThan(0);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      // The story with its requirement and its criterion; the approved scenario, and the draft apart.
      expect(brief).toContain('As Buyer, I want to pay for my cart, so that I get my items.');
      expect(brief).toContain('R1 (functional): The buyer pays for an order.');
      expect(brief).toContain('S1-A1');
      const approved = brief.slice(brief.indexOf('\n## Approved scenarios'), brief.indexOf('\n## Boxes'));
      expect(approved).toContain('S1-buy');
      expect(approved).toMatch(/Not approved[\s\S]*S1-empty/);
      expect(approved.slice(0, approved.search(/Not approved/))).not.toContain('S1-empty');
      // The boxes with their contracts and edges, the decision, and the entity.
      expect(brief).toMatch(/### `cart`[\s\S]*inputs: items: list string/);
      expect(brief).toMatch(/### Edges[\s\S]*`cart` → `pay`/);
      expect(brief).toMatch(/## Decisions[\s\S]*D1/);
      expect(brief).toMatch(/## Entities[\s\S]*Order/);
      // About 4 characters a token: under 6000 tokens.
      expect(brief.length / 4).toBeLessThan(6000);
    });

    await test.step('watch-build: The story\'s build panel - Build button, plan-changed notice and progress', async () => {
      // Step 5 of 5.
      // The panel shows the new thread, and the link keeps the thread.
      await expect(page.getByText('thr_e2e1').first()).toBeVisible();
      const links = join(shop.repo, '.rehearse/story-threads.json');
      await expect.poll(() => (existsSync(links) ? readFileSync(links, 'utf8') : '')).toContain('thr_e2e1');
    });
  } finally {
    await stop(child);
    shop.remove();
  }

  // Expect at the end: {"briefSections":6,"draftsListedApart":true,"tokens":"< 6000"}.
});
