// The small change type (T62): a file `changes/C<n>.yaml` adds to one story. It has a
// one-sentence title, 1 to 3 new criteria, 5 scenarios or fewer, and new boxes (root only) with
// new edges. It cannot edit an existing story, criterion, scenario or box. The loader merges a
// change into the loaded record, and marks each merged item with `change: <id>`.

import type { AcceptanceCriterion, Box, Edge, Id, Scenario } from '../types.js';

/** The folder of the change files, relative to the EPIC folder. */
export const CHANGES_DIR = 'changes';
/** The most scenarios a change can have. */
export const MAX_CHANGE_SCENARIOS = 5;
/** The most criteria a change can have. */
export const MAX_CHANGE_CRITERIA = 3;
/** Above this number of scenarios with its changes, validate tells the owner to think about a new story. */
export const STORY_SCENARIO_NOTE = 8;

/** The content of one change file, as it is written. */
export interface ChangeDoc {
  /** `C1`, `C2`, … The file name is `<id>.yaml`. */
  id: Id;
  /** The story the change adds to. */
  story: Id;
  /** One sentence. */
  title: string;
  why: string;
  criteria: AcceptanceCriterion[];
  /** Without the loader-added `story` and `change`. */
  scenarios: Omit<Scenario, 'story'>[];
  /** New root boxes. A missing `stories` means the change's story. */
  boxes?: Omit<Box, 'path'>[];
  /** New root edges. Each one has a new box of this change at one end. */
  edges?: Edge[];
}

/** One change file of a loaded record. */
export interface LoadedChange {
  /** Path relative to the EPIC folder, e.g. `changes/C1.yaml`. */
  file: string;
  doc: ChangeDoc;
}
