import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));

/** A copy of one fixture repo (`shop`, `monorepo`) in a new temporary folder. */
export function copyFixture(name: string): string {
  const root = join(mkdtempSync(join(tmpdir(), 'rehearse-graph-')), name);
  cpSync(join(FIXTURES, name), root, { recursive: true });
  return root;
}

/** Every file below root but the store (.rehearse/), with its content: to check a query changed nothing. */
export function snapshot(root: string, dir = root, out = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (abs === join(root, '.rehearse')) continue;
    if (statSync(abs).isDirectory()) snapshot(root, abs, out);
    else out.set(abs.slice(root.length + 1), readFileSync(abs, 'utf8'));
  }
  return out;
}
