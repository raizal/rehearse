// The executive summary (T54): the default deck, five or six slides a supervisor reads in a few
// minutes. Box summary-deck: where we are, what's done, what's not and why, how we know, what I
// need and what's next. Box group-done-by-area: done stories under the owner's areas
// (presentation.yaml), else by role, a few short lines each, every line with its proof level. Box
// group-not-done-by-reason: stories not done under the reason, what it takes and who acts. Box
// how-we-know: what "done" means here, pictures of passed runs, the numbers and their sources.
// Pure: the deck's story views and facts in, slides out.

import type { Block, DeckEvidence, DeckFacts, GroupCard, GroupLine, Link, Mark, Slide, StoryView } from './deck.js';
import type { PresentationInputs } from './inputs.js';
import { plain, sentences } from './plain.js';
import { DONE_RULE, levelWords, missingThings, plainStep, shortDate, standing, summarySentence, TRUST_SENTENCE, viewDoneState, viewProofLevel, type ProofContext, type ProofLevel } from './proof.js';

/** At most this many groups on the done and the not-done slides, and lines in a group. */
export const MAX_GROUPS = 6;
export const MAX_LINES = 3;
/** At most this many pictures of passed runs on the how-we-know slide. */
export const MAX_PICTURES = 4;

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const cap = (s: string): string => (s === '' ? s : s[0]!.toUpperCase() + s.slice(1));
const lower = (s: string): string => (s === '' || /^[A-Z]{2}/.test(s) ? s : s[0]!.toLowerCase() + s.slice(1));
const stop = (s: string): string => (s === '' || /[.!?…]$/.test(s) ? s : `${s}.`);

function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  const c = s.slice(0, max);
  const space = c.lastIndexOf(' ');
  return `${c.slice(0, space > max / 2 ? space : max).replace(/[,;:]$/, '')}…`;
}

/** "A", "A and B", "A, B and C", "A, B and 3 more". */
function names(titles: string[], max = 3): string {
  // Inside a sentence the later titles start small ("Create a record and see the flow"); an acronym stays.
  const list = titles.map((t, i) => (i > 0 && /^[A-Z][a-z]/.test(t) ? `${t[0]!.toLowerCase()}${t.slice(1)}` : t));
  if (list.length <= 1) return list[0] ?? '';
  if (list.length <= max) return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  return `${list.slice(0, max - 1).join(', ')} and ${list.length - max + 1} more`;
}

/** The newest run of an approved scenario whose e2e test passed. */
function lastPassed(v: StoryView): string | undefined {
  const at = v.scenarios.filter((x) => x.approved && v.facts.tests[x.s.id] === 'passed').map((x) => v.facts.runs?.[x.s.id]?.at ?? '');
  return at.sort().pop() || undefined;
}

// ---------------------------------------------------------------- what's done, by area

const LEVEL_ORDER: ProofLevel[] = ['seen-working', 'partly-seen', 'automated'];

/** The proof level of a line, with the date of the newest passed run when it was seen working. */
function levelText(v: StoryView, year: string): string {
  const at = viewProofLevel(v) !== 'automated' ? shortDate(lastPassed(v), year) : '';
  return `${levelWords(v)}${at ? `, ${at}` : ''}`;
}

export interface Area {
  title: string;
  stories: StoryView[];
}

/** The areas of the done stories: the owner's (presentation.yaml), else by role; never more than MAX_GROUPS. */
export function doneAreas(done: StoryView[], inputs: PresentationInputs): Area[] {
  const areas: Area[] = [];
  const placed = new Set<string>();
  if (inputs.areas.length > 0) {
    for (const a of inputs.areas) {
      const stories = done.filter((v) => a.stories.includes(v.story.id) && !placed.has(v.story.id));
      stories.forEach((v) => placed.add(v.story.id));
      if (stories.length > 0) areas.push({ title: a.title, stories });
    }
    const rest = done.filter((v) => !placed.has(v.story.id));
    if (rest.length > 0) areas.push({ title: 'Other things now done', stories: rest });
  } else {
    const byRole = new Map<string, StoryView[]>();
    for (const v of done) {
      const name = v.role?.name ?? 'the user';
      byRole.set(name, [...(byRole.get(name) ?? []), v]);
    }
    for (const [name, stories] of byRole) areas.push({ title: `What ${/^the /i.test(name) ? name : `the ${lower(name)}`} can now do`, stories });
  }
  if (areas.length <= MAX_GROUPS) return areas;
  const keep = areas.slice(0, MAX_GROUPS - 1);
  return [...keep, { title: 'And more', stories: areas.slice(MAX_GROUPS - 1).flatMap((a) => a.stories) }];
}

/** One area as a card: one line per story when it has a few, else one line per proof level. */
export function areaCard(a: Area, year: string): GroupCard {
  if (a.stories.length <= MAX_LINES)
    return { title: a.title, tone: 'good', lines: a.stories.map((v) => ({ text: v.title, level: levelText(v, year), mark: 'done', ids: [v.story.id] })) };
  const lines: GroupLine[] = [];
  for (const level of LEVEL_ORDER) {
    const vs = a.stories.filter((v) => viewProofLevel(v) === level);
    if (vs.length === 0) continue;
    const passed = vs.reduce((n, v) => n + v.tests.passed, 0);
    const approved = vs.reduce((n, v) => n + v.approved, 0);
    const at = level === 'automated' ? '' : shortDate(vs.map(lastPassed).filter(Boolean).sort().pop(), year);
    const word = level === 'partly-seen' ? `partly seen working (${passed} of ${approved})` : level === 'seen-working' ? 'seen working' : 'checked by automated tests';
    lines.push({ text: names(vs.map((v) => v.title)), level: `${word}${at ? `, ${at}` : ''}`, mark: 'done', ids: vs.map((v) => v.story.id) });
  }
  return { title: a.title, tone: 'good', lines };
}

// ---------------------------------------------------------------- what's not done, by reason

export type Reason = 'test-fails' | 'check-fails' | 'stale' | 'approval' | 'building' | 'not-planned';

/** The one reason a story is not done: the first that holds, in this order. */
export function notDoneReason(v: StoryView): Reason {
  if (v.tests.failed > 0) return 'test-fails';
  if ((v.facts.unit?.failed ?? 0) > 0 || (v.facts.simulation?.problems ?? 0) > 0) return 'check-fails';
  if (v.sign?.status === 'stale' || (v.sign?.status === 'signed' && !v.sign.buildable)) return 'stale';
  if (v.scenarios.length === 0 || v.boxes === 0) return 'not-planned';
  if (!v.sign?.buildable) return 'approval';
  return 'building';
}

export const REASON_ORDER: Reason[] = ['test-fails', 'check-fails', 'stale', 'approval', 'building', 'not-planned'];

/** What each reason takes, and who acts: the owner ("me") or the builders. */
const REASON_TAKES: Record<Reason, { takes: string; who: string }> = {
  'test-fails': { takes: 'Fix the code until the test passes again.', who: 'the builders' },
  'check-fails': { takes: 'Fix what the automated checks find.', who: 'the builders' },
  stale: { takes: 'I read what changed and sign it off again.', who: 'me' },
  approval: { takes: 'I read each check, a worked example of what it must do, approve it, and sign the part off.', who: 'me' },
  building: { takes: 'The builders write the code for the pieces left.', who: 'the builders (AI agents)' },
  'not-planned': { takes: 'I write down what it must do and how we will check it.', who: 'me' },
};

const waitingChecks = (v: StoryView): number => v.scenarios.length - v.approved;
const unbuilt = (v: StoryView): number => Math.max(0, v.boxes - v.facts.built);

function failedStep(v: StoryView): string {
  for (const x of v.scenarios) if (x.approved && v.facts.tests[x.s.id] === 'failed') return plainStep(v.facts.runs?.[x.s.id]?.failedStep);
  return '';
}

function reasonTitle(r: Reason, vs: StoryView[]): string {
  switch (r) {
    case 'test-fails': {
      const n = vs.reduce((k, v) => k + v.tests.failed, 0);
      const step = vs.length === 1 && n === 1 ? failedStep(vs[0]!) : '';
      return n === 1 ? `A test fails${step ? `: ${cut(step, 60)}` : ''}` : `${n} tests fail`;
    }
    case 'check-fails':
      return 'An automated check fails';
    case 'stale':
      return 'Changed after it was signed off; needs a new sign-off';
    case 'approval': {
      const n = vs.reduce((k, v) => k + waitingChecks(v), 0);
      return n > 0 ? `Waiting for my approval: ${plural(n, 'check')}` : 'Waiting for my sign-off';
    }
    case 'building': {
      const n = vs.reduce((k, v) => k + unbuilt(v), 0);
      return `Being built: ${plural(n, 'piece')} not built yet`;
    }
    case 'not-planned':
      return 'Not planned yet';
  }
}

function reasonDetail(r: Reason, v: StoryView): string {
  switch (r) {
    case 'test-fails': {
      const step = failedStep(v);
      return step ? `fails at "${cut(step, 50)}"` : plural(v.tests.failed, 'test') + ' failing';
    }
    case 'check-fails':
      return missingThings(v)[0] ?? '';
    case 'stale':
      return v.sign?.status === 'stale' ? 'changed after the sign-off' : 'signed off under an older rule';
    case 'approval': {
      const n = waitingChecks(v);
      const build = unbuilt(v) === 0 && v.boxes > 0 ? ', already built' : '';
      return n > 0 ? `${plural(n, 'check')} to approve${build}` : `ready for my sign-off${build}`;
    }
    case 'building':
      return `${plural(unbuilt(v), 'piece')} left`;
    case 'not-planned':
      return v.scenarios.length === 0 ? 'no checks written yet' : 'nothing planned to build yet';
  }
}

export interface ReasonGroup {
  reason: Reason;
  stories: StoryView[];
}

export function notDoneGroups(notDone: StoryView[]): ReasonGroup[] {
  return REASON_ORDER.map((reason) => ({ reason, stories: notDone.filter((v) => notDoneReason(v) === reason) })).filter((g) => g.stories.length > 0);
}

export function reasonCard(g: ReasonGroup): GroupCard {
  const { takes, who } = REASON_TAKES[g.reason];
  const shown = g.stories.length <= MAX_LINES ? g.stories : g.stories.slice(0, MAX_LINES - 1);
  const lines: GroupLine[] = shown.map((v) => ({ text: v.title, level: reasonDetail(g.reason, v), mark: g.reason === 'test-fails' || g.reason === 'check-fails' || g.reason === 'stale' ? 'failed' : 'not-yet', ids: [v.story.id] }));
  const rest = g.stories.slice(shown.length);
  if (rest.length > 0) lines.push({ text: `and ${plural(rest.length, 'more part')} of the plan`, mark: 'not-yet', ids: rest.map((v) => v.story.id) });
  return { title: reasonTitle(g.reason, g.stories), tone: g.reason === 'test-fails' || g.reason === 'check-fails' || g.reason === 'stale' ? 'bad' : 'warn', lines, takes, who };
}

// ---------------------------------------------------------------- how we know

/** Pictures of passed runs of approved scenarios, newest first. */
export function proofPictures(views: StoryView[], year: string, max = MAX_PICTURES): { asset: string; caption: string; links?: Link[] }[] {
  const runs = views.flatMap((v) =>
    v.scenarios.flatMap((x) => {
      const run = v.facts.runs?.[x.s.id];
      return x.approved && v.facts.tests[x.s.id] === 'passed' && run?.picture ? [{ v, x, run }] : [];
    }),
  );
  runs.sort((a, b) => (b.run.at ?? '').localeCompare(a.run.at ?? ''));
  return runs.slice(0, max).map(({ x, run }) => ({
    asset: run.picture!,
    caption: `${cut(cap(plain(x.s.title)), 70)} — passed${run.at ? `, ${shortDate(run.at, year)}` : ''}`,
    ...(run.video ? { links: [{ href: run.video, text: '▶ recording' }] } : {}),
  }));
}

function howWeKnow(views: StoryView[], facts: DeckFacts, ev: DeckEvidence, ctx: ProofContext, hasPicture: (asset: string) => boolean, narrate: (made: string) => string): Slide {
  const year = ctx.year;
  const pictures = proofPictures(views, year).filter((p) => hasPicture(p.asset));
  const approved = views.reduce((n, v) => n + v.approved, 0);
  const passed = views.reduce((n, v) => n + v.tests.passed, 0);
  const failed = views.reduce((n, v) => n + v.tests.failed, 0);
  const items: { text: string; mark?: Mark }[] = [];

  // E2E tests on the real screens.
  const e = ev.e2e;
  const span = e.newest ? (e.oldest && e.oldest.slice(0, 10) !== e.newest.slice(0, 10) ? `, runs from ${shortDate(e.oldest, year)} to ${shortDate(e.newest, year)}` : `, run ${shortDate(e.newest, year)}`) : '';
  if (e.source === 'none' || !facts.testResults) items.push({ text: `Tests on the real screens: no results were found for this deck${e.why ? ` (${e.why})` : ''}, so nothing is called seen working.`, mark: 'not-yet' });
  else if (passed + failed === 0) items.push({ text: `Tests on the real screens: none of the ${plural(approved, 'approved check')} has run on the real screens yet (Birdview${span}).`, mark: 'not-yet' });
  else items.push({ text: `Tests on the real screens: ${passed} of ${plural(approved, 'approved check')} passed${failed > 0 ? `, ${failed} failed` : ''} in their last run (Birdview${span})${approved - passed - failed > 0 ? `; ${approved - passed - failed} have no run on the real screens yet` : ''}.`, mark: failed > 0 ? 'failed' : passed > 0 && passed >= approved ? 'done' : 'not-yet' });

  // Unit tests.
  const u = ev.unit;
  if (u.file) items.push({ text: `Automated tests: ${u.passed ?? 0} of ${u.tests ?? 0} passed${u.failed ? `, ${u.failed} failed` : ''}${u.date ? ` (run ${shortDate(u.date, year)})` : ''}.`, mark: u.failed ? 'failed' : 'done' });
  else items.push({ text: `Automated tests: not counted for this deck${u.why ? ` (${u.why.replace(/; pnpm test:report makes one$/, '')})` : ''}.`, mark: 'not-yet' });

  // The simulation.
  const simulated = views.filter((v) => v.facts.simulation);
  const problems = simulated.reduce((n, v) => n + v.facts.simulation!.problems, 0);
  if (simulated.length === 0) items.push({ text: 'The plan check: not run for this deck.', mark: 'not-yet' });
  else if (problems === 0) items.push({ text: 'The plan simulates clean: rehearse walked every check through the plan, step by step, and found no problem.', mark: 'done' });
  else items.push({ text: `The plan check finds ${plural(problems, 'problem')}.`, mark: 'failed' });

  // Signatures.
  const sg = ev.signatures;
  if (sg.checked === 0) items.push({ text: 'Sign-offs: none yet, so there is no signature to check.', mark: 'not-yet' });
  else
    items.push({
      text: sg.valid === sg.checked ? `Every sign-off is signed with ${ctx.owner}'s key, and every signature checks out (${sg.valid} of ${sg.checked}).` : `Sign-offs: ${sg.valid} of ${sg.checked} signatures check out; the others cannot be trusted yet.`,
      mark: sg.valid === sg.checked ? 'done' : 'failed',
    });

  // Where it all comes from.
  const birdview = e.newest ? `; Birdview test results of ${shortDate(e.newest, year)}` : '';
  const sources = `Where it comes from: the plan as committed at ${facts.commit.sha} on ${facts.commit.branch}, ${shortDate(facts.commit.date, year)}${facts.uncommitted ? ' (with changes not committed yet)' : ''}${birdview}.`;

  const meaning = `${DONE_RULE} "Seen working" means its tests used the product on the real screens, step by step, and passed; "checked by automated tests" means the tests of the code pass but no run on the real screens yet.`;
  const noPicture =
    ev.recordings.found === 0 ? 'No picture of a test run: Birdview kept no recording of these tests.' : 'No picture of a passed test run is available.';
  const right: Block[] = [
    { type: 'text', text: meaning },
    { type: 'list', items },
    { type: 'text', text: sources, tone: 'small' },
    { type: 'text', text: TRUST_SENTENCE, tone: 'good' },
  ];
  const blocks: Block[] = pictures.length > 0 ? [{ type: 'gallery', items: pictures }, ...right] : [...right.slice(0, 2), { type: 'text', text: noPicture, tone: 'muted' }, ...right.slice(2)];
  return {
    key: 'how-we-know',
    title: 'How we know',
    narration: narrate(
      `Nothing here is my say-so: ${pictures.length > 0 ? `the pictures are the last screens of tests that passed; ` : ''}the numbers come from the test runs, the plan check and the signatures, as they were at ${facts.commit.sha}.`,
    ),
    ids: [],
    ...(pictures.length > 0 ? { layout: 'split' as const } : {}),
    blocks,
  };
}

// ---------------------------------------------------------------- the summary

export interface SummaryInput {
  title: string;
  goal?: string;
  /** Every story (counts), and the ones shown (lists). */
  views: StoryView[];
  shown: StoryView[];
  hiddenNote?: string;
  facts: DeckFacts;
  evidence: DeckEvidence;
  ctx: ProofContext;
  inputs: PresentationInputs;
  notice?: string;
  /** Whether the deck carries a picture (asset key). */
  hasPicture: (asset: string) => boolean;
}

/** The next steps the record suggests, most important first: one per reason, then the proof. */
export function nextSteps(groups: ReasonGroup[], s: ReturnType<typeof standing>, max = 3): string[] {
  const out: string[] = [];
  for (const g of groups) {
    const titles = names(g.stories.map((v) => `"${v.title}"`), 2);
    if (g.reason === 'test-fails') out.push(`The builders fix the failing ${g.stories.reduce((n, v) => n + v.tests.failed, 0) === 1 ? 'test' : 'tests'} of ${titles}.`);
    else if (g.reason === 'check-fails') out.push(`The builders fix what the automated checks find in ${titles}.`);
    else if (g.reason === 'stale') out.push(`I read what changed in ${titles} and sign off again.`);
    else if (g.reason === 'approval') {
      const n = g.stories.reduce((k, v) => k + waitingChecks(v), 0);
      out.push(n > 0 ? `I approve the ${plural(n, 'check')} waiting for ${titles}, and sign ${g.stories.length === 1 ? 'it' : 'them'} off.` : `I sign off ${titles}.`);
    } else if (g.reason === 'building') out.push(`The builders build the ${plural(g.stories.reduce((n, v) => n + unbuilt(v), 0), 'piece')} left of ${titles}.`);
    else out.push(`I write the plan of ${titles}.`);
  }
  if (s.automated + s.partly > 0) out.push(`Run tests on the real screens for the ${plural(s.automated + s.partly, 'part')} only checked by automated tests so far, so ${s.automated + s.partly === 1 ? 'it is' : 'they are'} seen working too.`);
  return out.slice(0, max);
}

/** The summary slides: where we are, done, not done and why, how we know, asks, next. */
export function summarySlides(x: SummaryInput): Slide[] {
  const { views, shown, facts, evidence, ctx, inputs } = x;
  const narrate = (key: string, made: string) => inputs.narration[key] ?? made;
  const s = standing(views);
  const sentence = summarySentence(s);
  const failing = views.reduce((n, v) => n + v.tests.failed, 0);
  const slides: Slide[] = [];

  // 1. Where we are
  const titleBlocks: Block[] = [];
  const goal = sentences(x.goal ?? '', 220);
  if (goal) titleBlocks.push({ type: 'lead', text: stop(goal) });
  if (x.notice) titleBlocks.push({ type: 'notice', text: x.notice });
  titleBlocks.push({ type: 'text', text: sentence + (x.hiddenNote ? ` ${x.hiddenNote}` : ''), ...(failing > 0 ? { tone: 'warn' as const } : s.done === s.total ? { tone: 'good' as const } : {}) });
  titleBlocks.push({
    type: 'bar',
    segments: [
      { label: s.partly === 0 ? 'seen working' : s.seen === 0 ? 'partly seen working' : `seen working (${s.partly} partly)`, count: s.seen + s.partly, tone: 'good' },
      { label: 'done, checked by automated tests', count: s.automated, tone: 'ok' },
      { label: 'not done yet', count: s.total - s.done, tone: failing > 0 ? 'bad' : 'todo' },
    ],
  });
  titleBlocks.push({ type: 'text', text: `Presented by ${ctx.owner} · ${facts.commit.date}`, tone: 'muted' });
  slides.push({ key: 'title', title: x.title, narration: narrate('title', `Where we are with "${x.title}", as of ${facts.commit.date}. ${sentence}`), ids: [], blocks: titleBlocks });

  // 2. What's done
  const done = shown.filter((v) => viewDoneState(v) === 'done');
  const areas = doneAreas(done, inputs);
  slides.push({
    key: 'done',
    title: "What's done",
    narration: narrate(
      'done',
      done.length === 0
        ? 'No part of the plan is done yet: none is both built and signed off.'
        : `${plural(done.length, 'part')} of the plan ${done.length === 1 ? 'is' : 'are'} built and signed off. Each line says how strong its proof is: seen working on the real screens, or checked by automated tests.`,
    ),
    ids: [],
    blocks:
      done.length === 0
        ? [{ type: 'text', text: 'Nothing is done yet: no part of the plan is both built and signed off.', tone: 'warn' }]
        : [{ type: 'groups', items: areas.map((a) => areaCard(a, ctx.year)) }],
  });

  // 3. What's not done yet, and why
  const notDone = shown.filter((v) => viewDoneState(v) !== 'done');
  const groups = notDoneGroups(notDone);
  const capped = groups.length <= MAX_GROUPS ? groups : [...groups.slice(0, MAX_GROUPS - 1), { reason: groups[MAX_GROUPS - 1]!.reason, stories: groups.slice(MAX_GROUPS - 1).flatMap((g) => g.stories) }];
  slides.push({
    key: 'not-done',
    title: "What's not done yet, and why",
    narration: narrate(
      'not-done',
      notDone.length === 0
        ? 'Nothing is left: every part of the plan is done.'
        : `${plural(notDone.length, 'part')} of the plan ${notDone.length === 1 ? 'is' : 'are'} not done yet, for ${plural(groups.length, 'reason')}. Each says what it takes and who acts.`,
    ),
    ids: [],
    blocks: notDone.length === 0 ? [{ type: 'text', text: 'Nothing: every part of the plan is done.', tone: 'good' }] : [{ type: 'groups', items: capped.map(reasonCard) }],
  });

  // 4. How we know
  slides.push(howWeKnow(views, facts, evidence, ctx, x.hasPicture, (made) => narrate('how-we-know', made)));

  // 5. What I need from you (only when the owner asks something), and what's next
  if (inputs.asks.length > 0)
    slides.push({
      key: 'asks',
      title: 'What I need from you',
      narration: narrate('asks', `I need ${plural(inputs.asks.length, 'thing')} from you to keep this moving.`),
      ids: [],
      blocks: [{ type: 'list', items: inputs.asks.map((a) => ({ text: a })) }],
    });
  const steps = inputs.next.length > 0 ? inputs.next : nextSteps(groups, s);
  slides.push({
    key: 'next',
    title: "What's next",
    narration: narrate('next', inputs.next.length > 0 ? 'These are my next steps.' : steps.length === 0 ? 'Nothing is left: every part of the plan is done and seen working.' : 'The next steps, most important first.'),
    ids: [],
    blocks: steps.length > 0 ? [{ type: 'list', items: steps.map((t) => ({ text: lower(t) === t ? cap(t) : t })) }] : [{ type: 'text', text: 'Nothing is left: every part of the plan is done and seen working.', tone: 'good' }],
  });
  return slides;
}

/** The first slide of the appendix of the full deck. */
export function detailsSlide(narration: string | undefined, stories: number): Slide {
  return {
    key: 'details',
    title: 'Details, story by story',
    narration: narration ?? 'The rest of this deck is the detail behind the summary: every part of the plan, one by one, with its checks and its proof.',
    ids: [],
    blocks: [
      { type: 'lead', text: `The slides after this one show each of the ${plural(stories, 'part')} of the plan on its own: what it is for, how it works, what was checked, and the proof.` },
      { type: 'text', text: 'In these slides a part of the plan is called a story, and a check is called a scenario.', tone: 'muted' },
    ],
  };
}
