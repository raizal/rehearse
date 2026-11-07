// Box build-deck (T52): one EPIC as slides for a supervisor who is not technical. Pure: the record,
// the facts the server gathered (git, built boxes, test results, design pictures, the gate) and the
// owner's presentation.yaml in; a Deck out. Every slide has 1–3 sentences of narration, made from
// the record unless the owner wrote one. Unfinished work shows as plainly as finished work.

import { laneColor } from '../layout/diagram.js';
import { layoutStoryFlow, storyFlow } from '../layout/storyflow.js';
import { briefSignState } from '../trust/build-brief.js';
import { scenarioTrust } from '../trust/stale.js';
import { servingBoxes } from '../trust/story-hash.js';
import type { AcceptanceCriterion, EpicRecord, Id, Requirement, Role, Scenario, Story } from '../types.js';
import { asArray, isObject } from '../util.js';
import type { BoxEvidence } from './built.js';
import type { PresentationInputs } from './inputs.js';
import { plain, sentences } from './plain.js';
import { DONE_WORDS, evidenceSlide, levelWords, missingThings, NO_EVIDENCE, plainStep, proofRows, recapSlides, shortDate, standing, standingSentence, viewDoneState, type DoneState, type ProofContext } from './proof.js';
import { detailsSlide, summarySlides } from './summary.js';
import { storyFlowSvg } from './svg.js';

// ---------------------------------------------------------------- facts (gathered by the server)

export type TestState = 'passed' | 'failed' | 'not-run' | 'not-written';

/** The last known run of one scenario's e2e test (T53). */
export interface TestRun {
  /** When it ran: an ISO date or date-time. */
  at?: string;
  /** The step that failed, as the test names it. */
  failedStep?: string;
  /** Birdview recorded this run. */
  recorded?: boolean;
  /** Relative link to the copied video, next to the deck (`--with-recordings`). */
  video?: string;
  /** A still of the last screen, as an asset key of deckHtml's assets. */
  picture?: string;
}

export type SignatureState = 'valid' | 'missing' | 'invalid' | 'unknown-signer';

export interface StoryFacts {
  /** Boxes of the story that are built or need no code of their own (T58, box-evidence). */
  built: number;
  /** Each box's built state and its evidence (T58). */
  boxes?: BoxEvidence[];
  /** Test state of each approved scenario, by scenario id. */
  tests: Record<Id, TestState>;
  /** The story's design picture, as an asset key of deckHtml's assets. */
  design?: { asset: string; caption: string };
  /** The last run of each approved scenario's test, by scenario id (T53). */
  runs?: Record<Id, TestRun>;
  /** Flow-Box commits that name a part of the story. */
  commits?: number;
  /** Unit tests that name the story's scenarios or criteria, from the unit report; absent: no report. */
  unit?: { tests: number; passed: number; failed: number };
  /** Simulation findings of the story: problems, and paths no approved scenario walks. */
  simulation?: { problems: number; uncovered: number };
  /** The signature of the story's last sign-off. */
  signature?: SignatureState;
}

/** Where each kind of proof came from (T53), for the evidence page. */
export interface DeckEvidence {
  e2e: {
    /** The running Birdview player, Birdview's saved results files, or nothing. */
    source: 'player' | 'saved' | 'none';
    /** The results file read. */
    file?: string;
    /** The test project the results belong to. */
    project?: string;
    /** Why that project: "this checkout's own", "the main checkout's own". */
    note?: string;
    /** Dates of the oldest and newest run used (ISO). */
    oldest?: string;
    newest?: string;
    used: number;
    /** Saved results left out: they match no test now. */
    dropped: number;
    /** Older saved runs of a test, replaced by its newer run. */
    older?: number;
    /** Why there are none. */
    why?: string;
  };
  recordings: {
    /** Videos of the runs used. */
    found: number;
    /** The folder next to the deck the videos were copied to. */
    copied?: string;
    pictures: number;
    picturesLeftOut: number;
    picturesBytes: number;
  };
  /** `scope`: the tests of the report that this EPIC counts (T59). `note`: the report does not show the test files. */
  unit: { file?: string; date?: string; tests?: number; passed?: number; failed?: number; scope?: string; note?: string; why?: string };
  signatures: { file: string; checked: number; valid: number };
}

export interface GateFact {
  check: string;
  message: string;
  stories: Id[];
}

export interface DeckFacts {
  /** The commit the deck shows: branch, short sha, commit date (YYYY-MM-DD). */
  commit: { branch: string; sha: string; date: string };
  /** The EPIC folder has changes that are not committed: the deck shows them, saying so. */
  uncommitted: boolean;
  /** Who presents: the git user. */
  owner?: string;
  /** The "Idea" of the EPIC's brainstorm.md. */
  idea?: string;
  stories: Record<Id, StoryFacts>;
  gate: { ok: boolean; items: GateFact[] };
  /** Whether test results were known (Birdview ran the tests); otherwise every written test is "not run". */
  testResults: boolean;
  /** Lines covered by unit tests, in whole percent, when the code graph has it. */
  coverage?: number;
  /** Where the proof came from (T53). Default: nothing looked up. */
  evidence?: DeckEvidence;
  /** The code graph "built" read (T58): when it was built, or why it could not be read. */
  codeGraph?: { ok: boolean; at?: string; why?: string };
}

// ---------------------------------------------------------------- the deck

export type StepState = 'done' | 'partly' | 'not-yet';
export type Mark = StepState | 'failed';

export interface ProgressStep {
  state: StepState;
  /** Short words under the mark: "3 of 5", "1 failing". */
  note: string;
  /** Something is wrong, not just unfinished (a failing test, a changed story). */
  alarm?: boolean;
}

export const PROGRESS_STEPS = ['designed', 'scenarios approved', 'built', 'tested', 'signed off'] as const;

export interface ProgressRow {
  id: Id;
  title: string;
  steps: ProgressStep[];
  /** Done, in progress or not started, by the one done rule (T53, T54). */
  state: DoneState;
  /** How strong the proof of a done story is: "seen working", "checked by automated tests". */
  level?: string;
}

/** A link in the deck: relative (a copied recording), never fetched. */
export interface Link {
  href: string;
  text: string;
}

export interface ListItem {
  text: string;
  /** Record id, shown small in the item's corner. */
  id?: string;
  mark?: Mark;
}

/** One line of the recap: a story, done with its proof, or what it still needs. */
export interface RecapItem {
  id: Id;
  text: string;
  mark: Mark;
  state: DoneState;
  links?: Link[];
}

/** One source of proof of a story: "E2E tests", "Built", "Signed"… */
export interface ProofRow {
  label: string;
  text: string;
  tone?: 'good' | 'warn' | 'bad' | 'muted';
  links?: Link[];
}

export interface CheckRow {
  id: Id;
  title: string;
  given?: string;
  when?: string;
  then?: string;
  approval: string;
  approved: boolean;
  test: TestState | 'not approved';
  /** When the test last ran ("6 Nov") and the failed step in plain words. */
  ran?: string;
  failedStep?: string;
  /** A still of the last screen (asset key) and a link to the copied video. */
  picture?: string;
  video?: string;
  /** The run was recorded, but the video is not sent with the deck. */
  kept?: boolean;
}

/** One line of a group on the summary (T54): a story or a few, and its proof level or what it needs. */
export interface GroupLine {
  text: string;
  /** Said after the text: "seen working, 7 Nov", "13 checks to approve". */
  level?: string;
  mark: Mark;
  /** Record ids, shown small in the line's corner. */
  ids?: string[];
}

/** A group on the summary: an area of what is done, or a reason something is not. */
export interface GroupCard {
  title: string;
  tone: 'good' | 'warn' | 'bad';
  lines: GroupLine[];
  /** What it takes, and who acts (not-done groups). */
  takes?: string;
  who?: string;
}

export interface MapColumn {
  role: string;
  kind: string;
  color: string;
  about?: string;
  stories: { id: Id; title: string; state: StepState }[];
}

export type Block =
  | { type: 'lead'; text: string }
  | { type: 'text'; text: string; tone?: 'muted' | 'warn' | 'good' | 'small' }
  | { type: 'notice'; text: string }
  | { type: 'list'; title?: string; items: ListItem[]; columns?: 1 | 2; legend?: boolean }
  | { type: 'stats'; items: { value: string; label: string; tone?: 'good' | 'warn' | 'bad' }[] }
  | { type: 'progress'; rows: ProgressRow[] }
  | { type: 'map'; columns: MapColumn[] }
  | { type: 'image'; asset: string; caption: string }
  | { type: 'flow'; svg: string; caption: string }
  | { type: 'checks'; rows: CheckRow[] }
  | { type: 'glossary'; items: { term: string; meaning: string }[] }
  | { type: 'recap'; done: RecapItem[]; notDone: RecapItem[]; compact: boolean; doneTotal: number; notDoneTotal: number }
  | { type: 'proof'; title?: string; rows: ProofRow[] }
  | { type: 'bar'; segments: { label: string; count: number; tone: 'good' | 'ok' | 'todo' | 'bad' }[] }
  | { type: 'groups'; items: GroupCard[] }
  | { type: 'gallery'; items: { asset: string; caption: string; links?: Link[] }[] };

export interface Slide {
  /** The narration key: a SLIDE_KEYS entry, a story id, or `<story id>-checks`; a continuation adds `-<n>`. */
  key: string;
  title: string;
  /** 1–3 sentences the owner says, or reads under the slide. */
  narration: string;
  /** Record ids, shown small in the corner. */
  ids: string[];
  /** Two columns: the first block on the left, the rest on the right. */
  layout?: 'split';
  blocks: Block[];
}

export interface Deck {
  slug: string;
  /** The executive summary only (the default), or the summary and the details, story by story. */
  kind: 'summary' | 'full';
  title: string;
  /** "<EPIC title> · as of <branch> @ <sha>, <date>" */
  footer: string;
  /** Shown on the title slide and in every footer when the record has uncommitted changes. */
  notice?: string;
  hiddenStories: number;
  slides: Slide[];
}

export const UNCOMMITTED_NOTICE = 'This deck includes changes to the plan that are not committed yet.';

export const GLOSSARY: { term: string; meaning: string }[] = [
  { term: 'Story', meaning: 'One thing a person or a system wants to do, and why. The work is planned, built and checked story by story.' },
  { term: 'Scenario', meaning: 'One worked example of a story: the steps it goes through and what must be true at the end.' },
  { term: 'Approval', meaning: 'The owner reads a scenario and approves it. Only approved scenarios count as proof.' },
  { term: 'Sign-off', meaning: 'The owner agrees that a story, its plan and its scenarios are right. Agents may build only signed-off stories.' },
  { term: 'E2E test', meaning: 'An end-to-end test: a program that uses the product the way a person would, for one scenario, and passes or fails.' },
  { term: 'Part', meaning: 'One step of the plan, such as a screen, a check or a command. A part counts as built when a commit says it builds that part or the code graph links code to it. A start, an end, or a decision whose branch a built neighbour holds needs no code of its own.' },
  { term: 'Gate', meaning: 'The final check before the work counts as done: everything traced, rehearsed without problems, unchanged since sign-off and signed off.' },
];

const GATE_WORDS: Record<string, string> = {
  traced: 'not yet proven by an approved scenario',
  'sim-clean': 'the rehearsal found a problem',
  'sim-uncovered': 'a path, often an error case, that no approved scenario walks yet',
  'no-stale': 'changed since it was approved or signed off',
  'signed-off': 'not signed off yet',
  signature: 'a signature that cannot be checked',
};

// ---------------------------------------------------------------- helpers

const cap = (s: string): string => (s === '' ? s : s[0]!.toUpperCase() + s.slice(1));
const stop = (s: string): string => (s === '' || /[.!?…]$/.test(s) ? s : `${s}.`);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const day = (at: string | undefined): string => (at ? at.slice(0, 10) : '');

/** "to send my supervisor a deck" → "Send my supervisor a deck". */
export function storyTitle(story: Pick<Story, 'want'>): string {
  return cap(plain(story.want).replace(/^to\s+/i, ''));
}

/** The person part of a git email: "raizal.pregnanta@x.com" → "raizal.pregnanta". */
function person(by: string | undefined): string {
  if (!by) return 'someone';
  return by.includes('@') ? by.split('@')[0]! : by;
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------- per story

export interface StoryView {
  story: Story;
  title: string;
  role?: Role;
  scenarios: { s: Scenario; approved: boolean }[];
  boxes: number;
  steps: ProgressStep[];
  sign: ReturnType<typeof briefSignState>;
  /** Tests of approved scenarios. */
  tests: Record<TestState, number>;
  approved: number;
  facts: StoryFacts;
}

export function storyView(record: EpicRecord, facts: DeckFacts, story: Story): StoryView {
  const role = asArray<Role>(record.prd?.roles).find((r) => isObject(r) && r.id === story.role);
  const scenarios = record.scenarioFiles.flatMap((f) =>
    asArray<Scenario>(f.scenarios)
      .filter((s) => isObject(s) && s.story === story.id)
      .map((s) => ({ s, approved: scenarioTrust(s, f.file).status === 'approved' })),
  );
  const f: StoryFacts = facts.stories[story.id] ?? { built: 0, tests: {} };
  const boxes = servingBoxes(record.flow, story.id).length;
  const approved = scenarios.filter((x) => x.approved).length;
  const tests: Record<TestState, number> = { passed: 0, failed: 0, 'not-run': 0, 'not-written': 0 };
  for (const x of scenarios) if (x.approved) tests[f.tests[x.s.id] ?? 'not-written'] += 1;
  const sign = briefSignState(record, story.id);

  const designed: ProgressStep = boxes > 0 ? { state: 'done', note: f.design ? 'plan and screen picture' : 'plan drawn' } : { state: 'not-yet', note: 'no plan yet' };
  const total = scenarios.length;
  const scen: ProgressStep =
    total === 0 ? { state: 'not-yet', note: 'none written' } : approved === total ? { state: 'done', note: `all ${total}` } : approved > 0 ? { state: 'partly', note: `${approved} of ${total}` } : { state: 'not-yet', note: `${total} not approved yet` };
  const built: ProgressStep =
    boxes === 0 ? { state: 'not-yet', note: 'nothing planned' } : f.built >= boxes ? { state: 'done', note: `all ${boxes} parts` } : f.built > 0 ? { state: 'partly', note: `${f.built} of ${boxes} parts` } : { state: 'not-yet', note: `0 of ${boxes} parts` };
  let tested: ProgressStep;
  if (approved === 0) tested = { state: 'not-yet', note: 'nothing approved' };
  else if (tests.failed > 0) tested = { state: 'partly', note: `${tests.failed} failed`, alarm: true };
  else if (tests.passed === approved) tested = { state: 'done', note: `all ${approved} pass` };
  else if (tests.passed > 0) tested = { state: 'partly', note: `${tests.passed} of ${approved} pass` };
  else if (tests['not-written'] === approved) tested = { state: 'not-yet', note: 'no tests yet' };
  else tested = { state: 'not-yet', note: [tests['not-written'] > 0 ? `${tests['not-written']} not written` : '', tests['not-run'] > 0 ? `${tests['not-run']} not run` : ''].filter(Boolean).join(', ') };
  let signed: ProgressStep;
  if (sign?.buildable) signed = { state: 'done', note: day(sign.at) };
  else if (sign?.status === 'stale') signed = { state: 'partly', note: 'changed since', alarm: true };
  else if (sign?.status === 'signed') signed = { state: 'partly', note: 'sign again' };
  else signed = { state: 'not-yet', note: 'waiting' };

  return { story, title: storyTitle(story), ...(role ? { role } : {}), scenarios, boxes, steps: [designed, scen, built, tested, signed], sign, tests, approved, facts: f };
}

/** A story's mark for the map, by the one done rule. */
function overall(v: StoryView): StepState {
  const state = viewDoneState(v);
  return state === 'done' ? 'done' : state === 'in-progress' ? 'partly' : 'not-yet';
}

function criterionMark(v: StoryView, c: AcceptanceCriterion): Mark {
  const mine = v.scenarios.filter((x) => isObject(x.s.expect) && x.s.expect.criterion === c.id);
  const approved = mine.filter((x) => x.approved);
  if (approved.some((x) => v.facts.tests[x.s.id] === 'failed')) return 'failed';
  if (approved.some((x) => v.facts.tests[x.s.id] === 'passed')) return 'done';
  if (approved.length > 0 || mine.length > 0) return 'partly';
  return 'not-yet';
}

function statusLine(v: StoryView): string {
  const parts: string[] = [];
  if (v.sign?.buildable) parts.push(`Signed off by ${person(v.sign.by)} on ${day(v.sign.at)}`);
  else if (v.sign?.status === 'stale') parts.push(`Changed after ${person(v.sign.by)} signed it off on ${day(v.sign.at)}: it needs a new sign-off`);
  else if (v.sign?.status === 'signed') parts.push('Signed off under an older rule: it needs a new sign-off');
  else parts.push('Not signed off yet');
  parts.push(v.boxes === 0 ? 'nothing planned to build' : `${v.facts.built} of ${plural(v.boxes, 'part')} built`);
  const waiting = v.scenarios.length - v.approved;
  if (v.scenarios.length === 0) parts.push('no scenarios yet');
  else {
    const t = v.tests;
    const bits = [v.approved === 0 ? 'no approved scenario yet' : `${t.passed} of ${v.approved} approved ${v.approved === 1 ? 'scenario' : 'scenarios'} tested and passed`];
    if (t.failed > 0) bits.push(`${t.failed} failed`);
    if (waiting > 0) bits.push(`${waiting} not approved yet`);
    parts.push(bits.join(', '));
  }
  return `${parts.join(' · ')}.`;
}

function checkRow(v: StoryView, x: { s: Scenario; approved: boolean }, year: string): CheckRow {
  const c = isObject(x.s.expect) ? v.story.acceptance.find((a) => a.id === x.s.expect!.criterion) : undefined;
  const approval = x.approved && x.s.approval ? `Approved by ${person(x.s.approval.by)} on ${day(x.s.approval.at)}` : x.s.approval ? 'Changed since it was approved: it needs a new approval' : 'Not approved yet';
  const test = x.approved ? (v.facts.tests[x.s.id] ?? 'not-written') : 'not approved';
  const run = x.approved && (test === 'passed' || test === 'failed') ? v.facts.runs?.[x.s.id] : undefined;
  const step = test === 'failed' ? plainStep(run?.failedStep) : '';
  return {
    id: x.s.id,
    title: cap(plain(x.s.title)),
    ...(c ? { given: plain(c.given), when: plain(c.when), then: plain(c.then) } : {}),
    approval,
    approved: x.approved,
    test,
    ...(run?.at ? { ran: shortDate(run.at, year) } : {}),
    ...(step ? { failedStep: step } : {}),
    ...(run?.picture ? { picture: run.picture } : {}),
    ...(run?.video ? { video: run.video } : run?.recorded ? { kept: true } : {}),
  };
}

/** The newest still of the last screen among the story's approved runs, with its caption. */
function newestPicture(v: StoryView, year: string): { asset: string; caption: string } | undefined {
  const best = v.scenarios
    .filter((x) => x.approved && v.facts.runs?.[x.s.id]?.picture)
    .map((x) => ({ x, run: v.facts.runs![x.s.id]! }))
    .sort((a, b) => (b.run.at ?? '').localeCompare(a.run.at ?? ''))[0];
  if (!best) return undefined;
  const state = v.facts.tests[best.x.s.id] === 'failed' ? 'failed' : 'passed';
  return { asset: best.run.picture!, caption: `Last screen of the test "${cap(plain(best.x.s.title))}"${best.run.at ? `, ${shortDate(best.run.at, year)}` : ''} (${state})` };
}

// ---------------------------------------------------------------- slides

function narrate(inputs: PresentationInputs, key: string, made: string): string {
  return inputs.narration[key] ?? made;
}

/** Story `S3` and its rows: the first approved scenario draws the flow, else the first one. */
function storySlides(record: EpicRecord, v: StoryView, inputs: PresentationInputs, ctx: ProofContext): Slide[] {
  const id = v.story.id;
  const role = v.role?.name ?? 'user';
  const lead = `As ${/^[aeiou]/i.test(role) ? 'an' : 'a'} ${role}, I want ${plain(v.story.want).replace(/^to\s+/i, 'to ')}, so that ${plain(v.story.soThat)}.`;
  const criteria: ListItem[] = asArray<AcceptanceCriterion>(v.story.acceptance)
    .filter(isObject)
    .map((c) => ({ text: stop(cap(plain(c.then))), id: c.id, mark: criterionMark(v, c) }));
  // With a picture (the design, else the last screen of a test): the picture on the left, the story on the right.
  const picture = v.facts.design ?? newestPicture(v, ctx.year);
  const first: Block[] = picture ? [{ type: 'image', asset: picture.asset, caption: picture.caption }, { type: 'lead', text: lead }] : [{ type: 'lead', text: lead }];
  const state = viewDoneState(v);
  const missing = missingThings(v);
  first.push({
    type: 'text',
    text: state === 'done' ? `Done, ${levelWords(v)}: built and signed off, and no test of it fails.` : `${DONE_WORDS[state]}: ${missing.slice(0, 3).join('; ')}${missing.length > 3 ? `; +${missing.length - 3} more` : ''}.`,
    tone: state === 'done' ? 'good' : v.steps.some((s) => s.alarm) ? 'warn' : 'muted',
  });
  first.push({ type: 'list', title: 'It is done when', items: criteria, columns: criteria.length > 5 && !picture ? 2 : 1, legend: true });
  first.push({ type: 'proof', title: 'The proof', rows: proofRows(v, ctx) });
  const made1 = `${v.title}. ${state === 'done' ? `This story is done (${levelWords(v)}): it is built and signed off, and no test of it fails.` : `${DONE_WORDS[state]}: ${missing[0] ?? 'not proven yet'}; ${statusLine(v).split(' · ')[0]!.toLowerCase()}.`}`;
  const slides: Slide[] = [{ key: id, title: v.title, narration: narrate(inputs, id, made1), ids: [id, ...asArray<string>(v.story.requirements)], ...(picture ? { layout: 'split' as const } : {}), blocks: first }];

  if (v.scenarios.length === 0) return slides;
  const pick = v.scenarios.find((x) => x.approved) ?? v.scenarios[0]!;
  const sf = storyFlow(record.flow, record.prd, pick.s);
  const svg = storyFlowSvg(sf, layoutStoryFlow(sf), `flow-${id}`);
  const rows = v.scenarios.map((x) => checkRow(v, x, ctx.year));
  const t = v.tests;
  const made2 =
    `The diagram follows one scenario, "${cap(plain(pick.s.title))}", step by step, in the lane of who does each step. ` +
    (v.approved === 0
      ? `This story has ${plural(rows.length, 'scenario')}. None is approved yet, so none is tested yet.`
      : `We checked ${plural(rows.length, 'scenario')}: ${v.approved} approved, ${t.passed} passed ${t.passed === 1 ? 'its' : 'their'} e2e test` +
    `${t.failed > 0 ? `, ${t.failed} failed` : ''}${t['not-written'] > 0 ? `, ${t['not-written']} without a test yet` : ''}${t['not-run'] > 0 ? `, ${t['not-run']} not run` : ''}.`);
  const [head, ...rest] = [rows.slice(0, 4), ...chunks(rows.slice(4), 7)];
  slides.push({
    key: `${id}-checks`,
    title: `${v.title}: how it works and what we checked`,
    narration: narrate(inputs, `${id}-checks`, made2),
    ids: [id, ...head!.map((r) => r.id)],
    layout: 'split',
    blocks: [
      { type: 'flow', svg, caption: `How it works: "${cap(plain(pick.s.title))}"` },
      { type: 'checks', rows: head! },
    ],
  });
  rest.forEach((part, i) => {
    slides.push({
      key: `${id}-checks-${i + 2}`,
      title: `${v.title}: what we checked (continued)`,
      narration: `More scenarios of this story, ${plural(part.length, 'scenario')} on this slide.`,
      ids: [id, ...part.map((r) => r.id)],
      blocks: [{ type: 'checks', rows: part }],
    });
  });
  return slides;
}

export interface DeckBuildOptions {
  /** The summary and, after it, the details story by story (`--full`). Default: the summary only. */
  full?: boolean;
  /** Whether the deck carries a picture (the assets given to deckHtml); default: none, so no slide is laid out around a missing picture. */
  hasPicture?: (asset: string) => boolean;
}

/**
 * The deck of one EPIC. `inputs` are the owner's (presentation.yaml), or none. By default the
 * executive summary (T54); `full` adds the details story by story as an appendix.
 */
export function presentationDeck(record: EpicRecord, facts: DeckFacts, inputs: PresentationInputs, opts: DeckBuildOptions = {}): Deck {
  const prd = record.prd;
  const epic = prd?.epic;
  const title = plain(epic?.title) || record.slug;
  const allStories = asArray<Story>(prd?.stories).filter((s) => isObject(s) && typeof s.id === 'string');
  const views = allStories.map((s) => storyView(record, facts, s));
  const hidden = new Set(inputs.hide);
  const shown = views.filter((v) => !hidden.has(v.story.id));
  const hiddenNote = hidden.size > 0 ? `${plural(hidden.size, 'story', 'stories')} not shown in this deck.` : undefined;
  const roles = asArray<Role>(prd?.roles).filter(isObject);
  const slides: Slide[] = [];

  // Counts over every story: hiding a story never makes the EPIC look further along.
  const signed = views.filter((v) => v.sign?.buildable).length;
  const stale = views.filter((v) => v.sign?.status === 'stale' || (v.sign?.status === 'signed' && !v.sign.buildable)).length;
  const failing = views.reduce((n, v) => n + v.tests.failed, 0);
  const passing = views.reduce((n, v) => n + v.tests.passed, 0);
  const approved = views.reduce((n, v) => n + v.approved, 0);
  const scenarioCount = views.reduce((n, v) => n + v.scenarios.length, 0);
  const notWritten = views.reduce((n, v) => n + v.tests['not-written'], 0);
  const notRun = views.reduce((n, v) => n + v.tests['not-run'], 0);
  // The one done rule (T53): the title, the recap, progress, the stories, quality and what's next.
  const stand = standing(views);
  const status = standingSentence(stand);
  const evidence = facts.evidence ?? NO_EVIDENCE;
  const ctx: ProofContext = { year: facts.commit.date.slice(0, 4), owner: facts.owner ?? 'the owner', evidence };
  const footer = `${title} · as of ${facts.commit.branch} @ ${facts.commit.sha}, ${facts.commit.date}${facts.uncommitted ? ' · includes uncommitted changes' : ''}`;
  const head = { slug: record.slug, title, footer, ...(facts.uncommitted ? { notice: UNCOMMITTED_NOTICE } : {}), hiddenStories: hidden.size };

  // The executive summary (T54): where we are, done, not done and why, how we know, asks, next.
  slides.push(
    ...summarySlides({
      title,
      ...(epic?.goal ? { goal: epic.goal } : {}),
      views,
      shown,
      ...(hiddenNote ? { hiddenNote } : {}),
      facts,
      evidence,
      ctx,
      inputs,
      ...(facts.uncommitted ? { notice: UNCOMMITTED_NOTICE } : {}),
      hasPicture: opts.hasPicture ?? (() => false),
    }),
  );
  if (!opts.full) return { ...head, kind: 'summary', slides };

  // The appendix: the details, story by story (T52, T53).
  slides.push(detailsSlide(inputs.narration.details, shown.length));

  // 1b. Recap: what is done, what is not, each with its proof (T53)
  slides.push(...recapSlides(shown, views, ctx, (made) => narrate(inputs, 'recap', made), hiddenNote));

  // 2. Why, and what it must do
  const people = roles.filter((r) => r.kind === 'human' || r.kind === 'agent');
  const whyBlocks: Block[] = [];
  if (facts.idea) whyBlocks.push({ type: 'lead', text: sentences(facts.idea, 420) });
  whyBlocks.push({ type: 'list', title: 'Who it is for', items: people.map((r) => ({ text: r.about ? `${r.name}: ${sentences(r.about, 160)}` : r.name })) });
  if (epic?.successMeasure) whyBlocks.push({ type: 'text', text: `Success looks like this: ${sentences(epic.successMeasure, 260)}`, tone: 'muted' });
  slides.push({
    key: 'why',
    title: 'Why we do this',
    narration: narrate(inputs, 'why', `${sentences(facts.idea ?? epic?.goal ?? '', 200)} It is for ${people.map((r) => r.name).join(', ') || 'its users'}.`),
    ids: [],
    blocks: whyBlocks,
  });
  const reqs = asArray<Requirement>(prd?.requirements).filter(isObject);
  slides.push({
    key: 'requirements',
    title: 'What it must do',
    narration: narrate(inputs, 'requirements', `These are the ${plural(reqs.length, 'requirement')} the plan is checked against. Each story below serves one or more of them.`),
    ids: [],
    blocks: [{ type: 'list', items: reqs.map((r) => ({ text: sentences(r.text, 130), id: r.id })), columns: 2 }],
  });

  // 3. Big picture: roles and their stories
  const columns: MapColumn[] = roles.map((r) => ({
    role: r.name,
    kind: r.kind,
    color: laneColor(record.flow, r.id),
    ...(r.about ? { about: sentences(r.about, 110) } : {}),
    stories: shown.filter((v) => v.story.role === r.id).map((v) => ({ id: v.story.id, title: v.title, state: overall(v) })),
  }));
  const mapNarr = `${plural(roles.length, 'role')} take part. ${columns
    .filter((c) => c.stories.length > 0)
    .map((c) => `${c.role} has ${plural(c.stories.length, 'story', 'stories')}`)
    .join(', ')}; the others do their part inside those stories.`;
  slides.push({
    key: 'big-picture',
    title: 'The big picture',
    narration: narrate(inputs, 'big-picture', `${mapNarr} A full circle is a finished story, a half circle one with work left.`),
    ids: [],
    blocks: [{ type: 'map', columns }, ...(hiddenNote ? [{ type: 'text' as const, text: hiddenNote, tone: 'muted' as const }] : [])],
  });

  // 4. Progress
  const rows: ProgressRow[] = shown.map((v) => {
    const level = levelWords(v);
    return { id: v.story.id, title: v.title, steps: v.steps, state: viewDoneState(v), ...(level ? { level } : {}) };
  });
  const finished = shown.filter((v) => viewDoneState(v) === 'done').length;
  const progSummary = `${finished} of ${plural(shown.length, 'story', 'stories')} done (built and signed off, no test fails), ${stand.seen} of them seen working on the real screens. ${signed} signed off; ${passing} of ${approved} approved scenarios pass their e2e test${failing > 0 ? `, ${failing} fail` : ''}.`;
  slides.push({
    key: 'progress',
    title: 'Progress, story by story',
    narration: narrate(inputs, 'progress', `Each row is a story and its five steps, from plan to sign-off. ${progSummary}`),
    ids: [],
    blocks: [{ type: 'progress', rows }, { type: 'text', text: progSummary + (hiddenNote ? ` ${hiddenNote}` : ''), tone: failing > 0 ? 'warn' : 'muted' }],
  });

  // 5. One section per story
  for (const v of shown) slides.push(...storySlides(record, v, inputs, ctx));

  // 6. Quality
  const boxPaths = new Set(views.flatMap((v) => servingBoxes(record.flow, v.story.id)));
  const builtTotal = views.reduce((n, v) => n + Math.min(v.facts.built, v.boxes), 0);
  const boxTotal = views.reduce((n, v) => n + v.boxes, 0);
  const unitStories = views.filter((v) => v.facts.unit);
  const unitTests = unitStories.reduce((n, v) => n + v.facts.unit!.tests, 0);
  const unitFailed = unitStories.reduce((n, v) => n + v.facts.unit!.failed, 0);
  const stats: Extract<Block, { type: 'stats' }>['items'] = [
    { value: `${stand.done} / ${views.length}`, label: 'stories done', tone: stand.done === views.length ? 'good' : 'warn' },
    { value: `${signed} / ${views.length}`, label: 'stories signed off', tone: signed === views.length ? 'good' : 'warn' },
    { value: `${approved} / ${scenarioCount}`, label: 'scenarios approved', tone: approved === scenarioCount ? 'good' : 'warn' },
    { value: `${passing} / ${approved}`, label: 'approved scenarios that pass their e2e test', tone: failing > 0 ? 'bad' : passing === approved ? 'good' : 'warn' },
    { value: `${builtTotal} / ${boxTotal}`, label: `planned parts with code (${boxPaths.size} distinct)`, tone: builtTotal === boxTotal ? 'good' : 'warn' },
  ];
  if (unitStories.length > 0) stats.push({ value: `${unitTests - unitFailed} / ${unitTests}`, label: "automated tests that name a story's scenario and pass", tone: unitFailed > 0 ? 'bad' : 'good' });
  if (facts.coverage !== undefined) stats.push({ value: `${facts.coverage}%`, label: 'of the code is run by unit tests' });
  const byCheck = new Map<string, Set<string>>();
  // A rehearsal finding that only says no approved scenario walks a path reads as a gap, not a problem.
  const kindOf = (g: GateFact): string => (g.check === 'sim-clean' && /no approved scenario|only by drafts/.test(g.message) ? 'sim-uncovered' : g.check);
  for (const g of facts.gate.items) {
    const set = byCheck.get(kindOf(g)) ?? new Set<string>();
    for (const s of g.stories) set.add(s);
    if (g.stories.length === 0) set.add('');
    byCheck.set(kindOf(g), set);
  }
  const byNumber = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });
  const gateList: ListItem[] = [...byCheck.entries()].map(([check, stories]) => {
    const ids = [...stories].filter(Boolean).sort(byNumber);
    const count = facts.gate.items.filter((g) => kindOf(g) === check).length;
    return { text: `${plural(count, 'item')}: ${GATE_WORDS[check] ?? check}${ids.length > 0 ? ` (${plural(ids.length, 'story', 'stories')})` : ''}`, id: ids.join(' '), mark: 'not-yet' as const };
  });
  const gateText = facts.gate.ok ? 'The gate passes: the final check finds nothing open.' : `The gate does not pass yet: ${plural(facts.gate.items.length, 'open item')}.`;
  const qualityBlocks: Block[] = [{ type: 'stats', items: stats }, { type: 'text', text: gateText, tone: facts.gate.ok ? 'good' : 'warn' }];
  if (gateList.length > 0) qualityBlocks.push({ type: 'list', items: gateList });
  if (!facts.testResults && approved > 0)
    qualityBlocks.push({ type: 'text', text: `Test results were not available when this deck was made${evidence.e2e.why ? ` (${evidence.e2e.why})` : ''}, so written tests show as "not run".`, tone: 'muted' });
  slides.push({
    key: 'quality',
    title: 'Quality',
    narration: narrate(inputs, 'quality', `${status} ${gateText} ${passing} of ${approved} approved scenarios pass their e2e test${notWritten > 0 ? `, and ${notWritten} have no test yet` : ''}.`),
    ids: [],
    blocks: qualityBlocks,
  });

  // 7. Risks
  const risks: ListItem[] = inputs.risks.map((r) => ({ text: r, mark: 'failed' as const }));
  const failingStories = views.filter((v) => v.tests.failed > 0).map((v) => v.story.id);
  if (failing > 0) risks.push({ text: `${plural(failing, 'e2e test')} ${failing === 1 ? 'fails' : 'fail'}: the work they check does not behave as approved.`, id: failingStories.join(' '), mark: 'failed' });
  const staleIds = views.filter((v) => v.sign?.status === 'stale' || (v.sign?.status === 'signed' && !v.sign.buildable)).map((v) => v.story.id);
  if (staleIds.length > 0) risks.push({ text: `${plural(staleIds.length, 'story', 'stories')} changed after sign-off; ${staleIds.length === 1 ? 'it needs' : 'they need'} a new sign-off before more work.`, id: staleIds.join(' '), mark: 'failed' });
  const draftIds = views.filter((v) => v.sign?.status === 'draft' || !v.sign).map((v) => v.story.id);
  if (draftIds.length > 0) risks.push({ text: `${plural(draftIds.length, 'story', 'stories')} ${draftIds.length === 1 ? 'is' : 'are'} not signed off yet, so agents may not build ${draftIds.length === 1 ? 'it' : 'them'}.`, id: draftIds.join(' '), mark: 'not-yet' });
  if (notWritten > 0) risks.push({ text: `${plural(notWritten, 'approved scenario')} ${notWritten === 1 ? 'has' : 'have'} no e2e test yet: nothing proves ${notWritten === 1 ? 'it' : 'them'} in the live product.`, mark: 'not-yet' });
  if (notRun > 0) risks.push({ text: `${plural(notRun, 'e2e test')} ${notRun === 1 ? 'was' : 'were'} not run for this deck.`, mark: 'not-yet' });
  const unbuilt = boxTotal - builtTotal;
  if (unbuilt > 0) risks.push({ text: `${plural(unbuilt, 'planned part')} ${unbuilt === 1 ? 'has' : 'have'} no code yet.`, mark: 'not-yet' });
  if (facts.uncommitted) risks.push({ text: UNCOMMITTED_NOTICE, mark: 'not-yet' });
  slides.push({
    key: 'risks',
    title: 'Risks',
    narration: narrate(
      inputs,
      'risks',
      risks.length === 0 ? 'The record shows no open risk: every story is signed off and built, and its tests pass.' : `${plural(risks.length, 'risk')} to know about${inputs.risks.length > 0 ? `, ${inputs.risks.length} of them from the owner` : ''}. The rest come straight from the plan and the tests.`,
    ),
    ids: [],
    blocks: risks.length > 0 ? [{ type: 'list', items: risks }] : [{ type: 'text', text: 'No open risks found in the plan or the tests.', tone: 'good' }],
  });

  // 9b. Where the proof comes from (T53)
  slides.push(evidenceSlide(facts, evidence, ctx.owner, (made) => narrate(inputs, 'evidence', made)));

  // 10. Glossary
  slides.push({
    key: 'glossary',
    title: 'Words used in this deck',
    narration: narrate(inputs, 'glossary', 'Some words have one fixed definition here. This is what each one means.'),
    ids: [],
    blocks: [{ type: 'glossary', items: GLOSSARY }],
  });

  return { ...head, kind: 'full', slides };
}
