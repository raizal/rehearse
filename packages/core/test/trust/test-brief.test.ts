// T47: the test brief of a story's approved scenarios (box test-brief). Its sections, the name rule
// it quotes, approved scenarios only, and its size on both real EPICs.

import { describe, expect, it } from 'vitest';
import type { Box } from '../../src/index.js';
import { APPROVE_FIRST, HOW_TO_WORK, howToWorkLines, isUiScenario, loadEpic, MAX_TEST_BRIEF_CHARS, NOT_SHOWN, scenarioTestBrief, TEST_NAME_RULE, testTitleLine, whereShown } from '../../src/index.js';
import { CODE_GRAPH_EPIC, makeEpic, REAL_EPIC } from '../helpers.js';
import { approvedEpic, withManyScenarios } from './helpers.js';

describe('scenarioTestBrief (T47, box test-brief)', () => {
  it('holds the story, each scenario with its criterion, steps, boxes and expect, then where, how to run, the rules and how to work', () => {
    const r = scenarioTestBrief(loadEpic(approvedEpic()).record, 'S1', ['S1-buy', 'S1-empty'], { exampleSpec: 'e2e/tests/S4.spec.ts' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const md = r.markdown;
    const heads = md.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
    expect(heads).toEqual([
      'S1-buy: Buyer pays and the order ships',
      'S1-empty: Buyer checks out an empty cart',
      'Where the test goes and its name',
      'Fixtures to start from',
      'How to run it',
      'Rules for this thread',
      'How to work in this repo',
    ]);
    expect(md).toContain('# Test brief: e2e tests for S1-buy, S1-empty (story S1 of the EPIC 2026-11-05-shop)');
    expect(md).toContain('Story: as Buyer, I want to pay for my cart, so that I get my items.');
    expect(md).toContain('Checks S1-A1: given a cart with items; when the buyer pays; then the order is shipped.');
    // Each step with the box it walks: path, title, inputs / outputs, error exits; and the branch taken.
    expect(md).toMatch(/2\. `cart`\n  - example: given \{"items":\["a"\]\} → then \{"orderId":"o1"\}\n  - box `cart`: /);
    expect(md).toMatch(/    - inputs: /);
    expect(md).toMatch(/    - error exits: empty-cart/);
    expect(md).toContain('`cart` taking "empty-cart"');
    expect(md).toContain('`ship/pack`');
    expect(md).toContain('Expect (what the test checks at the end): {"Order.status":"shipped"}');
    // Where and the name rule, quoted.
    expect(md).toContain('- File: `e2e/tests/S1.spec.ts`');
    expect(md).toContain("The first line of the test is `test('S1-buy', async ({ page }) => {`.");
    expect(md).toContain(TEST_NAME_RULE);
    expect(md).toContain('Copy the style (imports, fixtures, selectors by test id) from `e2e/tests/S4.spec.ts`.');
    expect(md).toContain('"test written, not run yet"');
    // How to run: through Birdview, waiting for the result; no Chromium in the sandbox.
    expect(md).toContain('`rehearse play 2026-11-05-shop S1 --test <file:line> --wait` plays one test in Birdview');
    expect(md).toContain('do not try to start Chromium or `playwright test` in the sandbox');
    expect(md).not.toContain('exec playwright test');
    // Only tests.
    expect(md).toContain('Write only tests: do not change app code. If the app cannot do what a scenario says, stop and say so in the thread');
    expect(md).toContain('its commits carry no `Flow-Box:` trailer');
    expect(md).toContain('Re-read this brief with `rehearse brief 2026-11-05-shop S1 --tests --scenario S1-buy --scenario S1-empty`.');
    for (const line of HOW_TO_WORK) expect(md).toContain(line);
    expect(r.scenarios).toEqual(['S1-buy', 'S1-empty']);
    expect(r.specFile).toBe('e2e/tests/S1.spec.ts');
    expect(r.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('takes the test project and spec file from the options; says so when there is no spec to copy', () => {
    const r = scenarioTestBrief(loadEpic(approvedEpic()).record, 'S2', ['S2-out-of-stock'], { testProject: 'web/e2e/', specFile: 'web/e2e/specs/S2.spec.ts' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.markdown).toContain('- File: `web/e2e/specs/S2.spec.ts`');
    expect(r.markdown).toContain('No spec exists yet in `web/e2e/`');
    expect(r.markdown).toContain('The key is the file relative to `web/e2e/`');
  });

  it('T48 says per scenario where each expected result shows and which fixture to start from', () => {
    const fixtures = { ui: { file: 'e2e/tests/serve.ts', exports: ['test', 'serve', 'stop', 'CLI'] }, cli: { file: 'e2e/tests/cli.ts', exports: ['freshRepo', 'rehearse', 'git'] } };
    const r = scenarioTestBrief(loadEpic(approvedEpic()).record, 'S1', ['S1-buy'], { fixtures });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The shop has no UI box: its expected result is in the files, and the scenario is a CLI one.
    expect(r.markdown).toContain(`Where each expected result shows:\n- \`Order.status\`: ${NOT_SHOWN}`);
    expect(r.markdown).toContain('Start from: a CLI scenario (no box of the app), `e2e/tests/cli.ts`.');
    expect(r.markdown).toContain('- UI scenario: `e2e/tests/serve.ts` (`test`, `serve`, `stop`, `CLI`) serves the app on a copy of a record.');
    expect(r.markdown).toContain('- CLI scenario: `e2e/tests/cli.ts` (`freshRepo`, `rehearse`, `git`) makes a fresh git repo and runs the CLI in it.');
    // Without the fixture it says so.
    const bare = scenarioTestBrief(loadEpic(approvedEpic()).record, 'S1', ['S1-buy']);
    expect(bare.ok && bare.markdown).toContain('Start from: a CLI scenario (no box of the app), no fixture yet: copy the setup of an existing spec.');
    expect(bare.ok && bare.markdown).toContain('- CLI scenario: no fixture in `e2e/tests/` makes a fresh git repo and runs the CLI in it; copy the setup of an existing spec.');
  });

  it('T48 where it shows: a UI box that reads the entity field or takes the field; else check the files', () => {
    const box = (b: Partial<Box>): Box => ({ id: 'x', path: 'x', title: 'X', kind: 'output', lane: 'l', ...b });
    const boxes = [
      box({ id: 'orders', path: 'orders', title: 'Orders tab', package: 'ui', reads: ['Order.*'] }),
      box({ id: 'rows', path: 'rows', title: 'Test rows', package: 'ui', outputs: { rows: 'list' } }),
      box({ id: 'pay', path: 'pay', title: 'Pay', package: 'server', reads: ['Payment.status'], outputs: { receipt: 'string' } }),
    ];
    expect(whereShown(boxes, 'Order.status')).toBe('shows in Orders tab (`orders`)');
    expect(whereShown(boxes, 'rows')).toBe('shows in Test rows (`rows`)');
    expect(whereShown(boxes, 'Payment.status')).toBe(NOT_SHOWN);
    expect(whereShown(boxes, 'receipt')).toBe(NOT_SHOWN);
  });

  it('T48 a scenario that walks a UI box is a UI scenario (the real EPIC); the shop has none', () => {
    const real = loadEpic(REAL_EPIC).record;
    const scenario = (id: string) => real.scenarioFiles.flatMap((f) => f.scenarios).find((s) => s.id === id)!;
    expect(isUiScenario(real, scenario('S14-summary'))).toBe(true);
    expect(isUiScenario(real, scenario('S14-play-wait'))).toBe(false);
    const shop = loadEpic(approvedEpic()).record;
    expect(isUiScenario(shop, shop.scenarioFiles[0]!.scenarios[0]!)).toBe(false);
  });

  it('T48 writes every command as it runs in the repo: pnpm rehearse and its setup line', () => {
    const commands = { cli: 'pnpm rehearse', setup: 'pnpm install --frozen-lockfile && pnpm -r build' };
    const r = scenarioTestBrief(loadEpic(approvedEpic()).record, 'S1', ['S1-buy'], { commands });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.markdown).toContain('`pnpm rehearse play 2026-11-05-shop S1 --test <file:line> --wait`');
    expect(r.markdown).toContain('`pnpm rehearse brief 2026-11-05-shop S1 --tests --scenario S1-buy`');
    for (const line of howToWorkLines(commands)) expect(r.markdown).toContain(line);
    expect(r.markdown).not.toContain('`rehearse ');
  });

  it('refuses a draft or stale scenario: approve this scenario first', () => {
    const draft = scenarioTestBrief(loadEpic(makeEpic()).record, 'S1', ['S1-buy']);
    expect(draft).toMatchObject({ ok: false, notApproved: [{ id: 'S1-buy', status: 'draft' }] });
    expect(!draft.ok && draft.reason).toBe(`S1-buy (draft): ${APPROVE_FIRST}; an agent writes tests for approved scenarios only`);
    // Approved, then changed: stale.
    const dir = approvedEpic();
    const record = loadEpic(dir).record;
    record.scenarioFiles.find((f) => f.story === 'S1')!.scenarios[0]!.title = 'Changed after approval';
    const stale = scenarioTestBrief(record, 'S1', ['S1-buy', 'S1-empty']);
    expect(stale).toMatchObject({ ok: false, notApproved: [{ id: 'S1-buy', status: 'stale' }] });
  });

  it('refuses no scenario, an unknown story and a scenario of another story', () => {
    const record = loadEpic(approvedEpic()).record;
    expect(scenarioTestBrief(record, 'S1', [])).toMatchObject({ ok: false, reason: 'name at least one scenario of S1' });
    expect(scenarioTestBrief(record, 'S9', ['S1-buy'])).toMatchObject({ ok: false, reason: 'no story S9 in prd.yaml' });
    expect(scenarioTestBrief(record, 'S1', ['S2-out-of-stock'])).toMatchObject({ ok: false, reason: 'no scenario S2-out-of-stock in story S1' });
  });

  it('the title line it gives is the one the name rule describes', () => {
    expect(testTitleLine('S13-row')).toBe("test('S13-row', async ({ page }) => {");
  });

  it('a brief over its budget shows the first scenarios in full and the others in one line each, every criterion once (T56)', () => {
    const record = withManyScenarios(loadEpic(approvedEpic()).record, 60);
    const ids = ['S1-buy', 'S1-empty', ...Array.from({ length: 60 }, (_, i) => `S1-buy-${i + 1}`)];
    const r = scenarioTestBrief(record, 'S1', ids);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const md = r.markdown;
    expect(md.length).toBeLessThan(MAX_TEST_BRIEF_CHARS);
    expect(md).toContain('## The other scenarios, in short');
    expect(md).toContain('brief 2026-11-05-shop S1 --tests --scenario <id>');
    for (const id of ids) expect(md, id).toContain(`${id}: `);
    expect(md).toContain('- S1-buy-60: Buyer 60 pays for a cart of many items and the order ships. Checks S1-A1 (above).');
    expect(md).toContain('given a cart with items; when the buyer pays; then the order is shipped');
  });

  it('a small brief is not shortened', () => {
    const r = scenarioTestBrief(loadEpic(approvedEpic()).record, 'S1', ['S1-buy', 'S1-empty']);
    if (r.ok) expect(r.markdown).not.toMatch(/in short|as in /);
  });

  it('stays compact: every approved scenario of each story of both EPICs, under about 6k tokens', () => {
    for (const dir of [REAL_EPIC, CODE_GRAPH_EPIC]) {
      const { record } = loadEpic(dir);
      for (const s of record.prd?.stories ?? []) {
        const ids = record.scenarioFiles.flatMap((f) => f.scenarios.filter((sc) => sc.story === s.id && sc.status === 'approved').map((sc) => sc.id));
        if (ids.length === 0) continue;
        const r = scenarioTestBrief(record, s.id, ids);
        if (r.ok) expect(r.markdown.length, `${record.slug} ${s.id}`).toBeLessThan(MAX_TEST_BRIEF_CHARS);
      }
    }
  });
});
