// T50: the words of a design link, the editor's address, the host-mode messages, which FigCraft
// saves rehearse writes and which it offers as a download, base64 and the latest test run.

import { describe, expect, it } from 'vitest';
import {
  asBytes,
  baseName,
  designCaption,
  figcraftSrc,
  latestRun,
  openPageHint,
  pageWords,
  readFigcraftMessage,
  savedWords,
  saveTarget,
  toBase64,
} from '../src/model/design.js';
import type { TestRow } from '../src/model/tests.js';

describe('T50 design words', () => {
  it('a page number says "page 13", a page name says the name', () => {
    expect(pageWords(13)).toBe('page 13');
    expect(pageWords('Story code')).toBe('page “Story code”');
    expect(openPageHint(13)).toBe('Open page 13');
    expect(openPageHint('Story code')).toBe('Open page “Story code”');
  });

  it('the caption names the file and the page', () => {
    expect(designCaption({ file: 'design/rehearse-review.figcraft', page: 14 })).toBe('design/rehearse-review.figcraft · page 14');
    expect(baseName('design/rehearse-review.figcraft')).toBe('rehearse-review.figcraft');
    expect(savedWords('design/x.figcraft')).toBe('Saved to design/x.figcraft — commit it when you are happy');
  });

  it('the editor opens in host mode on the same origin, the owner as the author', () => {
    expect(figcraftSrc('/figcraft/', 'Raizal I.N. Pregnanta')).toBe('figcraft/?host=parent&author=Raizal%20I.N.%20Pregnanta');
    expect(figcraftSrc('/figcraft', 'a&b')).toBe('figcraft/?host=parent&author=a%26b');
  });
});

describe('T50 FigCraft saves', () => {
  const sent = { name: 'rehearse-review.figcraft', file: 'design/rehearse-review.figcraft' };

  it('a plain Save of the sent file is written to that file', () => {
    expect(saveTarget({ name: 'rehearse-review.figcraft', saveAs: false }, sent)).toEqual({ kind: 'write', file: 'design/rehearse-review.figcraft' });
  });

  it('Save As, another name (exports, PNG, PDF, .fig) or nothing sent yet is a download', () => {
    expect(saveTarget({ name: 'rehearse-review.figcraft', saveAs: true }, sent)).toEqual({ kind: 'download', name: 'rehearse-review.figcraft' });
    expect(saveTarget({ name: 'page-13.png', saveAs: false }, sent)).toEqual({ kind: 'download', name: 'page-13.png' });
    expect(saveTarget({ name: 'rehearse-review.fig', saveAs: false }, sent)).toEqual({ kind: 'download', name: 'rehearse-review.fig' });
    expect(saveTarget({ name: 'rehearse-review.figcraft', saveAs: false }, undefined)).toEqual({ kind: 'download', name: 'rehearse-review.figcraft' });
  });

  it('reads the host-mode messages; others are ignored', () => {
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    expect(readFigcraftMessage({ type: 'figcraft:ready', version: '1', appVersion: '2' })).toEqual({ type: 'figcraft:ready', version: '1', appVersion: '2' });
    expect(readFigcraftMessage({ type: 'figcraft:dirty', dirty: true })).toEqual({ type: 'figcraft:dirty', dirty: true });
    expect(readFigcraftMessage({ type: 'figcraft:failed', error: 'no WebGL' })).toEqual({ type: 'figcraft:failed', error: 'no WebGL' });
    const save = readFigcraftMessage({ type: 'figcraft:save', name: 'x.figcraft', saveAs: false, bytes: buffer });
    expect(save).toMatchObject({ type: 'figcraft:save', name: 'x.figcraft', saveAs: false });
    expect([...(save as { bytes: Uint8Array }).bytes]).toEqual([1, 2, 3]);
    expect(readFigcraftMessage({ type: 'figcraft:save', name: 'x.figcraft', saveAs: false })).toBeUndefined();
    expect(readFigcraftMessage({ type: 'other' })).toBeUndefined();
    expect(readFigcraftMessage('figcraft:ready')).toBeUndefined();
  });

  it('bytes come as an ArrayBuffer or a typed array; base64 is what the save call sends', () => {
    expect([...asBytes(new Uint8Array([9, 8]))!]).toEqual([9, 8]);
    expect(asBytes('abc')).toBeUndefined();
    expect(toBase64(new TextEncoder().encode('figcraft'))).toBe(btoa('figcraft'));
    const big = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(atob(toBase64(big)).length).toBe(100_000);
  });
});

describe('T50 the latest test run beside a design', () => {
  const row = (scenarioId: string, status: TestRow['status']): TestRow => ({ scenarioId, title: scenarioId, status, words: status });

  it('no test has run: "No run yet"', () => {
    expect(latestRun([row('S1-buy', 'not run'), row('S1-empty', 'no test')])).toEqual({ ran: false, text: 'No run yet' });
  });

  it('a run: the summary and the rows that ran', () => {
    const run = latestRun([row('S1-buy', 'passed'), row('S1-empty', 'no test')]);
    expect(run).toMatchObject({ ran: true, text: '1 of 1 tests pass, 1 scenario without a test' });
    expect(run.ran && run.rows.map((r) => r.scenarioId)).toEqual(['S1-buy']);
  });
});
