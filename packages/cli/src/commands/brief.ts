// `rehearse brief <epic-dir-or-slug> <story> [--allow-unsigned] [--json]` (T44, box build-brief):
// the build brief a thread gets for a signed story. It refuses an unsigned or stale story (exit 1)
// unless --allow-unsigned, which says so on top of the brief.

import { decisionTexts, loadEpic, storyBuildBrief } from '@rehearse/core';
import { EXIT, resolveEpicDir, USAGE, type Io } from '../index.js';

const OPTIONS = ['--json', '--allow-unsigned'];

export function runBrief(args: string[], io: Io): number {
  const json = args.includes('--json');
  const allowUnsigned = args.includes('--allow-unsigned');
  const unknown = args.filter((a) => a.startsWith('-') && !OPTIONS.includes(a));
  const positional = args.filter((a) => !a.startsWith('-'));
  if (unknown.length > 0 || positional.length !== 2) {
    io.stderr(`rehearse brief: expected <epic-dir-or-slug> <story> [--allow-unsigned] [--json]\n\n${USAGE}`);
    return EXIT.usage;
  }
  const [epic, storyId] = positional as [string, string];
  const dir = resolveEpicDir(epic, io.cwd);
  if (!dir) {
    io.stderr(`rehearse brief: no EPIC folder ${epic} (not a folder, and not found as docs/epics/${epic})\n`);
    return EXIT.usage;
  }
  let made;
  try {
    made = storyBuildBrief(loadEpic(dir).record, storyId, { allowUnsigned, decisions: decisionTexts(dir) });
  } catch (e) {
    io.stderr(`rehearse brief: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.internal;
  }
  if (!made.ok) {
    if (json) io.stdout(JSON.stringify({ ok: false, storyId, reason: made.reason, ...(made.sign ? { sign: made.sign } : {}) }, null, 2) + '\n');
    else io.stderr(`rehearse brief: ${made.reason}\n`);
    return EXIT.findings;
  }
  if (json) io.stdout(JSON.stringify({ ok: true, storyId, hash: made.hash, sign: made.sign, markdown: made.markdown }, null, 2) + '\n');
  else io.stdout(made.markdown.endsWith('\n') ? made.markdown : `${made.markdown}\n`);
  return EXIT.ok;
}
