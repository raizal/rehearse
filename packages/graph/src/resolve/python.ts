// Box `update-graph/bulk-index`, Python (G10, G15, G19): scip-python indexes the whole repo in one run on
// a cold index; a warm basedpyright server answers the sites of the changed files on an update. Both are
// the npm packages, run by this Node with PATH emptied, so the host needs no Python (S6-A3).
//
// They see a mirror of the repo's Python files in a temp folder with a pyrightconfig.json of our own,
// so a pyright config of the repo is not read or written. The config points at the venv (G19): with
// one, a call into an installed package (`requests.get`) is `exact` to a target-only node; with none,
// only the sites inside the repo are confirmed, and the sites into third-party packages stay
// `unresolved` from name-match ("no venv found").

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { Resolution, ResolveInput, Resolver } from '../extend.js';
import type { StoredRef } from '../store.js';
import type { GraphNode } from '../types.js';
import { LspClient } from './lsp.js';
import { readScip, SCIP_DEFINITION, type ScipIndex } from './scip.js';
import { boundTarget, externalMember, externalModule, groupBy, nodeAt, refsToResolve } from './targets.js';

const run = promisify(execFile);
const require = createRequire(import.meta.url);

/** The scip-python project name of the repo's own symbols. */
const PROJECT = 'rehearse-repo';
const REQUEST_TIMEOUT_MS = 30_000;

/** The venv of a scope as an absolute folder, or undefined when there is none on disk. */
export function venvDir(root: string, venv: string | undefined): string | undefined {
  if (venv === undefined) return undefined;
  const dir = isAbsolute(venv) ? venv : join(root, venv);
  try {
    return statSync(dir).isDirectory() ? realpathSync(dir) : undefined;
  } catch {
    return undefined;
  }
}

/** `<venv>/lib/python3.x/site-packages` (POSIX) or `<venv>/Lib/site-packages` (Windows). */
export function sitePackages(venv: string): string | undefined {
  const win = join(venv, 'Lib', 'site-packages');
  if (existsSync(win)) return win;
  const lib = join(venv, 'lib');
  const py = existsSync(lib) ? readdirSync(lib).filter((d) => d.startsWith('python')).sort() : [];
  for (const d of py) if (existsSync(join(lib, d, 'site-packages'))) return join(lib, d, 'site-packages');
  return undefined;
}

/** `3.12` from the venv's pyvenv.cfg (`version` or `version_info`), else 3.12. */
function pythonVersion(venv: string | undefined): string {
  if (venv === undefined) return '3.12';
  try {
    const m = /^version(?:_info)?\s*=\s*(\d+\.\d+)/m.exec(readFileSync(join(venv, 'pyvenv.cfg'), 'utf8'));
    return m?.[1] ?? '3.12';
  } catch {
    return '3.12';
  }
}

interface Mirror {
  dir: string;
  venv: string | undefined;
  site: string | undefined;
}

/** Copy the repo's Python files into a new temp folder and write the pyright config next to them. */
function makeMirror(root: string, input: ResolveInput, prefix: string): Mirror {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  for (const f of input.scope.files) if (f.language === 'python') copyIn(root, dir, f.path);
  const venv = venvDir(root, input.scope.venv);
  const config: Record<string, unknown> = { pythonVersion: pythonVersion(venv) };
  if (venv !== undefined) Object.assign(config, { venvPath: dirname(venv), venv: venv.slice(dirname(venv).length + 1) });
  writeFileSync(join(dir, 'pyrightconfig.json'), JSON.stringify(config));
  return { dir, venv, site: venv === undefined ? undefined : sitePackages(venv) };
}

function copyIn(root: string, dir: string, path: string): boolean {
  const to = join(dir, ...path.split('/'));
  try {
    const text = readFileSync(join(root, ...path.split('/')));
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, text);
    return true;
  } catch {
    return false;
  }
}

/** The child environment: no PATH, so no Python on the host is ever run or read. */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: '' };
  for (const k of ['HOME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot']) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

/** The packages of a venv as scip-python's `--environment` file wants them: name, version, files. */
export function venvPackages(site: string | undefined): Array<{ name: string; version: string; files: string[] }> {
  if (site === undefined) return [];
  const out: Array<{ name: string; version: string; files: string[] }> = [];
  for (const d of readdirSync(site).filter((n) => n.endsWith('.dist-info')).sort()) {
    let meta: string;
    try {
      meta = readFileSync(join(site, d, 'METADATA'), 'utf8');
    } catch {
      continue;
    }
    const name = /^Name:\s*(.+)$/m.exec(meta)?.[1]?.trim();
    const version = /^Version:\s*(.+)$/m.exec(meta)?.[1]?.trim();
    if (!name || !version) continue;
    let record = '';
    try {
      record = readFileSync(join(site, d, 'RECORD'), 'utf8');
    } catch {
      // a package with no RECORD has no files to give
    }
    const files = record.split(/\r?\n/)
      .map((l) => (l.startsWith('"') ? l.slice(1, l.indexOf('"', 1)) : l.split(',')[0] ?? ''))
      .filter((f) => f !== '' && !f.startsWith('..') && !f.includes('.dist-info/'));
    out.push({ name, version, files });
  }
  return out;
}

// ─── scip-python (cold) ─────────────────────────────────────────────────────────────────────────

/** The bulk resolver of a cold index: one scip-python run over the whole repo (S6-A3, S6-A4). */
export function scipPythonResolver(): Resolver {
  return {
    name: 'scip-python',
    language: 'python',
    modes: ['cold'],
    async resolve(input) {
      if (input.refs.length === 0) return [];
      const root = realpathSync(input.root);
      const mirror = makeMirror(root, input, 'rehearse-scip-');
      try {
        const env = join(mirror.dir, '.rehearse-environment.json');
        writeFileSync(env, JSON.stringify(venvPackages(mirror.site)));
        const out = join(mirror.dir, '.rehearse-index.scip');
        await run(process.execPath, [
          require.resolve('@sourcegraph/scip-python/index.js'), 'index', '--cwd', mirror.dir,
          '--project-name', PROJECT, '--project-version', '0', '--environment', env, '--output', out, '--quiet',
        ], { cwd: mirror.dir, env: childEnv(), maxBuffer: 64 * 1024 * 1024 });
        return resolveFromScip(readScip(readFileSync(out)), input, mirror.venv !== undefined);
      } finally {
        rmSync(mirror.dir, { recursive: true, force: true });
      }
    },
  };
}

/** The answers a SCIP index gives for the reference sites (also used on a recorded index in tests). */
export function resolveFromScip(index: ScipIndex, input: ResolveInput, withVenv: boolean): Resolution[] {
  const defs = new Map<string, { path: string; line: number }>();
  for (const d of index.documents) {
    for (const o of d.occurrences) if (o.roles & SCIP_DEFINITION && !defs.has(o.symbol)) defs.set(o.symbol, { path: d.path, line: o.range[0] });
  }
  const docs = new Map(index.documents.map((d) => [d.path, d]));
  const out: Resolution[] = [];
  for (const [path, refs] of groupBy(input.refs, (r) => r.file)) {
    const doc = docs.get(path);
    if (!doc) continue;
    const byLine = groupBy(doc.occurrences.filter((o) => !(o.roles & SCIP_DEFINITION)), (o) => String(o.range[0] + 1));
    for (const ref of refs) {
      const line = byLine.get(String(ref.line)) ?? [];
      let target: GraphNode | undefined;
      for (const o of line) {
        const s = parseSymbol(o.symbol);
        if (!s || !matches(ref, s)) continue;
        target = scipTarget(ref, s, o.symbol, defs, input, withVenv);
        break;
      }
      // `from orders import get_order_by_id` next to the file: scip-python finds the name, not the module.
      if (!target && ref.kind === 'imports') target = importedFrom(ref, line, defs, input);
      if (target) out.push({ ref, target, trust: 'exact' });
    }
  }
  return out;
}

interface Descriptor {
  name: string;
  /** `/` namespace, `#` type, `.` term, `()` method, `:` meta, `(p)` parameter, `[t]` type parameter. */
  suffix: '/' | '#' | '.' | '()' | ':' | '!' | 'param' | 'tparam';
}

export interface ScipSymbol {
  pkg: string;
  descriptors: Descriptor[];
}

/** `scip-python python requests 2.31.0 \`requests.api\`/get().` → package and descriptors; undefined for a local. */
export function parseSymbol(symbol: string): ScipSymbol | undefined {
  if (symbol.startsWith('local ')) return undefined;
  // scheme, manager, package name, version, then the descriptors (none of the first four has a space here).
  const parts = symbol.split(' ', 4);
  const i = parts.join(' ').length + 1;
  const descriptors: Descriptor[] = [];
  const s = symbol.slice(i);
  let p = 0;
  const readName = (): string => {
    if (s[p] === '`') {
      let name = '';
      p++;
      while (p < s.length) {
        if (s[p] === '`' && s[p + 1] === '`') (name += '`'), (p += 2);
        else if (s[p] === '`') return p++, name;
        else name += s[p++];
      }
      return name;
    }
    const m = /^[\w$+\-]*/.exec(s.slice(p))![0];
    p += m.length;
    return m;
  };
  while (p < s.length) {
    if (s[p] === '(') {
      p++;
      const name = readName();
      p = s.indexOf(')', p) + 1;
      descriptors.push({ name, suffix: 'param' });
      continue;
    }
    if (s[p] === '[') {
      p++;
      const name = readName();
      p = s.indexOf(']', p) + 1;
      descriptors.push({ name, suffix: 'tparam' });
      continue;
    }
    const name = readName();
    const c = s[p];
    if (c === '(') {
      p = s.indexOf(')', p) + 2; // `(disambiguator).`
      descriptors.push({ name, suffix: '()' });
    } else if (c === '/' || c === '#' || c === '.' || c === ':' || c === '!') {
      p++;
      descriptors.push({ name, suffix: c });
    } else break; // not a symbol this reader knows
  }
  return { pkg: parts[2] ?? '', descriptors };
}

function isModule(s: ScipSymbol): boolean {
  const last = s.descriptors.at(-1);
  return last?.suffix === ':' && last.name === '__init__';
}

/** The dotted module of a symbol: its namespaces (`api.orders`). */
function moduleOf(s: ScipSymbol): string {
  return s.descriptors.filter((d) => d.suffix === '/').map((d) => d.name).join('.');
}

/** Whether an occurrence is the one a reference site names. */
function matches(ref: StoredRef, s: ScipSymbol): boolean {
  if (ref.kind === 'imports') {
    const last = ref.name.split('.').filter((p) => p !== '').pop();
    return isModule(s) && last !== undefined && moduleOf(s).split('.').pop() === last;
  }
  const last = s.descriptors.at(-1);
  return last !== undefined && last.suffix !== 'param' && last.suffix !== 'tparam' && last.name === ref.name;
}

function scipTarget(
  ref: StoredRef, s: ScipSymbol, symbol: string, defs: Map<string, { path: string; line: number }>,
  input: ResolveInput, withVenv: boolean,
): GraphNode | undefined {
  if (s.pkg === PROJECT) {
    const def = defs.get(symbol);
    if (!def) return undefined; // a module scip-python could not find: left to name-match
    const nodes = input.graph.nodesInFile(def.path);
    if (isModule(s)) return nodes.find((n) => n.kind === 'file');
    return nodeAt(nodes, s.descriptors.at(-1)!.name, def.line + 1);
  }
  if (s.pkg === 'python-stdlib' || !withVenv) return undefined;
  return boundTarget('python', ref, input.graph.bindings(ref.file)) ?? symbolTarget(s);
}

/** The repo file of an import whose names scip-python found in a file with the module's name. */
function importedFrom(
  ref: StoredRef, line: Array<{ symbol: string }>, defs: Map<string, { path: string; line: number }>, input: ResolveInput,
): GraphNode | undefined {
  const last = ref.name.split('.').filter((p) => p !== '').pop();
  for (const o of line) {
    const s = parseSymbol(o.symbol);
    const def = s?.pkg === PROJECT ? defs.get(o.symbol) : undefined;
    if (!def || last === undefined) continue;
    const stem = def.path.replace(/\.pyi?$/, '').split('/');
    if (stem.at(-1) === last || (stem.at(-1) === '__init__' && stem.at(-2) === last)) {
      return input.graph.nodesInFile(def.path).find((n) => n.kind === 'file');
    }
  }
  return undefined;
}

/** A target-only node named from the SCIP symbol, for a site with no import binding. */
function symbolTarget(s: ScipSymbol): GraphNode {
  const module = moduleOf(s);
  const pkg = module.split('.')[0] || s.pkg;
  if (isModule(s)) return externalModule('python', pkg, module);
  const member = s.descriptors.filter((d) => d.suffix !== '/' && d.suffix !== 'param' && d.suffix !== 'tparam').map((d) => d.name).join('.');
  return externalMember('python', pkg, module, member);
}

// ─── basedpyright (update) ──────────────────────────────────────────────────────────────────────

interface Warm {
  key: string;
  mirror: Mirror;
  client: LspClient;
  /** Mirror path → document version, for the files opened in the server. */
  open: Map<string, number>;
}

interface Position {
  line: number;
  character: number;
}
interface Location {
  uri: string;
  range: { start: Position; end: Position };
}
type Definition = Location | Location[] | Array<{ targetUri: string; targetSelectionRange: Location['range'] }> | null;

/** The resolver of an update: a basedpyright server kept warm in the process, asked about the changed sites. */
export function basedpyrightResolver(): Resolver {
  let warm: Warm | undefined;
  const stop = () => {
    if (!warm) return;
    warm.client.close();
    rmSync(warm.mirror.dir, { recursive: true, force: true });
    warm = undefined;
  };
  return {
    name: 'basedpyright',
    language: 'python',
    modes: ['update'],
    async resolve(input) {
      const root = realpathSync(input.root);
      const refs = askable(refsToResolve(input), input);
      const key = `${root}\u0000${input.scope.venv ?? ''}`;
      if (warm && warm.key !== key) stop();
      if (refs.length === 0 && !warm) return [];
      const w = warm ?? (warm = await start(root, input, key));
      sync(w, root, input);
      const out: Resolution[] = [];
      for (const [path, fileRefs] of groupBy(refs, (r) => r.file)) {
        const text = open(w, root, path);
        if (text === undefined) continue;
        const lines = text.split(/\r?\n/);
        const uri = pathToFileURL(join(w.mirror.dir, ...path.split('/'))).href;
        const answers = await Promise.all(fileRefs.map(async (ref) => {
          const character = columnOf(lines[ref.line - 1] ?? '', ref);
          if (character === undefined) return undefined;
          const def = await timeout(w.client.request<Definition>('textDocument/definition', {
            textDocument: { uri }, position: { line: ref.line - 1, character },
          }));
          const loc = firstLocation(def);
          const target = loc && lspTarget(ref, loc, w, input);
          return target ? ({ ref, target, trust: 'exact' } satisfies Resolution) : undefined;
        }));
        for (const a of answers) if (a) out.push(a);
      }
      return out;
    },
    async close() {
      stop();
    },
  };
}

async function start(root: string, input: ResolveInput, key: string): Promise<Warm> {
  const mirror = makeMirror(root, input, 'rehearse-pyright-');
  const client = new LspClient(process.execPath, [require.resolve('basedpyright/langserver.index.js'), '--stdio'], {
    cwd: mirror.dir, env: childEnv(),
  });
  const rootUri = pathToFileURL(mirror.dir).href;
  await timeout(client.request('initialize', {
    processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: 'repo' }],
    capabilities: { textDocument: { definition: { linkSupport: false } }, workspace: { configuration: true, workspaceFolders: true } },
  }));
  client.notify('initialized', {});
  return { key, mirror, client, open: new Map() };
}

/** Bring the mirror and the open documents up to date with the changed and removed files. */
function sync(w: Warm, root: string, input: ResolveInput): void {
  const changes: Array<{ uri: string; type: number }> = [];
  for (const path of input.changed) {
    if (!path.endsWith('.py')) continue;
    const to = join(w.mirror.dir, ...path.split('/'));
    const existed = existsSync(to);
    if (!copyIn(root, w.mirror.dir, path)) continue;
    const uri = pathToFileURL(to).href;
    changes.push({ uri, type: existed ? 2 : 1 });
    const version = w.open.get(path);
    if (version !== undefined) {
      w.open.set(path, version + 1);
      w.client.notify('textDocument/didChange', {
        textDocument: { uri, version: version + 1 }, contentChanges: [{ text: readFileSync(to, 'utf8') }],
      });
    }
  }
  for (const path of input.removed) {
    if (!path.endsWith('.py')) continue;
    const to = join(w.mirror.dir, ...path.split('/'));
    const uri = pathToFileURL(to).href;
    rmSync(to, { force: true });
    changes.push({ uri, type: 3 });
    if (w.open.delete(path)) w.client.notify('textDocument/didClose', { textDocument: { uri } });
  }
  if (changes.length > 0) w.client.notify('workspace/didChangeWatchedFiles', { changes });
}

/** Open a mirror file in the server (once), and return its text. */
function open(w: Warm, root: string, path: string): string | undefined {
  const file = join(w.mirror.dir, ...path.split('/'));
  if (!existsSync(file) && !copyIn(root, w.mirror.dir, path)) return undefined;
  const text = readFileSync(file, 'utf8');
  if (!w.open.has(path)) {
    w.open.set(path, 1);
    w.client.notify('textDocument/didOpen', { textDocument: { uri: pathToFileURL(file).href, languageId: 'python', version: 1, text } });
  }
  return text;
}

/** The 0-based column of the name a reference site points at, in its line. */
export function columnOf(line: string, ref: StoredRef): number | undefined {
  if (ref.kind === 'imports') {
    const last = ref.name.split('.').filter((p) => p !== '').pop();
    const at = line.indexOf(ref.name);
    if (last === undefined || at === -1) return undefined;
    return at + ref.name.lastIndexOf(last);
  }
  if (ref.receiver !== undefined && ref.receiver !== '?') {
    const at = line.indexOf(`${ref.receiver}.${ref.name}`);
    if (at !== -1) return at + ref.receiver.length + 1;
  }
  const m = new RegExp(`(?<![\\w.])${ref.name}\\b|(?<=\\.)${ref.name}\\b`).exec(line);
  return m?.index;
}

function firstLocation(def: Definition | undefined): Location | undefined {
  if (!def) return undefined;
  const first = Array.isArray(def) ? def[0] : def;
  if (!first) return undefined;
  return 'targetUri' in first ? { uri: first.targetUri, range: first.targetSelectionRange } : first;
}

/**
 * The sites worth one definition request. With no venv only a repo node can be the target, and a repo
 * node has the name of its definition: a call whose name no repo node has (`len`, `os.path.join`,
 * a method of a package object) is left out, unless an import binds the name (an alias).
 */
function askable(refs: StoredRef[], input: ResolveInput): StoredRef[] {
  if (input.scope.venv !== undefined) return refs;
  const named = new Map<string, boolean>();
  const inRepo = (name: string) => {
    let has = named.get(name);
    if (has === undefined) named.set(name, (has = input.graph.nodesNamed(name).some((n) => !n.targetOnly)));
    return has;
  };
  const aliases = new Map<string, Set<string>>();
  const bound = (r: StoredRef) => {
    let set = aliases.get(r.file);
    if (!set) aliases.set(r.file, (set = new Set(input.graph.bindings(r.file).map((b) => b.local))));
    return set.has(r.name);
  };
  return refs.filter((r) => r.kind === 'imports' || inRepo(r.name) || bound(r));
}

function lspTarget(ref: StoredRef, loc: Location, w: Warm, input: ResolveInput): GraphNode | undefined {
  let file: string;
  try {
    file = fileURLToPath(loc.uri);
  } catch {
    return undefined;
  }
  const rel = relative(w.mirror.dir, file);
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    const path = rel.split(sep).join('/');
    const nodes = input.graph.nodesInFile(path);
    const { start, end } = loc.range;
    if (ref.kind === 'imports' || (start.line === end.line && start.character === end.character)) {
      return nodes.find((n) => n.kind === 'file');
    }
    const name = (readFileSync(file, 'utf8').split(/\r?\n/)[start.line] ?? '').slice(start.character, end.character);
    return nodeAt(nodes, name, start.line + 1);
  }
  if (w.mirror.site === undefined) return undefined; // no venv: third-party stays unresolved (G19)
  const inSite = relative(w.mirror.site, file);
  const stub = /[\\/]typeshed-fallback[\\/]stubs[\\/][^\\/]+[\\/](.+)$/.exec(file)?.[1];
  const modFile = !inSite.startsWith('..') && !isAbsolute(inSite) ? inSite : stub;
  if (modFile === undefined) return undefined; // the standard library
  const bound = boundTarget('python', ref, input.graph.bindings(ref.file));
  if (bound) return bound;
  const module = modFile.split(/[\\/]/).join('.').replace(/\.pyi?$/, '').replace(/\.__init__$/, '');
  const pkg = module.split('.')[0]!;
  return ref.kind === 'imports' ? externalModule('python', pkg, module) : externalMember('python', pkg, module, ref.name);
}

function timeout<T>(p: Promise<T>): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), REQUEST_TIMEOUT_MS);
    timer.unref();
  });
  return Promise.race([p.catch(() => undefined), t]).finally(() => clearTimeout(timer));
}
