// The start file of a story's e2e tests (T61, box `e2e-start`), as `rehearse e2e-start` writes it.
// One `test('<scenario id>: <title>')` for each approved scenario, one `test.step('<box path>: <box
// title>')` for each step, with the step example and the expected result as comments. Each step
// body throws "not written: …", so a test never passes before a person or an agent writes it.
// `mainPath` keeps only the story's main path scenario: the owner's pick in review.yaml, else the
// story map rule. A file that exists is never written again: `append` adds the tests of the
// scenarios it does not have yet, after its own text, and changes none of its tests.
// Pure: the record, the options and the text of the file now in; the text to write out.

import { dirname, posix, relative, sep } from 'node:path';
import { indexBoxes } from '../flow-index.js';
import type { AcceptanceCriterion, EpicRecord, Id, Scenario, ScenarioStep, Story } from '../types.js';
import { asArray, isObject } from '../util.js';
import { scenarioTrust } from './stale.js';
import { isUiScenario, mainPathScenario, type TestFixture } from './test-brief.js';

export interface E2eStartOptions {
  /** Only these scenarios (`--scenario`, more than one allowed). */
  scenarios?: Id[];
  /** Only the story's main path scenario (`--main-path`). */
  mainPath?: boolean;
  /** The owner's main path pick for the story (review.yaml `mainPath`). */
  mainPathPick?: Id;
  /** The spec file, relative to the repo root, e.g. `e2e/tests/S10.spec.ts`. */
  specFile: string;
  /** The text of the spec file when it exists. */
  existing?: string;
  /** Add the missing tests to the file that exists (`--append`). */
  append?: boolean;
  /** The fixtures of the test project, to import from: `ui` serves the app, `cli` runs the CLI. */
  fixtures?: { ui?: TestFixture; cli?: TestFixture };
}

export type E2eStartError = 'no-story' | 'no-scenario' | 'not-approved' | 'none-approved' | 'exists' | 'nothing-new';

export type E2eStart =
  | {
      ok: true;
      storyId: Id;
      /** The scenarios with a new test, the main path first. */
      scenarios: Id[];
      /** The main path scenario of the story, when it has one. */
      mainId?: Id;
      /** The scenarios left out because the file has a test of them already (`append`). */
      kept: Id[];
      /** The whole text of the file to write. */
      text: string;
      appended: boolean;
    }
  | { ok: false; storyId: Id; error: E2eStartError; reason: string };

/** What each step body throws until it is written. The words "not written" show in the failed run. */
export const NOT_WRITTEN = 'not written';

/** "S10-pass: CI passes" names S10-pass: a test title is the scenario id, or the id, ": " and its title. */
const ID_TITLE_RE = /^([\w.-]+): \S/;
const TEST_RE = /^\s*test(?:\.only)?\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;

/** The scenario id a test title names: the whole title, or the id before ": ". */
export function testNameOf(title: string): string {
  return ID_TITLE_RE.exec(title)?.[1] ?? title;
}

/** The scenario ids the tests of a spec file name, from each line that starts with `test(` and a quoted title. */
export function specTestNames(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split('\n')) {
    const m = TEST_RE.exec(line);
    if (m) out.add(testNameOf(m[2]!.replace(/\\(.)/g, '$1')));
  }
  return out;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
/** A string in single quotes for TypeScript. */
const quote = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
/** A value on one comment line: no line breaks, never longer than 300 characters. */
function compact(v: unknown): string {
  const text = oneLine(JSON.stringify(v) ?? '');
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}

/** The import specifier of a fixture file from the spec file: `./serve.js`. */
function specifier(specFile: string, fixture: string): string {
  const rel = relative(dirname(specFile), fixture).split(sep).join(posix.sep).replace(/\.ts$/, '.js');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function storyScenarios(record: EpicRecord, storyId: Id): { s: Scenario; approved: boolean }[] {
  return record.scenarioFiles.flatMap((f) =>
    asArray<Scenario>(f.scenarios)
      .filter((s) => isObject(s) && (s.story ?? f.story) === storyId)
      .map((s) => ({ s, approved: scenarioTrust(s, f.file).status === 'approved' })),
  );
}

/** One test: its title, a comment line for the criterion, one step for each scenario step, and the expected result. */
function testText(record: EpicRecord, story: Story, s: Scenario, main: boolean, ui: boolean): string {
  const index = indexBoxes(record.flow);
  const steps = asArray<ScenarioStep>(s.steps).filter(isObject);
  const criterion = s.expect?.criterion ? asArray<AcceptanceCriterion>(story.acceptance).find((c) => isObject(c) && c.id === s.expect!.criterion) : undefined;
  const lines = [`test(${quote(`${s.id}: ${oneLine(str(s.title))}`)}, async (${ui ? '{ page }' : ''}) => {`];
  if (main) lines.push(`  // The main path of ${story.id}: "done" needs this test passed on the real screens.`);
  if (criterion) lines.push(`  // Checks ${criterion.id}: given ${oneLine(str(criterion.given))}; when ${oneLine(str(criterion.when))}; then ${oneLine(str(criterion.then))}.`);
  steps.forEach((st, i) => {
    const box = index.get(st.name)?.box;
    const title = box ? oneLine(str(box.title)) : st.name;
    lines.push(...(lines.length > 1 ? [''] : []), `  await test.step(${quote(`${st.name}: ${title}`)}, async () => {`, `    // Step ${i + 1} of ${steps.length}${st.branch ? `, the branch "${st.branch}"` : ''}.`);
    if (isObject(st.example)) {
      const ex = st.example;
      lines.push(`    // Example${ex.id ? ` ${ex.id}` : ''}: given ${compact(ex.given ?? {})}; then ${compact(ex.then ?? {})}${ex.stateAfter ? `; state after ${compact(ex.stateAfter)}` : ''}.`);
    }
    lines.push(`    throw new Error(${quote(`${NOT_WRITTEN}: ${s.id} step ${i + 1} (${st.name})`)});`, '  });');
  });
  if (isObject(s.expect) && s.expect.state !== undefined) lines.push('', `  // Expect at the end: ${compact(s.expect.state)}.`);
  lines.push('});');
  return lines.join('\n');
}

/** The head of a new file: what it is, and the imports of the fixtures its tests use. */
function headText(record: EpicRecord, story: Story, opts: E2eStartOptions, ui: boolean, cli: boolean): string {
  const f = opts.fixtures ?? {};
  const lines = [
    `// The e2e tests of story ${story.id} ("${oneLine(str(story.want))}"), one for each scenario, named after the scenario id.`,
    `// \`rehearse e2e-start\` wrote this start file from docs/epics/${record.slug}/scenarios/${story.id}.yaml. Each step title`,
    '// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.',
    '// Work only from the scenarios and the running product (the UI and the CLI), not from the code of the boxes.',
    '',
  ];
  lines.push(f.ui ? `import { expect, test } from '${specifier(opts.specFile, f.ui.file)}';` : "import { expect, test } from '@playwright/test';");
  if (cli && f.cli) lines.push(`import { ${f.cli.exports.join(', ')} } from '${specifier(opts.specFile, f.cli.file)}';`);
  if (ui && !f.ui) lines.push('// No serve fixture in the test project: serve the app as an existing spec does.');
  return lines.join('\n');
}

/** Box e2e-start: the start file of a story's e2e tests, or why there is none. */
export function e2eStart(record: EpicRecord, storyId: Id, opts: E2eStartOptions): E2eStart {
  const fail = (error: E2eStartError, reason: string): E2eStart => ({ ok: false, storyId, error, reason });
  const story = asArray<Story>(record.prd?.stories).find((s) => isObject(s) && s.id === storyId);
  if (!story) return fail('no-story', `no story ${storyId} in prd.yaml`);
  const mine = storyScenarios(record, storyId);
  if (mine.length === 0) return fail('no-scenario', `story ${storyId} has no scenarios yet: write them first`);
  const mainId = mainPathScenario(record, storyId, opts.mainPathPick);
  let picked: { s: Scenario; approved: boolean }[];
  if (opts.mainPath) picked = mine.filter((m) => m.s.id === mainId);
  else if (opts.scenarios && opts.scenarios.length > 0) {
    const unknown = opts.scenarios.filter((id) => !mine.some((m) => m.s.id === id));
    if (unknown.length > 0) return fail('no-scenario', `no scenario ${unknown.join(', ')} in story ${storyId}`);
    picked = [...new Set(opts.scenarios)].map((id) => mine.find((m) => m.s.id === id)!);
  } else picked = mine.filter((m) => m.approved);
  if (picked.length === 0) return fail('none-approved', `story ${storyId} has no approved scenario: the owner approves the scenarios first`);
  const draft = picked.filter((m) => !m.approved).map((m) => m.s.id);
  if (draft.length > 0) return fail('not-approved', `${draft.join(', ')}: approve this scenario first; a test checks approved scenarios only`);
  // The main path first, then the others in record order or the order asked.
  picked = [...picked].sort((a, b) => Number(b.s.id === mainId) - Number(a.s.id === mainId));

  if (opts.existing !== undefined && !opts.append) {
    return fail('exists', `the test file exists already: ${opts.specFile}. Add --append to add the missing tests to it, or --stdout to print the start file`);
  }
  const have = opts.existing !== undefined ? specTestNames(opts.existing) : new Set<string>();
  const kept = picked.filter((m) => have.has(m.s.id)).map((m) => m.s.id);
  const fresh = picked.filter((m) => !have.has(m.s.id));
  if (fresh.length === 0) return fail('nothing-new', `${opts.specFile} has a test of ${kept.join(', ')} already: nothing to add`);

  const uiOf = new Map(fresh.map((m) => [m.s.id, isUiScenario(record, m.s)]));
  const tests = fresh.map((m) => testText(record, story, m.s, m.s.id === mainId, uiOf.get(m.s.id)!));
  const anyUi = [...uiOf.values()].some(Boolean);
  const anyCli = [...uiOf.values()].some((u) => !u);
  const text =
    opts.existing !== undefined
      ? `${opts.existing.trimEnd()}\n\n${tests.join('\n\n')}\n`
      : `${headText(record, story, opts, anyUi, anyCli)}\n\n${tests.join('\n\n')}\n`;
  return { ok: true, storyId, scenarios: fresh.map((m) => m.s.id), ...(mainId ? { mainId } : {}), kept, text, appended: opts.existing !== undefined };
}
