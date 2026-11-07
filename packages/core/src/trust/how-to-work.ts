// How an agent works on a story in a rehearse repo (T44, T48 box `work-rules`). One text, from one
// place: the build brief and the test brief end with it, and the bb plugin skill
// (`packages/bb-plugin/skills/rehearse/SKILL.md`, section "Working on a story") holds the same
// lines in their default form; a test checks that the two agree. Each command is written as it
// runs in the repo: `repoCommands` finds the rehearse command and the setup line.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** How the commands of the text are written in one repo. */
export interface RepoCommands {
  /** The rehearse command: `rehearse`, or `pnpm rehearse` in a repo whose package.json has a `rehearse` script. */
  cli: string;
  /** Install and build, e.g. `pnpm install --frozen-lockfile && pnpm -r build`; none when the repo does not say. */
  setup?: string;
}

/** The setup of a pnpm workspace. */
export const PNPM_SETUP = 'pnpm install --frozen-lockfile && pnpm -r build';

/** The form the skill prints. */
export const DEFAULT_COMMANDS: RepoCommands = { cli: 'rehearse', setup: PNPM_SETUP };

/** The rules, one bullet each, in Markdown, with the commands written as they run in the repo. */
export function howToWorkLines(cmds: RepoCommands = DEFAULT_COMMANDS): string[] {
  const c = cmds.cli;
  return [
    "Commit on your thread's branch. Do not merge, push or rebase onto main yourself, and never turn the sandbox off. When done, say so in the thread: the owner merges from rehearse.",
    cmds.setup
      ? `Set up first: \`${cmds.setup}\` (the install needs network: if the sandbox blocks it, say so in the thread).`
      : 'Set up first: install and build the repo as its README says (the install needs network: if the sandbox blocks it, say so in the thread).',
    'Every commit carries a `Flow-Box: <box path>` trailer for each box it builds: that is how rehearse links code to the plan. Add the `Co-Authored-By` line your own rules ask for.',
    `Start from the section *Code you start from*; use \`${c} context <box path>\` before reading files by hand, \`${c} find|show|near\` for the rest, \`${c} coverage\` for unit test coverage.`,
    `Re-read the plan any time with \`${c} brief <epic> <story>\`; see what rehearse sees of your work with \`${c} progress <epic> <story>\`.`,
    `Run e2e tests through Birdview: \`${c} play <epic> <story> --test <file:line> --wait\` plays one, waits for it and exits 0 when it passed, 1 when it failed or timed out. Do not try to start Chromium in the sandbox.`,
    `Before you say done: \`${c} validate <epic>\`, \`${c} simulate <epic>\` and \`${c} gate check <epic>\`, the repo's tests, and one e2e test per approved scenario, named after the scenario id.`,
    'Never approve a scenario or sign off a story. No command does it; only the owner, in the rehearse UI.',
    'Never merge your branch: no command does it. Only the owner merges, with "Merge into <branch>" in the rehearse UI; an agent never calls `POST /api/thread/merge`.',
    'Do not edit the record (`docs/epics/…`) without asking in the thread first: a change to a story, its scenarios or its boxes makes the owner\'s approvals and sign-off stale. If the plan is wrong, say so and propose the change. Something found after the build goes in `corrections.md`.',
    'Report in the thread in plain words: what is done per box, what is not, and the test results. Then stop: the owner merges.',
  ];
}

/** The rules in their default form (`rehearse`, a pnpm workspace), as the skill holds them. */
export const HOW_TO_WORK: readonly string[] = howToWorkLines();

/** The section as the brief and the skill print it. */
export function howToWorkMarkdown(cmds: RepoCommands = DEFAULT_COMMANDS): string {
  return howToWorkLines(cmds).map((line) => `- ${line}`).join('\n');
}

/**
 * How the commands are written in the repo at `top`: `pnpm rehearse` when its package.json has a
 * `rehearse` script (the command is not on PATH there), else `rehearse`; the pnpm setup when it
 * has a pnpm-lock.yaml.
 */
export function repoCommands(top: string): RepoCommands {
  let scripts: Record<string, unknown> = {};
  try {
    const pkg = JSON.parse(readFileSync(join(top, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> };
    scripts = pkg.scripts ?? {};
  } catch {
    scripts = {};
  }
  return {
    cli: typeof scripts.rehearse === 'string' ? 'pnpm rehearse' : 'rehearse',
    ...(existsSync(join(top, 'pnpm-lock.yaml')) ? { setup: PNPM_SETUP } : {}),
  };
}
