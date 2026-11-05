// T11 (story Code tab, design page 13): the pure model of the Code tab. The component tests are
// in code.test.tsx.

import { describe, expect, it } from 'vitest';
import type { BoxCodeView, BoxCommit, CodeIndex, Hunk } from '@rehearse/server';
import { bullets, codeChipText, codeStrip, compareChoices, plainWords, splitPath, splitRows, stripBoxText, taskThreads, unifiedRows } from '../src/model/code.js';
import { boxAt } from '../src/model/diagram.js';
import { storyDetail } from '../src/model/storyview.js';
import { reviewEpic } from './fixture.js';

const ref = (c: string, subject: string) => ({ sha: c.repeat(40), short: c.repeat(7), subject, date: '2026-11-05T10:00:00+07:00' });
const commit = (c: string, subject: string, body = ''): BoxCommit => ({ ...ref(c, subject), body, boxes: [] });

/** Story S1 of the shop, with the decision in-stock serving it too. */
function s1() {
  const view = reviewEpic();
  boxAt(view.flow, 'in-stock')!.stories = ['S1'];
  return storyDetail(view, 'S1');
}

const INDEX: CodeIndex = {
  ok: true,
  head: ref('9', 'Head'),
  boxes: {
    cart: { commits: [ref('1', 'Cart')], files: ['src/cart.ts', 'src/cart.test.ts', 'README.md'] },
    pay: { commits: [], files: [] },
    'in-stock': { commits: [ref('2', 'Stock')], files: ['src/stock.ts'] },
  },
};

describe('T11 1 the story header chip and T11 2 the box strip', () => {
  it('lists the HOW boxes in flow order with kind, lane and file count; decision, start and end boxes never have code', () => {
    const strip = codeStrip(s1().how, INDEX, ['cart']);
    expect(strip.map((b) => [b.path, b.kind, b.lane, b.canHaveCode, b.hasCode, stripBoxText(b), b.changed])).toEqual([
      ['cart', 'input', 'Builder', true, true, '3 files', true],
      ['pay', 'process', 'System', true, false, 'no code', false],
      ['in-stock', 'decision', 'System', false, false, 'no code', false],
    ]);
    expect(codeChipText(strip)).toBe('Code: 1 of 3 boxes have code');
  });

  it('without the index (loading or no git) no box has code', () => {
    const strip = codeStrip(s1().how, undefined);
    expect(strip.every((b) => !b.hasCode && !b.changed)).toBe(true);
    expect(codeChipText(codeStrip(s1().how, { ok: false, reason: 'no git' }))).toBe('Code: 0 of 3 boxes have code');
  });

  it('says one file and one box in the singular', () => {
    const one = codeStrip(s1().how, { ...INDEX, boxes: { cart: { commits: [ref('1', 'Cart')], files: ['a.ts'] } } } as CodeIndex);
    expect(stripBoxText(one[0]!)).toBe('1 file');
    expect(codeChipText(one.slice(0, 1))).toBe('Code: 1 of 1 box has code');
  });
});

describe('T11 3 the box panel', () => {
  const view = (over: Partial<BoxCodeView> = {}): BoxCodeView => ({
    ok: true,
    box: 'cart',
    commits: [ref('1', 'First'), ref('2', 'Second')],
    head: ref('9', 'Head'),
    before: ref('0', 'Parent'),
    after: ref('2', 'Second'),
    range: [],
    changedBoxes: [],
    files: [],
    unchanged: [],
    ...over,
  });

  it('compare choices: before is the current before, any commit of the box, or HEAD; after is any commit of the box or HEAD', () => {
    const c = compareChoices(view());
    expect(c.before.map((x) => x.label)).toEqual(['0000000 Parent', '1111111 First', '2222222 Second', '9999999 Head (HEAD)']);
    expect(c.after.map((x) => x.label)).toEqual(['1111111 First', '2222222 Second', '9999999 Head (HEAD)']);
    expect(compareChoices(view({ commits: [ref('9', 'Head')], after: ref('9', 'Head') })).after.map((x) => x.label)).toEqual(['9999999 Head (HEAD)']);
  });

  it('plain words: the bullet lines of each body (a wrapped bullet is one line), else the subject; and the record ids of the subjects', () => {
    const range = [
      commit('1', 'Sign approvals with SSH keys (D41)', '- trust/signature.ts: canonical payloads,\n  ssh-keygen behind an interface.\n- Approve writes nothing without a key.\n\nFlow-Box: approve'),
      commit('2', 'Fix the cart total (R13, D41)', 'Only prose here.\n\nFlow-Box: cart'),
    ];
    expect(plainWords(range)).toEqual({
      lines: [
        { text: 'trust/signature.ts: canonical payloads, ssh-keygen behind an interface.', short: '1111111' },
        { text: 'Approve writes nothing without a key.', short: '1111111' },
        { text: 'Fix the cart total (R13, D41)', short: '2222222' },
      ],
      ids: ['D41', 'R13'],
    });
    expect(bullets('* star bullet\nnot a bullet\n  - indented bullet')).toEqual(['star bullet', 'indented bullet']);
  });

  it('task threads: the thr_ ids a body or its trailers name, once each; none when no commit names one', () => {
    const range = [commit('1', 'One', 'Done in thr_abc123.\n\nBB-Thread: thr_abc123'), commit('2', 'Two', 'Flow-Box: cart\nBB-Thread: thr_zz9')];
    expect(taskThreads(range)).toEqual([
      { id: 'thr_abc123', short: '1111111', subject: 'One' },
      { id: 'thr_zz9', short: '2222222', subject: 'Two' },
    ]);
    expect(taskThreads([commit('3', 'Three', 'no thread')])).toEqual([]);
  });

  it('splits a path into the file name and its folder', () => {
    expect(splitPath('packages/core/src/trust/write.ts')).toEqual({ name: 'write.ts', dir: 'packages/core/src/trust' });
    expect(splitPath('README.md')).toEqual({ name: 'README.md', dir: '' });
  });
});

describe('T11 3 diff rows', () => {
  const ctx = (o: number, n: number) => ({ kind: 'context' as const, text: `c${o}`, old: o, new: n });
  const hunk: Hunk = {
    oldStart: 10,
    oldLines: 10,
    newStart: 20,
    newLines: 10,
    section: 'function f()',
    lines: [ctx(10, 20), { kind: 'del', text: 'old', old: 11 }, { kind: 'add', text: 'new', new: 21 }, ctx(12, 22), ctx(13, 23), ctx(14, 24), ctx(15, 25), ctx(16, 26), ctx(17, 27), { kind: 'add', text: 'more', new: 28 }, ctx(18, 29)],
  };

  it('unified: a hunk header, then the lines; a run of more than 4 unchanged lines folds, keeping the line next to each change', () => {
    const rows = unifiedRows([hunk]);
    expect(rows[0]).toEqual({ kind: 'hunk', hunk: 0, text: '@@ -10,10 +20,10 @@ function f()' });
    const shape = rows.slice(1).map((r) => (r.kind === 'line' ? `${r.line.kind}:${r.line.old ?? ''}/${r.line.new ?? ''}` : r.kind === 'fold' ? `fold ${r.count}` : r.kind));
    expect(shape).toEqual(['context:10/20', 'del:11/', 'add:/21', 'context:12/22', 'fold 4', 'context:17/27', 'add:/28', 'context:18/29']);
    const fold = rows.find((r) => r.kind === 'fold');
    expect(fold).toEqual({ kind: 'fold', id: '0:3', count: 4 });
    expect(unifiedRows([hunk], new Set(['0:3'])).some((r) => r.kind === 'fold')).toBe(false);
  });

  it('split: unchanged lines on both sides, removed lines left of the added lines that replace them', () => {
    const rows = splitRows([{ ...hunk, lines: hunk.lines.slice(0, 4) }]);
    expect(rows.map((r) => (r.kind === 'pair' ? [r.left?.text, r.right?.text] : r.kind))).toEqual(['hunk', ['c10', 'c10'], ['old', 'new'], ['c12', 'c12']]);
    const uneven = splitRows([{ ...hunk, lines: [{ kind: 'del', text: 'a', old: 1 }, { kind: 'del', text: 'b', old: 2 }, { kind: 'add', text: 'c', new: 1 }] }]);
    expect(uneven.slice(1).map((r) => (r.kind === 'pair' ? [r.left?.text, r.right?.text] : r.kind))).toEqual([
      ['a', 'c'],
      ['b', undefined],
    ]);
  });
});
