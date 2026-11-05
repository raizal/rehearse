// `rehearse new <slug> --title "<title>"`: box `new-epic` (R1, S1).
// The EPIC goes in docs/epics/<slug>/ below the git top-level of cwd, or below cwd without git.

import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';
import { createEpic } from '@rehearse/core';
import { EXIT, USAGE, type Io } from '../index.js';

/** The git top-level of `cwd`, or `cwd` when it is not in a git work tree (or git is missing). */
export function repoRoot(cwd: string): string {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const top = out.trim();
    return top === '' ? cwd : top;
  } catch {
    return cwd;
  }
}

export function runNew(args: string[], io: Io): number {
  const positional: string[] = [];
  let title: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--title') {
      title = args[++i];
      if (title === undefined) return usage(io, '--title needs a value');
    } else if (a.startsWith('--title=')) {
      title = a.slice('--title='.length);
    } else if (a.startsWith('-')) {
      return usage(io, `unknown option ${a}`);
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) return usage(io, 'expected one <slug>');
  if (title === undefined || title.trim() === '') return usage(io, 'expected --title "<title>"');

  const root = repoRoot(io.cwd);
  let res;
  try {
    res = createEpic(root, positional[0]!, title);
  } catch (e) {
    io.stderr(`rehearse new: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.internal;
  }
  if (!res.ok) {
    io.stderr(`rehearse new: ${res.exit}: ${res.message}\n`);
    return res.exit === 'bad-slug' ? EXIT.usage : EXIT.findings;
  }
  io.stdout(`Created ${relative(root, res.epicDir)}\n`);
  return EXIT.ok;
}

function usage(io: Io, why: string): number {
  io.stderr(`rehearse new: ${why}: rehearse new <slug> --title "<title>"\n\n${USAGE}`);
  return EXIT.usage;
}
