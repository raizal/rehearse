// The test brief of a story's approved scenarios (T47, box `test-brief`): Markdown a coding agent
// can write the missing e2e tests from on its own. Per scenario: the criterion it checks (given /
// when / then), its steps with the boxes they walk (path, title, inputs / outputs, error exits),
// the step examples and `expect`, where each expected result shows in the app, and the fixture to
// start from (T48, box `work-rules`). Then where the test goes and its exact name (the rule the
// Tests tab matches on, TEST_NAME_RULE), a spec to copy the style from, how to run it through
// Birdview, "write only tests", and how to work in a rehearse repo (`howToWorkMarkdown`). A draft
// or stale scenario is refused: the owner approves it first. Pure: the paths come in as options.

import { indexBoxes } from '../flow-index.js';
import type { AcceptanceCriterion, Box, EpicRecord, Hash, Id, Role, Scenario, ScenarioStep, Story } from '../types.js';
import { asArray, isObject } from '../util.js';
import { briefSignState } from './build-brief.js';
import { testCodeSection, type TestCodeOptions } from './code-start.js';
import { DEFAULT_COMMANDS, howToWorkMarkdown, type RepoCommands } from './how-to-work.js';
import { scenarioTrust } from './stale.js';

/** `code`, `codeUnavailable`, `cli` and `e2eHelpers`: the "Code you start from" section (T49). */
export interface TestBriefOptions extends TestCodeOptions {
  /** The e2e test project, relative to the repo root. Default `e2e`. */
  testProject?: string;
  /** The spec file the tests go in, relative to the repo root. Default `<testProject>/tests/<story>.spec.ts`. */
  specFile?: string;
  /** An existing spec, relative to the repo root, to copy the style from. */
  exampleSpec?: string;
  /** How the commands are written in the repo (`repoCommands`). Default `rehearse`, a pnpm workspace. */
  commands?: RepoCommands;
  /** The fixtures a test starts from: `ui` serves the app (UI scenarios), `cli` runs the CLI in a fresh repo. */
  fixtures?: { ui?: TestFixture; cli?: TestFixture };
}

/** A fixture file of the test project and what it exports. */
export interface TestFixture {
  /** Relative to the repo root, e.g. `e2e/tests/serve.ts`. */
  file: string;
  exports: string[];
}

/** What the brief says of an expected result no UI box shows. */
export const NOT_SHOWN = 'not shown in the UI, check the files';

export type TestBrief =
  | {
      ok: true;
      storyId: Id;
      scenarios: Id[];
      markdown: string;
      /** Story hash rule 2 of the content now. */
      hash: Hash;
      specFile: string;
    }
  | {
      ok: false;
      storyId: Id;
      reason: string;
      /** The scenarios that are not approved, and their status. */
      notApproved?: { id: Id; status: 'draft' | 'stale' }[];
    };

/**
 * How the Tests tab (and `rehearse playlists`, `buildPlaylist`) finds the test of a scenario. It
 * reads every `*.spec.ts` under the test project (not node_modules, dot folders, test-results or
 * playwright-report) and takes each line that starts with `test(` and a quoted title; the test
 * whose title is exactly the scenario id is the scenario's test.
 */
export const TEST_NAME_RULE =
  'The Tests tab finds a scenario\'s test in any `*.spec.ts` under the test project: a line that starts with `test(` and a quoted title (`test.describe` and `test.step` lines do not count), whose title is exactly the scenario id. Any other title leaves the row on "no test".';

/** The first line of a scenario's test, as the Tests tab matches it. */
export function testTitleLine(scenarioId: Id): string {
  return `test('${scenarioId}', async ({ page }) => {`;
}

/** What the Tests tab says on the row of a scenario that is not approved. */
export const APPROVE_FIRST = 'approve this scenario first';

const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
const MAX_JSON_CHARS = 400;

function compact(v: unknown): string {
  const text = JSON.stringify(v) ?? '';
  return text.length > MAX_JSON_CHARS ? `${text.slice(0, MAX_JSON_CHARS - 1)}…` : text;
}

/** `a: string, b: list X` */
function fields(map: unknown): string {
  return isObject(map) ? Object.entries(map).map(([k, v]) => `${k}: ${str(v)}`).join(', ') : '';
}

/** The story's scenarios with their trust, in record order. */
function storyScenarios(record: EpicRecord, storyId: Id): { s: Scenario; status: 'approved' | 'draft' | 'stale' }[] {
  return record.scenarioFiles.flatMap((f) =>
    asArray<Scenario>(f.scenarios)
      .filter((s) => isObject(s) && (s.story ?? f.story) === storyId)
      .map((s) => ({ s, status: scenarioTrust(s, f.file).status })),
  );
}

/** Each scenario of a story and its trust (approved, draft or stale), in record order. */
export function scenarioStatuses(record: EpicRecord, storyId: Id): { id: Id; status: 'approved' | 'draft' | 'stale' }[] {
  return storyScenarios(record, storyId).map((m) => ({ id: m.s.id, status: m.status }));
}

/** The test brief of some approved scenarios of a story, or why there is none. */
export function scenarioTestBrief(record: EpicRecord, storyId: Id, scenarioIds: Id[], opts: TestBriefOptions = {}): TestBrief {
  const story = asArray<Story>(record.prd?.stories).find((s) => isObject(s) && s.id === storyId);
  const sign = briefSignState(record, storyId);
  if (!story || !sign) return { ok: false, storyId, reason: `no story ${storyId} in prd.yaml` };
  if (scenarioIds.length === 0) return { ok: false, storyId, reason: `name at least one scenario of ${storyId}` };
  const mine = storyScenarios(record, storyId);
  const unknown = scenarioIds.filter((id) => !mine.some((m) => m.s.id === id));
  if (unknown.length > 0) return { ok: false, storyId, reason: `no scenario ${unknown.join(', ')} in story ${storyId}` };
  const picked = [...new Set(scenarioIds)].map((id) => mine.find((m) => m.s.id === id)!);
  const notApproved = picked.filter((m) => m.status !== 'approved').map((m) => ({ id: m.s.id, status: m.status as 'draft' | 'stale' }));
  if (notApproved.length > 0) {
    const list = notApproved.map((n) => `${n.id} (${n.status})`).join(', ');
    return { ok: false, storyId, reason: `${list}: ${APPROVE_FIRST}; an agent writes tests for approved scenarios only`, notApproved };
  }
  const testProject = (opts.testProject ?? 'e2e').replace(/\/+$/, '');
  const specFile = opts.specFile ?? `${testProject}/tests/${storyId}.spec.ts`;
  const ids = picked.map((m) => m.s.id);
  /** A box is described once, at its first step in the brief; later steps name it only. */
  const seen = new Set<string>();
  const cmds = opts.commands ?? DEFAULT_COMMANDS;
  const markdown = [
    header(record, story, ids),
    ...picked.map((m) => scenarioSection(record, story, m.s, seen, opts.fixtures ?? {})),
    testCodeSection(picked.map((m) => ({ id: m.s.id, boxes: scenarioBoxes(m.s) })), opts),
    whereSection(testProject, specFile, ids, opts.exampleSpec),
    fixtureSection(testProject, opts.fixtures ?? {}),
    runSection(cmds.cli, record.slug, storyId, testProject),
    rulesSection(cmds.cli, record.slug, storyId, ids),
    `## How to work in this repo\n\n${howToWorkMarkdown(cmds)}`,
  ]
    .filter((s) => s !== '')
    .join('\n\n');
  return { ok: true, storyId, scenarios: ids, markdown: `${markdown}\n`, hash: sign.currentHash, specFile };
}

/** The boxes a scenario walks, in step order, once each. */
export function scenarioBoxes(s: Scenario): string[] {
  return [...new Set(asArray<ScenarioStep>(s.steps).filter(isObject).map((st) => st.name))];
}

/** The boxes the given scenarios of a story walk, once each, start and end left out: what the test brief gathers code for. */
export function testBriefBoxPaths(record: EpicRecord, storyId: Id, scenarioIds: Id[]): string[] {
  const mine = storyScenarios(record, storyId);
  const index = indexBoxes(record.flow);
  const walked = scenarioIds.flatMap((id) => {
    const m = mine.find((x) => x.s.id === id);
    return m ? scenarioBoxes(m.s) : [];
  });
  return [...new Set(walked)].filter((b) => !['start', 'end'].includes(String(index.get(b)?.box.kind)));
}

function roleName(record: EpicRecord, id: string): string {
  const role = asArray<Role>(record.prd?.roles).find((r) => isObject(r) && r.id === id);
  return role && typeof role.name === 'string' ? role.name : id;
}

function header(record: EpicRecord, story: Story, ids: Id[]): string {
  return [
    `# Test brief: e2e tests for ${ids.join(', ')} (story ${story.id} of the EPIC ${record.slug})`,
    '',
    `Write one Playwright e2e test per scenario below. Each scenario is approved by the owner: the test proves the app does what it says.`,
    '',
    `Story: as ${roleName(record, story.role)}, I want ${oneLine(str(story.want))}, so that ${oneLine(str(story.soThat))}.`,
    `Record: \`docs/epics/${record.slug}/\` (prd.yaml, flow.yaml, scenarios/${story.id}.yaml).`,
  ].join('\n');
}

function boxLine(path: string, box: Box | undefined): string[] {
  if (!box) return [`  - box \`${path}\` (not in flow.yaml)`];
  const lines = [`  - box \`${path}\`: ${oneLine(str(box.title))}`];
  const add = (label: string, value: string) => {
    if (value !== '') lines.push(`    - ${label}: ${value}`);
  };
  add('inputs', fields(box.inputs));
  add('outputs', fields(box.outputs));
  add('error exits', asArray<string>(box.errorExits).join(', '));
  return lines;
}

/**
 * Where an expected result shows in the app: the UI boxes (package `ui`) that read the entity
 * field (`Entity.field`, or `Entity.*`), or that take or give a field of that name.
 */
export function whereShown(boxes: readonly Box[], key: string): string {
  const dot = key.indexOf('.');
  const entity = dot > 0 ? key.slice(0, dot) : undefined;
  const field = dot > 0 ? key.slice(dot + 1) : key;
  const shows = boxes.filter((b) => {
    if (b.package !== 'ui') return false;
    if (entity) return asArray<string>(b.reads).some((r) => r === key || r === `${entity}.*`);
    return (isObject(b.outputs) && field in b.outputs) || (isObject(b.inputs) && field in b.inputs);
  });
  return shows.length > 0 ? `shows in ${shows.map((b) => `${oneLine(str(b.title))} (\`${b.path}\`)`).join(', ')}` : NOT_SHOWN;
}

/** A scenario that walks a UI box is tested in the app; any other through the CLI. */
export function isUiScenario(record: EpicRecord, s: Scenario): boolean {
  const index = indexBoxes(record.flow);
  return asArray<ScenarioStep>(s.steps).some((st) => isObject(st) && index.get(st.name)?.box.package === 'ui');
}

/** The fixture a scenario starts from, by name; `fixtureSection` says what each one does. */
function fixtureLine(ui: boolean, fixtures: { ui?: TestFixture; cli?: TestFixture }): string {
  const f = ui ? fixtures.ui : fixtures.cli;
  return `Start from: ${ui ? 'a UI scenario (it walks a box of the app)' : 'a CLI scenario (no box of the app)'}, ${f ? `\`${f.file}\`` : 'no fixture yet: copy the setup of an existing spec'}.`;
}

function fixtureSection(testProject: string, fixtures: { ui?: TestFixture; cli?: TestFixture }): string {
  const line = (f: TestFixture | undefined, kind: string, what: string) =>
    f ? `- ${kind}: \`${f.file}\` (${f.exports.map((e) => `\`${e}\``).join(', ')}) ${what}.` : `- ${kind}: no fixture in \`${testProject}/tests/\` ${what}; copy the setup of an existing spec.`;
  return [
    '## Fixtures to start from',
    '',
    line(fixtures.ui, 'UI scenario', 'serves the app on a copy of a record'),
    line(fixtures.cli, 'CLI scenario', 'makes a fresh git repo and runs the CLI in it'),
  ].join('\n');
}

function scenarioSection(record: EpicRecord, story: Story, s: Scenario, seen: Set<string>, fixtures: { ui?: TestFixture; cli?: TestFixture }): string {
  const index = indexBoxes(record.flow);
  const criterion = s.expect?.criterion ? asArray<AcceptanceCriterion>(story.acceptance).find((c) => isObject(c) && c.id === s.expect!.criterion) : undefined;
  const lines = [`## ${s.id}: ${oneLine(str(s.title))}`, ''];
  if (criterion) lines.push(`Checks ${criterion.id}: given ${oneLine(str(criterion.given))}; when ${oneLine(str(criterion.when))}; then ${oneLine(str(criterion.then))}.`, '');
  lines.push('Steps (one `test.step` each, its title starts with the box path; a box is described at its first step in this brief):');
  asArray<ScenarioStep>(s.steps).forEach((st, i) => {
    if (!isObject(st)) return;
    lines.push(`${i + 1}. \`${st.name}\`${st.branch ? ` taking "${st.branch}"` : ''}`);
    if (isObject(st.example)) {
      const ex = st.example;
      lines.push(`  - example: given ${compact(ex.given ?? {})} → then ${compact(ex.then ?? {})}${ex.stateAfter ? `; state after ${compact(ex.stateAfter)}` : ''}`);
    }
    if (!seen.has(st.name)) {
      seen.add(st.name);
      lines.push(...boxLine(st.name, index.get(st.name)?.box));
    }
  });
  if (isObject(s.expect)) lines.push('', `Expect (what the test checks at the end): ${compact(s.expect.state ?? {})}`);
  const expected = isObject(s.expect) && isObject(s.expect.state) ? Object.keys(s.expect.state) : [];
  if (expected.length > 0) {
    const boxes = [...index.values()].map((e) => e.box);
    const byPlace = new Map<string, string[]>();
    for (const k of expected) byPlace.set(whereShown(boxes, k), [...(byPlace.get(whereShown(boxes, k)) ?? []), k]);
    lines.push('', 'Where each expected result shows:', ...[...byPlace].map(([place, keys]) => `- ${keys.map((k) => `\`${k}\``).join(', ')}: ${place}`));
  }
  lines.push('', fixtureLine(isUiScenario(record, s), fixtures));
  return lines.join('\n');
}

function whereSection(testProject: string, specFile: string, ids: Id[], example: string | undefined): string {
  const first = ids[0]!;
  return [
    '## Where the test goes and its name',
    '',
    `- File: \`${specFile}\` (add to it when it exists). The test project is \`${testProject}/\`.`,
    `- Name: the scenario id, exactly: ${ids.map((id) => `\`${id}\``).join(', ')}. The first line of the test is \`${testTitleLine(first)}\`.`,
    `- ${TEST_NAME_RULE}`,
    `- Steps: \`await test.step('<box path>: <what happens>', async () => { … })\`, one per step above, in order. Birdview maps each step to its box by the text before the first ": ".`,
    example ? `- Copy the style (imports, fixtures, selectors by test id) from \`${example}\`.` : `- No spec exists yet in \`${testProject}/\`: start from the Playwright config there.`,
    '- When the file lands, the Tests tab shows the row as "test written, not run yet" instead of "no test".',
  ].join('\n');
}

function runSection(cli: string, slug: string, storyId: Id, testProject: string): string {
  return [
    '## How to run it',
    '',
    `- \`${cli} play ${slug} ${storyId} --test <file:line> --wait\` plays one test in Birdview, where the owner watches it, waits for it and prints passed or failed (exit 0 or 1). The key is the file relative to \`${testProject}/\` and the line of \`test(\`, e.g. \`tests/${storyId}.spec.ts:12\`.`,
    `- \`${cli} playlists ${slug} --tests ${testProject}\` writes the story playlists again; the ${storyId} playlist then lists the new tests.`,
    '- Birdview runs the browser outside the sandbox: do not try to start Chromium or `playwright test` in the sandbox.',
  ].join('\n');
}

function rulesSection(cli: string, slug: string, storyId: Id, ids: Id[]): string {
  return [
    '## Rules for this thread',
    '',
    '- Write only tests: do not change app code. If the app cannot do what a scenario says, stop and say so in the thread: which scenario, which step, what the app does instead.',
    '- Do not change a scenario to fit the app. A scenario that looks wrong is for the owner: say so in the thread.',
    '- A test builds no box: its commits carry no `Flow-Box:` trailer (the line on trailers below is for build threads), so rehearse does not count a box as built by them.',
    `- Re-read this brief with \`${cli} brief ${slug} ${storyId} --tests ${ids.map((id) => `--scenario ${id}`).join(' ')}\`.`,
    '- Run each test through Birdview before you say done, and report per scenario: written, run, passed or failed (and where).',
  ].join('\n');
}
