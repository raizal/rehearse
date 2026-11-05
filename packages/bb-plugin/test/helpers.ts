import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Invocation } from '../src/resolve-bin.js';

export const FAKE_REHEARSE = fileURLToPath(new URL('./fixtures/fake-rehearse.mjs', import.meta.url));
export const fakeInvocation: Invocation = { command: process.execPath, prefix: [FAKE_REHEARSE] };

/** A temp repo with docs/epics/<slug>/ for each slug. */
export function tempRepo(...slugs: string[]): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'bb-rehearse-')));
  for (const slug of slugs) mkdirSync(join(repo, 'docs', 'epics', slug), { recursive: true });
  return repo;
}

/** True while something accepts connections on 127.0.0.1:port. */
export async function listening(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

export async function until(check: () => Promise<boolean> | boolean, timeoutMs = 8000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}
