// T13 feature 2: `rehearse playlists` writes one Birdview playlist per story into the folder it
// is told (default <test project>/birdview/playlists), from tests named after scenario ids.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHOP } from '../../core/test/helpers.js';
import { run } from '../src/index.js';

function io(cwd: string) {
  const out = { stdout: '', stderr: '' };
  return { out, io: { cwd, stdout: (t: string) => (out.stdout += t), stderr: (t: string) => (out.stderr += t) } };
}

const SPEC = `import { test } from '@playwright/test';

test('S1-buy', async () => {
  await test.step('cart: Buyer checks out', async () => {});
  await test.step('pay: Shop charges', async () => {});
});
`;

function testProject(spec = SPEC): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'rehearse-pl-')), 'e2e');
  mkdirSync(join(dir, 'tests'), { recursive: true });
  writeFileSync(join(dir, 'playwright.config.ts'), 'export default {};\n');
  writeFileSync(join(dir, 'tests', 'shop.spec.ts'), spec);
  return dir;
}

describe('T13 2 rehearse playlists', () => {
  it('T13 2.6 writes <out>/<story>.json for each story with a test, and nothing else', () => {
    const tests = testProject();
    const out = join(tests, 'out');
    const t = io(tests);
    expect(run(['playlists', SHOP, '--tests', tests, '--out', out], t.io)).toBe(0);
    const playlist = JSON.parse(readFileSync(join(out, 'S1.json'), 'utf8'));
    expect(playlist.name).toBe('S1 · to pay for my cart');
    expect(playlist.tests).toHaveLength(1);
    expect(playlist.tests[0]).toMatchObject({ file: 'tests/shop.spec.ts', line: 3, name: 'S1-buy', steps: { 'cart: Buyer checks out': 'cart', 'pay: Shop charges': 'pay' } });
    expect(existsSync(join(out, 'S2.json'))).toBe(false);
    expect(t.out.stdout).toContain('S1.json: 1 test(s)');
  });

  it('T13 2.7 defaults to <test project>/birdview/playlists', () => {
    const tests = testProject();
    expect(run(['playlists', SHOP, '--tests', tests], io(tests).io)).toBe(0);
    expect(existsSync(join(tests, 'birdview', 'playlists', 'S1.json'))).toBe(true);
  });

  it('T13 2.8 exits 1 on a step whose box the scenario does not walk, or when no test names a scenario', () => {
    const bad = testProject(SPEC.replace('pay: Shop charges', 'ship: Shop ships'));
    const t = io(bad);
    expect(run(['playlists', SHOP, '--tests', bad], t.io)).toBe(1);
    expect(t.out.stderr).toContain('names ship');
    const none = testProject("import { test } from '@playwright/test';\ntest('unrelated', () => {});\n");
    const n = io(none);
    expect(run(['playlists', SHOP, '--tests', none], n.io)).toBe(1);
    expect(n.out.stderr).toContain('no test');
  });

  it('T13 2.9 usage errors exit 2', () => {
    const tests = testProject();
    for (const args of [[], ['--tests'], [SHOP, '--nope'], ['no-such-epic', '--tests', tests]]) expect(run(['playlists', ...args], io(tests).io)).toBe(2);
  });
});
