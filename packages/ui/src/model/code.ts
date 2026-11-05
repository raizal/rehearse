// The story Code tab (design page 13): the HOW boxes with their code, the box panel's compare
// choices, the change in plain words from the commit bodies, task threads, and the diff rows
// (unified with folded unchanged runs, or split side by side). Code comes only from git
// Flow-Box trailers (`GET api/code-index`, `GET api/box-code`).

import type { BoxCodeView, BoxCommit, CodeIndex, CommitRef, DiffLine, Hunk } from '@rehearse/server';
import type { StoryHow } from './storyview.js';

/** Boxes that never have code: they are choices and ends, not work. */
export const NO_CODE_KINDS: readonly string[] = ['decision', 'start', 'end'];

export interface CodeStripBox {
  path: string;
  title: string;
  kind: string;
  /** The lane's role name. */
  lane: string;
  /** False for a decision, start or end box. */
  canHaveCode: boolean;
  /** At least one commit has its Flow-Box trailer (or the trailer of a box inside it). */
  hasCode: boolean;
  /** Files its commits touched. */
  files: number;
  /** It has commits in the compare range. */
  changed: boolean;
}

/** The story's HOW boxes, in flow order, with their code. */
export function codeStrip(how: StoryHow, index: CodeIndex | undefined, changed: readonly string[] = []): CodeStripBox[] {
  const lanes = new Map(how.lanes.map((l) => [l.role, l.label]));
  return how.boxes.map(({ path, box }) => {
    const kind = typeof box.kind === 'string' ? box.kind : 'process';
    const canHaveCode = !NO_CODE_KINDS.includes(kind);
    const own = index?.ok && canHaveCode ? index.boxes[path] : undefined;
    const hasCode = (own?.commits.length ?? 0) > 0;
    return {
      path,
      title: typeof box.title === 'string' ? box.title : path,
      kind,
      lane: lanes.get(box.lane) ?? String(box.lane ?? ''),
      canHaveCode,
      hasCode,
      files: hasCode ? own!.files.length : 0,
      changed: hasCode && changed.includes(path),
    };
  });
}

/** `Code: N of M boxes have code`. */
export function codeChipText(strip: CodeStripBox[]): string {
  const n = strip.filter((b) => b.hasCode).length;
  return `Code: ${n} of ${strip.length} ${strip.length === 1 ? 'box has' : 'boxes have'} code`;
}

/** What a box card says about its code. */
export function stripBoxText(b: CodeStripBox): string {
  if (!b.hasCode) return 'no code';
  return `${b.files} ${b.files === 1 ? 'file' : 'files'}`;
}

// ---------------------------------------------------------------- compare

export interface CompareChoice {
  sha: string;
  label: string;
}

const choice = (c: CommitRef, note?: string): CompareChoice => ({ sha: c.sha, label: `${c.short} ${c.subject}${note ? ` (${note})` : ''}` });

/**
 * Before: the current before, every commit of the box, HEAD. After: every commit of the box,
 * HEAD (and the current after). Oldest first, no duplicates.
 */
export function compareChoices(v: BoxCodeView): { before: CompareChoice[]; after: CompareChoice[] } {
  const uniq = (list: CompareChoice[]) => list.filter((c, i) => list.findIndex((d) => d.sha === c.sha) === i);
  const head = choice(v.head, 'HEAD');
  const own = v.commits.map((c) => (c.sha === v.head.sha ? head : choice(c)));
  return {
    before: uniq([choice(v.before), ...own, head]),
    after: uniq([...own, head, choice(v.after)]),
  };
}

// ---------------------------------------------------------------- plain words

export interface PlainLine {
  text: string;
  /** Short hash of the commit it comes from. */
  short: string;
}

export interface PlainWords {
  lines: PlainLine[];
  /** Decision, requirement and correction ids the subjects name (D41, R13, C28), in order. */
  ids: string[];
}

const BULLET = /^\s*[-*]\s+(.*)$/;
const RECORD_ID = /\b[DRC]\d+\b/g;

/** The bullet lines of a commit body; a wrapped bullet (indented next lines) is one line. */
export function bullets(body: string): string[] {
  const out: string[] = [];
  let open = false;
  for (const raw of body.split('\n')) {
    const m = BULLET.exec(raw);
    if (m) {
      out.push(m[1]!.trim());
      open = true;
    } else if (open && /^\s+\S/.test(raw)) {
      out[out.length - 1] += ` ${raw.trim()}`;
    } else {
      open = false;
    }
  }
  return out;
}

/** The change in plain words: the bullets of each commit body, or its subject when it has none. */
export function plainWords(range: BoxCommit[]): PlainWords {
  const lines: PlainLine[] = [];
  const ids: string[] = [];
  for (const c of range) {
    const b = bullets(c.body);
    for (const text of b.length > 0 ? b : [c.subject]) lines.push({ text, short: c.short });
    for (const id of c.subject.match(RECORD_ID) ?? []) if (!ids.includes(id)) ids.push(id);
  }
  return { lines, ids };
}

export interface TaskThread {
  id: string;
  short: string;
  subject: string;
}

/** bb threads (`thr_…`) that the commits of the range name in their body or trailers. */
export function taskThreads(range: BoxCommit[]): TaskThread[] {
  const out: TaskThread[] = [];
  for (const c of range) {
    for (const id of c.body.match(/\bthr_[a-z0-9]+\b/g) ?? []) {
      if (!out.some((t) => t.id === id)) out.push({ id, short: c.short, subject: c.subject });
    }
  }
  return out;
}

// ---------------------------------------------------------------- files

export function splitPath(path: string): { name: string; dir: string } {
  const at = path.lastIndexOf('/');
  return at < 0 ? { name: path, dir: '' } : { name: path.slice(at + 1), dir: path.slice(0, at) };
}

// ---------------------------------------------------------------- diff rows

/** A run of unchanged lines longer than this folds, keeping one line next to each change. */
export const FOLD_OVER = 4;

export type UnifiedRow =
  | { kind: 'hunk'; hunk: number; text: string }
  | { kind: 'line'; line: DiffLine }
  | { kind: 'fold'; id: string; count: number };

const hunkHeader = (h: Hunk) => `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@${h.section ? ` ${h.section}` : ''}`;

/**
 * Unified rows. A run of more than FOLD_OVER unchanged lines folds to one row ("N lines with no
 * change"), keeping the line next to each change; a fold whose id is in `open` stays unfolded.
 */
export function unifiedRows(hunks: Hunk[], open: ReadonlySet<string> = new Set()): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  hunks.forEach((h, hi) => {
    rows.push({ kind: 'hunk', hunk: hi, text: hunkHeader(h) });
    let i = 0;
    while (i < h.lines.length) {
      if (h.lines[i]!.kind !== 'context') {
        rows.push({ kind: 'line', line: h.lines[i]! });
        i++;
        continue;
      }
      let j = i;
      while (j < h.lines.length && h.lines[j]!.kind === 'context') j++;
      const run = h.lines.slice(i, j);
      const keepHead = i > 0 ? 1 : 0;
      const keepTail = j < h.lines.length ? 1 : 0;
      const id = `${hi}:${i}`;
      if (run.length > FOLD_OVER && !open.has(id)) {
        for (const line of run.slice(0, keepHead)) rows.push({ kind: 'line', line });
        rows.push({ kind: 'fold', id, count: run.length - keepHead - keepTail });
        for (const line of run.slice(run.length - keepTail)) rows.push({ kind: 'line', line });
      } else {
        for (const line of run) rows.push({ kind: 'line', line });
      }
      i = j;
    }
  });
  return rows;
}

export type SplitRow = { kind: 'hunk'; text: string } | { kind: 'pair'; left?: DiffLine; right?: DiffLine };

/** Side by side: unchanged lines on both sides; removed lines left, next to the added lines that replace them. */
export function splitRows(hunks: Hunk[]): SplitRow[] {
  const rows: SplitRow[] = [];
  for (const h of hunks) {
    rows.push({ kind: 'hunk', text: hunkHeader(h) });
    let i = 0;
    while (i < h.lines.length) {
      const line = h.lines[i]!;
      if (line.kind === 'context') {
        rows.push({ kind: 'pair', left: line, right: line });
        i++;
        continue;
      }
      const dels: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (i < h.lines.length && h.lines[i]!.kind === 'del') dels.push(h.lines[i++]!);
      while (i < h.lines.length && h.lines[i]!.kind === 'add') adds.push(h.lines[i++]!);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
        const left = dels[k];
        const right = adds[k];
        rows.push({ kind: 'pair', ...(left ? { left } : {}), ...(right ? { right } : {}) });
      }
    }
  }
  return rows;
}
