// Which bb project a new story thread goes into (T46). `bb thread spawn` outside a bb thread cannot
// guess the project, so serve must pass `--project`. In order:
//   1. the `bbProject` option of serve;
//   2. REHEARSE_BB_PROJECT (the bb panel sets it for the serve it starts), then BB_PROJECT_ID (a bb thread);
//   3. `bb project list --json`: the one project with a `local_path` source at the repo root, or at
//      the main checkout when the repo is a git worktree;
//   4. none: the spawn is refused with NO_BB_PROJECT, in plain words.
// Step 3 runs once, lazily, at the first spawn.

import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Runner } from './story-thread.js';

export const NO_BB_PROJECT =
  'rehearse could not tell which bb project this repo is in. Open rehearse from the bb panel, or start serve with REHEARSE_BB_PROJECT=<id>.';

/** Steps 1 and 2: the option, else the environment. */
export function bbProjectFrom(option: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  return option || env.REHEARSE_BB_PROJECT || env.BB_PROJECT_ID || undefined;
}

export interface BbProjectEntry {
  id: string;
  /** Paths of its `local_path` sources. */
  paths: string[];
}

/** `bb project list --json` → projects and their local paths. Broken output is no projects. */
export function parseProjectList(text: string): BbProjectEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: BbProjectEntry[] = [];
  for (const p of parsed as Array<{ id?: unknown; sources?: unknown }>) {
    if (!p || typeof p.id !== 'string' || !Array.isArray(p.sources)) continue;
    const paths = (p.sources as Array<{ type?: unknown; path?: unknown }>)
      .filter((s) => s?.type === 'local_path' && typeof s.path === 'string' && s.path !== '')
      .map((s) => s.path as string);
    out.push({ id: p.id, paths });
  }
  return out;
}

/** The one project with a local path among `roots`; null for none or several. */
export function matchProject(projects: BbProjectEntry[], roots: string[]): string | null {
  const wanted = new Set(roots.map(samePath));
  const ids = new Set(projects.filter((p) => p.paths.some((path) => wanted.has(samePath(path)))).map((p) => p.id));
  return ids.size === 1 ? [...ids][0]! : null;
}

/** Step 3: the repo root (and the main checkout of a worktree) against `bb project list`. */
export async function findBbProject(run: Runner, cwd: string): Promise<string | null> {
  const top = await run('git', ['rev-parse', '--show-toplevel'], { cwd });
  if (top.code !== 0 || top.stdout.trim() === '') return null;
  const roots = [top.stdout.trim()];
  const common = await run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd });
  if (common.code === 0 && common.stdout.trim() !== '') roots.push(dirname(common.stdout.trim()));
  const list = await run('bb', ['project', 'list', '--json'], { cwd });
  if (list.code !== 0 || list.spawnError !== undefined) return null;
  return matchProject(parseProjectList(list.stdout), roots);
}

/** The project for spawns: the given one, else step 3 run once at the first call. */
export function bbProjectResolver(given: string | undefined, find: () => Promise<string | null>): () => Promise<string | null> {
  if (given) return () => Promise.resolve(given);
  let found: Promise<string | null> | undefined;
  return () => (found ??= find().catch(() => null));
}

/** Absolute, without a trailing slash, symlinks resolved when the path exists. */
function samePath(path: string): string {
  const abs = resolve(path);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}
