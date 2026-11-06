// Box `update-graph/scope`, the venv of a uv or poetry project (G19): the order is `.venv`, then uv,
// then poetry, then the pyright config (scope.ts findVenv). A venv outside the repo is an absolute path.

import { createHash } from 'node:crypto';
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { readText, tomlSection, tomlString } from './scope.js';

export type Env = Record<string, string | undefined>;

/** The venv uv or poetry made for the project at `root`, or undefined. */
export function managedVenv(root: string, env: Env = process.env): string | undefined {
  const pyproject = readText(join(root, 'pyproject.toml')) ?? '';
  return uvVenv(root, pyproject, env) ?? poetryVenv(root, pyproject, env);
}

/** uv: `UV_PROJECT_ENVIRONMENT` (its default `.venv` is checked before). */
function uvVenv(root: string, pyproject: string, env: Env): string | undefined {
  const uv = isFile(join(root, 'uv.lock')) || tomlSection(pyproject, 'tool.uv') !== undefined;
  const dir = env.UV_PROJECT_ENVIRONMENT;
  if (!uv || !dir) return undefined;
  return asVenv(root, isAbsolute(dir) ? dir : join(root, dir));
}

/** poetry: `{name}-{hash of the project folder}-py3.x` in its virtualenvs folder. */
function poetryVenv(root: string, pyproject: string, env: Env): string | undefined {
  const poetry = tomlSection(pyproject, 'tool.poetry');
  if (!isFile(join(root, 'poetry.lock')) && poetry === undefined) return undefined;
  const name = (poetry && tomlString(poetry, 'name')) ?? tomlString(tomlSection(pyproject, 'project') ?? '', 'name');
  if (!name) return undefined;
  const local = tomlSection(readText(join(root, 'poetry.toml')) ?? '', 'virtualenvs');
  const dir = env.POETRY_VIRTUALENVS_PATH
    ?? (local && tomlString(local, 'path'))
    ?? join(env.POETRY_CACHE_DIR ?? poetryCache(env), 'virtualenvs');
  const prefix = `${poetryEnvName(name, root)}-py`;
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((e) => e.startsWith(prefix)).sort(byVersion);
  } catch {
    return undefined;
  }
  const last = entries.at(-1);
  return last === undefined ? undefined : asVenv(root, join(dir, last));
}

/** poetry's `generate_env_name`: the lowercased name, sanitized, cut to 42, and 8 characters of a hash. */
export function poetryEnvName(name: string, root: string): string {
  const sanitized = name.toLowerCase().replace(/[ $`!*@"\\\r\n\t]/g, '_').slice(0, 42);
  let cwd = root;
  try {
    cwd = realpathSync(root);
  } catch {
    // a root that is gone keeps its path
  }
  if (process.platform === 'win32') cwd = cwd.toLowerCase();
  const hash = createHash('sha256').update(cwd).digest('base64url').slice(0, 8);
  return `${sanitized}-${hash}`;
}

function poetryCache(env: Env): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'pypoetry');
  if (process.platform === 'win32') return join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'pypoetry', 'Cache');
  return join(env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'pypoetry');
}

function byVersion(a: string, b: string): number {
  const v = (s: string) => (/-py(\d+)\.(\d+)$/.exec(s) ?? []).slice(1).map(Number);
  const [a1 = 0, a2 = 0] = v(a);
  const [b1 = 0, b2 = 0] = v(b);
  return a1 - b1 || a2 - b2;
}

/** The venv as a repo path when it is in the repo, else absolute; undefined when it is not a folder. */
function asVenv(root: string, dir: string): string | undefined {
  try {
    if (!statSync(dir).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  const rel = relative(root, dir);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : dir;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
