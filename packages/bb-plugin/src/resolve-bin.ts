// Which `rehearse` to run for a checkout. The repo's own install wins over PATH, so
// the panel and the CLI use the same version as the repo's CI.

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export interface Invocation {
  command: string;
  /** Arguments before the rehearse arguments (the script path when the command is node). */
  prefix: string[];
}

/**
 * Order: the configured command (setting `rehearseCommand`), then
 * `node_modules/.bin/rehearse` or `packages/cli/bin/rehearse.js` in `cwd` or a
 * parent folder, then `rehearse` on PATH.
 */
export function resolveRehearse(cwd: string, configured: string, exists: (path: string) => boolean = existsSync): Invocation {
  const setting = configured.trim();
  if (setting !== '') {
    const path = isAbsolute(setting) ? setting : resolve(cwd, setting);
    if (setting.endsWith('.js') || setting.endsWith('.mjs')) return { command: 'node', prefix: [path] };
    return { command: setting.includes('/') ? path : setting, prefix: [] };
  }
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const bin = join(dir, 'node_modules', '.bin', 'rehearse');
    if (exists(bin)) return { command: bin, prefix: [] };
    const script = join(dir, 'packages', 'cli', 'bin', 'rehearse.js');
    if (exists(script)) return { command: 'node', prefix: [script] };
    if (dirname(dir) === dir) break;
  }
  return { command: 'rehearse', prefix: [] };
}
