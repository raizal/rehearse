// T47: the test brief of a story's approved scenarios (box test-brief). Its sections, the name rule
// it quotes, approved scenarios only, and its size on both real EPICs.

import { describe, expect, it } from 'vitest';
import { APPROVE_FIRST, HOW_TO_WORK, loadEpic, scenarioTestBrief, TEST_NAME_RULE, testTitleLine } from '../../src/index.js';
import { CODE_GRAPH_EPIC, makeEpic, REAL_EPIC } from '../helpers.js';
import { approvedEpic } from './helpers.js';

/** About 6k tokens at four characters a token, like the build brief. */
const MAX_BRIEF_CHARS = 24_000;

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
    // How to run.
    expect(md).toContain("`pnpm --filter ./e2e exec playwright test tests/S1.spec.ts -g 'S1-buy'`");
    expect(md).toContain('`rehearse play 2026-11-05-shop S1 --test <file:line>`');
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
    expect(r.markdown).toContain("`pnpm --filter ./web/e2e exec playwright test specs/S2.spec.ts -g 'S2-out-of-stock'`");
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

  it('stays compact: every approved scenario of each story of both EPICs, under about 6k tokens', () => {
    for (const dir of [REAL_EPIC, CODE_GRAPH_EPIC]) {
      const { record } = loadEpic(dir);
      for (const s of record.prd?.stories ?? []) {
        const ids = record.scenarioFiles.flatMap((f) => f.scenarios.filter((sc) => sc.story === s.id && sc.status === 'approved').map((sc) => sc.id));
        if (ids.length === 0) continue;
        const r = scenarioTestBrief(record, s.id, ids);
        if (r.ok) expect(r.markdown.length, `${record.slug} ${s.id}`).toBeLessThan(MAX_BRIEF_CHARS);
      }
    }
  });
});
