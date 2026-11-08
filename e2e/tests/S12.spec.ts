// The e2e tests of story S12 ("to play a story's e2e tests in Birdview with one button"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S12.yaml. Each step title
// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.
// Work only from the scenarios and the product that runs (the UI and the CLI), not from the code of the boxes.
//
// This test runs in the real Birdview player. If it also drove that player (switch the project, write a
// playlist, play), it would stop itself. So the test starts a second Birdview player of its own: the
// player server of the plugin, on a free port, with a temporary data folder, a temporary default project
// and a temporary playlists folder. `rehearse serve --birdview-port` talks to that second player only.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { CLI, expect, stop, test } from './serve.js';

const SHOP = fileURLToPath(new URL('../../packages/core/test/fixtures/shop', import.meta.url));
const E2E_MODULES = fileURLToPath(new URL('../node_modules', import.meta.url));
const EPIC = 'docs/epics/2026-11-05-shop';
/** The port of the real Birdview player (the plugin default). The test never calls it. */
const REAL_PLAYER_PORT = 3298;

/** The player server of the Birdview plugin. The real player gives its folder in E2E_PLAYER_DIR. */
function playerServer(): string {
  const dirs = [process.env.E2E_PLAYER_DIR, join(homedir(), 'projects/bb-plugin-birdview-e2e/player')];
  const found = dirs.filter((d): d is string => !!d).map((d) => join(d, 'server.mjs')).find((f) => existsSync(f));
  if (!found) throw new Error(`no Birdview player server.mjs in ${dirs.join(' or ')}`);
  return found;
}

/** A free TCP port on 127.0.0.1. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      s.close(() => (a && typeof a === 'object' ? resolve(a.port) : reject(new Error('no port'))));
    });
  });
}

/**
 * The env of a child process, without the values of the real player and of the outer Playwright run.
 * The real player gives its port, its data folder and its pause file in E2E_PLAYER_*; a child must not see them.
 */
function cleanEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(E2E_PLAYER_|PW_|PLAYWRIGHT_|TEST_|BB_|REHEARSE_)/.test(k) || k === 'NODE_OPTIONS') continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}

/** A Playwright test project with one spec file. Its tests use no browser, so they pass at once. */
function testProject(dir: string, spec: string, titles: string[]): void {
  mkdirSync(join(dir, 'tests'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{ "name": "e2e", "private": true, "type": "module" }\n');
  writeFileSync(join(dir, 'playwright.config.ts'), "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './tests' });\n");
  writeFileSync(
    join(dir, 'tests', spec),
    "import { expect, test } from '@playwright/test';\n\n" +
      titles.map((t) => `test('${t}', async () => {\n  expect(1 + 1).toBe(2);\n});\n`).join('\n'),
  );
  // The player runs `playwright test` in this folder: it finds @playwright/test of the repo's e2e project.
  symlinkSync(E2E_MODULES, join(dir, 'node_modules'), 'dir');
}

/** A fake `bb` on PATH: the serve gets no real thread and no real project. */
function fakeBb(bin: string): void {
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'bb'), `#!${process.execPath}\nconst a = process.argv.slice(2);\nprocess.stdout.write(a[1] === 'list' ? '[]\\n' : '{}\\n');\n`);
  chmodSync(join(bin, 'bb'), 0o755);
}

type Player = { port: number; url: string; child: ChildProcess; log: () => string };

/** Start the second Birdview player and wait for /health. */
async function startPlayer(o: { data: string; projectDir: string; playlistsDir: string }): Promise<Player> {
  const port = await freePort();
  const cdpPort = await freePort();
  if ([REAL_PLAYER_PORT, Number(process.env.E2E_PLAYER_PORT)].includes(port)) throw new Error(`port ${port} is the real player's port`);
  const env = cleanEnv({
    E2E_PLAYER_PORT: String(port),
    E2E_PLAYER_CDP_PORT: String(cdpPort),
    E2E_PLAYER_DATA_DIR: o.data,
    E2E_PLAYER_RECORDINGS: join(o.data, 'recordings'),
    E2E_PLAYER_PROJECT_DIR: o.projectDir,
    E2E_PLAYER_PLAYLISTS_DIR: o.playlistsDir,
    E2E_PLAYER_NODE: process.execPath,
  });
  const child = spawn(process.execPath, [playerServer()], { cwd: o.data, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout!.on('data', (c: Buffer) => (out += c.toString()));
  child.stderr!.on('data', (c: Buffer) => (out += c.toString()));
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`the second Birdview player exited with ${child.exitCode}:\n${out}`);
    const ok = await fetch(`${url}/health`).then((r) => r.ok, () => false);
    if (ok) return { port, url, child, log: () => out };
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill('SIGTERM');
  throw new Error(`the second Birdview player did not answer in 10 s:\n${out}`);
}

/** Read the second player (GET only). */
async function playerGet<T>(player: Player, path: string): Promise<T> {
  const r = await fetch(`${player.url}${path}`);
  return (await r.json()) as T;
}
type Projects = { active: { projectDir: string; playlistsDir: string; playlist: string | null } | null; default: string | null };
type PlayerState = { status: string; queue: string[]; results: Record<string, { last?: string }> };

/** Start `rehearse serve` on the repo, pointed at the second player, and wait for its URL. */
function serveOn(repo: string, env: NodeJS.ProcessEnv, birdviewPort: number): Promise<{ child: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, 'serve', EPIC, '--port', '0', '--birdview-port', String(birdviewPort)], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`rehearse serve printed no URL in 15 s:\n${out}`));
    }, 15_000);
    const read = (c: Buffer) => {
      out += c.toString();
      const m = /http:\/\/127\.0\.0\.1:\d+\/\S*/.exec(out);
      if (m) {
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

/** Open the Tests tab of story S1. */
async function openTests(page: Page): Promise<void> {
  await page.getByTestId('nav-stories').click();
  await page.getByTestId('queue-story-S1').click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('to pay for my cart');
  await page.getByTestId('story-tab-tests').click();
}

test('S12-switch: Birdview on another project - the notice, Play switches it, Switch back returns it', async ({ page }) => {
  // The main path of S12: "done" needs this test passed on the real screens.
  // Checks S12-A3: given Birdview plays another project; when the builder opens the Tests tab, plays, or clicks "Switch back"; then the tab says "Birdview is on <other project>. Play will switch it to this repo."; Play switches it; "Switch back" returns the player to its default project.
  // The real Birdview waits before each action of this test, so the test gets more time, as S11 does.
  test.setTimeout(180_000);
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'rehearse-e2e-s12-')));
  // The repo: the shop record, and its e2e test project with a test for each S1 scenario.
  const repo = join(tmp, 'repo');
  const thisProject = join(repo, 'e2e');
  mkdirSync(repo, { recursive: true });
  cpSync(SHOP, join(repo, EPIC), { recursive: true });
  testProject(thisProject, 'S1.spec.ts', ['S1-buy', 'S1-empty']);
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n');
  // The other project: the default project of the second player.
  const otherProject = join(tmp, 'other-app', 'e2e');
  testProject(otherProject, 'other.spec.ts', ['other test']);
  const data = join(tmp, 'birdview-data');
  mkdirSync(data, { recursive: true });
  fakeBb(join(tmp, 'bin'));
  const env = cleanEnv({
    PATH: `${join(tmp, 'bin')}:${process.env.PATH}`,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'e2e',
    GIT_AUTHOR_EMAIL: 'e2e@example.com',
    GIT_COMMITTER_NAME: 'e2e',
    GIT_COMMITTER_EMAIL: 'e2e@example.com',
    // The serve reads results from the second player's data folder, never from the real one.
    REHEARSE_BIRDVIEW_DATA: data,
  });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'the shop record and its test project');

  const player = await startPlayer({ data, projectDir: otherProject, playlistsDir: join(tmp, 'other-app', 'playlists') });
  let serve: ChildProcess | undefined;
  const notice = page.getByText(/Birdview is on .+\. Play will switch it to this repo\./);
  try {
    const { child, url } = await serveOn(repo, env, player.port);
    serve = child;
    // Given: Birdview plays another project.
    expect((await playerGet<Projects>(player, '/api/projects')).active?.projectDir).toBe(otherProject);

    await test.step('story-playlist: Story playlist and Play in Birdview', async () => {
      // Step 1 of 5.
      // Example other-project: given {"storyId":"S4","birdview":{"project":"eudr-fe"}}; then {"notice":"Birdview is on eudr-fe. Play will switch it to this repo.","link":"Switch back"}.
      await page.goto(url);
      await openTests(page);
      await expect(notice).toBeVisible();
      await expect(notice).toContainText('other-app');
      await expect(page.getByRole('button', { name: 'Play in Birdview' })).toBeVisible();
      // The tab only reads the player: the player stays on the other project.
      expect((await playerGet<Projects>(player, '/api/projects')).active?.projectDir).toBe(otherProject);
    });

    await test.step('play-story: Play the story in Birdview', async () => {
      // Step 2 of 5.
      await page.getByRole('button', { name: 'Play in Birdview' }).click();
      // Play switches the second player to this repo's test project, writes the story playlist there and plays it.
      await expect.poll(async () => (await playerGet<Projects>(player, '/api/projects')).active?.projectDir, { timeout: 15_000 }).toBe(thisProject);
      const playlistsDir = (await playerGet<Projects>(player, '/api/projects')).active!.playlistsDir;
      expect(playlistsDir.startsWith(tmp)).toBe(true);
      const files = () => (existsSync(playlistsDir) ? readdirSync(playlistsDir).filter((f) => f.endsWith('.json')) : []);
      await expect.poll(() => files().length, { timeout: 15_000 }).toBe(1);
      expect(readFileSync(join(playlistsDir, files()[0]!), 'utf8')).toContain('S1');
      // Both S1 tests ran in the second player and passed.
      await expect
        .poll(async () => {
          const s = await playerGet<PlayerState>(player, '/api/state');
          const passed = Object.entries(s.results).filter(([k, r]) => k.includes('S1.spec.ts') && r.last === 'passed').length;
          return s.status === 'idle' && s.queue.length === 0 ? passed : -1;
        }, { timeout: 60_000 })
        .toBe(2);
    });

    await test.step('story-playlist: Story playlist and Play in Birdview', async () => {
      // Step 3 of 5.
      // The player is on this repo now: the notice is gone, and the Birdview line names this repo's playlist.
      await expect(notice).toHaveCount(0);
      await expect(page.getByText(/Birdview: .+ · playlist .*S1/).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Switch back' }).or(page.getByRole('link', { name: 'Switch back' })).first()).toBeVisible();
    });

    await test.step('use-project: Switch Birdview back', async () => {
      // Step 4 of 5.
      // Example switch-back: given {"to":"default"}; then {"project":"eudr-fe"}.
      await page.getByRole('button', { name: 'Switch back' }).or(page.getByRole('link', { name: 'Switch back' })).first().click();
      await expect.poll(async () => (await playerGet<Projects>(player, '/api/projects')).active?.projectDir, { timeout: 15_000 }).toBe(otherProject);
    });

    await test.step('story-playlist: Story playlist and Play in Birdview', async () => {
      // Step 5 of 5.
      // The player is on its default project again: the tab shows the notice again.
      const projects = await playerGet<Projects>(player, '/api/projects');
      expect(projects.default).toBe(otherProject);
      expect(projects.active?.projectDir).toBe(projects.default);
      await expect(notice).toBeVisible();
      await expect(notice).toContainText('other-app');
    });
  } catch (error) {
    throw new Error(`${(error as Error).message}\n--- second Birdview player log ---\n${player.log().slice(-2000)}`);
  } finally {
    if (serve) await stop(serve);
    await stop(player.child);
    rmSync(tmp, { recursive: true, force: true });
  }

  // Expect at the end: {"switched":true,"switchedBack":"default"}.
});
