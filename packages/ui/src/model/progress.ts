// The words of the progress block and the Stories overview (T44, box watch-build). Pure: the
// component and the tests share them.

import type { StoryProgress } from '@rehearse/server';

type Box = StoryProgress['boxes'][number];
type Scenario = StoryProgress['scenarios'][number];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "built · 3 commits, 2 on the thread's branch", "no code of its own" or "not built" (T58). */
export function boxProgressText(b: Box, threadBranch: string | null): string {
  if (b.state === 'no-code') return 'no code of its own';
  if (b.state === 'not-built') return 'not built';
  const on = threadBranch ? `, ${b.onThreadBranch} on ${threadBranch}` : '';
  return b.commits > 0 ? `built · ${plural(b.commits, 'commit')}${on}` : 'built · code the code graph maps to it';
}

/** The evidence of a box, or what was looked for, in plain words (T58, box box-evidence). */
export function boxEvidenceText(b: Box): string {
  return b.evidence.text;
}

/** The e2e state of a scenario in words: "not run yet" is said as it is. */
export function scenarioStateText(s: Scenario): string {
  if (s.state === 'missing') return 'no e2e test yet';
  if (s.state === 'not-run') return 'test found, not run yet';
  if (s.state === 'passing') return 'passing';
  return s.failedStep ? `failing at ${s.failedStep}` : 'failing';
}

/** "Signed off, the sign-off holds" / "Signed off, but the story changed since" / "Not signed off". */
export function signOffText(p: StoryProgress): string {
  if (p.signOff.status === 'signed') return p.signOff.valid ? 'Signed off, the sign-off holds' : 'Signed off, but the signature does not check';
  if (p.signOff.status === 'stale') return 'Signed off, but the story changed since';
  return 'Not signed off';
}

/** The Stories overview cell: "1/2 boxes · 0/2 tested". */
export function overviewText(p: StoryProgress): string {
  const c = p.counts;
  return `${c.boxesWithCode}/${c.boxes} ${c.boxes === 1 ? 'box' : 'boxes'} · ${c.scenariosTested}/${c.scenarios} tested`;
}

/** The thread word of the overview: its status, or nothing without a thread. */
export function overviewThread(p: StoryProgress): string | undefined {
  if (!p.thread) return undefined;
  return p.thread.status === null ? 'thread' : `thread ${p.thread.statusText}`;
}
