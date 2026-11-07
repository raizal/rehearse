// A test fixture for CLI scenarios (T48): a fresh git repo in a temp folder, the rehearse CLI run
// in it, and git with a test identity. UI scenarios start from `serve.ts` instead.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI } from './serve.js';

/** Run the rehearse CLI in `cwd`: its exit code, stdout and stderr. */
export function rehearse(cwd: string, ...args: string[]): { code: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** Run git in `cwd` as a test user; its stdout. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' });
}

/** A new empty git repo in a temp folder, and how to remove it after the test. */
export function freshRepo(name = 'repo'): { tmp: string; repo: string; remove: () => void } {
  const tmp = mkdtempSync(join(tmpdir(), 'rehearse-e2e-cli-'));
  const repo = join(tmp, name);
  git(tmp, 'init', '-q', repo);
  return { tmp, repo, remove: () => rmSync(tmp, { recursive: true, force: true }) };
}
