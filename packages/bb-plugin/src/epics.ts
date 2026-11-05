// The EPIC folders of a repo, for the panel's picker: docs/epics/<slug>/.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isSlug } from './cli-args.js';

export function listEpics(repoPath: string): string[] {
  try {
    return readdirSync(join(repoPath, 'docs', 'epics'), { withFileTypes: true })
      .filter((d) => d.isDirectory() && isSlug(d.name))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}
