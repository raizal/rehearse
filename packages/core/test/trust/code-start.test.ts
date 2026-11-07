// "Code you start from" (T49, box code-start-section): the section the build brief and the test
// brief print from the code facts the server or the CLI gathered. Pure: the facts are given here.

import { describe, expect, it } from 'vitest';
import {
  briefBoxPaths,
  CODE_START_HEADING,
  codeStartSection,
  coverageBadge,
  decisionTexts,
  loadEpic,
  MAX_BRIEF_CHARS,
  MAX_CODE_COMMITS,
  MAX_CODE_FUNCTIONS,
  MAX_CODE_GUESSES,
  MAX_CODE_NEIGHBOURS,
  PNPM_SETUP,
  scenarioTestBrief,
  storyBuildBrief,
  testBriefBoxPaths,
  TEST_NO_CODE,
  testCodeSection,
  type BoxCode,
  type CodeRef,
} from '../../src/index.js';
import { CODE_GRAPH_EPIC, REAL_EPIC } from '../helpers.js';
import { approvedEpic, signedEpic } from './helpers.js';


const fn = (i: number, file = 'src/pay.ts'): CodeRef => ({ name: `charge${i}`, file, line: 10 + i });

function payCode(over: Partial<BoxCode> = {}): BoxCode {
  return {
    box: 'pay',
    coverage: { percent: 72, tests: 3 },
    functions: [{ ...fn(0), coverage: { percent: 72, tests: 3 } }, { ...fn(1), coverage: { percent: null, tests: 0 } }],
    commits: [{ short: 'abc1234', subject: 'T9: pay by card', branch: 'feature/pay' }],
    callers: [{ name: 'checkout', file: 'src/cart.ts', line: 4 }],
    callees: [{ name: 'gateway', file: 'src/gateway.ts', line: 2 }],
    testedBy: [{ name: 'pay > charges the card', file: 'src/pay.test.ts', line: 7 }],
    ...over,
  };
}

describe('codeStartSection (T49, box code-start-section)', () => {
  it('prints one block per box in the order of the boxes, with path:line, badges, commits, callers, callees, tests and the commands', () => {
    const cart: BoxCode = { ...payCode(), box: 'cart', functions: [{ ...fn(5, 'src/cart.ts') }], coverage: { percent: null, tests: 0 } };
    const md = codeStartSection(['cart', 'pay'], { code: [payCode(), cart], cli: 'pnpm rehearse' });
    expect(md.startsWith(`## ${CODE_START_HEADING}\n`)).toBe(true);
    expect(md.indexOf('### `cart`')).toBeLessThan(md.indexOf('### `pay`'));
    expect(md).toContain('### `pay`: 2 functions, 72% · 3 tests');
    expect(md).toContain('- `charge0` src/pay.ts:10 (72% · 3 tests)');
    expect(md).toContain('- `charge1` src/pay.ts:11 (no coverage data)');
    expect(md).toContain('### `cart`: 1 function, no coverage data');
    expect(md).toContain('- Earlier commits: `abc1234` T9: pay by card (feature/pay)');
    expect(md).toContain('- Called by: `checkout` src/cart.ts:4');
    expect(md).toContain('- Calls: `gateway` src/gateway.ts:2');
    expect(md).toContain('- Tested by: `pay > charges the card` src/pay.test.ts:7');
    expect(md).toContain('- Dig deeper: `pnpm rehearse context pay`, `pnpm rehearse show charge0`, `pnpm rehearse coverage box pay`');
  });

  it('a box missing from the facts gets no block; no facts at all, no section', () => {
    expect(codeStartSection(['cart'], { code: [payCode()] })).toBe('');
    expect(codeStartSection(['pay'], {})).toBe('');
    expect(codeStartSection(['ship', 'pay'], { code: [payCode()] })).not.toContain('`ship`');
  });

  it('caps functions, commits, callers, callees and tests, and says how many more', () => {
    const many = <T>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));
    const md = codeStartSection(['pay'], {
      code: [
        payCode({
          functions: many(12, (i) => fn(i)),
          total: 12,
          commits: many(9, (i) => ({ short: `c${i}`, subject: `T${i}`, branch: i < 3 ? 'b1' : 'b2' })),
          callers: many(9, (i) => fn(i, 'src/a.ts')),
          callees: many(9, (i) => fn(i, 'src/b.ts')),
          testedBy: many(9, (i) => fn(i, 'src/pay.test.ts')),
        }),
      ],
    });
    expect(md.match(/^- `charge\d+` src\/pay\.ts/gm)).toHaveLength(MAX_CODE_FUNCTIONS);
    expect(md).toContain(`- and ${12 - MAX_CODE_FUNCTIONS} more: \`rehearse coverage box pay\``);
    expect(md).toContain(`- Earlier commits, latest ${MAX_CODE_COMMITS} of 9: \`c0\` T0; \`c1\` T1; \`c2\` T2 (b1); \`c3\` T3; \`c4\` T4 (b2)`);
    for (const label of ['Called by', 'Calls', 'Tested by']) {
      const line = md.split('\n').find((l) => l.startsWith(`- ${label}: `))!;
      expect(line.split('; ')).toHaveLength(MAX_CODE_NEIGHBOURS);
    }
  });

  it('a box with no code lists the nearest code as guesses; a box whose code is in its children says so', () => {
    const guesses = Array.from({ length: 7 }, (_, i) => fn(i, 'src/orders.ts'));
    const md = codeStartSection(['ship', 'ship/pack', 'cart'], {
      code: [
        { box: 'cart', functions: [], commits: [], callers: [], callees: [], testedBy: [], guesses, guessWords: 'cart order item' },
        { box: 'ship', functions: [], inChildren: true, commits: [], callers: [], callees: [], testedBy: [] },
        { box: 'ship/pack', functions: [], commits: [], callers: [], callees: [], testedBy: [], guesses: [] },
      ],
    });
    expect(md).toContain('### `cart`: no code yet\nNo code yet. Nearest existing code (guesses: graph matches for "cart order item", not linked to this box):');
    expect(md.match(/^- `charge\d+` src\/orders\.ts/gm)).toHaveLength(MAX_CODE_GUESSES);
    expect(md).toContain("- Dig deeper: `rehearse find 'cart order item'`, then `rehearse context <name>` on a match");
    expect(md).toContain('### `ship`: its code is in the boxes inside it');
    expect(md).toContain('### `ship/pack`: no code yet\nNo code yet, and the graph found nothing near its title.');
  });

  it('when the graph is down the section is one line, and the brief still builds', () => {
    const md = codeStartSection(['pay'], { codeUnavailable: 'database is locked\nat open', cli: 'node packages/cli/bin/rehearse.js' });
    expect(md).toBe(
      `## ${CODE_START_HEADING}\n\nThe code graph is not available (database is locked at open), so this brief lists no code; find it with \`node packages/cli/bin/rehearse.js find <words>\` once the graph opens.`,
    );
    const r = storyBuildBrief(loadEpic(signedEpic()).record, 'S1', { codeUnavailable: 'no graph' });
    expect(r.ok && r.markdown).toContain('The code graph is not available (no graph)');
  });

  it('quotes a command argument that holds a space', () => {
    const md = codeStartSection(['pay'], { code: [payCode({ target: 'rehearse record 2026-11-05-shop . box:pay', show: 'scip x/pay.ts/charge().' })] });
    expect(md).toContain("`rehearse context 'rehearse record 2026-11-05-shop . box:pay'`, `rehearse show 'scip x/pay.ts/charge().'`");
  });

  it('the badge is the coverage badge of the CLI and the panel', () => {
    expect(coverageBadge({ percent: 72, tests: 3 })).toBe('72% · 3 tests');
    expect(coverageBadge({ percent: 100, tests: 1 })).toBe('100% · 1 test');
    expect(coverageBadge({ percent: null, tests: 0 })).toBe('no coverage data');
  });
});

describe('the build brief with code (T49)', () => {
  it('puts the section after the boxes, for the boxes of the story', () => {
    const { record } = loadEpic(signedEpic());
    expect(briefBoxPaths(record, 'S1')).toEqual(['cart', 'pay']);
    const r = storyBuildBrief(record, 'S1', { code: [payCode()] });
    if (!r.ok) throw new Error(r.reason);
    const heads = r.markdown.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
    // The Design section (T50) sits between the boxes and the code.
    expect(heads.indexOf(CODE_START_HEADING)).toBe(heads.indexOf('Boxes') + 2);
    expect(heads.indexOf('Design')).toBe(heads.indexOf('Boxes') + 1);
    expect(r.markdown).toContain('Start from the section *Code you start from*');
  });

  it('every story of both real EPICs stays under the size budget with every box at its caps', () => {
    const long = (i: number, dir: string): CodeRef => ({ name: `someFairlyLongFunctionName${i}`, file: `packages/${dir}/src/some/folder/a-module-file.ts`, line: 100 + i });
    let largest = { id: '', chars: 0 };
    for (const dir of [REAL_EPIC, CODE_GRAPH_EPIC]) {
      const { record } = loadEpic(dir);
      const decisions = decisionTexts(dir);
      for (const s of record.prd!.stories) {
        const code: BoxCode[] = briefBoxPaths(record, s.id).map((box) => ({
          box,
          coverage: { percent: 72, tests: 3 },
          functions: Array.from({ length: MAX_CODE_FUNCTIONS }, (_, i) => ({ ...long(i, 'core'), coverage: { percent: 72, tests: 3 } })),
          total: 40,
          commits: Array.from({ length: 9 }, (_, i) => ({ short: `abc123${i}`, subject: 'T44: a commit subject that runs the whole seventy characters long, cut', branch: i % 3 === 2 ? 'bb/a-branch-name-of-a-thread-thr_abcdefghij' : undefined })).map((c) => (c.branch ? c : { short: c.short, subject: c.subject })),
          callers: Array.from({ length: MAX_CODE_NEIGHBOURS }, (_, i) => long(i, 'server')),
          callees: Array.from({ length: MAX_CODE_NEIGHBOURS }, (_, i) => long(i, 'graph')),
          testedBy: Array.from({ length: MAX_CODE_NEIGHBOURS }, (_, i) => ({ name: 'storyBuildBrief (T44, box build-brief) > holds every sectio…', file: 'packages/core/test/trust/build-brief.test.ts', line: 22 + i })),
        }));
        // With a design link of the story and of two boxes (T50).
        const link = { file: 'design/rehearse-review.figcraft', page: 15, png: 'design/15-story-code-thread-hidden.png' };
        const design = { story: link, boxes: Object.fromEntries(briefBoxPaths(record, s.id).slice(0, 2).map((b) => [b, link])) };
        const r = storyBuildBrief(record, s.id, { allowUnsigned: true, decisions, code, cli: 'pnpm rehearse', commands: { cli: 'pnpm rehearse', setup: PNPM_SETUP }, design });
        if (!r.ok) throw new Error(r.reason);
        if (r.markdown.length > largest.chars) largest = { id: `${record.slug} ${s.id}`, chars: r.markdown.length };
        expect(r.markdown.length, `${record.slug} ${s.id}`).toBeLessThan(MAX_BRIEF_CHARS);
      }
    }
    expect(largest.chars).toBeGreaterThan(0);
  });
});

describe('the test brief with code (T49; T61: no box code)', () => {
  it('lists no code of the boxes, says to work from the scenarios and the product that runs, and lists the e2e helpers', () => {
    const { record } = loadEpic(approvedEpic());
    expect(testBriefBoxPaths(record, 'S1', ['S1-buy', 'S1-empty'])).toEqual(expect.arrayContaining(['cart', 'pay']));
    const r = scenarioTestBrief(loadEpic(approvedEpic()).record, 'S1', ['S1-buy', 'S1-empty'], {
      code: [payCode({ functions: Array.from({ length: 7 }, (_, i) => fn(i)), total: 7 })],
      e2eHelpers: [{ name: 'serve', file: 'e2e/tests/serve.ts', line: 16 }],
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.markdown).toContain(`## ${CODE_START_HEADING}`);
    expect(r.markdown).toContain(TEST_NO_CODE);
    expect(r.markdown).not.toContain('src/pay.ts');
    expect(r.markdown).not.toContain('charge0');
    expect(r.markdown).toContain('- E2e helpers: `serve` e2e/tests/serve.ts:16');
  });

  it('says so when there are no helpers; the rule shows also without code facts', () => {
    expect(testCodeSection([{ id: 'S1-buy', boxes: ['pay'] }], { code: [payCode()] })).toContain('- E2e helpers: none yet outside the spec files.');
    expect(testCodeSection([{ id: 'S1-buy', boxes: ['pay'] }], { codeUnavailable: 'no graph' })).not.toContain('no graph');
    expect(testCodeSection([{ id: 'S1-buy', boxes: ['pay'] }], {})).toContain(TEST_NO_CODE);
  });
});
