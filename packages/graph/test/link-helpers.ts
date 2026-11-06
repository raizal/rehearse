// Helpers of the linker tests: a copy of the shop fixture with overlays from fixtures/links, and a
// git history made in that copy. Git never runs in this repo's own history.

import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { copyFixture, FIXTURES } from './helpers.js';

/** A copy of `shop` with the overlays `record`, `openapi` copied over it. */
export function shopWith(...overlays: string[]): string {
  const root = copyFixture('shop');
  for (const o of overlays) cpSync(join(FIXTURES, 'links', o), root, { recursive: true });
  return root;
}

/** Run git in `root` with a fixed author, no signing, no hooks and no global config. */
export function git(root: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } },
  ).trim();
}

/** `git init` and commit every file, with no trailer. */
export function initRepo(root: string): string {
  git(root, 'init', '-q', '-b', 'main');
  return commitAll(root, 'initial');
}

/** Commit every change with `message` (trailers included), and return the commit SHA. */
export function commitAll(root: string, message: string): string {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

/** Replace `from` by `to` in one file; fail when `from` is not there. */
export function edit(root: string, file: string, from: string, to: string): void {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  if (!text.includes(from)) throw new Error(`${file} has no ${from}`);
  writeFileSync(path, text.replace(from, to));
}
