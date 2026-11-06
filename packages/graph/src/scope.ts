// Box `update-graph/scope`: find the tsconfig files, the source files and the Python environment
// (G12, G19). node_modules and the venv are never in `files`: their symbols are edge targets only.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import type { SymbolPackage } from './symbols.js';
import type { CodeLanguage } from './types.js';

export interface ScopeFile {
  /** Repo path, `/`-separated. */
  path: string;
  language: CodeLanguage;
}

export interface Scope {
  files: ScopeFile[];
  /** Every tsconfig*.json in the repo, repo paths, sorted. */
  tsconfigs: string[];
  /** The Python environment, a repo path, or undefined: "no venv found" (G19). */
  venv?: string;
}

const TS_EXT = /\.(ts|tsx|mts|cts)$/;
const DTS = /\.d\.(ts|mts|cts)$|\.d\.[^.]+\.ts$/;
const PY_EXT = /\.py$/;
const TSCONFIG = /^tsconfig.*\.json$/;
const SKIP_DIRS = new Set(['node_modules', '__pycache__', 'site-packages', 'bower_components', 'jspm_packages']);

/** Repo path of an absolute path below root. */
export function repoPath(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/');
}

export function findScope(root: string): Scope {
  const venv = findVenv(root);
  const tsFiles: string[] = [];
  const pyFiles: string[] = [];
  const tsconfigs: string[] = [];
  walk(root, root, venv, (path, name) => {
    if (TSCONFIG.test(name)) tsconfigs.push(path);
    else if (TS_EXT.test(name) && !DTS.test(name)) tsFiles.push(path);
    else if (PY_EXT.test(name)) pyFiles.push(path);
  });
  tsconfigs.sort();
  let ts: string[];
  if (tsconfigs.length === 0) {
    ts = tsFiles;
  } else {
    const inScope = new Set<string>();
    for (const config of tsconfigs) {
      const match = tsconfigMatcher(root, config);
      for (const f of tsFiles) if (match(f)) inScope.add(f);
    }
    ts = [...inScope];
  }
  const files: ScopeFile[] = [
    ...ts.map((path) => ({ path, language: 'typescript' as const })),
    ...pyFiles.map((path) => ({ path, language: 'python' as const })),
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return venv === undefined ? { files, tsconfigs } : { files, tsconfigs, venv };
}

/** Every file below `dir`, except dot folders, node_modules, the venv and any folder with a pyvenv.cfg. */
function walk(root: string, dir: string, venv: string | undefined, visit: (path: string, name: string) => void): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  if (dir !== root && entries.some((e) => e.name === 'pyvenv.cfg' && e.isFile())) return;
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      if (venv !== undefined && repoPath(root, abs) === venv) continue;
      walk(root, abs, venv, visit);
    } else if (e.isFile()) {
      visit(repoPath(root, abs), e.name);
    }
  }
}

/** The Python environment: `.venv`, then the pyright config (`venvPath` + `venv`). */
export function findVenv(root: string): string | undefined {
  if (isDir(join(root, '.venv'))) return '.venv';
  const pyright = readJsonc(join(root, 'pyrightconfig.json'));
  if (isRecord(pyright) && typeof pyright.venv === 'string') {
    return posix.normalize(posix.join(typeof pyright.venvPath === 'string' ? pyright.venvPath : '.', pyright.venv));
  }
  const pyproject = readText(join(root, 'pyproject.toml'));
  if (pyproject !== undefined) {
    const section = tomlSection(pyproject, 'tool.pyright');
    const venv = section && tomlString(section, 'venv');
    if (venv) return posix.normalize(posix.join(tomlString(section, 'venvPath') ?? '.', venv));
  }
  return undefined;
}

interface TsconfigPatterns {
  files?: string[];
  include?: string[];
  exclude?: string[];
  outDir?: string;
}

/** A test for repo paths in the program of one tsconfig: files, include, exclude, outDir, relative extends. */
function tsconfigMatcher(root: string, config: string): (path: string) => boolean {
  const merged = loadTsconfig(join(root, config), root, new Set());
  const configDir = posix.dirname(config);
  const files = new Set((merged.files ?? []).map((f) => posix.normalize(f)));
  const include = merged.include ?? (merged.files ? [] : ['**/*']);
  const exclude = [...(merged.exclude ?? ['node_modules', 'bower_components', 'jspm_packages'])];
  if (merged.outDir) exclude.push(merged.outDir);
  const inc = include.map((p) => globRegex(p, true));
  const exc = exclude.map((p) => globRegex(p, false));
  return (path) => {
    const rel = posix.relative(configDir === '.' ? '' : configDir, path);
    if (files.has(rel)) return true;
    if (!inc.some((r) => r.test(rel))) return false;
    // An exclude pattern matches the file or one of its folders.
    const parts = rel.split('/');
    return !parts.some((_, i) => exc.some((r) => r.test(parts.slice(0, i + 1).join('/'))));
  };
}

/** The patterns of a tsconfig, each made relative to `configFile`'s folder, with relative `extends` merged in. */
function loadTsconfig(configFile: string, root: string, seen: Set<string>): TsconfigPatterns {
  if (seen.has(configFile)) return {};
  seen.add(configFile);
  const json = readJsonc(configFile);
  if (!isRecord(json)) return {};
  const here = dirname(configFile);
  let base: TsconfigPatterns = {};
  const ext = json.extends;
  for (const e of Array.isArray(ext) ? ext : typeof ext === 'string' ? [ext] : []) {
    if (typeof e !== 'string' || !e.startsWith('.')) continue; // a package config has no file patterns
    const file = existsSync(join(here, e)) ? join(here, e) : join(here, `${e}.json`);
    const parent = loadTsconfig(file, root, seen);
    const shift = (p: string) => posix.normalize(posix.join(repoPath(here, dirname(file)) || '.', p));
    base = {
      ...base,
      ...(parent.files ? { files: parent.files.map(shift) } : {}),
      ...(parent.include ? { include: parent.include.map(shift) } : {}),
      ...(parent.exclude ? { exclude: parent.exclude.map(shift) } : {}),
      ...(parent.outDir ? { outDir: shift(parent.outDir) } : {}),
    };
  }
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);
  const own: TsconfigPatterns = {};
  const files = strings(json.files);
  const include = strings(json.include);
  const exclude = strings(json.exclude);
  if (files) own.files = files;
  if (include) own.include = include;
  if (exclude) own.exclude = exclude;
  const opts = json.compilerOptions;
  if (isRecord(opts) && typeof opts.outDir === 'string') own.outDir = opts.outDir;
  return { ...base, ...own };
}

/**
 * A tsconfig glob as a regex over a path relative to the config folder. `**` is any folders, `*` and `?`
 * stay in one segment. In an include, a pattern with no wildcard and no extension is a folder: every file below it.
 */
export function globRegex(pattern: string, isInclude: boolean): RegExp {
  let p = posix.normalize(pattern.replace(/\\/g, '/')).replace(/\/$/, '');
  const last = p.split('/').pop() ?? '';
  if (isInclude && !/[*?]/.test(last) && !/\.[A-Za-z0-9]+$/.test(last)) p = p === '.' ? '**/*' : `${p}/**/*`;
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === '*' && p[i + 1] === '*') {
      i++;
      if (p[i + 1] === '/') {
        i++;
        re += '(?:[^/]+/)*';
      } else {
        re += '.*';
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/** The package of a file for its symbol IDs: the nearest package.json (TypeScript) or pyproject.toml (Python). */
export function packageFinder(root: string): (path: string, language: CodeLanguage) => SymbolPackage {
  const cache = new Map<string, SymbolPackage>();
  const none: SymbolPackage = { name: '.', version: '.' };
  const lookup = (dir: string, language: CodeLanguage): SymbolPackage => {
    const key = `${language}:${dir}`;
    const hit = cache.get(key);
    if (hit) return hit;
    let pkg: SymbolPackage | undefined;
    if (language === 'typescript') {
      const json = readJsonc(join(root, dir, 'package.json'));
      if (isRecord(json) && typeof json.name === 'string') {
        pkg = { name: json.name, version: typeof json.version === 'string' ? json.version : '.' };
      }
    } else {
      const toml = readText(join(root, dir, 'pyproject.toml'));
      const section = toml && (tomlSection(toml, 'project') ?? tomlSection(toml, 'tool.poetry'));
      const name = section && tomlString(section, 'name');
      if (name) pkg = { name, version: tomlString(section, 'version') ?? '.' };
    }
    if (!pkg) pkg = dir === '.' || dir === '' ? none : lookup(posix.dirname(dir), language);
    cache.set(key, pkg);
    return pkg;
  };
  return (path, language) => lookup(posix.dirname(path), language);
}

/** JSON with comments and trailing commas (tsconfig, pyrightconfig); undefined when missing or bad. */
export function readJsonc(file: string): unknown {
  const text = readText(file);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(stripJsonComments(text));
  } catch {
    return undefined;
  }
}

function stripJsonComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i === -1) break;
      i++;
    } else if (c === ',' && /^\s*[}\]]/.test(text.slice(i + 1, i + 200))) {
      // a trailing comma
    } else {
      out += c;
    }
  }
  return out;
}

/** The lines of one `[section]` of a TOML file, or undefined. */
function tomlSection(toml: string, name: string): string | undefined {
  const lines = toml.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `[${name}]`);
  if (start === -1) return undefined;
  const end = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

function tomlString(section: string, key: string): string | undefined {
  const m = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']*)["']`, 'm').exec(section);
  return m?.[1];
}

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
