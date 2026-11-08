// The e2e tests of story S27 ("to add a small change to a signed story, with 5 scenarios or fewer, and approve only the new scenarios"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S27.yaml. Each step title
// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.
// Work only from the scenarios and the product that runs (the UI and the CLI), not from the code of the boxes.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page } from '@playwright/test';
import { CLI, expect, stop, test } from './serve.js';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SIGNED = join(REPO, 'packages/core/test/fixtures/code-graph-signed');
const EPIC = 'docs/epics/2026-11-05-code-graph';
const CHANGE = join(EPIC, 'changes/C1.yaml');

/**
 * A git repo with a copy of the code-graph-signed fixture: story S10 is signed and its scenarios are
 * approved. The repo's git config signs with a new SSH key with no passphrase. allowed_signers lists
 * the signers of the fixture and this key. The test does not use the owner's ssh-agent or global git
 * config, and the key is removed with the folder.
 */
function signedStory(): { repo: string; epicDir: string; env: NodeJS.ProcessEnv; git: (...a: string[]) => string; remove: () => void } {
  const tmp = mkdtempSync(join(tmpdir(), 'rehearse-e2e-s27-'));
  const repo = join(tmp, 'repo');
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: join(tmp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  delete env.SSH_AUTH_SOCK;
  writeFileSync(join(tmp, 'gitconfig'), '');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' });
  cpSync(SIGNED, repo, { recursive: true });
  git('init', '-q', '-b', 'main');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'e2e', '-f', join(tmp, 'key')], { env });
  git('config', 'user.name', 'e2e');
  git('config', 'user.email', 'e2e@example.com');
  git('config', 'gpg.format', 'ssh');
  git('config', 'user.signingkey', join(tmp, 'key'));
  mkdirSync(join(repo, '.rehearse'));
  writeFileSync(
    join(repo, '.rehearse/allowed_signers'),
    readFileSync(join(REPO, '.rehearse/allowed_signers'), 'utf8').trimEnd() +
      `\ne2e@example.com namespaces="rehearse" ${readFileSync(join(tmp, 'key.pub'), 'utf8')}`,
  );
  git('add', '-A');
  git('commit', '-q', '--no-gpg-sign', '-m', 'signed EPIC');
  return { repo, epicDir: join(repo, EPIC), env, git, remove: () => rmSync(tmp, { recursive: true, force: true }) };
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

test('S27-main: An agent adds a small change to a signed story, and the owner approves it and signs off again', async ({ page }) => {
  // The main path of S27: "done" needs this test passed on the real screens.
  // Checks S27-A1: given a signed story; when an agent writes `changes/C<n>.yaml` with an id, the story, a one-sentence title, why, 1 to 3 new criteria and 5 scenarios or fewer; then validate loads the change into its story, and each criterion, scenario and box of the change has the mark "New in C<n>".

  const story = signedStory();
  const rehearse = (...args: string[]) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: story.repo, env: story.env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  // An empty Birdview data folder: the row does not depend on the real Birdview.
  const birdview = join(story.repo, '../birdview-data');
  mkdirSync(birdview);
  const statusRow = () => /^S10\s.*$/m.exec(rehearse('status', EPIC, '--birdview-data', birdview).out)?.[0] ?? '';
  const signOffs = () => readFileSync(join(story.epicDir, 'signoff.yaml'), 'utf8');
  const oldSignOffs = signOffs();
  const oldBlocks = ['S10-cold-bench', 'S10-warm-bench', 'S10-too-slow'].map((id) => scenarioBlock(story.epicDir, 'S10', id));
  let child: ChildProcess | undefined;
  try {
    await test.step('start: Builder has an idea', async () => {
      // S10 is signed before the change.
      expect(statusRow()).toMatch(/^S10\s+yes\s/);
      expect(rehearse('validate', EPIC).out).toContain('validate: OK, no findings');
    });

    await test.step('change-new: rehearse change new <epic> <story> --title "..."', async () => {
      // Step 2 of 7.
      // Example start-file: given {"epic":"2026-11-05-rehearse","story":"S21","title":"The Next button shows a count of scenarios left."}; then {"file":"changes/C1.yaml","criteria":["S21-A7"],"scenarios":["S21-c1-main"]}.
      const made = rehearse('change', 'new', EPIC, 'S10', '--title', 'CI shows the time of each step.');
      expect(made.code, made.out).toBe(0);
      expect(made.out).toContain(`Created ${CHANGE} (change C1 to story S10).`);
      const file = readFileSync(join(story.repo, CHANGE), 'utf8');
      expect(file).toContain('id: C1\nstory: S10\ntitle: CI shows the time of each step.\n');
      expect(file).toContain('- id: S10-A3');
      expect(file).toContain('- id: S10-c1-main');
    });

    await test.step('change-file: Write the change - 1 to 3 criteria, 5 scenarios or fewer, new root boxes only', async () => {
      // Step 3 of 7.
      // Example write: given {"change":"C1"}; then {"criteria":"S21-A7","scenarios":"S21-c1-main, S21-c1-last, S21-c1-none"}.
      // The agent writes why, the new criterion and the title of the scenario.
      const path = join(story.repo, CHANGE);
      writeFileSync(
        path,
        readFileSync(path, 'utf8')
          .replace('why: Write why the owner asked for this change.', 'why: The owner wants to see which step of the benchmark is slow.')
          .replace('given: Write the start state.', 'given: a run of the cold index benchmark')
          .replace('when: Write what the user does.', 'when: CI ends the run')
          .replace('then: Write the result.', 'then: the log shows the time of each step')
          .replace('title: Write the main path of the change.', 'title: CI shows the time of each step of the cold index'),
      );
      expect(readFileSync(path, 'utf8')).not.toContain('Write ');
    });

    await test.step('change-limits: Check the limits - 5 scenarios or fewer, no edit of an existing item', async () => {
      // Step 4 of 7.
      // One criterion and one scenario: in the limits, and the change edits no item of the record.
      expect(rehearse('validate', EPIC).out).toContain('validate: OK, no findings');
      expect(story.git('status', '--porcelain')).toBe(`?? ${EPIC}/changes/\n`);
      // The old approvals stay valid. Only the change waits for the owner.
      const row = statusRow();
      expect(row).toContain('C1 is new: sign off again: you');
      expect(row).toContain('approve 1 scenario: you');
      const progress = rehearse('progress', EPIC, 'S10').out;
      expect(progress).toContain('not approved: S10-c1-main');
      expect(progress).toContain('S10-cold-bench: no e2e test yet');
    });

    await test.step('change-signoff: Approve the change scenarios and sign off the story again - the preview shows only the change', async () => {
      // Step 5 of 7.
      const served = await serveSigned(story.repo, story.epicDir, story.env);
      child = served.child;
      await page.goto(`${served.url.replace(/#.*$/, '')}#/stories/S10/what`);
      await page.getByTestId('story-scenario-open-S10-c1-main').click();
      // The owner sees each of the 4 steps. Guess: ArrowRight plays the next step, as on the other storyboards.
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
      // The board opens at the branch point, after the shared opening (S22). The owner sees the steps not seen yet there too.
      while (await page.getByTestId('card-next-unseen').count()) await page.getByTestId('card-next-unseen').click();
      await approveButton(page).click();
      await expect.poll(() => readFileSync(join(story.repo, CHANGE), 'utf8'), { timeout: 15_000 }).toMatch(/status: approved/);
      // The owner signs off S10 on the Sign off page. The confirm dialog has the sign-off preview.
      await page.getByTestId('nav-signoff').click();
      await page.getByRole('checkbox', { name: /^S10 / }).check();
      await page.getByTestId('signoff-button').click();
      const preview = page.getByTestId('signoff-confirm-dialog');
      await expect(page.getByTestId('signoff-confirm-stories')).toHaveText('S10');
      // The preview shows only the change. The rest of the story is folded under "The rest of the story is as signed".
      await expect(preview.getByText('S10-c1-main').first()).toBeVisible();
      await expect(page.getByTestId('signoff-preview-rest-S10')).not.toHaveAttribute('open');
      await expect(preview.getByText(/S10-warm-bench/)).toBeHidden();
      await page.getByTestId('signoff-confirm').click();
      await expect.poll(signOffs, { timeout: 15_000 }).not.toBe(oldSignOffs);
      const added = signOffs().slice(oldSignOffs.length);
      expect(added).toContain('by: e2e@example.com');
      expect(added).toContain('BEGIN SSH SIGNATURE');
      expect(signOffs().startsWith(oldSignOffs)).toBe(true);
    });

    await test.step('change-shown: The tools mark the change items "New in C<n>"', async () => {
      // Step 6 of 7.
      // The story page marks the scenario card, the criterion and the map path of the change with "New in C1".
      await page.goto(page.url().replace(/#.*$/, '#/stories/S10/what'));
      await expect(page.getByText('New in C1').first()).toBeVisible();
      expect(rehearse('progress', EPIC, 'S10').out).toMatch(/S10-c1-main/);
    });

    await test.step('change-done: The small change is part of the signed story', async () => {
      // Step 7 of 7.
      // S10 is signed again, and the old approvals did not change.
      expect(statusRow()).toMatch(/^S10\s+yes\s/);
      expect(rehearse('progress', EPIC, 'S10').out).not.toContain('Sign-off: not valid');
      expect(['S10-cold-bench', 'S10-warm-bench', 'S10-too-slow'].map((id) => scenarioBlock(story.epicDir, 'S10', id))).toEqual(oldBlocks);
      expect(rehearse('validate', EPIC).out).toContain('validate: OK');
    });
  } finally {
    if (child) await stop(child);
    story.remove();
  }

  // Expect at the end: {"change":"C1","merged":"into story S21","marks":"New in C1"}.
});
