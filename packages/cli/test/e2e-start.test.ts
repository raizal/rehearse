// `rehearse e2e-start` (T61, S26, box e2e-start): the start file of a story's e2e tests, written in
// the test project or printed. It never writes over a file; --append adds only the missing tests.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeEpic } from '../../core/test/helpers.js';
import { approvedEpic } from '../../core/test/trust/helpers.js';
import { main } from '../src/index.js';

async function cli(args: string[], cwd = tmpdir()): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(args, { cwd, stdout: (t) => (out += t), stderr: (t) => (err += t) });
  return { code, out, err };
}

/** The shop, approved, with an empty e2e project beside it that has a serve fixture. */
function shop(): { dir: string; spec: string } {
  const dir = approvedEpic();
  const e2e = join(dirname(dir), 'e2e');
  mkdirSync(join(e2e, 'tests'), { recursive: true });
  writeFileSync(join(e2e, 'playwright.config.ts'), 'export default {};\n');
  writeFileSync(join(e2e, 'tests', 'serve.ts'), 'export const test = 1;\nexport async function serve() {}\n');
  return { dir, spec: join(e2e, 'tests', 'S1.spec.ts') };
}

describe('rehearse e2e-start (T61, box e2e-start)', () => {
  it('writes the start file in the test project: one test for each approved scenario, the main path first, exit 0', async () => {
    const { dir, spec } = shop();
    const r = await cli(['e2e-start', dir, 'S1'], dirname(dir));
    expect(r).toMatchObject({ code: 0, err: '' });
    expect(r.out).toContain('Wrote e2e/tests/S1.spec.ts: 2 tests for S1-buy, S1-empty (S1-buy is the main path).');
    expect(r.out).toContain('Each step fails with "not written" until you write it.');
    const text = readFileSync(spec, 'utf8');
    expect(text).toContain("import { expect, test } from './serve.js';");
    expect(text.indexOf("test('S1-buy:")).toBeLessThan(text.indexOf("test('S1-empty:"));
  });

  it('--main-path writes only the main path; --stdout prints and writes nothing', async () => {
    const { dir, spec } = shop();
    const printed = await cli(['e2e-start', dir, 'S1', '--main-path', '--stdout']);
    expect(printed.code).toBe(0);
    expect(printed.out).toContain("test('S1-buy: Buyer pays and the order ships'");
    expect(printed.out).not.toContain("test('S1-empty");
    expect(existsSync(spec)).toBe(false);
    const wrote = await cli(['e2e-start', dir, 'S1', '--main-path'], dirname(dir));
    expect(wrote.out).toContain('Wrote e2e/tests/S1.spec.ts: a test for S1-buy (S1-buy is the main path).');
  });

  it('never writes over the file (exit 1); --append adds the missing tests and keeps the others', async () => {
    const { dir, spec } = shop();
    const mine = "import { test } from './serve.js';\n\ntest('S1-buy', async () => {\n  // my own test\n});\n";
    writeFileSync(spec, mine);
    const again = await cli(['e2e-start', dir, 'S1'], dirname(dir));
    expect(again).toMatchObject({ code: 1, out: '' });
    expect(again.err).toContain('rehearse e2e-start: the test file exists already: e2e/tests/S1.spec.ts. Add --append');
    expect(readFileSync(spec, 'utf8')).toBe(mine);
    const added = await cli(['e2e-start', dir, 'S1', '--append'], dirname(dir));
    expect(added.code).toBe(0);
    expect(added.out).toContain('Added to e2e/tests/S1.spec.ts: a test for S1-empty.');
    expect(added.out).toContain('Kept the tests of S1-buy as they are.');
    expect(readFileSync(spec, 'utf8').startsWith(mine.trimEnd())).toBe(true);
    expect(await cli(['e2e-start', dir, 'S1', '--append'], dirname(dir))).toMatchObject({ code: 1 });
  });

  it('exit 1 for a draft scenario; exit 2 for an unknown story, an unknown scenario or a usage error', async () => {
    const draft = await cli(['e2e-start', makeEpic(), 'S1', '--stdout']);
    expect(draft.code).toBe(1);
    expect(draft.err).toContain('the owner approves the scenarios first');
    expect((await cli(['e2e-start', approvedEpic(), 'S9', '--stdout'])).code).toBe(2);
    expect((await cli(['e2e-start', approvedEpic(), 'S1', '--scenario', 'S1-nope', '--stdout'])).code).toBe(2);
    expect((await cli(['e2e-start', approvedEpic(), 'S1', '--main-path', '--scenario', 'S1-buy'])).err).toContain('--main-path and --scenario do not go together');
    expect((await cli(['e2e-start', approvedEpic(), 'S1', '--stdout', '--append'])).code).toBe(2);
    expect((await cli(['e2e-start', approvedEpic()])).code).toBe(2);
  });
});
