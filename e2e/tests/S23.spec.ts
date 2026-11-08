// The e2e tests of story S23 ("one Status page that says per story whether it is signed, built, tested on the real screens and done, and what is missing and who acts"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S23.yaml. Each step title
// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.
// Work only from the scenarios and the product that runs (the UI and the CLI), not from the code of the boxes.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI, expect, stop, test } from './serve.js';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SIGNED = join(REPO, 'packages/core/test/fixtures/code-graph-signed');
const EPIC = 'docs/epics/2026-11-05-code-graph';

/**
 * A git repo with a copy of the code-graph-signed fixture: all 10 stories are signed. The test
 * changes S10 after its sign-off, adds S11 with no sign-off, and adds a Flow-Box commit for the
 * box of S10. So the EPIC has signed, changed and unsigned stories.
 */
function mixedEpic(): { tmp: string; repo: string; birdview: string; env: NodeJS.ProcessEnv; git: (...a: string[]) => string; remove: () => void } {
  const tmp = mkdtempSync(join(tmpdir(), 'rehearse-e2e-s23-'));
  const repo = join(tmp, 'repo');
  const birdview = join(tmp, 'birdview-data');
  mkdirSync(birdview);
  writeFileSync(join(tmp, 'gitconfig'), '');
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: join(tmp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...a], { cwd: repo, env, encoding: 'utf8' });
  cpSync(SIGNED, repo, { recursive: true });
  // The fixture's signatures are checked against the allowed signers of the checkout.
  mkdirSync(join(repo, '.rehearse'));
  cpSync(join(REPO, '.rehearse/allowed_signers'), join(repo, '.rehearse/allowed_signers'));
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '--no-gpg-sign', '-m', 'signed EPIC');
  const prdFile = join(repo, EPIC, 'prd.yaml');
  let prd = readFileSync(prdFile, 'utf8');
  prd = prd.replace('soThat: a change that makes the graph slow cannot merge\n', 'soThat: a change that makes the graph slow cannot merge into main\n');
  const s11 =
    '  - id: S11\n    role: ci\n    want: to see the speed of each run in one table\n    soThat: I see a slow change early\n    requirements: [R8]\n' +
    '    acceptance:\n      - id: S11-A1\n        given: a run of the benchmark\n        when: CI ends the run\n        then: the table shows the time of each step\n';
  const end = prd.indexOf('\n', prd.indexOf('then: the update takes less than 300 ms')) + 1;
  prd = prd.slice(0, end) + s11 + prd.slice(end);
  writeFileSync(prdFile, prd);
  git('commit', '-q', '--no-gpg-sign', '-am', 'change S10, add S11');
  git('commit', '-q', '--no-gpg-sign', '--allow-empty', '-m', 'build bench', '-m', 'Flow-Box: bench');
  return { tmp, repo, birdview, env, git, remove: () => rmSync(tmp, { recursive: true, force: true }) };
}

/** Start `rehearse serve` in `repo` and wait for its URL. */
function serveIn(repo: string, epicDir: string, env: NodeJS.ProcessEnv): Promise<{ child: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, 'serve', epicDir, '--port', '0'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

const HEADER = '0 of 11 stories done · 0 seen working on the real screens · 11 not done';

test('S23-page-table: The Status page shows one row per story with its columns, the header and the sources', async ({ page }) => {
  // The main path of S23: "done" needs this test passed on the real screens.
  // Checks S23-A3: given an EPIC with signed, changed and unsigned stories; when the builder opens Status or runs `rehearse status <epic>`; then one row per story with Signed (yes / changed since sign-off / no), Built ("8 of 8 boxes" or "6 of 8 — 2 left"), Tests on the real screens ("3 of 5 passed", "none yet", "1 failing"), Automated tests (from the unit report), and Done (done · seen working, done · checked by automated tests, or not done), under a header such as "18 of 21 stories done · 2 seen working on the real screens · 3 not done", with the sources and their dates.
  const epic = mixedEpic();
  const epicDir = join(epic.repo, EPIC);
  const { child, url } = await serveIn(epic.repo, epicDir, epic.env);
  // The CLI says the same as the page: the test uses it to know the rows that the page must show.
  const cli = spawnSync(process.execPath, [CLI, 'status', EPIC, '--birdview-data', epic.birdview], { cwd: epic.repo, env: epic.env, encoding: 'utf8' });
  const row = (story: string) => page.getByRole('row').filter({ has: page.getByRole('cell', { name: story, exact: true }) });
  try {
    await test.step('status-view: Open the Status page', async () => {
      expect(cli.status, cli.stdout + cli.stderr).toBe(0);
      await page.goto(url);
      await page.getByTestId('nav-status').click();
      await expect(page.getByRole('heading', { name: /Status/ }).first()).toBeVisible();
    });

    await test.step('box-evidence: Decide per box built, no code of its own, or not built, with the evidence', async () => {
      // The Flow-Box commit builds the one box of S10. S1 has 5 boxes and none is built.
      expect(cli.stdout).toMatch(/^S10\s+changed since sign-off\s+1 of 1 box\s/m);
      expect(cli.stdout).toMatch(/^S1\s+yes\s+0 of 5 — 5 left\s/m);
      await expect(row('S10')).toContainText('1 of 1 box');
      await expect(row('S1')).toContainText('0 of 5 — 5 left');
    });

    await test.step('status-table: One row per story - signed, built, real screens, automated tests, done', async () => {
      // Example table: given {"epic":"2026-11-05-rehearse"}; then {"header":"19 of 22 stories done · 0 seen working on the real screens · 3 not done","columns":["Signed","Built","Tests on the real screens","Automated tests","Done","What's missing — who acts"]}.
      expect(cli.stdout).toContain(HEADER);
      await expect(page.getByText(HEADER)).toBeVisible();
      // Six columns after the story id. Guess: the page uses the long column names of the scenario.
      const headers = page.getByRole('columnheader');
      for (const name of ['Signed', 'Built', /real screens/i, /Automated/, 'Done', /What's missing/]) {
        await expect(headers.filter({ hasText: name })).toHaveCount(1);
      }
      // One row per story: S1 to S11.
      for (let n = 1; n <= 11; n++) await expect(row(`S${n}`)).toHaveCount(1);
      // Signed: yes, changed since sign-off, and no.
      await expect(row('S1')).toContainText('yes');
      await expect(row('S10')).toContainText('changed since sign-off');
      await expect(row('S11')).toContainText('no');
      await expect(row('S1')).toContainText('none yet');
      await expect(row('S1')).toContainText('not done');
    });

    await test.step('whats-missing: Say what is missing per story and who acts', async () => {
      expect(cli.stdout).toMatch(/^S10\s.*changed since sign-off: sign off again: you; main path test not written: test thread/m);
      await expect(row('S10')).toContainText('sign off again: you');
      await expect(row('S10')).toContainText('main path test not written: test thread');
      await expect(row('S11')).toContainText('no scenarios written yet: planning agent');
      await expect(row('S1')).toContainText('builders');
    });

    await test.step('status-sources: Say where the facts come from, and when', async () => {
      // Example sources: given {"epic":"2026-11-05-rehearse"}; then {"sources":"commit, code graph, Birdview results, unit report, each with its date"}.
      const commit = epic.git('rev-parse', '--short', 'HEAD').trim();
      const day = epic.git('log', '-1', '--format=%cs').trim();
      expect(cli.stdout).toContain(`commit: main @ ${commit}, ${day}`);
      await expect(page.getByText(/commit:/).first()).toContainText(commit);
      await expect(page.getByText(/commit:/).first()).toContainText(day);
      await expect(page.getByText(/code graph not built yet/).first()).toBeVisible();
      await expect(page.getByText(/no unit report/).first()).toBeVisible();
      await expect(page.getByText(/real screens:/).first()).toBeVisible();
    });

    await test.step('status-page: The Status page - table, filters, a row opens the story\'s progress', async () => {
      // Guess: a filter button "Not done" and a click on the story id open the story's progress.
      await page.getByRole('button', { name: /not done/i }).first().click();
      await expect(row('S10')).toHaveCount(1);
      await row('S10').getByRole('cell', { name: 'S10', exact: true }).click();
      await expect(page.getByText(/S10/).first()).toBeVisible();
      await expect(page).toHaveURL(/S10/);
    });

    await test.step('status-known: The builder knows what is not done and who acts', async () => {
      // The page and the CLI wrote nothing in the repo.
      expect(epic.git('status', '--porcelain')).toBe('');
    });
  } finally {
    await stop(child);
    epic.remove();
  }

  // Expect at the end: {"header":"N of M stories done · K seen working on the real screens · J not done","columns":6,"sources":"with dates","writes":"none"}.
});
