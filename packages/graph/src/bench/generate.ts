// Box `bench` (G11, G24): the benchmark repo. A fixed seed gives the same files, byte for byte, on
// each run and each machine: no dates, no Math.random, no map order. Half the files are TypeScript,
// half Python, with the things every reader path handles: imports between files, calls through an
// import and inside the file, classes with `extends` and methods, `new`, calls into outside packages
// (target-only nodes), FastAPI routes with a router prefix, and Vitest and pytest test files. The
// Python packages are namespace packages (no __init__.py), so `files` counts every source file.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface BenchRepoOptions {
  /** Source files in all; half TypeScript (rounded up), half Python. */
  files: number;
  seed: number;
}

/** Targets the bench queries: they exist in every generated repo, whatever its size. */
export interface BenchProbes {
  /** Words for `find`. */
  find: string;
  /** A function name for `show` and `near`. */
  show: string;
  /** `path from to`: a chain of calls through imports, three edges long. */
  path: [string, string];
  /** The files the one-file update changes, one per language. */
  update: { typescript: string; python: string };
}

export interface BenchRepo {
  /** Repo path → content, sorted by path. */
  files: Map<string, string>;
  probes: BenchProbes;
}

const DOMAINS = ['orders', 'billing', 'users', 'catalog', 'shipping', 'inventory', 'reports', 'auth', 'search', 'payments'];
const NOUNS = ['order', 'invoice', 'user', 'item', 'cart', 'price', 'stock', 'report', 'token', 'address', 'payment', 'refund', 'session', 'rule', 'batch', 'quote'];
const VERBS = ['load', 'save', 'build', 'check', 'apply', 'format', 'parse', 'merge', 'compute', 'find', 'list', 'update', 'send', 'map'];
const SUFFIXES = ['', 'row', 'list', 'by id', 'total', 'state', 'event', 'record'];
/** Files per folder. */
const FOLDER = 20;
/** Every TEST_EVERY-th file of a language is a test file; every ROUTE_EVERY-th Python file has routes. */
const TEST_EVERY = 10;
const ROUTE_EVERY = 25;

/** mulberry32: a small PRNG with the same numbers on every platform. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Module {
  index: number;
  domain: string;
  /** Repo path. */
  path: string;
  /** The exported functions; the first one calls the first function of the nearest import. */
  functions: string[];
  className: string;
  /** The class's three methods: get, put and count, named by the module's noun and a verb. */
  methods: [string, string, string];
  test: boolean;
}

const camel = (words: string[]) => words.map((w, i) => (i === 0 ? w : w[0]!.toUpperCase() + w.slice(1))).join('');
const pascal = (words: string[]) => words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
const snake = (words: string[]) => words.join('_');

/** The benchmark repo for a size and seed, in memory. */
export function generateBenchRepo(opts: BenchRepoOptions): BenchRepo {
  if (!Number.isInteger(opts.files) || opts.files < 20) throw new Error('the bench repo needs at least 20 files');
  const rand = prng(opts.seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

  const out = new Map<string, string>();
  out.set('package.json', '{ "name": "bench-repo", "version": "1.0.0", "private": true }\n');
  out.set('tsconfig.json', '{\n  // The TypeScript half of the bench repo.\n  "compilerOptions": { "strict": true, "outDir": "dist" },\n  "include": ["web/src"]\n}\n');
  out.set('api/pyproject.toml', '[project]\nname = "bench-api"\nversion = "1.0.0"\ndependencies = ["fastapi", "requests"]\n');

  const tsCount = Math.ceil(opts.files / 2);
  const pyCount = opts.files - tsCount;
  const ts = modules(tsCount, 'typescript', pick, int);
  const py = modules(pyCount, 'python', pick, int);

  const tsCalls = new Map<number, number>();
  for (const m of ts) out.set(m.path, m.test ? tsTest(m, ts, rand, int) : tsSource(m, ts, rand, pick, int, tsCalls));
  const pyCalls = new Map<number, number>();
  for (const m of py) out.set(m.path, m.test ? pyTest(m, py, rand, int) : pySource(m, py, rand, pick, int, pyCalls));

  // A chain of three call edges through imports, from the last TS source file back.
  const chain = callChain(ts, tsCalls, 3);
  const sources = (ms: Module[]) => ms.filter((m) => !m.test);
  const probe = sources(ts)[Math.floor(sources(ts).length / 2)]!;
  const files = new Map([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return {
    files,
    probes: {
      find: `${probe.functions[0]!.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`)}`,
      show: probe.functions[0]!,
      path: [chain[0]!, chain[chain.length - 1]!],
      update: { typescript: sources(ts)[Math.floor(sources(ts).length / 4)]!.path, python: sources(py)[Math.floor(sources(py).length / 4)]!.path },
    },
  };
}

/** Write the repo below `dir` (made if missing) and return it. */
export function writeBenchRepo(dir: string, opts: BenchRepoOptions): BenchRepo {
  const repo = generateBenchRepo(opts);
  for (const [path, text] of repo.files) {
    const abs = join(dir, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return repo;
}

function modules(
  count: number, language: 'typescript' | 'python',
  pick: <T>(xs: readonly T[]) => T, int: (lo: number, hi: number) => number,
): Module[] {
  const out: Module[] = [];
  for (let i = 0; i < count; i++) {
    const domain = DOMAINS[Math.floor(i / FOLDER) % DOMAINS.length]!;
    const folder = `${domain}${Math.floor(i / (FOLDER * DOMAINS.length)) || ''}`;
    const test = i % TEST_EVERY === TEST_EVERY - 1;
    const noun = pick(NOUNS);
    const base = language === 'typescript' ? `${noun}${pascal([pick(VERBS)])}${i}` : `${noun}_${pick(VERBS)}_${i}`;
    const path = language === 'typescript'
      ? `web/src/${folder}/${base}${test ? '.test' : ''}.ts`
      : `api/app/${folder}/${test ? 'test_' : ''}${base}.py`;
    const functions: string[] = [];
    for (let f = int(4, 8); f > 0; f--) {
      const words = [pick(VERBS), pick(NOUNS), ...pick(SUFFIXES).split(' ').filter((w) => w !== ''), String(i), String(f)];
      functions.push(language === 'typescript' ? camel(words) : snake(words));
    }
    // Method names come from a pool, as in real code: some classes share one, most do not.
    const method = (verb: string, plural = false) => {
      const words = [verb, pick(NOUNS) + (plural ? 's' : '')];
      return language === 'typescript' ? camel(words) : snake(words);
    };
    const methods: [string, string, string] = [method(pick(['load', 'find', 'read'])), method(pick(['save', 'store', 'write'])), method('count', true)];
    out.push({ index: i, domain, path, functions, className: `${pascal([noun, pick(['service', 'store', 'client', 'handler'])])}${i}`, methods, test });
  }
  return out;
}

/** Up to `n` earlier source modules, distinct, for the imports of module `m`. */
function importsOf(m: Module, all: Module[], n: number, rand: () => number): Module[] {
  const earlier = all.filter((o) => o.index < m.index && !o.test);
  const picked = new Map<number, Module>();
  for (let k = 0; k < n && earlier.length > 0; k++) {
    // Most imports go to nearby files (the same folder), some anywhere: a realistic import graph.
    const near = rand() < 0.7;
    const from = near ? Math.max(0, earlier.length - FOLDER) : 0;
    const o = earlier[from + Math.floor(rand() * (earlier.length - from))]!;
    picked.set(o.index, o);
  }
  return [...picked.values()].sort((a, b) => a.index - b.index);
}

function tsSpec(from: Module, to: Module): string {
  const a = dirname(from.path).split('/');
  const b = to.path.replace(/\.ts$/, '').split('/');
  let k = 0;
  while (k < a.length && k < b.length - 1 && a[k] === b[k]) k++;
  const up = a.length - k;
  return `${up === 0 ? './' : '../'.repeat(up)}${b.slice(k).join('/')}`;
}

function pySpec(to: Module): string {
  return to.path.replace(/^api\//, '').replace(/\.py$/, '').split('/').join('.');
}

function tsSource(
  m: Module, all: Module[], rand: () => number, pick: <T>(xs: readonly T[]) => T,
  int: (lo: number, hi: number) => number, calls: Map<number, number>,
): string {
  const deps = importsOf(m, all, int(1, 3), rand);
  const lines: string[] = [`// ${m.domain}: ${m.functions[0]} and its helpers.`, ''];
  if (m.index % 7 === 0) lines.push(`import { z } from 'zod';`);
  for (const d of deps) lines.push(`import { ${d.functions[0]}, ${d.className} } from '${tsSpec(m, d)}';`);
  // The nearest import is the base class and the first callee: long call chains for `path`.
  const lead = deps[deps.length - 1];
  if (lead) calls.set(m.index, lead.index);
  const noun = pascal([pick(NOUNS)]);
  lines.push('', `export interface ${noun}${m.index} {`, '  id: string;', '  total: number;', '  tags: string[];', '}', '');
  lines.push(`export class ${m.className}${lead ? ` extends ${lead.className}` : ''} {`);
  lines.push(`  private readonly cache = new Map<string, ${noun}${m.index}>();`, '');
  const [get, put, count] = m.methods;
  lines.push(`  ${get}(id: string): ${noun}${m.index} | undefined {`, '    return this.cache.get(id);', '  }', '');
  lines.push(`  ${put}(row: ${noun}${m.index}): void {`, '    this.cache.set(row.id, row);', `    this.${count}();`, '  }', '');
  lines.push(`  ${count}(): number {`, '    return this.cache.size;', '  }', '}', '');
  m.functions.forEach((fn, k) => {
    lines.push(`export function ${fn}(id: string, total = ${int(0, 99)}): ${noun}${m.index} {`);
    lines.push(`  const tags = ['${m.domain}', id].filter((t) => t.length > ${int(0, 3)});`);
    if (k === 0 && lead) lines.push(`  const prev = ${lead.functions[0]}(id, total);`, '  total += prev.total;');
    else if (deps.length > 0 && rand() < 0.5) lines.push(`  total += ${pick(deps).functions[0]}(id).total;`);
    if (k + 1 < m.functions.length && rand() < 0.6) lines.push(`  total += ${m.functions[k + 1]}(id).total;`);
    if (rand() < 0.3) lines.push(`  const store = new ${m.className}();`, `  store.${m.methods[1]}({ id, total, tags });`);
    if (m.index % 7 === 0 && k === 0) lines.push(`  z.string().parse(id);`);
    if (rand() < 0.2) lines.push(`  if (total < 0) {`, `    throw new Error('${fn}: negative total');`, '  }');
    lines.push(`  return { id, total: Math.round(total * 100) / 100, tags };`, '}', '');
  });
  lines.push(`export async function fetch${pascal([m.domain])}${m.index}(id: string): Promise<${noun}${m.index}> {`);
  lines.push(`  const res = await fetch(\`/api/${m.domain}/\${id}\`);`, `  if (!res.ok) return ${m.functions[0]}(id);`, `  return (await res.json()) as ${noun}${m.index};`, '}', '');
  return lines.join('\n');
}

function tsTest(m: Module, all: Module[], rand: () => number, int: (lo: number, hi: number) => number): string {
  const deps = importsOf(m, all, int(1, 2), rand);
  const lines = [`import { describe, expect, it } from 'vitest';`];
  for (const d of deps) lines.push(`import { ${d.functions.slice(0, 2).join(', ')} } from '${tsSpec(m, d)}';`);
  lines.push('', `describe('${m.domain} ${m.index}', () => {`);
  for (const d of deps) {
    for (const fn of d.functions.slice(0, 2)) {
      lines.push(`  it('${fn} keeps the id', () => {`, `    expect(${fn}('a${m.index}').id).toBe('a${m.index}');`, '  });', '');
    }
  }
  lines.push('});', '');
  return lines.join('\n');
}

function pySource(
  m: Module, all: Module[], rand: () => number, pick: <T>(xs: readonly T[]) => T,
  int: (lo: number, hi: number) => number, calls: Map<number, number>,
): string {
  const deps = importsOf(m, all, int(1, 3), rand);
  const route = m.index % ROUTE_EVERY === 0;
  const lines: string[] = [`"""${m.domain}: ${m.functions[0]} and its helpers."""`, ''];
  lines.push('import os');
  if (m.index % 5 === 0) lines.push('import requests');
  if (route) lines.push('from fastapi import APIRouter');
  for (const d of deps) lines.push(`from ${pySpec(d)} import ${d.functions[0]}, ${d.className}`);
  // The nearest import is the base class and the first callee: long call chains for `path`.
  const lead = deps[deps.length - 1];
  if (lead) calls.set(m.index, lead.index);
  lines.push('');
  if (route) lines.push(`router = APIRouter(prefix="/api/${m.domain}/${m.index}")`, '');
  lines.push('', `class ${m.className}${lead ? `(${lead.className})` : ''}:`);
  lines.push(`    """A cache of ${m.domain} rows."""`, '');
  lines.push('    def __init__(self) -> None:', '        self.rows: dict[str, dict] = {}', '');
  const [get, put, count] = m.methods;
  lines.push(`    def ${get}(self, row_id: str) -> dict | None:`, '        return self.rows.get(row_id)', '');
  lines.push(`    def ${put}(self, row: dict) -> None:`, '        self.rows[row["id"]] = row', `        self.${count}()`, '');
  lines.push(`    def ${count}(self) -> int:`, '        return len(self.rows)', '');
  m.functions.forEach((fn, k) => {
    lines.push('', `def ${fn}(row_id: str, total: float = ${int(0, 99)}) -> dict:`);
    lines.push(`    tags = [t for t in ["${m.domain}", row_id] if len(t) > ${int(0, 3)}]`);
    if (k === 0 && lead) lines.push(`    prev = ${lead.functions[0]}(row_id, total)`, '    total += prev["total"]');
    else if (deps.length > 0 && rand() < 0.5) lines.push(`    total += ${pick(deps).functions[0]}(row_id)["total"]`);
    if (k + 1 < m.functions.length && rand() < 0.6) lines.push(`    total += ${m.functions[k + 1]}(row_id)["total"]`);
    if (rand() < 0.3) lines.push(`    store = ${m.className}()`, `    store.${m.methods[1]}({"id": row_id, "total": total, "tags": tags})`);
    if (rand() < 0.2) lines.push('    if total < 0:', `        raise ValueError("${fn}: negative total")`);
    if (k === 0) lines.push(`    if os.environ.get("BENCH_DEBUG"):`, `        print(os.path.join("${m.domain}", row_id))`);
    lines.push('    return {"id": row_id, "total": round(total, 2), "tags": tags}');
  });
  if (m.index % 5 === 0) {
    lines.push('', '', `def fetch_${m.domain}_${m.index}(url: str) -> dict:`, '    return requests.get(url).json()');
  }
  if (route) {
    lines.push('', '', `@router.get("/{row_id}")`, `def get_${m.domain}_${m.index}(row_id: str) -> dict:`, `    return ${m.functions[0]}(row_id)`);
    lines.push('', '', `@router.post("/")`, `def post_${m.domain}_${m.index}(row: dict) -> dict:`, `    ${m.className}().${m.methods[1]}(row)`, '    return row');
  }
  lines.push('');
  return lines.join('\n');
}

function pyTest(m: Module, all: Module[], rand: () => number, int: (lo: number, hi: number) => number): string {
  const deps = importsOf(m, all, int(1, 2), rand);
  const lines: string[] = [];
  for (const d of deps) lines.push(`from ${pySpec(d)} import ${d.functions.slice(0, 2).join(', ')}`);
  for (const d of deps) {
    for (const fn of d.functions.slice(0, 2)) {
      lines.push('', '', `def test_${fn}():`, `    assert ${fn}("a${m.index}")["id"] == "a${m.index}"`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** Function names along `steps` import calls, from the last module that has such a chain. */
function callChain(ms: Module[], calls: Map<number, number>, steps: number): string[] {
  for (let i = ms.length - 1; i >= 0; i--) {
    const chain = [ms[i]!];
    while (chain.length <= steps) {
      const next = calls.get(chain[chain.length - 1]!.index);
      if (next === undefined) break;
      chain.push(ms[next]!);
    }
    if (chain.length > steps) return chain.map((m) => m.functions[0]!);
  }
  throw new Error('the bench repo has no call chain; give it more files');
}
