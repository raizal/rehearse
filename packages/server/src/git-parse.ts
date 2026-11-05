// Pure parsers for the git output that the box code route reads: `git log` records with the
// Flow-Box trailers, `git diff --numstat -z`, and a unified diff (hunks, line numbers, renames,
// binary files, no newline at end of file). No git runs here.

/** Separates records in the `git log --format` this module reads. */
export const RS = '\x1e';
/** Separates fields of a record. */
export const FS = '\x1f';
/** Separates the Flow-Box trailer values of one commit. */
export const TS = '\x1d';

/** `--format` of a commit with its Flow-Box trailers: hash, short hash, subject, date, boxes. */
export const LOG_FORMAT = `${'%x1e'}%H%x1f%h%x1f%s%x1f%cI%x1f%(trailers:key=Flow-Box,valueonly,separator=%x1d)`;
/** The same, plus the body (which holds the trailers too). */
export const LOG_FORMAT_BODY = `${LOG_FORMAT}%x1f%b`;

export interface CommitRef {
  sha: string;
  short: string;
  subject: string;
  /** Committer date, ISO 8601. */
  date: string;
}

export interface LogCommit extends CommitRef {
  /** Flow-Box trailer values: box paths. */
  boxes: string[];
  /** Files the commit touched (with `--name-only`). */
  files: string[];
  /** Message body after the subject (with `%b`). */
  body?: string;
}

/**
 * Parse `git log --format=LOG_FORMAT [--name-only]` or `--format=LOG_FORMAT_BODY`. Each record
 * starts with RS; with `--name-only` the file names follow the header line.
 */
export function parseLog(text: string, withBody = false): LogCommit[] {
  const out: LogCommit[] = [];
  for (const record of text.split(RS)) {
    if (record.trim() === '') continue;
    const fields = record.split(FS);
    const [sha, short, subject, date] = fields;
    if (sha === undefined || !/^[0-9a-f]{40}$/.test(sha) || short === undefined || subject === undefined || date === undefined) continue;
    let boxField: string;
    let files: string[] = [];
    let body: string | undefined;
    if (withBody) {
      boxField = fields[4] ?? '';
      body = fields.slice(5).join(FS).replace(/\s+$/, '');
    } else {
      const rest = fields.slice(4).join(FS);
      const nl = rest.indexOf('\n');
      boxField = nl < 0 ? rest : rest.slice(0, nl);
      files = nl < 0 ? [] : rest.slice(nl + 1).split('\n').filter((f) => f !== '');
    }
    const boxes = boxField
      .split(TS)
      .map((b) => b.trim())
      .filter((b) => b !== '');
    out.push({ sha, short, subject, date: date.trim(), boxes, files, ...(body !== undefined ? { body } : {}) });
  }
  return out;
}

/** A trailer value names the box at `path` itself or a box inside it. */
export function trailerServes(trailer: string, path: string): boolean {
  return trailer === path || trailer.startsWith(`${path}/`);
}

// ---------------------------------------------------------------- numstat

export interface FileStat {
  /** Path after the change. */
  path: string;
  /** Path before the change, when the file was renamed. */
  oldPath?: string;
  /** Lines added; 0 for a binary file. */
  added: number;
  removed: number;
  binary: boolean;
}

/** Parse `git diff --numstat -z`. A rename is `added\tremoved\t\0old\0new\0`; a binary file has `-` counts. */
export function parseNumstat(text: string): FileStat[] {
  const parts = text.split('\0');
  const out: FileStat[] = [];
  for (let i = 0; i < parts.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(parts[i]!.replace(/^\n/, ''));
    if (!m) continue;
    const binary = m[1] === '-' || m[2] === '-';
    const counts = { added: binary ? 0 : Number(m[1]), removed: binary ? 0 : Number(m[2]), binary };
    if (m[3] !== '') {
      out.push({ path: m[3]!, ...counts });
    } else {
      const oldPath = parts[i + 1];
      const path = parts[i + 2];
      i += 2;
      if (oldPath !== undefined && path !== undefined) out.push({ path, oldPath, ...counts });
    }
  }
  return out;
}

// ---------------------------------------------------------------- unified diff

export interface DiffLine {
  kind: 'context' | 'add' | 'del';
  text: string;
  /** Line number in the old file (context and removed lines). */
  old?: number;
  /** Line number in the new file (context and added lines). */
  new?: number;
  /** The line has no newline at the end of the file. */
  noNewline?: boolean;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Text after the second `@@`: often the enclosing function. */
  section: string;
  lines: DiffLine[];
}

export interface FileDiff {
  /** Path before; absent for an added file. */
  oldPath?: string;
  /** Path after; absent for a deleted file. */
  newPath?: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
  /** Rename similarity in percent. */
  similarity?: number;
  binary: boolean;
  hunks: Hunk[];
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** Strip the `a/` or `b/` prefix of a `---`/`+++` path; `/dev/null` is no file. */
function sidePath(raw: string): string | undefined {
  const p = raw.replace(/\t.*$/, '');
  if (p === '/dev/null') return undefined;
  return p.replace(/^[ab]\//, '');
}

/** Parse the output of `git diff` (no colour, default prefixes) into one entry per file. */
export function parseUnifiedDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | undefined;
  let hunk: Hunk | undefined;
  let oldNo = 0;
  let newNo = 0;
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
      file = { oldPath: m?.[1], newPath: m?.[2], status: 'modified', binary: false, hunks: [] };
      if (file.oldPath === undefined) delete file.oldPath;
      if (file.newPath === undefined) delete file.newPath;
      files.push(file);
      hunk = undefined;
      continue;
    }
    if (!file) continue;
    if (hunk) {
      const c = line[0];
      if (c === '\\') {
        const last = hunk.lines[hunk.lines.length - 1];
        if (last) last.noNewline = true;
        continue;
      }
      // The header counts say how many lines belong to the hunk; an empty line is a context
      // line whose leading space was stripped.
      const full = oldNo >= hunk.oldStart + hunk.oldLines && newNo >= hunk.newStart + hunk.newLines;
      if (!full && (c === '+' || c === '-' || c === ' ' || line === '')) {
        const body = line.slice(1);
        if (c === '+') hunk.lines.push({ kind: 'add', text: body, new: newNo++ });
        else if (c === '-') hunk.lines.push({ kind: 'del', text: body, old: oldNo++ });
        else hunk.lines.push({ kind: 'context', text: body, old: oldNo++, new: newNo++ });
        continue;
      }
    }
    const h = HUNK.exec(line);
    if (h) {
      hunk = {
        oldStart: Number(h[1]),
        oldLines: h[2] === undefined ? 1 : Number(h[2]),
        newStart: Number(h[3]),
        newLines: h[4] === undefined ? 1 : Number(h[4]),
        section: h[5] ?? '',
        lines: [],
      };
      oldNo = hunk.oldStart;
      newNo = hunk.newStart;
      file.hunks.push(hunk);
      continue;
    }
    hunk = undefined;
    if (line.startsWith('new file mode')) {
      file.status = 'added';
      delete file.oldPath;
    } else if (line.startsWith('deleted file mode')) {
      file.status = 'deleted';
      delete file.newPath;
    } else if (line.startsWith('rename from ')) {
      file.status = 'renamed';
      file.oldPath = line.slice('rename from '.length);
    } else if (line.startsWith('rename to ')) {
      file.status = 'renamed';
      file.newPath = line.slice('rename to '.length);
    } else if (line.startsWith('similarity index ')) {
      file.similarity = Number.parseInt(line.slice('similarity index '.length), 10);
    } else if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      file.binary = true;
    } else if (line.startsWith('--- ')) {
      const p = sidePath(line.slice(4));
      if (p === undefined) delete file.oldPath;
      else if (file.status !== 'renamed') file.oldPath = p;
    } else if (line.startsWith('+++ ')) {
      const p = sidePath(line.slice(4));
      if (p === undefined) delete file.newPath;
      else if (file.status !== 'renamed') file.newPath = p;
    }
  }
  return files;
}

export interface CappedDiff extends FileDiff {
  /** Diff lines left out after the cap. */
  more: number;
}

/** Keep at most `max` diff lines (over all hunks); count the rest in `more`. */
export function capDiff(file: FileDiff, max: number): CappedDiff {
  let left = max;
  let more = 0;
  const hunks: Hunk[] = [];
  for (const h of file.hunks) {
    if (left <= 0) {
      more += h.lines.length;
      continue;
    }
    if (h.lines.length <= left) {
      hunks.push(h);
      left -= h.lines.length;
    } else {
      hunks.push({ ...h, lines: h.lines.slice(0, left) });
      more += h.lines.length - left;
      left = 0;
    }
  }
  return { ...file, hunks, more };
}
