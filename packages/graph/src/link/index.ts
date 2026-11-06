// Box `update-graph/link` (G4, G13, G17, G18, G23, G25, G30): the linkers that add nodes and edges
// from outside the code readers. The order matters: the record linker makes the box nodes that the
// git linker's `builds` edges start from.
//
// What each one runs again on an update (see each file):
//   record  only when a record file changed (docs/epics/*/prd.yaml, flow.yaml, scenarios/*.yaml)
//   git     git log of the new commits and git blame of the changed files a trailer commit touched;
//           maps the blamed lines to nodes on every update
//   tests   on every update that read a file (it reads only the graph)
//   http    parses the changed TypeScript files; matches every client call on every update

import type { Linker } from '../extend.js';
import { gitLinker, type GitRunner } from './git.js';
import { httpLinker } from './http.js';
import { recordLinker } from './record.js';
import { testsLinker } from './tests.js';

export interface LinkerOptions {
  /** Runs git; tests pass a fake. */
  git?: GitRunner;
}

export function defaultLinkers(opts: LinkerOptions = {}): Linker[] {
  return [recordLinker(), gitLinker(opts.git ? { run: opts.git } : {}), testsLinker(), httpLinker()];
}

export { recordLinker, readRecord, recordId, EPICS_DIR } from './record.js';
export { gitLinker, execGit, parseBlame, parseTrailerLog, trailerCommits, commitId, gitBoxId, type GitRunner, type GitResult, type TrailerCommit } from './git.js';
export { testsLinker, VITEST, PYTEST, type TestAdapter } from './tests.js';
export { httpLinker, clientCalls, clientPath, type ClientCall } from './http.js';
