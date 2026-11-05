// T11 (story Code tab, design page 13): the pure parsers of the git output that the box code
// route reads. No git runs here.

import { describe, expect, it } from 'vitest';
import { capDiff, FS, parseLog, parseNumstat, parseUnifiedDiff, RS, trailerServes, TS } from '../src/git-parse.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

describe('T11 1 parseLog: commits with Flow-Box trailers', () => {
  it('reads hash, short hash, subject, date, trailer boxes and the files of --name-only', () => {
    const text = [
      `${RS}${A}${FS}aaaaaaa${FS}Sign approvals (D41)${FS}2026-11-05T15:03:45+07:00${FS}approve${TS}gate/traced\n\npackages/core/src/trust/write.ts\npackages/core/src/trust/signature.ts\n`,
      `${RS}${B}${FS}bbbbbbb${FS}No trailer${FS}2026-11-04T10:00:00+07:00${FS}\n\nREADME.md\n`,
    ].join('');
    expect(parseLog(text)).toEqual([
      { sha: A, short: 'aaaaaaa', subject: 'Sign approvals (D41)', date: '2026-11-05T15:03:45+07:00', boxes: ['approve', 'gate/traced'], files: ['packages/core/src/trust/write.ts', 'packages/core/src/trust/signature.ts'] },
      { sha: B, short: 'bbbbbbb', subject: 'No trailer', date: '2026-11-04T10:00:00+07:00', boxes: [], files: ['README.md'] },
    ]);
  });

  it('reads the body when the format has %b, and skips records that are not commits', () => {
    const body = '- First change.\n- Second change.\n\nFlow-Box: approve\n';
    const text = `${RS}${A}${FS}aaaaaaa${FS}Subject${FS}2026-11-05T15:03:45+07:00${FS}approve${FS}${body}\n${RS}garbage${FS}x\n`;
    expect(parseLog(text, true)).toEqual([{ sha: A, short: 'aaaaaaa', subject: 'Subject', date: '2026-11-05T15:03:45+07:00', boxes: ['approve'], files: [], body: body.trimEnd() }]);
  });

  it('a trailer serves its box and the boxes that hold it, not a box whose name only starts the same', () => {
    expect(trailerServes('gate/traced', 'gate')).toBe(true);
    expect(trailerServes('gate/traced', 'gate/traced')).toBe(true);
    expect(trailerServes('gate', 'gate/traced')).toBe(false);
    expect(trailerServes('gateway', 'gate')).toBe(false);
  });
});

describe('T11 3 parseNumstat: +/− counts per file', () => {
  it('reads counts, renames (old and new path) and binary files from -z output', () => {
    const text = ['69\t17\tpackages/core/src/trust/write.ts', '3\t1\t', 'old/name.ts', 'new/name.ts', '-\t-\tdesign/13-story-code.png', ''].join('\0');
    expect(parseNumstat(text)).toEqual([
      { path: 'packages/core/src/trust/write.ts', added: 69, removed: 17, binary: false },
      { path: 'new/name.ts', oldPath: 'old/name.ts', added: 3, removed: 1, binary: false },
      { path: 'design/13-story-code.png', added: 0, removed: 0, binary: true },
    ]);
  });

  it('reads nothing from empty output', () => {
    expect(parseNumstat('')).toEqual([]);
  });
});

describe('T11 3 parseUnifiedDiff: hunks with old and new line numbers', () => {
  const modified = [
    'diff --git a/src/write.ts b/src/write.ts',
    'index 1111111..2222222 100644',
    '--- a/src/write.ts',
    '+++ b/src/write.ts',
    '@@ -92,5 +131,5 @@ export function approveScenarios(dir, ids)',
    '   if (findings.length > 0) return;',
    '-  const approval = old;',
    '+  const verifier = opts.verifier;',
    '+  const signed = new Map();',
    '--- not a header: a removed line that starts with two dashes',
    ' ',
    '   return docs;',
    '@@ -200 +202 @@',
    '-a',
    '+b',
    '',
  ].join('\n');

  it('numbers context, added and removed lines from the hunk header and keeps the section text', () => {
    const [f] = parseUnifiedDiff(modified);
    expect(f).toMatchObject({ oldPath: 'src/write.ts', newPath: 'src/write.ts', status: 'modified', binary: false });
    expect(f!.hunks).toHaveLength(2);
    const h = f!.hunks[0]!;
    expect(h).toMatchObject({ oldStart: 92, oldLines: 5, newStart: 131, newLines: 5, section: 'export function approveScenarios(dir, ids)' });
    expect(h.lines).toEqual([
      { kind: 'context', text: '  if (findings.length > 0) return;', old: 92, new: 131 },
      { kind: 'del', text: '  const approval = old;', old: 93 },
      { kind: 'add', text: '  const verifier = opts.verifier;', new: 132 },
      { kind: 'add', text: '  const signed = new Map();', new: 133 },
      { kind: 'del', text: '-- not a header: a removed line that starts with two dashes', old: 94 },
      { kind: 'context', text: '', old: 95, new: 134 },
      { kind: 'context', text: '  return docs;', old: 96, new: 135 },
    ]);
    expect(f!.hunks[1]).toMatchObject({ oldStart: 200, oldLines: 1, newStart: 202, newLines: 1 });
    expect(f!.hunks[1]!.lines).toEqual([
      { kind: 'del', text: 'a', old: 200 },
      { kind: 'add', text: 'b', new: 202 },
    ]);
  });

  it('marks a line with no newline at the end of the file', () => {
    const text = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1 +1 @@', '-old', '\\ No newline at end of file', '+new', '\\ No newline at end of file'].join('\n');
    expect(parseUnifiedDiff(text)[0]!.hunks[0]!.lines).toEqual([
      { kind: 'del', text: 'old', old: 1, noNewline: true },
      { kind: 'add', text: 'new', new: 1, noNewline: true },
    ]);
  });

  it('reads added, deleted, renamed and binary files, several in one diff', () => {
    const text = [
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      'index 0000000..3333333',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1,2 @@',
      '+one',
      '+two',
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      'index 4444444..0000000',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
      'diff --git a/old/name.ts b/new/name.ts',
      'similarity index 91%',
      'rename from old/name.ts',
      'rename to new/name.ts',
      'index 5555555..6666666 100644',
      '--- a/old/name.ts',
      '+++ b/new/name.ts',
      '@@ -3 +3 @@',
      '-x',
      '+y',
      'diff --git a/logo.png b/logo.png',
      'index 7777777..8888888 100644',
      'Binary files a/logo.png and b/logo.png differ',
    ].join('\n');
    const files = parseUnifiedDiff(text);
    expect(files.map((f) => [f.status, f.oldPath, f.newPath, f.binary])).toEqual([
      ['added', undefined, 'new.ts', false],
      ['deleted', 'gone.ts', undefined, false],
      ['renamed', 'old/name.ts', 'new/name.ts', false],
      ['modified', 'logo.png', 'logo.png', true],
    ]);
    expect(files[0]!.hunks[0]!.lines.map((l) => l.new)).toEqual([1, 2]);
    expect(files[1]!.hunks[0]!.lines).toEqual([{ kind: 'del', text: 'bye', old: 1 }]);
    expect(files[2]!.similarity).toBe(91);
    expect(files[3]!.hunks).toEqual([]);
  });

  it('a pure rename with no content change has no hunks', () => {
    const text = ['diff --git a/a.ts b/b.ts', 'similarity index 100%', 'rename from a.ts', 'rename to b.ts'].join('\n');
    expect(parseUnifiedDiff(text)).toEqual([{ oldPath: 'a.ts', newPath: 'b.ts', status: 'renamed', similarity: 100, binary: false, hunks: [] }]);
  });

  it('reads nothing from empty output', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});

describe('T11 4 capDiff: large diffs', () => {
  it('keeps the first max lines over all hunks and counts the rest', () => {
    const lines = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ kind: 'add' as const, text: `l${from + i}`, new: from + i }));
    const file = { newPath: 'big.ts', status: 'added' as const, binary: false, hunks: [1, 2, 3].map((k) => ({ oldStart: 0, oldLines: 0, newStart: k * 10, newLines: 10, section: '', lines: lines(10, k * 10) })) };
    const capped = capDiff(file, 15);
    expect(capped.more).toBe(15);
    expect(capped.hunks.map((h) => h.lines.length)).toEqual([10, 5]);
    expect(capDiff(file, 2000).more).toBe(0);
    expect(capDiff(file, 2000).hunks).toHaveLength(3);
  });
});
