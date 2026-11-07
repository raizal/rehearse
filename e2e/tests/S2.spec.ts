// The e2e tests of story S2 ("to know exactly what is wrong in a record draft"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S2.yaml. Each step title
// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.
// Work only from the scenarios and the running product (the UI and the CLI), not from the code of the boxes.

import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './serve.js';
import { rehearse, git, freshRepo } from './cli.js';

const SHOP = fileURLToPath(new URL('../../packages/core/test/fixtures/shop', import.meta.url));
const SLUG = '2026-11-05-shop';

test('S2-unknown-story: A box points to a story that does not exist', async () => {
  // The main path of S2: "done" needs this test passed on the real screens.
  // Checks S2-A2: given a box points to story S9 and prd.yaml has no S9; when the agent runs validate; then exit code 1, and the error names the box path and S9.
  const { repo, remove } = freshRepo();
  const flow = join(repo, 'docs/epics', SLUG, 'flow.yaml');
  try {
    cpSync(SHOP, join(repo, 'docs/epics', SLUG), { recursive: true });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'the shop record');
    const clean = readFileSync(flow, 'utf8');
    // The box pay points to the story S9, and prd.yaml has no S9.
    writeFileSync(flow, clean.replace(/(- id: pay\n(?:.*\n){3}\s+stories: )\[S1\]/, '$1[S9]'));
    expect(readFileSync(flow, 'utf8')).not.toBe(clean);
    let report: { command: string; ok: boolean; findings: { kind: string; file: string; path: string; message: string; refs: string[] }[] } | undefined;
    let code: number | null = null;

    await test.step('validate/parse: Parse YAML files', async () => {
      // Step 1 of 6.
      // Example parse-ok-2: given {"epicDir":"docs/epics/x"}; then {"docs":{"flow.yaml":"parsed","prd.yaml":"parsed"}}.
      const r = rehearse(repo, 'validate', SLUG, '--json');
      code = r.code;
      report = JSON.parse(r.out);
      expect(report!.findings.filter((f) => f.message.includes('yaml-syntax'))).toEqual([]);
    });

    await test.step('validate/schema: Check JSON Schema', async () => {
      // Step 2 of 6.
      // Example schema-ok: given {"docs":{"flow.yaml":"parsed"}}; then {"findings":[]}.
      expect(report!.findings.filter((f) => f.kind === 'schema')).toEqual([]);
    });

    await test.step('validate/refs: Check cross-file references', async () => {
      // Step 3 of 6.
      // Example refs-unknown-story: given {"docs":{"flow.yaml":"parsed"}}; then {"findings":[{"kind":"reference","path":"pay","message":"story S9 unknown"}]}.
      expect(report!.findings).toEqual([{ kind: 'reference', file: 'flow.yaml', path: 'pay', message: 'story S9 unknown', refs: ['S9'] }]);
    });

    await test.step('validate/report: Write validation report', async () => {
      // Step 4 of 6.
      // Example vreport-2: given {"findings":["reference"]}; then {"report":{"command":"validate","ok":false}}.
      expect(report).toMatchObject({ command: 'validate', ok: false });
      const text = rehearse(repo, 'validate', SLUG);
      expect(text.out).toContain('flow.yaml: pay: reference: story S9 unknown');
      expect(text.out).toContain('validate: 1 finding');
    });

    await test.step('valid: Record valid?', async () => {
      // Step 5 of 6, the branch "no".
      expect(code).toBe(1);
    });

    await test.step('draft-record: Draft or fix record files', async () => {
      // Step 6 of 6.
      // The agent fixes the record: the box points to S1 again, and validate passes.
      writeFileSync(flow, clean);
      const r = rehearse(repo, 'validate', SLUG);
      expect(r.code, r.out + r.err).toBe(0);
      expect(r.out).toContain('validate: OK');
    });

    // Expect at the end: {"exitCode":1,"finding":{"path":"pay","ref":"S9"}}.
    expect(code).toBe(1);
    expect(report!.findings[0]).toMatchObject({ path: 'pay', refs: ['S9'] });
  } finally {
    remove();
  }
});
