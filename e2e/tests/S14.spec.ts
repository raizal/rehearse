// The e2e tests of story S14 ("to merge the work of an agent thread into my branch with one button, after seeing what it brings"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S14.yaml. Each step title
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
    environment: { id: 'env_' + t.id, path: t.path ?? repo, branchName: t.branch }, pendingTodos: [] });
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
  const tmp = mkdtempSync(join(tmpdir(), 'rehearse-e2e-s14-'));
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

/** Open a story (S1 by default) from the review queue on the story page. */
async function openStory(page: Page, story = 'S1'): Promise<void> {
  await page.getByTestId('nav-stories').click();
  await page.getByTestId(`queue-story-${story}`).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(story === 'S1' ? 'to pay for my cart' : 'to ship paid orders');
}

/** Play every step of a scenario on its storyboard, then press Approve. */
async function approve(page: Page, id: string): Promise<void> {
  await page.getByTestId(`glance-branch-${id}`).click(); // The path button on the story map: the "Open storyboard" button of a card can be under the next card.
  const approveButton = page.getByTestId('card-approve');
  for (let i = 0; i < 12 && !(await approveButton.isEnabled()); i++) await page.getByTestId('card-next-step').click();
  await expect(approveButton).toBeEnabled();
  await approveButton.click();
}

const TRAILER = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';

test('S14-merge: Merge into main merges the idle thread\'s branch with --no-ff and the thread\'s title', async ({ page }) => {
  // The main path of S14: "done" needs this test passed on the real screens.
  // Checks S14-A2: given that summary, and a thread bb says is idle or done; when the builder presses "Merge into <current branch>" and confirms the summary; then rehearse runs `git merge --no-ff <branch>` in serve's checkout with the message "Merge <thread title>" and the Co-Authored-By line the repo uses; the summary then says nothing is left to merge.
  // Before the steps: story S1 of a copy of the shop record is signed in the UI with a test key, and
  // "Build with an agent" starts a build thread in the fake bb. The thread's worktree gets 2 commits,
  // and bb says the thread is idle.
  test.setTimeout(180_000);
  const shop = signingShop();
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: shop.env, encoding: 'utf8' });
  writeFileSync(join(shop.repo, '.gitignore'), '.rehearse/story-threads.json\n.rehearse/graph.db*\n');
  git(shop.repo, 'add', '-A');
  git(shop.repo, 'commit', '-q', '-m', 'Ignore the local files of rehearse', '-m', TRAILER);
  const { child, url } = await serveIn(shop.repo, shop.env);
  const mergeButton = page.getByRole('button', { name: /^Merge into main/ });
  const wt = join(shop.tmp, 'thread-worktree');
  let branch = '';
  let title = '';
  page.on('dialog', (d) => void d.accept());
  try {
    // The gate lets the owner sign off S1 only when each branch on its path has an approved scenario.
    for (const [story, id] of [['S1', 'S1-buy'], ['S1', 'S1-empty'], ['S2', 'S2-out-of-stock']] as const) {
      await page.goto(url);
      await openStory(page, story);
      await approve(page, id);
      await expect.poll(() => scenarioBlock(shop.epicDir, story, id)).toMatch(/status: approved/);
    }
    await page.getByTestId('nav-signoff').click();
    await page.getByRole('checkbox', { name: /^S1 / }).check();
    await page.getByTestId('signoff-button').click();
    // A dialog shows what the owner agrees to. The owner confirms it.
    await expect(page.getByTestId('signoff-confirm-stories')).toHaveText('S1');
    await page.getByTestId('signoff-confirm').click();
    await expect.poll(() => (JSON.parse(shop.rehearse('brief', EPIC, 'S1', '--json').out || '{}') as { sign?: { status?: string } }).sign?.status).toBe('signed');
    git(shop.repo, 'add', '-A');
    git(shop.repo, 'commit', '-q', '-m', 'Approve the scenarios and sign off S1', '-m', TRAILER);
    await page.goto(url);
    await openStory(page);
    const buildButton = page.getByRole('button', { name: /Build with an agent/ });
    // The story thread rail, with the build panel, is on the Code tab of the story.
    await page.getByTestId('story-tab-code').click();
    await buildButton.click();
    await expect.poll(() => shop.bbCalls().filter((a) => a[0] === 'thread' && a[1] === 'spawn').length).toBe(1);
    // The build thread works in its own worktree, on its own branch, and makes 2 commits.
    const stateFile = join(shop.tmp, 'bb-state.json');
    const state = JSON.parse(readFileSync(stateFile, 'utf8')) as { threads: Record<string, { title: string; branch: string; status: string; path?: string }> };
    const thread = state.threads['thr_e2e1']!;
    branch = thread.branch;
    title = thread.title;
    expect(title).not.toBe('');
    git(shop.repo, 'worktree', 'add', '-q', '-b', branch, wt);
    mkdirSync(join(wt, 'src'));
    writeFileSync(join(wt, 'src/cart.ts'), 'export function checkOut(items: string[]): string {\n  return items.join(",");\n}\n');
    git(wt, 'add', '-A');
    git(wt, 'commit', '-q', '-m', 'T1: check out the cart', '-m', `Flow-Box: cart\n${TRAILER}`);
    mkdirSync(join(wt, 'test'));
    writeFileSync(join(wt, 'test/cart.test.ts'), 'import { checkOut } from "../src/cart.js";\nconsole.log(checkOut(["a"]));\n');
    git(wt, 'add', '-A');
    git(wt, 'commit', '-q', '-m', 'T1: test the cart', '-m', `Flow-Box: cart\n${TRAILER}`);
    thread.status = 'idle';
    thread.path = wt;
    writeFileSync(stateFile, JSON.stringify(state));

    await test.step('merge-panel: The merge summary, Merge into <current branch>, and play after a test merge', async () => {
      // Step 1 of 5.
      // The builder opens the story's thread panel again: it shows the build thread.
      await page.goto(url);
      await openStory(page);
      await page.getByTestId('story-tab-code').click();
      await expect(page.getByText('thr_e2e1').first()).toBeVisible();
    });

    await test.step('thread-branch: What the thread\'s branch has that the current branch has not', async () => {
      // Step 2 of 5.
      // The branch of the thread has 2 commits and 2 files that main has not.
      expect(git(shop.repo, 'rev-list', '--count', `main..${branch}`).trim()).toBe('2');
      await expect(page.getByText('2 commits in the thread, not in main yet').first()).toBeVisible();
      await expect(page.getByText('T1: check out the cart').first()).toBeVisible();
      await expect(page.getByText('T1: test the cart').first()).toBeVisible();
      // The file list is folded under "2 files": the builder opens it.
      await page.getByTestId('merge-build-files').getByText('2 files').click();
      await expect(page.getByText('src/cart.ts').first()).toBeVisible();
      await expect(page.getByText('test/cart.test.ts').first()).toBeVisible();
    });

    await test.step('merge-panel: The merge summary, Merge into <current branch>, and play after a test merge', async () => {
      // Step 3 of 5.
      // bb says the thread is idle, so the merge button is on.
      await expect(mergeButton).toBeVisible();
      await expect(mergeButton).toBeEnabled();
    });

    await test.step('merge-thread: Merge the thread\'s branch into serve\'s checkout', async () => {
      // Step 4 of 5.
      // Example merge-no-ff: given {"storyId":"S4","kind":"build","thread":{"status":"idle","title":"Build S4"}}; then {"git":"git merge --no-ff bb/build-s4","message":"Merge Build S4","trailer":"Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"}.
      const before = git(shop.repo, 'rev-parse', 'HEAD').trim();
      await mergeButton.click();
      // The builder confirms the summary: 2 commits of the branch, with git merge --no-ff and the title.
      await expect(page.getByTestId('merge-build-confirm')).toContainText(`Merge 2 commits of ${branch} into main with git merge --no-ff`);
      await expect(page.getByTestId('merge-build-confirm')).toContainText(`The commit says “Merge ${title}”`);
      await page.getByTestId('merge-build-yes').click();
      await expect.poll(() => git(shop.repo, 'rev-parse', 'HEAD').trim()).not.toBe(before);
      // A merge commit (--no-ff): 2 parents, the old HEAD and the thread's branch.
      const parents = git(shop.repo, 'log', '-1', '--format=%P').trim().split(' ');
      expect(parents).toEqual([before, git(shop.repo, 'rev-parse', branch).trim()]);
      expect(git(shop.repo, 'log', '-1', '--format=%s').trim()).toBe(`Merge ${title}`);
      expect(git(shop.repo, 'log', '-1', '--format=%b')).toContain(TRAILER);
      expect(git(shop.repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
      expect(existsSync(join(shop.repo, 'src/cart.ts'))).toBe(true);
    });

    await test.step('merge-panel: The merge summary, Merge into <current branch>, and play after a test merge', async () => {
      // Step 5 of 5.
      // Example nothing-left: given {"storyId":"S4","kind":"build"}; then {"text":"Nothing in the thread that main does not have."}.
      await expect(page.getByText('Nothing in the thread that main does not have.').first()).toBeVisible();
      expect(git(shop.repo, 'rev-list', '--count', `main..${branch}`).trim()).toBe('0');
      await expect(mergeButton).toHaveCount(0);
    });
  } finally {
    await stop(child);
    shop.remove();
  }

  // Expect at the end: {"merged":true,"commitsLeft":0}.
});
