// T61 (S26, box e2e-start): the start file of a story's e2e tests. One test for each approved
// scenario, one step for each step, each step fails until it is written, the main path first, and a
// file that exists is never written again.

import { describe, expect, it } from 'vitest';
import { e2eStart, loadEpic, NOT_WRITTEN, specTestNames, testNameOf } from '../../src/index.js';
import { makeEpic } from '../helpers.js';
import { approvedEpic } from './helpers.js';

const FIXTURES = { ui: { file: 'e2e/tests/serve.ts', exports: ['test'] }, cli: { file: 'e2e/tests/cli.ts', exports: ['freshRepo', 'rehearse'] } };
const SPEC = 'e2e/tests/S1.spec.ts';
const shop = () => loadEpic(approvedEpic()).record;

describe('e2eStart (T61, box e2e-start)', () => {
  it('writes one test for each approved scenario, one step for each step, with the example as a comment; each step fails', () => {
    const r = e2eStart(shop(), 'S1', { specFile: SPEC, fixtures: FIXTURES });
    if (!r.ok) throw new Error(r.reason);
    expect(r.scenarios).toEqual(['S1-buy', 'S1-empty']);
    expect(r.mainId).toBe('S1-buy');
    expect(r.appended).toBe(false);
    expect(r.text).toContain("import { expect, test } from './serve.js';");
    expect(r.text).toContain("import { freshRepo, rehearse } from './cli.js';");
    expect(r.text.match(/^test\(/gm)).toHaveLength(2);
    expect(r.text).toContain("test('S1-buy: Buyer pays and the order ships', async () => {");
    expect(r.text).toContain("test('S1-empty: Buyer checks out an empty cart', async () => {");
    expect(r.text).toContain('// The main path of S1: "done" needs this test passed on the real screens.');
    expect(r.text).toContain('// Checks S1-A1: given a cart with items; when the buyer pays; then the order is shipped.');
    expect(r.text.match(/await test\.step\(/g)).toHaveLength(7 + 3);
    expect(r.text).toContain("await test.step('cart: Check out the cart', async () => {");
    expect(r.text).toContain('// Example cart-ok: given {"items":["a"]}; then {"orderId":"o1"}.');
    expect(r.text).toContain('// Step 2 of 3, the branch "empty-cart".');
    expect(r.text).toContain('// Expect at the end: {"Order.status":"shipped"}.');
    // Never a silent pass: each step throws until it is written.
    expect(r.text.match(new RegExp(`throw new Error\\('${NOT_WRITTEN}: `, 'g'))).toHaveLength(10);
    expect(r.text).toContain(`'${NOT_WRITTEN}: S1-buy step 3 (pay)'`);
    // The Tests tab and Birdview find each test by its scenario id.
    expect([...specTestNames(r.text)]).toEqual(['S1-buy', 'S1-empty']);
  });

  it('--main-path keeps only the main path: the story map rule, else the owner pick in review.yaml; the main path comes first', () => {
    const rule = e2eStart(shop(), 'S1', { specFile: SPEC, mainPath: true });
    expect(rule.ok && rule.scenarios).toEqual(['S1-buy']);
    const pick = e2eStart(shop(), 'S1', { specFile: SPEC, mainPath: true, mainPathPick: 'S1-empty' });
    expect(pick.ok && pick.scenarios).toEqual(['S1-empty']);
    expect(pick.ok && pick.text).toContain('// The main path of S1');
    const both = e2eStart(shop(), 'S1', { specFile: SPEC, mainPathPick: 'S1-empty' });
    expect(both.ok && both.scenarios).toEqual(['S1-empty', 'S1-buy']);
    // Without fixtures it imports from Playwright.
    expect(rule.ok && rule.text).toContain("import { expect, test } from '@playwright/test';");
  });

  it('never writes over a file; --append adds only the missing tests and keeps the existing text', () => {
    const existing = "import { test } from './serve.js';\n\ntest('S1-buy', async () => {\n  // my own test\n});\n";
    const exists = e2eStart(shop(), 'S1', { specFile: SPEC, existing });
    expect(exists).toMatchObject({ ok: false, error: 'exists' });
    expect(!exists.ok && exists.reason).toContain('the test file exists already: e2e/tests/S1.spec.ts');
    const added = e2eStart(shop(), 'S1', { specFile: SPEC, existing, append: true });
    if (!added.ok) throw new Error(added.reason);
    expect(added).toMatchObject({ scenarios: ['S1-empty'], kept: ['S1-buy'], appended: true });
    expect(added.text.startsWith(existing.trimEnd())).toBe(true);
    expect(added.text).toContain("test('S1-empty: Buyer checks out an empty cart'");
    expect(added.text.match(/^test\('S1-buy/gm)).toHaveLength(1);
    const again = e2eStart(shop(), 'S1', { specFile: SPEC, existing: added.text, append: true });
    expect(again).toMatchObject({ ok: false, error: 'nothing-new' });
  });

  it('says why there is no file: no story, no scenario, a draft scenario, no approved scenario', () => {
    expect(e2eStart(shop(), 'S9', { specFile: SPEC })).toMatchObject({ ok: false, error: 'no-story' });
    expect(e2eStart(shop(), 'S1', { specFile: SPEC, scenarios: ['S1-nope'] })).toMatchObject({ ok: false, error: 'no-scenario' });
    const drafts = loadEpic(makeEpic()).record;
    expect(e2eStart(drafts, 'S1', { specFile: SPEC })).toMatchObject({ ok: false, error: 'none-approved' });
    const draft = e2eStart(drafts, 'S1', { specFile: SPEC, scenarios: ['S1-buy'] });
    expect(draft).toMatchObject({ ok: false, error: 'not-approved' });
    expect(!draft.ok && draft.reason).toContain('S1-buy: approve this scenario first');
  });

  it('testNameOf reads the scenario id of a title: the whole title, or the id before ": "', () => {
    expect(testNameOf('S10-pass: CI passes')).toBe('S10-pass');
    expect(testNameOf('S10-pass')).toBe('S10-pass');
    expect(testNameOf('a test without an id')).toBe('a test without an id');
    expect([...specTestNames("test.describe('x', () => {});\n  test(\"S2-a: it's ok\", async () => {});\n")]).toEqual(['S2-a']);
  });
});
