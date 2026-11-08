// The e2e tests of story S8 ("to see why the EPIC is ready or not ready"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S8.yaml. Each step title
// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.
// Work only from the scenarios and the product that runs (the UI and the CLI), not from the code of the boxes.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI, expect, serve, stop, test } from './serve.js';

const SHOP = fileURLToPath(new URL('../../packages/core/test/fixtures/shop', import.meta.url));

type Report = { ok: boolean; findings: { kind: string; file: string; path: string; message: string; refs: string[] }[] };

test('S8-no-proof: A requirement has no story', async ({ page }) => {
  // The main path of S8: "done" needs this test passed on the real screens.
  // Checks S8-A1: given requirement R2 has no story; when the builder opens the readiness view; then R2 shows "no proof", and the view gives the reason.
  // A copy of the shop record where S2 serves R1, not R2: no story serves R2.
  const tmp = mkdtempSync(join(tmpdir(), 'rehearse-e2e-s8-'));
  const epicDir = join(tmp, 'shop');
  cpSync(SHOP, epicDir, { recursive: true });
  const prd = join(epicDir, 'prd.yaml');
  const text = readFileSync(prd, 'utf8');
  expect(text).toContain('requirements: [R2]');
  writeFileSync(prd, text.replace('requirements: [R2]', 'requirements: [R1]'));
  const { child, url } = await serve(epicDir);
  try {
    await test.step('review/readiness: Readiness chain and correction counts', async () => {
      // Step 1 of 1.
      // Example ready-no-proof: given {"requirements":["R2"],"stories":[]}; then {"noProof":[{"id":"R2","reason":"no story"}]}.
      await page.goto(url);
      await expect(page.getByTestId('report-status')).toHaveText(/validate: OK/);
      await page.getByTestId('nav-readiness').click();
      await expect(page.getByTestId('readiness-view')).toBeVisible();
      // In the chain, R2 shows "no proof", and no story is under it.
      await expect(page.getByTestId('readiness-req-R2')).toContainText('The shop ships a paid order.');
      await expect(page.getByTestId('readiness-req-status-R2')).toContainText('no proof');
      await expect(page.getByTestId('readiness-story-R2-S2')).toHaveCount(0);
      // The list of requirements with no proof gives the reason: no story.
      await expect(page.getByTestId('readiness-no-proof-R2')).toContainText('R2');
      await expect(page.getByTestId('readiness-no-proof-reason-R2')).toContainText('no story');
    });

    // Expect at the end: {"R2":"no-proof"}.
    const gate = spawnSync(process.execPath, [CLI, 'gate', 'check', epicDir, '--json'], { encoding: 'utf8' });
    const report = JSON.parse(gate.stdout) as Report;
    expect(gate.status).toBe(1);
    expect(report.findings).toContainEqual(expect.objectContaining({ kind: 'gate', file: 'prd.yaml', message: 'R2 has no story', refs: ['R2'] }));
  } finally {
    await stop(child);
    rmSync(tmp, { recursive: true, force: true });
  }
});
