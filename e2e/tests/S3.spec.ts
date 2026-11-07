// The e2e tests of story S3 ("to simulate the EPIC and get a list of design errors"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S3.yaml. Each step title
// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.
// Work only from the scenarios and the running product (the UI and the CLI), not from the code of the boxes.

import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './serve.js';
import { rehearse, freshRepo } from './cli.js';

const SHOP = fileURLToPath(new URL('../../packages/core/test/fixtures/shop', import.meta.url));
const SLUG = '2026-11-05-shop';

type Finding = { kind: string; file: string; path: string; message: string };
type Report = { command: string; ok: boolean; findings: Finding[]; permissionMatrix: Record<string, Record<string, string[]>> };

test('S3-uncovered-branch: A decision branch that no approved scenario reaches', async () => {
  // The main path of S3: "done" needs this test passed on the real screens.
  // Checks S3-A2: given a decision box has a "no" branch that no approved scenario reaches; when the builder runs simulate; then the report has a coverage error for that branch.
  // The shop record: the decision in-stock has the branch "no", and only a draft scenario (S2-out-of-stock) takes it.
  const { repo, remove } = freshRepo();
  let r: { code: number | null; out: string; err: string };
  let report: Report;
  try {
    cpSync(SHOP, join(repo, 'docs/epics', SLUG), { recursive: true });
    r = rehearse(repo, 'simulate', SLUG, '--json');
    report = JSON.parse(r.out) as Report;

    await test.step('simulate/load: Load approved scenarios (skip stale and draft)', async () => {
      // Step 1 of 8.
      // Drafts are skipped: without --drafts no scenario covers the branch; with --drafts the draft covers it, as information.
      expect(report.findings).toContainEqual(expect.objectContaining({ path: 'in-stock', message: expect.stringContaining('no approved scenario takes it') }));
      const drafts = rehearse(repo, 'simulate', SLUG, '--drafts');
      expect(drafts.code, drafts.out + drafts.err).toBe(0);
      expect(drafts.out).toContain('branch no of decision in-stock (to failed): covered only by drafts (S2-out-of-stock: draft)');
    });

    await test.step('simulate/contracts: Chain examples and check data shapes', async () => {
      // Step 2 of 8.
      expect(report.findings.filter((f) => !['coverage', 'acceptance'].includes(f.kind))).toEqual([]);
    });

    await test.step('simulate/coverage: Find branches and error exits that no scenario reaches', async () => {
      // Step 3 of 8.
      // Example coverage-gap: given {"scenarios":["shop-1"]}; then {"findings":[{"kind":"coverage","path":"in-stock","message":"branch no not reached"}]}.
      expect(report.findings).toContainEqual({ kind: 'coverage', file: 'flow.yaml', path: 'in-stock', message: 'branch no of decision in-stock (to failed): no approved scenario takes it', refs: [] });
    });

    await test.step('simulate/lifecycles: Check transitions and reachable states', async () => {
      // Step 4 of 8.
      expect(report.findings.filter((f) => f.kind === 'lifecycle')).toEqual([]);
    });

    await test.step('simulate/acceptance: Compare end states with acceptance criteria', async () => {
      // Step 5 of 8.
      expect(report.findings).toContainEqual(expect.objectContaining({ kind: 'acceptance', path: 'S2', message: 'criterion S2-A1: no approved scenario checks it (expect.criterion)' }));
    });

    await test.step('simulate/permissions: Build permission matrix', async () => {
      // Step 6 of 8.
      expect(report.permissionMatrix).toEqual({ buyer: { Order: ['write', 'transition'] }, shop: { Order: ['read', 'write', 'transition'] } });
    });

    await test.step('simulate/report: Write sorted, deterministic report', async () => {
      // Step 7 of 8.
      // Sorted and the same on each run.
      expect(rehearse(repo, 'simulate', SLUG, '--json').out).toBe(r.out);
      const keys = report.findings.map((f) => `${f.file}\u0000${f.path}`);
      expect(keys).toEqual([...keys].sort());
    });

    await test.step('design-errors: Design errors found?', async () => {
      // Step 8 of 8, the branch "yes".
      expect(r.code).toBe(1);
      expect(report.ok).toBe(false);
      const text = rehearse(repo, 'simulate', SLUG);
      expect(text.out).toContain('flow.yaml: in-stock: coverage: branch no of decision in-stock (to failed): no approved scenario takes it');
    });

    // Expect at the end: {"finding":{"kind":"coverage","path":"in-stock","branch":"no"}}.
    expect(report.findings.filter((f) => f.kind === 'coverage' && f.path === 'in-stock' && f.message.startsWith('branch no '))).toHaveLength(1);
  } finally {
    remove();
  }
});
