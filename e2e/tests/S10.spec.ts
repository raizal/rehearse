// The e2e tests of story S10 ("to run validate, simulate and gate check without bb"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S10.yaml. Each step title
// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.
// Work only from the scenarios and the running product (the UI and the CLI), not from the code of the boxes.

import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './serve.js';
import { rehearse, git, freshRepo } from './cli.js';

const SHOP = fileURLToPath(new URL('../../packages/core/test/fixtures/shop', import.meta.url));
const SLUG = '2026-11-05-shop';

type Report = { command: string; ok: boolean; findings: { kind: string; path: string; message: string }[] };

test('S10-fail: CI finds a simulator error', async () => {
  // The main path of S10: "done" needs this test passed on the real screens.
  // Checks S10-A1: given a record with one simulator error; when CI runs `npx rehearse simulate <slug> --json`; then exit code 1, and the JSON lists the error.
  // The shop record has no approved scenario, so simulate finds design errors: branches and error exits that no approved scenario takes.
  const { repo, remove } = freshRepo();
  const ci: Record<string, { code: number | null; report: Report }> = {};
  try {
    await test.step('pr-opened: PR opened or updated', async () => {
      // Step 1 of 4.
      git(repo, 'commit', '-q', '--allow-empty', '-m', 'main');
      git(repo, 'checkout', '-q', '-b', 'feature/shop');
      cpSync(SHOP, join(repo, 'docs/epics', SLUG), { recursive: true });
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', 'the shop record');
      expect(git(repo, 'diff', '--name-only', 'main...feature/shop')).toContain(`docs/epics/${SLUG}/flow.yaml`);
    });

    await test.step('ci-run: CI runs validate, simulate, gate --json', async () => {
      // Step 2 of 4.
      // Example ci-dirty: given {"epicDir":"docs/epics/x"}; then {"exitCode":1,"report":{"ok":false}}.
      // CI runs the CLI without bb: the commands need only the repo.
      for (const command of [['validate'], ['simulate'], ['gate', 'check']]) {
        const r = rehearse(repo, ...command, SLUG, '--json');
        expect(r.err).toBe('');
        ci[command[0]!] = { code: r.code, report: JSON.parse(r.out) as Report };
      }
      expect(ci.validate).toMatchObject({ code: 0, report: { command: 'validate', ok: true } });
    });

    await test.step('ci-ok: Exit code 0?', async () => {
      // Step 3 of 4, the branch "no".
      expect(ci.simulate!.code).toBe(1);
      expect(ci.gate!.code).toBe(1);
    });

    await test.step('ci-fail: PR blocked, report attached', async () => {
      // Step 4 of 4.
      // The report the PR gets: the JSON lists each error, the same on each run.
      const report = ci.simulate!.report;
      expect(report).toMatchObject({ command: 'simulate', ok: false });
      expect(report.findings).toContainEqual(expect.objectContaining({ kind: 'coverage', path: 'in-stock', message: expect.stringContaining('branch no of decision in-stock') }));
      expect(rehearse(repo, 'simulate', SLUG, '--json').out).toBe(JSON.stringify(report, null, 2) + '\n');
    });

    // Expect at the end: {"exitCode":1,"jsonListsError":true}.
    expect(ci.simulate!.code).toBe(1);
    expect(ci.simulate!.report.findings.length).toBeGreaterThan(0);
  } finally {
    remove();
  }
});
