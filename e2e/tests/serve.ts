// A test fixture: `rehearse serve` on a fresh copy of the shop fixture in a temp folder. The
// server stops after the test.

import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base } from '@playwright/test';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SHOP = join(REPO, 'packages/core/test/fixtures/shop');
export const CLI = join(REPO, 'packages/cli/bin/rehearse.js');

/** Start the server and wait for the URL it prints. */
export function serve(epicDir: string): Promise<{ child: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, 'serve', epicDir, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`rehearse serve printed no URL in 15 s:\n${out}${err}`));
    }, 15_000);
    child.stdout!.on('data', (c: Buffer) => {
      out += c.toString();
      const m = /http:\/\/127\.0\.0\.1:\d+\/\S*/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve({ child, url: m[0] });
      }
    });
    child.stderr!.on('data', (c: Buffer) => (err += c.toString()));
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`rehearse serve exited with ${code}:\n${out}${err}`));
    });
  });
}

export function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((done) => {
    const force = setTimeout(() => child.kill('SIGKILL'), 3_000);
    child.once('exit', () => {
      clearTimeout(force);
      done();
    });
    child.kill('SIGTERM');
  });
}

export const test = base.extend<{ shopUrl: string }>({
  shopUrl: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'rehearse-e2e-'));
    const epicDir = join(dir, 'shop');
    cpSync(SHOP, epicDir, { recursive: true });
    const { child, url } = await serve(epicDir);
    try {
      await use(url);
    } finally {
      await stop(child);
      rmSync(dir, { recursive: true, force: true });
    }
  },
});

export { expect } from '@playwright/test';
