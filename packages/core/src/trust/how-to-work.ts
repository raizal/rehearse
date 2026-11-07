// How an agent works on a story in a rehearse repo (T44). One text, from one place: the build
// brief ends with it, and the bb plugin skill (`packages/bb-plugin/skills/rehearse/SKILL.md`,
// section "Working on a story") holds the same lines; a test checks that the two agree.

/** The rules, one bullet each, in Markdown. */
export const HOW_TO_WORK: readonly string[] = [
  'Every commit carries a `Flow-Box: <box path>` trailer for each box it builds: that is how rehearse links code to the plan. Add the `Co-Authored-By` line your own rules ask for.',
  'Read code with `rehearse find|show|near|context`; check unit test coverage with `rehearse coverage`.',
  'Re-read the plan any time with `rehearse brief <epic> <story>`; see what rehearse sees of your work with `rehearse progress <epic> <story>`.',
  'Before you say done: `rehearse validate`, `rehearse simulate` and `rehearse gate check` on the EPIC, the repo\'s tests, and one e2e test per approved scenario, named after the scenario id.',
  'Never approve a scenario or sign off a story. No command does it; only the owner, in the rehearse UI.',
  'Do not edit the record (`docs/epics/…`) without asking in the thread first: a change to a story, its scenarios or its boxes makes the owner\'s approvals and sign-off stale. If the plan is wrong, say so and propose the change. Something found after the build goes in `corrections.md`.',
  'Report in the thread in plain words: what is done per box, what is not, and the test results.',
];

/** The section as the brief and the skill print it. */
export function howToWorkMarkdown(): string {
  return HOW_TO_WORK.map((line) => `- ${line}`).join('\n');
}
