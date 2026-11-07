// `rehearse change new <epic-dir-or-slug> <story> --title "<title>"`: box `change-new` (T62).
// It writes the start file of a small change, `changes/C<n>.yaml`, in the EPIC folder.
// An agent or the planner then writes the change. Only the owner approves and signs off.

import { relative } from 'node:path';
import { newChange } from '@rehearse/core';
import { EXIT, resolveEpicDir, USAGE, type Io } from '../index.js';

export function runChange(args: string[], io: Io): number {
  const [sub, ...rest] = args;
  if (sub !== 'new') return usage(io, sub === undefined ? 'expected the subcommand new' : `unknown subcommand ${sub}`);
  const positional: string[] = [];
  let title: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--title') {
      title = rest[++i];
      if (title === undefined) return usage(io, '--title needs a value');
    } else if (a.startsWith('--title=')) {
      title = a.slice('--title='.length);
    } else if (a.startsWith('-')) {
      return usage(io, `unknown option ${a}`);
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 2) return usage(io, 'expected <epic-dir-or-slug> <story>');
  if (title === undefined || title.trim() === '') return usage(io, 'expected --title "<title>"');
  const [epic, story] = positional as [string, string];
  const dir = resolveEpicDir(epic, io.cwd);
  if (!dir) {
    io.stderr(`rehearse change new: no EPIC folder ${epic} (not a folder, and not found as docs/epics/${epic})\n`);
    return EXIT.usage;
  }
  let res;
  try {
    res = newChange(dir, story, title);
  } catch (e) {
    io.stderr(`rehearse change new: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.internal;
  }
  if (!res.ok) {
    io.stderr(`rehearse change new: ${res.exit}: ${res.message}\n`);
    return EXIT.findings;
  }
  io.stdout(
    `Created ${relative(io.cwd, res.path) || res.path} (change ${res.id} to story ${story}).\n` +
      `Write 1 to 3 criteria and 5 scenarios or fewer. Then run: rehearse validate ${epic}\n` +
      `The owner approves the new scenarios and signs off the story again.\n`,
  );
  return EXIT.ok;
}

function usage(io: Io, why: string): number {
  io.stderr(`rehearse change: ${why}: rehearse change new <epic-dir-or-slug> <story> --title "<title>"\n\n${USAGE}`);
  return EXIT.usage;
}
