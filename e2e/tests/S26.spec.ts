// The e2e tests of story S26 ("a real-screen test of each story's main path, written from its scenarios by a separate thread, and 'done' to need it"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S26.yaml. Each step title
// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.
// Work only from the scenarios and the product that runs (the UI and the CLI), not from the code of the boxes.

import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI, expect, stop, test } from './serve.js';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SIGNED = join(REPO, 'packages/core/test/fixtures/code-graph-signed');
const EPIC = 'docs/epics/2026-11-05-code-graph';
const SPEC = 'e2e/tests/S10.spec.ts';

/**
 * A git repo with a copy of the code-graph-signed fixture: S10 is signed and not stale. A Flow-Box
 * commit builds its one box, and an e2e project is in the repo. The environment has no bb on the
 * PATH and no BB_ variables, so "Write tests" cannot start a real thread.
 */
function builtStory(): { repo: string; birdview: string; env: NodeJS.ProcessEnv; git: (...a: string[]) => string; remove: () => void } {
  const tmp = mkdtempSync(join(tmpdir(), 'rehearse-e2e-s26-'));
  const repo = join(tmp, 'repo');
  const birdview = join(tmp, 'birdview-data');
  mkdirSync(birdview);
  writeFileSync(join(tmp, 'gitconfig'), '');
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: join(tmp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of Object.keys(env)) if (key.startsWith('BB_')) delete env[key];
  delete env.SSH_AUTH_SOCK;
  env.PATH = [dirname(process.execPath), '/usr/bin', '/bin'].join(':');
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...a], { cwd: repo, env, encoding: 'utf8' });
  cpSync(SIGNED, repo, { recursive: true });
  mkdirSync(join(repo, '.rehearse'));
  cpSync(join(REPO, '.rehearse/allowed_signers'), join(repo, '.rehearse/allowed_signers'));
  mkdirSync(join(repo, 'e2e/tests'), { recursive: true });
  writeFileSync(join(repo, 'e2e/playwright.config.ts'), 'export default {};\n');
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '--no-gpg-sign', '-m', 'signed EPIC');
  git('commit', '-q', '--no-gpg-sign', '--allow-empty', '-m', 'build bench', '-m', 'Flow-Box: bench');
  return { repo, birdview, env, git, remove: () => rmSync(tmp, { recursive: true, force: true }) };
}

/**
 * Save a result of one test in a Birdview data folder of the test's own: projects.json names the
 * e2e project, and projects/<name>-<hash>/results.json has the result by file:line. This is not the
 * data folder of the real Birdview.
 */
function saveResult(birdview: string, repo: string, key: string, last: 'passed' | 'failed') {
  const projectDir = realpathSync(join(repo, 'e2e'));
  const folder = join(birdview, 'projects', `e2e-${createHash('sha1').update(projectDir).digest('hex').slice(0, 8)}`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(birdview, 'projects.json'), JSON.stringify({ projects: [{ projectDir }] }));
  writeFileSync(join(folder, 'results.json'), JSON.stringify({ [key]: { last, at: Date.now() } }));
}

/** Start `rehearse serve` in `repo` and wait for its URL. Birdview is on a port that nothing uses. */
function serveIn(repo: string, epicDir: string, env: NodeJS.ProcessEnv): Promise<{ child: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, 'serve', epicDir, '--port', '0', '--birdview-port', '1'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

test('S26-main-path-done: The test thread writes the main path test, it passes on the real screens, and the story is done', async ({ page }) => {
  // The main path of S26: "done" needs this test passed on the real screens.
  // Checks S26-A6: given a story that is signed, not stale and built; when the deck, the Status page, `rehearse status` or `rehearse progress` decides if it is done; then it is done only when its main path test passed on the real screens in its last run and no test of it fails; this rule replaces the done rule of S20 and S23.
  const story = builtStory();
  const { child, url } = await serveIn(story.repo, join(story.repo, EPIC), story.env);
  const rehearse = (...args: string[]) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: story.repo, env: story.env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const statusRow = () => /^S10\s.*$/m.exec(rehearse('status', EPIC, '--birdview-data', story.birdview).out)?.[0] ?? '';
  try {
    await test.step('write-tests: Click "Write tests" on a story', async () => {
      // Example click: given {"epic":"2026-11-05-rehearse","story":"S10"}; then {"storyId":"S10"}.
      await page.goto(`${url.replace(/#.*$/, '')}#/stories/S10/what`);
      // The Tests tab has the button "Write the N missing tests with an agent". No bb is on the PATH, so no real thread starts.
      await page.getByTestId('story-tab-tests').click(); await page.getByTestId('story-tests-write-all').click();
      await expect(page.getByText(/S10/).first()).toBeVisible();
    });

    await test.step('test-thread: Start a separate test thread, the main path first', async () => {
      // The test thread gets the test brief: the main path is first.
      const brief = rehearse('brief', EPIC, 'S10', '--tests');
      expect(brief.code, brief.out).toBe(0);
      expect(brief.out).toContain('The main path of this story is S10-cold-bench, the first scenario below. Write the main path test first.');
      expect(brief.out.indexOf('## S10-cold-bench:')).toBeLessThan(brief.out.indexOf('## S10-warm-bench:'));
    });

    await test.step('e2e-start: rehearse e2e-start <epic> <story> [--scenario <id>] [--main-path]', async () => {
      const start = rehearse('e2e-start', EPIC, 'S10', '--main-path');
      expect(start.code, start.out).toBe(0);
      expect(start.out).toContain(`Wrote ${SPEC}: a test for S10-cold-bench (S10-cold-bench is the main path).`);
      const spec = readFileSync(join(story.repo, SPEC), 'utf8');
      expect(spec).toContain("test('S10-cold-bench: CI measures a cold index of 1,000 files'");
      expect(spec).not.toContain("test('S10-warm-bench:");
      expect(spec).toContain("throw new Error('not written: S10-cold-bench step 1 (bench-start)')");
      // Before a run, the story is not done.
      expect(statusRow()).toContain('not seen working yet');
    });

    await test.step('main-path-test: Write the main path test and run it on the real screens', async () => {
      // Example passed: given {"specFile":"e2e/tests/S10.spec.ts"}; then {"run":"S10-pass passed on the real screens"}.
      // The test thread writes each step. Then the run passes, and Birdview saves the result by file:line.
      const file = join(story.repo, SPEC);
      const spec = readFileSync(file, 'utf8').replace(/throw new Error\('not written: [^']*'\);/g, 'expect(true).toBe(true);');
      writeFileSync(file, spec);
      expect(spec).not.toContain('not written');
      const line = spec.split('\n').findIndex((l) => l.startsWith("test('S10-cold-bench:")) + 1;
      expect(line).toBeGreaterThan(0);
      saveResult(story.birdview, story.repo, `tests/S10.spec.ts:${line}`, 'passed');
      expect(existsSync(join(story.birdview, 'projects.json'))).toBe(true);
    });

    await test.step('done-seen: Done needs the main path test passed on the real screens', async () => {
      // Example done: given {"signed":"yes","stale":"no","built":"all boxes","mainPath":"passed","failing":0}; then {"done":"done · main path seen working"}.
      const row = statusRow();
      expect(row).toMatch(/^S10\s+yes\s+1 of 1 box\s+1 of 3 passed\s/);
      expect(row).toContain('done · main path seen working (1 of 3)');
    });

    await test.step('done-shown: Show done, the level and what is missing', async () => {
      const status = rehearse('status', EPIC, '--birdview-data', story.birdview).out;
      expect(status).toContain('1 of 10 stories done');
      expect(status).toContain('real screens: Birdview\'s saved results');
      // What is still missing is said, with who acts.
      expect(statusRow()).toContain('2 other scenarios without a real-screen test: test thread');
      // The Status page shows the same row. The page reads the live player, and not this data folder,
      // so the page checks only the facts that do not need the run.
      await page.getByTestId('nav-status').click();
      const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /^S10 / }) }); // The row header is the story id and its title.
      await expect(row).toContainText('yes');
      await expect(row).toContainText('1 of 1 box');
    });

    await test.step('seen-known: The builder knows the story works on the real screens, or what is missing', async () => {
      // Expect at the end: S10 is done. The record has no change: only the e2e project is new.
      expect(statusRow()).toMatch(/done · main path seen working/);
      expect(story.git('status', '--porcelain', '--', 'docs')).toBe('');
    });
  } finally {
    await stop(child);
    story.remove();
  }

  // Expect at the end: {"S10":"done","rule":"signed, not stale, built, main path passed in its last run, no test fails"}.
});
