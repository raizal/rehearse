// The e2e tests of story S15 ("the brief an agent gets to say which code already builds each box of the story"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S15.yaml. Each step title
// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.
// Work only from the scenarios and the product that runs (the UI and the CLI), not from the code of the boxes.

import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './serve.js';
import { rehearse, git, freshRepo } from './cli.js';

const SHOP = fileURLToPath(new URL('../../packages/core/test/fixtures/shop', import.meta.url));
const EPIC = 'docs/epics/2026-11-05-shop';

type Code = { cli: string; code: { box: string; functions: { name: string; file: string; line: number; coverage: { percent: number | null; tests: number } }[] }[] };

/** The lines of one `### \`<box>\`` block in the "Code you start from" section. */
function boxBlock(section: string, box: string): string[] {
  const start = section.indexOf(`### \`${box}\``);
  expect(start, `the block of ${box}`).toBeGreaterThanOrEqual(0);
  const next = section.indexOf('\n### ', start + 1);
  return section.slice(start, next < 0 ? undefined : next).split('\n');
}

test('S15-code: Each box of the story gets its code with path:line and coverage, in the boxes\' order', async () => {
  // The main path of S15: "done" needs this test passed on the real screens.
  // Checks S15-A1: given a story whose boxes have code in the graph; when rehearse makes its build brief; then a section "Code you start from" follows the boxes, one block per box in the same order; each lists up to 8 functions that build it with path:line and the coverage badge ("72% · 3 tests" or "no coverage data").
  // The shop record: story S1 walks the boxes cart and pay, in this order. The repo gets code for both boxes:
  // 10 functions in src/cart.ts (more than 8) and 1 function in src/pay.ts. Each commit carries the Flow-Box trailer of its box.
  // The sign-off is a UI action with the owner's key. The code section does not depend on it, so the test uses --allow-unsigned.
  const { repo, remove } = freshRepo();
  let brief = '';
  let section = '';
  try {
    await test.step('start-build: Start a build thread, or send it the change', async () => {
      // Step 1 of 4.
      cpSync(SHOP, join(repo, EPIC), { recursive: true });
      writeFileSync(join(repo, 'package.json'), '{"name":"shop","type":"module"}\n');
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', 'the shop record');
      mkdirSync(join(repo, 'src'));
      writeFileSync(join(repo, 'src/cart.ts'), Array.from({ length: 10 }, (_, i) => `export function cartStep${i + 1}(): number { return ${i + 1}; }\n`).join(''));
      git(repo, 'add', 'src/cart.ts');
      git(repo, 'commit', '-q', '-m', 'T1: the cart', '-m', 'Flow-Box: cart');
      writeFileSync(join(repo, 'src/pay.ts'), 'export function chargeBuyer(): boolean { return true; }\n');
      git(repo, 'add', 'src/pay.ts');
      git(repo, 'commit', '-q', '-m', 'T2: the payment', '-m', 'Flow-Box: pay');
      const r = rehearse(repo, 'brief', EPIC, 'S1', '--allow-unsigned');
      expect(r.code, r.err).toBe(0);
      brief = r.out;
      expect(brief).toMatch(/^# Build brief: story S1\b/);
    });

    await test.step('gather-box-code: Gather the code of the boxes from the code graph', async () => {
      // Step 2 of 4.
      // Example two-boxes: given {"storyId":"S11","boxes":["start-build","build-brief"]}; then {"code":["start-build","build-brief"],"cli":"node packages/cli/bin/rehearse.js"}.
      const r = rehearse(repo, 'brief', EPIC, 'S1', '--allow-unsigned', '--json');
      expect(r.code, r.err).toBe(0);
      const { code } = JSON.parse(r.out) as { code: Code };
      expect(code.code.map((c) => c.box)).toEqual(['cart', 'pay']);
      expect(code.cli).toBeTruthy();
      const cart = code.code[0]!.functions;
      expect(cart.map((f) => f.name)).toEqual(Array.from({ length: 10 }, (_, i) => `cartStep${i + 1}`));
      expect(cart[0]).toMatchObject({ file: 'src/cart.ts', line: 1, coverage: { percent: null, tests: 0 } });
      expect(code.code[1]!.functions).toEqual([expect.objectContaining({ name: 'chargeBuyer', file: 'src/pay.ts', line: 1 })]);
    });

    await test.step('code-start-section: Write "Code you start from"', async () => {
      // Step 3 of 4.
      // Example function-line: given {"box":"build-brief","function":"storyBuildBrief"}; then {"line":"- `storyBuildBrief` packages/core/src/trust/build-brief.ts:<line> (no coverage data)"}.
      const start = brief.indexOf('\n## Code you start from\n');
      expect(start, 'the section "Code you start from"').toBeGreaterThanOrEqual(0);
      const end = brief.indexOf('\n## ', start + 1);
      section = brief.slice(start, end < 0 ? undefined : end);
      // One block for each box, in the order of the boxes.
      expect(section.indexOf('### `cart`')).toBeLessThan(section.indexOf('### `pay`'));
      const fn = /^- `\w+` src\/\w+\.ts:\d+ \((no coverage data|\d+% · \d+ tests?)\)$/;
      const cart = boxBlock(section, 'cart');
      expect(cart[0]).toMatch(/^### `cart`: 10 functions\b/);
      const cartFns = cart.filter((l) => fn.test(l));
      expect(cartFns).toHaveLength(8);
      expect(cartFns[0]).toBe('- `cartStep1` src/cart.ts:1 (no coverage data)');
      expect(cart.join('\n')).toContain('and 2 more');
      const pay = boxBlock(section, 'pay');
      expect(pay[0]).toMatch(/^### `pay`: 1 function\b/);
      expect(pay.filter((l) => fn.test(l))).toEqual(['- `chargeBuyer` src/pay.ts:1 (no coverage data)']);
    });

    await test.step('build-brief: Make the build brief of a signed story', async () => {
      // Step 4 of 4.
      // The section follows the boxes (and the design), and comes before the entities.
      const at = (h: string) => brief.indexOf(`\n## ${h}\n`);
      expect(at('Boxes')).toBeGreaterThan(0);
      expect(at('Boxes')).toBeLessThan(at('Code you start from'));
      expect(at('Code you start from')).toBeLessThan(at('Entities the boxes read or write'));
    });

    // Expect at the end: {"section":"Code you start from","after":"Boxes","maxFunctions":8}.
    for (const box of ['cart', 'pay']) expect(boxBlock(section, box).filter((l) => /^- `\w+` /.test(l)).length).toBeLessThanOrEqual(8);
  } finally {
    remove();
  }
});
