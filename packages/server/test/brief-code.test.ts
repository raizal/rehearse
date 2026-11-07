// The code facts of a brief (T49, box gather-box-code), gathered from a real graph of a small repo:
// the graph's shop fixture with the core shop EPIC under docs/epics/, and one commit whose Flow-Box
// trailer names the box `pay`. No network, no tests run.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { briefBoxPaths, loadEpic, storyBuildBrief } from '@rehearse/core';
import { gatherBriefCode, guessWords, openGraphAccess, rehearseCommand, type GraphAccess } from '../src/index.js';

const SHOP_CODE = fileURLToPath(new URL('../../graph/test/fixtures/shop', import.meta.url));
const SHOP_EPIC = fileURLToPath(new URL('../../core/test/fixtures/shop', import.meta.url));
const SLUG = '2026-11-05-shop';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });

/** The shop's code and EPIC in one repo: a first commit, then one that builds `pay`. */
function shopRepo(): { root: string; epicDir: string } {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), 'rehearse-brief-code-'))), 'shop');
  cpSync(SHOP_CODE, root, { recursive: true });
  const epicDir = join(root, 'docs', 'epics', SLUG);
  cpSync(SHOP_EPIC, epicDir, { recursive: true });
  mkdirSync(join(root, 'e2e', 'tests'), { recursive: true });
  writeFileSync(join(root, 'e2e', 'tsconfig.json'), '{ "include": ["tests"] }\n');
  writeFileSync(join(root, 'e2e', 'tests', 'helpers.ts'), 'export function openShop(): string {\n  return "/";\n}\n');
  writeFileSync(join(root, 'e2e', 'tests', 'S1.spec.ts'), "import { openShop } from './helpers';\nexport function inSpec(): string {\n  return openShop();\n}\n");
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'shop');
  writeFileSync(join(root, 'src', 'pay.ts'), `${readText(join(root, 'src', 'pay.ts'))}\n// card payments\n`);
  git(root, 'commit', '-q', '-am', 'T1: pay by card', '-m', 'Flow-Box: pay');
  return { root, epicDir };
}

function readText(path: string): string {
  return execFileSync('cat', [path], { encoding: 'utf8' });
}

let shop: { root: string; epicDir: string };
beforeAll(() => {
  shop = shopRepo();
}, 60_000);

describe('gatherBriefCode (T49, box gather-box-code)', () => {
  it('the box with code: its functions with coverage and its commits with branch; a box with none gets guesses; the e2e helpers', async () => {
    const { record } = loadEpic(shop.epicDir);
    const boxes = briefBoxPaths(record, 'S1');
    expect(boxes).toEqual(['cart', 'pay']);
    const facts = await gatherBriefCode({ epicDir: shop.epicDir, record, boxes, graph: openGraphAccess(shop.root), testProject: 'e2e' });
    expect(facts.codeUnavailable).toBeUndefined();
    expect(facts.cli).toBe('rehearse');
    const [cart, pay] = facts.code!;
    expect(pay!.box).toBe('pay');
    expect(pay!.functions[0]).toMatchObject({ name: 'charge', file: 'src/pay.ts', line: 10, coverage: { percent: null, tests: 0 } });
    expect(pay!.commits).toEqual([{ short: expect.stringMatching(/^[0-9a-f]{7}$/), subject: 'T1: pay by card', branch: 'main' }]);
    expect(pay!.target).toBe('pay');
    expect(cart!.box).toBe('cart');
    expect(cart!.functions).toEqual([]);
    expect(cart!.guessWords).toContain('cart');
    for (const g of cart!.guesses ?? []) expect(g.file.endsWith('.test.ts')).toBe(false);
    expect(facts.e2eHelpers).toEqual([{ name: 'openShop', file: 'e2e/tests/helpers.ts', line: 1 }]);

    const brief = storyBuildBrief(record, 'S1', { allowUnsigned: true, ...facts });
    if (!brief.ok) throw new Error(brief.reason);
    expect(brief.markdown).toContain('### `pay`: 1 function, no coverage data\n- `charge` src/pay.ts:10 (no coverage data)');
    expect(brief.markdown).toContain('### `cart`: no code yet');
  }, 60_000);

  it('the graph cannot open: one line, and the commits are not needed for the brief to build', async () => {
    const { record } = loadEpic(shop.epicDir);
    const down: GraphAccess = async () => {
      throw new Error('the graph store is locked');
    };
    const facts = await gatherBriefCode({ epicDir: shop.epicDir, record, boxes: ['pay'], graph: down });
    expect(facts).toEqual({ cli: 'rehearse', codeUnavailable: 'the graph store is locked' });
    const brief = storyBuildBrief(record, 'S1', { allowUnsigned: true, ...facts });
    expect(brief.ok && brief.markdown).toContain('The code graph is not available (the graph store is locked)');
  });

  it('a graph store that is not a database is the same as no graph', async () => {
    const root = join(realpathSync(mkdtempSync(join(tmpdir(), 'rehearse-brief-down-'))), 'shop');
    cpSync(SHOP_EPIC, join(root, 'docs', 'epics', SLUG), { recursive: true });
    mkdirSync(join(root, '.rehearse', 'graph.db'), { recursive: true });
    const epicDir = join(root, 'docs', 'epics', SLUG);
    const facts = await gatherBriefCode({ epicDir, record: loadEpic(epicDir).record, boxes: ['pay'], root, graph: openGraphAccess(root) });
    expect(facts.code).toBeUndefined();
    expect(facts.codeUnavailable).toEqual(expect.any(String));
  });

  it('the rehearse command as it runs in the repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rehearse-cmd-'));
    expect(rehearseCommand(dir)).toBe('rehearse');
    mkdirSync(join(dir, 'packages', 'cli', 'bin'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'cli', 'bin', 'rehearse.js'), '');
    expect(rehearseCommand(dir)).toBe('node packages/cli/bin/rehearse.js');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { rehearse: 'node packages/cli/bin/rehearse.js' } }));
    expect(rehearseCommand(dir)).toBe('pnpm rehearse');
  });

  it('guess words: the title and contract, short and common words left out', () => {
    expect(guessWords('Check out the cart', ['orderId', 'items'])).toBe('check out cart order items');
  });
});
