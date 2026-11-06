// G19: the venv is `.venv`, then uv, then poetry, then the pyright config (box `update-graph/scope`).

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findVenv } from '../src/index.js';
import { poetryEnvName } from '../src/venv.js';

function repo(files: Record<string, string>, dirs: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'rehearse-venv-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  for (const d of dirs) mkdirSync(join(root, d), { recursive: true });
  return root;
}

const POETRY = '[tool.poetry]\nname = "Shop API"\n';
const PYRIGHT = { 'pyrightconfig.json': '{ "venvPath": "envs", "venv": "pyright" }' };

/** A poetry virtualenvs folder with the env of `root` in it. */
function poetryHome(root: string, py = '3.12'): { dir: string; venv: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rehearse-poetry-'));
  const venv = join(dir, `${poetryEnvName('Shop API', root)}-py${py}`);
  mkdirSync(venv);
  return { dir, venv };
}

describe('G19 venv detection', () => {
  it('G19 .venv comes first, before uv, poetry and the pyright config', () => {
    const root = repo({ 'uv.lock': '', 'pyproject.toml': POETRY, ...PYRIGHT }, ['.venv', 'envs/uv', 'envs/pyright']);
    expect(findVenv(root, { UV_PROJECT_ENVIRONMENT: 'envs/uv', POETRY_VIRTUALENVS_PATH: poetryHome(root).dir })).toBe('.venv');
  });

  it('G19 uv: UV_PROJECT_ENVIRONMENT of a uv project, before poetry and the pyright config', () => {
    const root = repo({ 'uv.lock': '', 'pyproject.toml': POETRY, ...PYRIGHT }, ['envs/uv', 'envs/pyright']);
    expect(findVenv(root, { UV_PROJECT_ENVIRONMENT: 'envs/uv', POETRY_VIRTUALENVS_PATH: poetryHome(root).dir })).toBe('envs/uv');
    const tool = repo({ 'pyproject.toml': '[tool.uv]\ndev-dependencies = []\n' }, ['envs/uv']);
    expect(findVenv(tool, { UV_PROJECT_ENVIRONMENT: join(tool, 'envs/uv') })).toBe('envs/uv');
  });

  it('G19 poetry: {name}-{hash}-py3.x in the virtualenvs folder (absolute, outside the repo), before the pyright config', () => {
    const root = repo({ 'pyproject.toml': POETRY, 'poetry.lock': '', ...PYRIGHT }, ['envs/pyright']);
    const home = poetryHome(root);
    mkdirSync(join(home.dir, `${poetryEnvName('Shop API', root)}-py3.9`));
    expect(findVenv(root, { POETRY_VIRTUALENVS_PATH: home.dir })).toBe(home.venv);
    // POETRY_CACHE_DIR/virtualenvs, and poetry.toml `[virtualenvs] path`
    const cache = mkdtempSync(join(tmpdir(), 'rehearse-poetry-cache-'));
    mkdirSync(join(cache, 'virtualenvs', `${poetryEnvName('Shop API', root)}-py3.11`), { recursive: true });
    expect(findVenv(root, { POETRY_CACHE_DIR: cache })).toBe(join(cache, 'virtualenvs', `${poetryEnvName('Shop API', root)}-py3.11`));
    writeFileSync(join(root, 'poetry.toml'), `[virtualenvs]\npath = "${home.dir}"\n`);
    expect(findVenv(root, { POETRY_CACHE_DIR: cache })).toBe(home.venv);
  });

  it("G19 poetry's env name: lowercased, sanitized, and 8 characters of the urlsafe base64 SHA-256 of the folder", () => {
    // python: base64.urlsafe_b64encode(hashlib.sha256(b'/nonexistent/shop').digest())[:8]
    expect(poetryEnvName('Shop API', '/nonexistent/shop')).toBe('shop_api-bJ7QGCuw');
  });

  it('G19 the pyright config when there is no .venv, uv or poetry env; none at all is "no venv found"', () => {
    expect(findVenv(repo(PYRIGHT, ['envs/pyright']), {})).toBe('envs/pyright');
    expect(findVenv(repo({ 'uv.lock': '', 'pyproject.toml': POETRY }), { POETRY_VIRTUALENVS_PATH: join(tmpdir(), 'none') })).toBeUndefined();
  });
});
