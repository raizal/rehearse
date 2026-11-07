// `rehearse progress <epic-dir-or-slug> <story> [--json]` (T44, box watch-build): what rehearse
// sees of the work on a story, the same as the progress block of the UI. Per box, built or not yet
// from Flow-Box commits on every branch; per approved scenario, its e2e test; the gate findings of
// the story and the sign-off; and the thread working on it, if one is linked. Read-only.

import { findTestProject, processRunner, createStoryThreads, progressText, StoryThreadError, type Runner } from '@rehearse/server';
import { EXIT, resolveEpicDir, USAGE, type Io } from '../index.js';

export async function runProgress(args: string[], io: Io, run: Runner = processRunner()): Promise<number> {
  const json = args.includes('--json');
  const unknown = args.filter((a) => a.startsWith('-') && a !== '--json');
  const positional = args.filter((a) => !a.startsWith('-'));
  if (unknown.length > 0 || positional.length !== 2) {
    io.stderr(`rehearse progress: expected <epic-dir-or-slug> <story> [--json]\n\n${USAGE}`);
    return EXIT.usage;
  }
  const [epic, storyId] = positional as [string, string];
  const dir = resolveEpicDir(epic, io.cwd);
  if (!dir) {
    io.stderr(`rehearse progress: no EPIC folder ${epic} (not a folder, and not found as docs/epics/${epic})\n`);
    return EXIT.usage;
  }
  try {
    const testProject = findTestProject(dir);
    const threads = createStoryThreads({ epicDir: dir, run, ...(testProject ? { testProject } : {}) });
    const progress = await threads.progress(storyId);
    io.stdout(json ? JSON.stringify(progress, null, 2) + '\n' : progressText(progress));
    return EXIT.ok;
  } catch (e) {
    if (e instanceof StoryThreadError) {
      io.stderr(`rehearse progress: ${e.message}\n`);
      return e.status === 400 ? EXIT.usage : e.status === 404 ? EXIT.findings : EXIT.internal;
    }
    io.stderr(`rehearse progress: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.internal;
  }
}
