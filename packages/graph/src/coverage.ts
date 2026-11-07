// Unit test coverage on the code graph (T43, story S12). rehearse reads coverage, it never runs a
// test: the lcov files the test runners wrote (`coverage/lcov.info` in each package by default:
// vitest --coverage, c8, and Python's `coverage lcov` all write it) are mapped onto the graph by
// file path and by the line ranges of the code nodes, then added up per function, file, folder,
// package and plan box.
//   lines     a line with DA hits > 0 is run, DA 0 is not run, a line without DA is not code.
//   branches  BRDA per line; a line with some branches taken and some not is partly taken.
//   tests     the test nodes with a `tests` edge to the code (the tests linker: direct calls and
//             calls through the helpers of test files).
//   stale     the source file changed after the lcov file that reports it was written.
// Parsing and the roll-ups are pure; `loadCoverage` reads the files, cached by mtime.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { GraphEdge, GraphNode, NodeKind, Trust } from './types.js';

/** One `SF:` record of an lcov file, as written. */
export interface LcovRecord {
  /** The `SF:` path as written: absolute, or relative to where the runner ran. */
  file: string;
  /** Line → hits, from `DA:`. */
  lines: Map<number, number>;
  /** Line → branches found and taken, from `BRDA:`. */
  branches: Map<number, { found: number; hit: number }>;
  functions: { name: string; line: number; hits: number }[];
}

/** Parse lcov text. Unknown lines are skipped; a record without `end_of_record` still counts. */
export function parseLcov(text: string): LcovRecord[] {
  const out: LcovRecord[] = [];
  let rec: LcovRecord | undefined;
  const fnLines = new Map<string, number>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      rec = { file: line.slice(3), lines: new Map(), branches: new Map(), functions: [] };
      fnLines.clear();
      out.push(rec);
      continue;
    }
    if (!rec) continue;
    const colon = line.indexOf(':');
    const tag = colon === -1 ? line : line.slice(0, colon);
    const parts = colon === -1 ? [] : line.slice(colon + 1).split(',');
    if (tag === 'DA') {
      const n = Number(parts[0]);
      const hits = Number(parts[1]);
      if (Number.isInteger(n) && n > 0 && Number.isFinite(hits)) rec.lines.set(n, (rec.lines.get(n) ?? 0) + hits);
    } else if (tag === 'BRDA') {
      const n = Number(parts[0]);
      if (!Number.isInteger(n) || n <= 0) continue;
      const taken = parts[3] === undefined || parts[3] === '-' ? 0 : Number(parts[3]);
      const b = rec.branches.get(n) ?? { found: 0, hit: 0 };
      b.found++;
      if (taken > 0) b.hit++;
      rec.branches.set(n, b);
    } else if (tag === 'FN') {
      // FN:<line>,<name> (lcov 1.x) or FN:<line>,<end>,<name> (lcov 2.x).
      const n = Number(parts[0]);
      const name = parts.slice(parts.length > 2 && /^\d+$/.test(parts[1]!) ? 2 : 1).join(',');
      if (Number.isInteger(n)) fnLines.set(name, n);
    } else if (tag === 'FNDA') {
      const name = parts.slice(1).join(',');
      rec.functions.push({ name, line: fnLines.get(name) ?? 0, hits: Number(parts[0]) || 0 });
    } else if (tag === 'end_of_record') {
      rec = undefined;
    }
  }
  return out;
}

/** The coverage of one source file, from one or more lcov files. */
export interface FileCoverage {
  /** Repo path, `/`-separated. */
  path: string;
  lines: Map<number, number>;
  branches: Map<number, { found: number; hit: number }>;
  /** When the newest lcov file that reports it was written. */
  reportMs: number;
}

/** An lcov file that was read. */
export interface CoverageReport {
  /** Repo path of the lcov file. */
  path: string;
  mtimeMs: number;
  /** Source files it reports. */
  files: number;
}

export interface CoverageData {
  reports: CoverageReport[];
  files: Map<string, FileCoverage>;
}

export const EMPTY_COVERAGE: CoverageData = { reports: [], files: new Map() };

/**
 * The repo path of an `SF:` path. Absolute paths are made relative to the repo; a relative path is
 * tried against the folder above the lcov file's folder (a package root, where the runner ran), the
 * lcov file's own folder, then the repo root, and the first one that exists wins.
 */
export function sourcePath(sf: string, lcovPath: string, root: string, exists: (abs: string) => boolean = existsSync): string | undefined {
  const norm = (abs: string) => {
    const rel = relative(root, abs).split(sep).join('/');
    return rel === '' || rel.startsWith('../') || isAbsolute(rel) ? undefined : rel;
  };
  if (isAbsolute(sf)) return norm(sf);
  const lcovDir = dirname(join(root, lcovPath));
  const tries = [dirname(lcovDir), lcovDir, root].map((d) => join(d, sf));
  return norm(tries.find(exists) ?? tries[0]!);
}

/** Merge the records of several lcov files: hits add up, branches keep the most taken. */
export function mergeCoverage(reports: { report: CoverageReport; records: LcovRecord[] }[], root: string, exists?: (abs: string) => boolean): CoverageData {
  const files = new Map<string, FileCoverage>();
  for (const { report, records } of reports) {
    for (const r of records) {
      const path = sourcePath(r.file, report.path, root, exists);
      if (path === undefined) continue;
      let f = files.get(path);
      if (!f) files.set(path, (f = { path, lines: new Map(), branches: new Map(), reportMs: report.mtimeMs }));
      f.reportMs = Math.max(f.reportMs, report.mtimeMs);
      for (const [n, hits] of r.lines) f.lines.set(n, (f.lines.get(n) ?? 0) + hits);
      for (const [n, b] of r.branches) {
        const old = f.branches.get(n);
        f.branches.set(n, old ? { found: Math.max(old.found, b.found), hit: Math.max(old.hit, b.hit) } : { ...b });
      }
    }
  }
  return { reports: reports.map((r) => r.report), files };
}

/** Folders the search for lcov files never enters. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.rehearse', '.pnpm-store', '.venv', 'venv', '__pycache__', '.omc', 'dist']);
const MAX_DEPTH = 8;

/** Every `coverage/lcov.info` below the repo root, repo paths, sorted. */
export function findLcovFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
      const sub = dir === '' ? e.name : `${dir}/${e.name}`;
      if (e.name === 'coverage' && existsSync(join(root, sub, 'lcov.info'))) out.push(`${sub}/lcov.info`);
      else if (depth < MAX_DEPTH) walk(sub, depth + 1);
    }
  };
  walk('', 0);
  return out.sort();
}

const parsed = new Map<string, { mtimeMs: number; size: number; records: LcovRecord[] }>();

/**
 * Read the coverage of a repo: every `coverage/lcov.info` below it, plus `paths` (repo-relative or
 * absolute lcov files). Each file is parsed again only when its mtime or size changed.
 */
export function loadCoverage(root: string, paths: readonly string[] = []): CoverageData {
  const all = new Set([...findLcovFiles(root), ...paths.map((p) => (isAbsolute(p) ? relative(root, p) : p).split(sep).join('/'))]);
  const reports: { report: CoverageReport; records: LcovRecord[] }[] = [];
  for (const path of [...all].sort()) {
    const abs = join(root, path);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    let hit = parsed.get(abs);
    if (!hit || hit.mtimeMs !== st.mtimeMs || hit.size !== st.size) {
      hit = { mtimeMs: st.mtimeMs, size: st.size, records: parseLcov(readFileSync(abs, 'utf8')) };
      parsed.set(abs, hit);
    }
    reports.push({ report: { path, mtimeMs: st.mtimeMs, files: hit.records.length }, records: hit.records });
  }
  return mergeCoverage(reports, root);
}

/** A key that changes when any lcov file changes: the cache key of a CoverageIndex. */
export const coverageKey = (data: CoverageData): string => data.reports.map((r) => `${r.path}@${r.mtimeMs}`).join('|');

/** The coverage of some code, added up. */
export interface CoverageStats {
  /** Lines of code (lines with a DA entry). */
  lines: number;
  /** Of them, run by a test. */
  covered: number;
  branches: number;
  branchesCovered: number;
  /** Lines covered in whole percent, rounded down; null: no coverage data for this code. */
  percent: number | null;
  /** Tests with a `tests` edge to the code. */
  tests: number;
  /** A source file of it changed after its coverage was written. */
  stale: boolean;
}

export const NO_STATS: CoverageStats = { lines: 0, covered: 0, branches: 0, branchesCovered: 0, percent: null, tests: 0, stale: false };

/** One line of a function's code: run (green), not run (red), not code (none); branches partly taken. */
export interface LineMark {
  n: number;
  state: 'run' | 'missed' | 'none';
  hits?: number;
  /** Branches on the line: `partial` when some were taken and some not. */
  branch?: 'all' | 'partial' | 'none';
  branches?: { found: number; hit: number };
}

/** A test that calls the code. */
export interface TestRef {
  id: string;
  name: string;
  file?: string;
  range?: string;
  trust: Trust;
  /** The test calls the code itself; false: through a helper of a test file. */
  direct: boolean;
}

/** The coverage of one code node, for the function view. */
export interface NodeCoverage {
  id: string;
  file?: string;
  range?: string;
  stats: CoverageStats;
  lines: LineMark[];
  /** The lines of code not run, as `12-14`, `20`. */
  uncovered: string[];
  testedBy: TestRef[];
}

/** What the repo has: the lcov files read, and what to run when there are none. */
export interface CoverageInfo {
  found: boolean;
  reports: CoverageReport[];
  /** With no lcov file: the one line that says how to make one. */
  hint?: string;
}

export const LCOV_HINT = 'Any test runner that writes lcov works: vitest --coverage, c8, or `coverage lcov` for Python.';

/** The no-data line: this repo's own command when its package.json has a `coverage` script. */
export function coverageHint(root: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    if (pkg.scripts?.coverage) return `No coverage file yet. Run \`pnpm coverage\` to write coverage/lcov.info in each package. ${LCOV_HINT}`;
  } catch {
    // no package.json: the general hint
  }
  return `No coverage file yet. Write coverage/lcov.info with your test runner. ${LCOV_HINT}`;
}

export function coverageInfo(data: CoverageData, root: string): CoverageInfo {
  return data.reports.length > 0 ? { found: true, reports: data.reports } : { found: false, reports: [], hint: coverageHint(root) };
}

/** Code kinds whose lines are counted. */
const CODE: readonly NodeKind[] = ['function', 'method', 'class', 'route', 'module', 'file'];

const span = (range: string | undefined): [number, number] | undefined => {
  const m = /^(\d+)-(\d+)$/.exec(range ?? '');
  return m ? [Number(m[1]), Number(m[2])] : undefined;
};

/** `[1,2,3,7]` → `1-3`, `7`. */
export function lineRanges(lines: number[]): string[] {
  const out: string[] = [];
  const sorted = [...lines].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    out.push(i === j ? String(sorted[i]) : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return out;
}

/** A piece of code: a whole file, or a line range of one. */
export interface CodePart {
  file: string;
  from?: number;
  to?: number;
}

/**
 * The coverage of the graph's code. `mtimeOf` gives a source file's mtime (stale check); tests pass
 * a fake. Build one per graph write and lcov change.
 */
export class CoverageIndex {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly byFile = new Map<string, GraphNode[]>();
  /** code node → the tests edges into it. */
  private readonly testsInto = new Map<string, GraphEdge[]>();
  /** test → the nodes it calls directly. */
  private readonly calls = new Map<string, Set<string>>();
  private readonly staleCache = new Map<string, boolean>();

  constructor(
    readonly data: CoverageData,
    nodes: GraphNode[],
    edges: GraphEdge[],
    private readonly mtimeOf: (file: string) => number | undefined = () => undefined,
  ) {
    for (const n of nodes) {
      this.nodes.set(n.id, n);
      if (n.file === undefined || n.targetOnly) continue;
      const list = this.byFile.get(n.file) ?? [];
      list.push(n);
      this.byFile.set(n.file, list);
    }
    for (const e of edges) {
      if (e.kind === 'tests') {
        const list = this.testsInto.get(e.to) ?? [];
        list.push(e);
        this.testsInto.set(e.to, list);
      } else if (e.kind === 'calls') {
        const set = this.calls.get(e.from) ?? new Set();
        set.add(e.to);
        this.calls.set(e.from, set);
      }
    }
  }

  get found(): boolean {
    return this.data.reports.length > 0;
  }

  /** The source changed after the lcov file that reports it. */
  stale(file: string): boolean {
    let s = this.staleCache.get(file);
    if (s === undefined) {
      const cov = this.data.files.get(file);
      const m = cov ? this.mtimeOf(file) : undefined;
      s = cov !== undefined && m !== undefined && m > cov.reportMs;
      this.staleCache.set(file, s);
    }
    return s;
  }

  /** The coverage of some code: line sets united per file, so code counted twice counts once. */
  stats(parts: readonly CodePart[]): CoverageStats {
    const lines = new Map<string, Set<number>>();
    let any = false;
    let stale = false;
    const tests = new Set<string>();
    for (const p of parts) {
      for (const t of this.testsIn(p)) tests.add(t);
      const cov = this.data.files.get(p.file);
      if (!cov) continue;
      any = true;
      if (this.stale(p.file)) stale = true;
      const set = lines.get(p.file) ?? new Set<number>();
      for (const n of cov.lines.keys()) if (within(n, p)) set.add(n);
      for (const n of cov.branches.keys()) if (within(n, p)) set.add(-n);
      lines.set(p.file, set);
    }
    if (!any) return { ...NO_STATS, tests: tests.size };
    let total = 0;
    let covered = 0;
    let branches = 0;
    let branchesCovered = 0;
    for (const [file, set] of lines) {
      const cov = this.data.files.get(file)!;
      for (const n of set) {
        if (n > 0) {
          total++;
          if ((cov.lines.get(n) ?? 0) > 0) covered++;
        } else {
          const b = cov.branches.get(-n)!;
          branches += b.found;
          branchesCovered += b.hit;
        }
      }
    }
    return { lines: total, covered, branches, branchesCovered, percent: percentOf(covered, total), tests: tests.size, stale };
  }

  /** The tests of the code in a part: `tests` edges into its nodes (any node of the file, or inside the range). */
  private testsIn(p: CodePart): Set<string> {
    const out = new Set<string>();
    for (const n of this.byFile.get(p.file) ?? []) {
      if (!CODE.includes(n.kind)) continue;
      const s = span(n.range);
      if (p.from !== undefined && p.to !== undefined && (!s || s[0] < p.from || s[1] > p.to)) continue;
      for (const e of this.testsInto.get(n.id) ?? []) out.add(e.from);
    }
    return out;
  }

  /** The part of a code node: its range, or its whole file for a file node. */
  part(id: string): CodePart | undefined {
    const n = this.nodes.get(id);
    if (!n || n.file === undefined || n.targetOnly) return undefined;
    const s = span(n.range);
    return n.kind === 'file' || !s ? { file: n.file } : { file: n.file, from: s[0], to: s[1] };
  }

  file(path: string): CoverageStats {
    return this.stats([{ file: path }]);
  }

  files(paths: Iterable<string>): CoverageStats {
    return this.stats([...paths].map((file) => ({ file })));
  }

  node(id: string): CoverageStats {
    const p = this.part(id);
    return p ? this.stats([p]) : NO_STATS;
  }

  /** The tests that call a node, direct ones first. */
  testedBy(id: string): TestRef[] {
    const out = new Map<string, TestRef>();
    for (const e of this.testsInto.get(id) ?? []) {
      const t = this.nodes.get(e.from);
      if (!t || out.has(t.id)) continue;
      out.set(t.id, {
        id: t.id, name: t.name, trust: e.trust, direct: this.calls.get(t.id)?.has(id) ?? false,
        ...(t.file !== undefined ? { file: t.file } : {}), ...(t.range !== undefined ? { range: t.range } : {}),
      });
    }
    return [...out.values()].sort((a, b) => Number(b.direct) - Number(a.direct) || (a.file ?? '').localeCompare(b.file ?? '') || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /** One node for the function view: its numbers, a mark per line, the lines not run, and its tests. */
  nodeCoverage(id: string): NodeCoverage | undefined {
    const n = this.nodes.get(id);
    const p = this.part(id);
    if (!n || !p) return undefined;
    const cov = this.data.files.get(p.file);
    const lines: LineMark[] = [];
    const missed: number[] = [];
    if (cov) {
      const from = p.from ?? 1;
      const to = p.to ?? Math.max(0, ...cov.lines.keys(), ...cov.branches.keys());
      for (let i = from; i <= to; i++) {
        const hits = cov.lines.get(i);
        const b = cov.branches.get(i);
        const mark: LineMark = { n: i, state: hits === undefined ? 'none' : hits > 0 ? 'run' : 'missed' };
        if (hits !== undefined) mark.hits = hits;
        if (b) {
          mark.branches = { ...b };
          mark.branch = b.hit === 0 ? 'none' : b.hit < b.found ? 'partial' : 'all';
        }
        if (mark.state === 'missed') missed.push(i);
        lines.push(mark);
      }
    }
    return {
      id, stats: this.stats([p]), lines, uncovered: lineRanges(missed), testedBy: this.testedBy(id),
      ...(n.file !== undefined ? { file: n.file } : {}), ...(n.range !== undefined ? { range: n.range } : {}),
    };
  }
}

const within = (n: number, p: CodePart): boolean => p.from === undefined || p.to === undefined || (n >= p.from && n <= p.to);

const percentOf = (covered: number, total: number): number | null => (total === 0 ? null : Math.floor((covered * 100) / total));

/** Add up stats that were counted apart (folders on the map): lines and tests are summed. */
export function sumStats(all: readonly CoverageStats[]): CoverageStats {
  const withData = all.filter((s) => s.percent !== null);
  const sum = (k: 'lines' | 'covered' | 'branches' | 'branchesCovered') => withData.reduce((a, s) => a + s[k], 0);
  const lines = sum('lines');
  const covered = sum('covered');
  return {
    lines, covered, branches: sum('branches'), branchesCovered: sum('branchesCovered'),
    percent: withData.length === 0 ? null : percentOf(covered, lines),
    tests: all.reduce((a, s) => a + s.tests, 0),
    stale: withData.some((s) => s.stale),
  };
}

/** Code node kinds a box's code is made of (as in the drill-down below a leaf box). */
export const BOX_CODE_KINDS: readonly NodeKind[] = ['function', 'method', 'class', 'route'];

/** A test file of vitest or pytest, or a file below a test folder. */
const isTestFile = (path: string): boolean => /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(test_[^/]*|[^/]*_test|conftest)\.py$/.test(path);

export interface BoxCodeInput {
  /** Every box path of the EPIC, `a`, `a/b`, … */
  paths: readonly string[];
  /** Box path → the code nodes its `builds` edges reach. */
  builds: ReadonlyMap<string, readonly GraphNode[]>;
  /** Box path → the files of its Flow-Box commits: the code of a box with no builds edge. */
  flowBoxFiles?: ReadonlyMap<string, readonly string[]>;
  /** File → the code nodes it defines. */
  defined: (file: string) => readonly GraphNode[];
}

const isBoxCode = (n: GraphNode): boolean => BOX_CODE_KINDS.includes(n.kind) && !n.targetOnly && n.file !== undefined && !isTestFile(n.file);

/**
 * The code of each box, by the drill-down's rule: the code its `builds` edges reach, else the code
 * defined in the files of its Flow-Box commits (test files left out). A box with boxes inside it
 * adds up the code of all of them, its own too. A box with no code has no entry.
 */
export function boxCode(input: BoxCodeInput): Map<string, GraphNode[]> {
  const own = new Map<string, GraphNode[]>();
  for (const path of input.paths) {
    let code = (input.builds.get(path) ?? []).filter(isBoxCode);
    if (code.length === 0) {
      const files = (input.flowBoxFiles?.get(path) ?? []).filter((f) => !isTestFile(f));
      code = files.flatMap((f) => input.defined(f).filter(isBoxCode));
    }
    if (code.length > 0) own.set(path, code);
  }
  const out = new Map<string, GraphNode[]>();
  for (const path of input.paths) {
    const all = new Map<string, GraphNode>();
    for (const [p, code] of own) if (p === path || p.startsWith(`${path}/`)) for (const n of code) all.set(n.id, n);
    if (all.size > 0) out.set(path, [...all.values()].sort((a, b) => (a.id < b.id ? -1 : 1)));
  }
  return out;
}

/** The coverage of each box that has code. */
export function boxCoverage(index: CoverageIndex, code: ReadonlyMap<string, readonly GraphNode[]>): Record<string, CoverageStats> {
  const out: Record<string, CoverageStats> = {};
  for (const [path, nodes] of code) out[path] = index.stats(nodes.flatMap((n) => index.part(n.id) ?? []));
  return out;
}
