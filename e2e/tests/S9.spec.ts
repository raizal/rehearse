// The e2e tests of story S9 ("to sign off the EPIC gate"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S9.yaml. Each step title
// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.
// Work only from the scenarios and the product that runs (the UI and the CLI), not from the code of the boxes.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { CLI, expect, stop, test } from './serve.js';
import { rehearse } from './cli.js';

const SHOP = fileURLToPath(new URL('../../packages/core/test/fixtures/shop', import.meta.url));
const EPIC = 'docs/epics/2026-11-05-shop';

type Finding = { kind: string; file: string; path: string; message: string; refs: string[] };
type Report = { command: string; ok: boolean; findings: Finding[] };

test('S9-sign: Builder signs off a clean EPIC', async ({ page }) => {
  // The main path of S9: "done" needs this test passed on the real screens.
  // Checks S9-A2: given all gate checks pass; when the builder signs off; then the record keeps who, when and a hash for each story.
  // Given: the builder approved each scenario of the shop record with a test key (not the owner's key). Only the sign-off is left.
  test.setTimeout(180_000);
  const shop = signedShop({});
  let server: { child: ChildProcess; url: string } | undefined;
  let gate: { code: number | null; out: string; err: string };
  let report: Report;
  const signoff = join(shop.epicDir, 'signoff.yaml');
  try {
    server = await shop.serve();
    const url = server.url;
    await approve(page, url, shop.fingerprint, 'S1', 'S1-buy', 7, join(shop.epicDir, 'scenarios/S1.yaml'));
    await approve(page, url, shop.fingerprint, 'S1', 'S1-empty', 3, join(shop.epicDir, 'scenarios/S1.yaml'));
    await approve(page, url, shop.fingerprint, 'S2', 'S2-out-of-stock', 3, join(shop.epicDir, 'scenarios/S2.yaml'));
    gate = rehearse(shop.repo, 'gate', 'check', EPIC, '--json');
    report = JSON.parse(gate.out) as Report;
    // Before the sign-off, the gate names only the stories that are not signed off.
    const notSigned = (f: Finding) => f.file === 'signoff.yaml' && f.message.endsWith('is not signed off; the owner signs it off in the UI');

    await test.step('gate/traced: Every requirement has a story, and every story has an approved scenario', async () => {
      // Step 1 of 7.
      expect(report.findings.filter((f) => /has no story|has no approved scenario/.test(f.message))).toEqual([]);
      expect(report.findings.filter((f) => f.kind === 'acceptance')).toEqual([]);
    });

    await test.step('gate/sim-clean: Simulation has no findings', async () => {
      // Step 2 of 7.
      const sim = rehearse(shop.repo, 'simulate', EPIC, '--json');
      expect(sim.code, sim.out + sim.err).toBe(0);
      expect((JSON.parse(sim.out) as Report).findings).toEqual([]);
      expect(report.findings.filter((f) => ['coverage', 'contract', 'lifecycle'].includes(f.kind))).toEqual([]);
    });

    await test.step('gate/no-stale: No stale scenario', async () => {
      // Step 3 of 7.
      expect(report.findings.filter((f) => /stale|not evidence/.test(f.message))).toEqual([]);
    });

    await test.step('gate/report: Gate report', async () => {
      // Step 4 of 7.
      expect(report.command).toBe('gate');
      expect(gate.err).toBe('');
      expect(report.findings.filter((f) => !notSigned(f))).toEqual([]);
      expect(report.findings.filter(notSigned).map((f) => f.path).sort()).toEqual(['S1', 'S2']);
    });

    await test.step('gate-ok: Gate passes?', async () => {
      // Step 5 of 7, the branch "yes".
      // Example gate-yes: given {"report":{"ok":true}}; then {"branch":"yes"}.
      // The checks pass, so the Sign off page lets the builder sign off.
      await page.goto(url);
      await page.getByTestId('nav-signoff').click();
      await expect(page.getByTestId('signoff-view')).toBeVisible();
      await expect(page.getByTestId('signoff-gate-findings')).not.toContainText(/coverage|acceptance|stale/);
      expect(existsSync(signoff)).toBe(false);
    });

    await test.step('sign-off: Sign off (UI button only)', async () => {
      // Step 6 of 7.
      // Example sign-1: given {"storyIds":["S1","S2"],"user":"a@b.c"}; then {"signOff":{"by":"a@b.c","storyHashes":{"S1":"h1","S2":"h2"}}}.
      await expect(page.getByTestId('signoff-signer-by')).toHaveText('a@b.c');
      await expect(page.getByTestId('signoff-signer-key')).toHaveText(shop.fingerprint);
      await page.getByRole('checkbox', { name: /^S1 / }).check();
      await page.getByRole('checkbox', { name: /^S2 / }).check();
      await expect(page.getByTestId('signoff-button')).toBeEnabled();
      await page.getByTestId('signoff-button').click();
      // The record keeps who, when, and a hash for each story, with a signature.
      await expect.poll(() => (existsSync(signoff) ? readFileSync(signoff, 'utf8') : '')).toContain('a@b.c');
      const text = readFileSync(signoff, 'utf8');
      expect(text).toMatch(/\bat: '?\d{4}-\d\d-\d\dT/);
      expect(text).toMatch(/\bS1: '?sha256:[0-9a-f]{64}/);
      expect(text).toMatch(/\bS2: '?sha256:[0-9a-f]{64}/);
      expect(text).toContain('BEGIN SSH SIGNATURE');
      await expect(page.getByTestId('signoff-history')).toContainText('a@b.c');
    });

    await test.step('signed: EPIC signed — build may start', async () => {
      // Step 7 of 7.
      const after = rehearse(shop.repo, 'gate', 'check', EPIC, '--json');
      expect(after.code, after.out + after.err).toBe(0);
      expect(JSON.parse(after.out) as Report).toMatchObject({ command: 'gate', ok: true, findings: [] });
      await page.getByTestId('reload').click();
      await page.getByTestId('nav-readiness').click();
      await expect(page.getByTestId('readiness-summary')).toContainText(/EPIC status:\s*signed/);
    });

    // Expect at the end: {"Epic.status":"signed","SignOff.by":"a@b.c"}.
    expect(rehearse(shop.repo, 'gate', 'check', EPIC).out).toContain(shop.fingerprint);
    expect(readFileSync(signoff, 'utf8')).toMatch(/\bby: '?a@b\.c/);
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
  const tmp = mkdtempSync(join(tmpdir(), 'rehearse-e2e-s9-'));
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
  await page.getByTestId(`story-scenario-open-${id}`).click();
  await expect(page.getByTestId('card-step-count')).toHaveText(`Step 1 of ${steps}`);
  for (let n = 2; n <= steps; n++) {
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
