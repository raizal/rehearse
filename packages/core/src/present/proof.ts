// What is done, what is not, and the proof (T53). Box story-done-state: one rule for "done", used by
// every slide. Box build-recap: the recap slide right after the title. Box proof-lines: one line per
// source of proof on a story slide, each honest when its source is missing. Box evidence-page:
// where each kind of proof comes from. Pure: the deck's story views and facts in, blocks out.

import type { Block, DeckEvidence, DeckFacts, Link, Mark, ProofRow, RecapItem, Slide, StoryView } from './deck.js';
import { plain } from './plain.js';

// ---------------------------------------------------------------- the done rule

export type DoneState = 'done' | 'in-progress' | 'not-started';

export const DONE_RULE = 'Done means: the plan is approved, it is built, its checks pass, and it is signed off.';

export const DONE_WORDS: Record<DoneState, string> = { done: 'Done', 'in-progress': 'In progress', 'not-started': 'Not started' };

export interface DoneInput {
  /** Signed off under the current rule and unchanged since. */
  signedOff: boolean;
  /** The sign-off state: never signed (draft or none), signed, or changed since (stale). */
  signStatus?: 'signed' | 'stale' | 'draft';
  /** Approved scenarios, and of them the ones whose e2e test passed in its last known run. */
  approved: number;
  passed: number;
  /** Parts of the plan, and of them the ones with code. */
  boxes: number;
  built: number;
}

/**
 * Done: signed off and not stale, every approved scenario's e2e test passed in its last known run
 * (at least one: nothing approved proves nothing), every part has code. Not started: never signed
 * off and no part has code. In progress: everything else.
 */
export function storyDoneState(x: DoneInput): DoneState {
  if (x.signedOff && x.approved > 0 && x.passed === x.approved && x.boxes > 0 && x.built >= x.boxes) return 'done';
  if ((x.signStatus === undefined || x.signStatus === 'draft') && x.built <= 0) return 'not-started';
  return 'in-progress';
}

export function viewDoneState(v: StoryView): DoneState {
  return storyDoneState({
    signedOff: v.sign?.buildable === true,
    ...(v.sign ? { signStatus: v.sign.status } : {}),
    approved: v.approved,
    passed: v.tests.passed,
    boxes: v.boxes,
    built: Math.min(v.facts.built, v.boxes),
  });
}

// ---------------------------------------------------------------- words

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const cap = (s: string): string => (s === '' ? s : s[0]!.toUpperCase() + s.slice(1));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-06…" → "6 Nov" (the year too when it is not `year`). */
export function shortDate(at: string | undefined, year?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(at ?? '');
  if (!m) return '';
  const d = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]}`;
  return year !== undefined && m[1] === year ? d : `${d} ${m[1]}`;
}

/** The person part of a git email: "raizal.pregnanta@x.com" → "raizal.pregnanta". */
export function person(by: string | undefined): string {
  if (!by) return 'someone';
  return by.includes('@') ? by.split('@')[0]! : by;
}

/** A failed test step as plain words: "check-box: the box turns red" → "the box turns red". */
export function plainStep(step: string | undefined): string {
  if (!step) return '';
  const at = step.indexOf(': ');
  const words = at > 0 && /^[a-z0-9][a-z0-9/-]*$/.test(step.slice(0, at)) ? step.slice(at + 2) : step;
  return plain(words);
}

function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  const c = s.slice(0, max);
  const space = c.lastIndexOf(' ');
  return `${c.slice(0, space > max / 2 ? space : max).replace(/[,;:]$/, '')}…`;
}

/** Runs of the story's approved scenarios, newest first. */
function approvedRuns(v: StoryView) {
  return v.scenarios
    .filter((x) => x.approved)
    .map((x) => ({ s: x.s, state: v.facts.tests[x.s.id] ?? 'not-written', run: v.facts.runs?.[x.s.id] }))
    .sort((a, b) => (b.run?.at ?? '').localeCompare(a.run?.at ?? ''));
}

/** "last run 6 Nov", or "runs from 3 Nov to 6 Nov". */
function runDates(v: StoryView, year: string): string {
  const days = [...new Set(approvedRuns(v).flatMap((r) => (r.run?.at && (r.state === 'passed' || r.state === 'failed') ? [r.run.at.slice(0, 10)] : [])))].sort();
  if (days.length === 0) return '';
  if (days.length === 1) return `last run ${shortDate(days[0], year)}`;
  return `runs from ${shortDate(days[0], year)} to ${shortDate(days[days.length - 1], year)}`;
}

/** Links to the copied recordings of the story's approved scenarios, newest first. */
export function recordingLinks(v: StoryView): Link[] {
  return approvedRuns(v).flatMap((r) => (r.run?.video ? [{ href: r.run.video, text: `▶ ${cut(cap(plain(r.s.title)), 38)}` }] : []));
}

/** Approved scenarios whose last run was recorded, the video kept by the owner (not copied). */
function keptRecordings(v: StoryView): number {
  return approvedRuns(v).filter((r) => r.run?.recorded && !r.run.video).length;
}

// ---------------------------------------------------------------- what is missing, most important first

/** What keeps a story from done, the most important first. Empty for a done story. */
export function missingThings(v: StoryView): string[] {
  if (viewDoneState(v) === 'done') return [];
  const out: string[] = [];
  const failed = approvedRuns(v).filter((r) => r.state === 'failed');
  if (failed.length > 0) {
    const step = plainStep(failed[0]!.run?.failedStep);
    out.push(`${failed.length === 1 ? 'a test fails' : `${failed.length} tests fail`}${step ? `: ${cut(step, 70)}` : ''}`);
  }
  if (v.sign?.status === 'stale') out.push('changed after sign-off: needs a new sign-off');
  else if (v.sign?.status === 'signed' && !v.sign.buildable) out.push('signed off under an older rule: needs a new sign-off');
  const waiting = v.scenarios.length - v.approved;
  if (v.scenarios.length === 0) out.push('no scenarios written yet');
  else if (waiting > 0) out.push(`waiting for my approval (${plural(waiting, 'scenario')})`);
  else if (!v.sign || v.sign.status === 'draft') out.push('waiting for my sign-off');
  if (v.boxes === 0) out.push('nothing planned to build yet');
  else if (v.facts.built < v.boxes) out.push(`${plural(v.boxes - v.facts.built, 'part')} not built`);
  if (v.tests['not-written'] > 0) out.push(`${v.tests['not-written']} of ${plural(v.approved, 'test')} not written yet`);
  if (v.tests['not-run'] > 0) out.push(`${v.tests['not-run']} of ${plural(v.approved, 'test')} not run yet`);
  if (out.length === 0) out.push('not proven yet');
  return out;
}

// ---------------------------------------------------------------- proof lines

export interface ProofContext {
  /** The deck's year: dates in it leave the year out. */
  year: string;
  owner: string;
  evidence: DeckEvidence;
}

/** One proof row per source, for a story slide. */
export function proofRows(v: StoryView, ctx: ProofContext): ProofRow[] {
  const rows: ProofRow[] = [];
  const t = v.tests;
  const runs = approvedRuns(v);

  // E2E tests (Birdview)
  if (v.approved === 0) rows.push({ label: 'E2E tests', text: v.scenarios.length === 0 ? 'no scenarios yet, so no test counts' : 'no approved scenario yet, so no test counts', tone: 'muted' });
  else {
    const bits: string[] = [];
    if (t.passed > 0) bits.push(`${t.passed} of ${v.approved} passed`);
    if (t.failed > 0) {
      const step = plainStep(runs.find((r) => r.state === 'failed')?.run?.failedStep);
      bits.push(`${t.failed} failed${step ? ` at "${cut(step, 60)}"` : ''}`);
    }
    if (t['not-run'] > 0) bits.push(`${t['not-run']} not run${ctx.evidence.e2e.source === 'none' ? ' (no test results found)' : ''}`);
    if (t['not-written'] > 0) bits.push(`${t['not-written']} not written`);
    const dates = runDates(v, ctx.year);
    rows.push({ label: 'E2E tests', text: `${bits.join(', ')}${dates ? ` · ${dates}` : ''}`, tone: t.failed > 0 ? 'bad' : t.passed === v.approved ? 'good' : 'warn' });
  }

  // Recording
  const links = recordingLinks(v);
  const kept = keptRecordings(v);
  if (links.length > 0) rows.push({ label: 'Recording', text: links.length === 1 ? '' : `${links.length} videos:`, links });
  else if (kept > 0) rows.push({ label: 'Recording', text: `${kept === 1 ? 'recording' : `${kept} recordings`} kept by ${ctx.owner}`, tone: 'muted' });
  else if (v.approved > 0) rows.push({ label: 'Recording', text: 'Birdview kept no recording of these tests', tone: 'muted' });

  // Unit tests
  const u = v.facts.unit;
  if (!u) rows.push({ label: 'Unit tests', text: 'not counted for this deck', tone: 'muted' });
  else if (u.tests === 0) rows.push({ label: 'Unit tests', text: "no automated test names this story's scenarios", tone: 'muted' });
  else
    rows.push({
      label: 'Unit tests',
      text: `${plural(u.tests, 'automated test')} name this story's scenarios: ${u.failed > 0 ? `${u.passed} pass, ${u.failed} fail` : u.passed === u.tests ? (u.tests === 1 ? 'it passes' : 'all pass') : `${u.passed} pass, ${u.tests - u.passed} skipped`}`,
      tone: u.failed > 0 ? 'bad' : u.passed === u.tests ? 'good' : 'warn',
    });

  // Simulation
  const sim = v.facts.simulation;
  if (!sim) rows.push({ label: 'Simulation', text: 'not run for this deck', tone: 'muted' });
  else if (sim.problems > 0) rows.push({ label: 'Simulation', text: `${plural(sim.problems, 'problem')} found in the plan`, tone: 'bad' });
  else
    rows.push({
      label: 'Simulation',
      text: `the plan simulates clean${sim.uncovered > 0 ? `; ${plural(sim.uncovered, 'path')}, often an error case, no approved scenario walks yet` : ''}`,
      tone: sim.uncovered > 0 ? 'warn' : 'good',
    });

  // Built
  if (v.boxes === 0) rows.push({ label: 'Built', text: 'nothing planned to build yet', tone: 'muted' });
  else {
    const commits = v.facts.commits;
    rows.push({ label: 'Built', text: `${v.facts.built} of ${plural(v.boxes, 'part')} ${v.facts.built === 1 ? 'has' : 'have'} code${commits !== undefined ? ` (${plural(commits, 'commit')})` : ''}`, tone: v.facts.built >= v.boxes ? 'good' : 'warn' });
  }

  // Signed
  const s = v.sign;
  if (s?.buildable) {
    const sig = v.facts.signature;
    const sigText = sig === 'valid' ? ', signature checked' : sig === 'missing' ? ', but it has no signature' : sig === 'invalid' ? ', but the signature does not match' : sig === 'unknown-signer' ? ', but the key is not one the repo trusts' : ', signature not checked';
    rows.push({ label: 'Signed', text: `signed off by ${person(s.by)} on ${shortDate(s.at, ctx.year)}${sigText}`, tone: sig === 'valid' ? 'good' : 'warn' });
  } else if (s?.status === 'stale') rows.push({ label: 'Signed', text: `changed after ${person(s.by)} signed it off on ${shortDate(s.at, ctx.year)}: needs a new sign-off`, tone: 'bad' });
  else if (s?.status === 'signed') rows.push({ label: 'Signed', text: 'signed off under an older rule: needs a new sign-off', tone: 'warn' });
  else rows.push({ label: 'Signed', text: 'not signed off yet', tone: 'warn' });
  return rows;
}

// ---------------------------------------------------------------- recap

export interface Standing {
  done: number;
  inProgress: number;
  notStarted: number;
  total: number;
}

export function standing(views: StoryView[]): Standing {
  const states = views.map(viewDoneState);
  return { done: states.filter((s) => s === 'done').length, inProgress: states.filter((s) => s === 'in-progress').length, notStarted: states.filter((s) => s === 'not-started').length, total: views.length };
}

/** "6 of 18 stories are done. 9 are in progress. 3 are not started." */
export function standingSentence(s: Standing): string {
  const parts = [`${s.done} of ${plural(s.total, 'story', 'stories')} ${s.done === 1 ? 'is' : 'are'} done.`];
  if (s.inProgress > 0) parts.push(`${s.inProgress} ${s.inProgress === 1 ? 'is' : 'are'} in progress.`);
  if (s.notStarted > 0) parts.push(`${s.notStarted} ${s.notStarted === 1 ? 'is' : 'are'} not started.`);
  return parts.join(' ');
}

export function recapItem(v: StoryView, ctx: ProofContext): RecapItem {
  const state = viewDoneState(v);
  if (state === 'done') {
    const links = recordingLinks(v).slice(0, 1).map((l) => ({ ...l, text: '▶ recording' }));
    const kept = links.length === 0 && keptRecordings(v) > 0 ? ` · recording kept by ${ctx.owner}` : '';
    const text = `${v.title} — signed off ${shortDate(v.sign?.at, ctx.year)} by ${person(v.sign?.by)} · ${v.tests.passed} of ${v.approved} checks pass${kept}`;
    return { id: v.story.id, text, mark: 'done', state, ...(links.length > 0 ? { links } : {}) };
  }
  const missing = missingThings(v);
  // The two most important things, so a reader sees what is left without opening the story.
  const more = missing.length > 1 ? ` · ${missing[1]}${missing.length > 2 ? ` · +${missing.length - 2} more` : ''}` : '';
  const mark: Mark = v.tests.failed > 0 || v.sign?.status === 'stale' ? 'failed' : state === 'in-progress' ? 'partly' : 'not-yet';
  return { id: v.story.id, text: `${v.title} — ${missing[0]}${more}`, mark, state };
}

/** Items per slide before the recap goes compact, and before it splits in two. */
export const RECAP_ROOMY = 10;
export const RECAP_MAX = 30;

/** The recap slide(s): done on the left, not done on the right; split only when it cannot fit. */
export function recapSlides(views: StoryView[], all: StoryView[], ctx: ProofContext, narration: (made: string) => string, hiddenNote?: string): Slide[] {
  const s = standing(all);
  const sentence = standingSentence(s);
  const items = views.map((v) => recapItem(v, ctx));
  const done = items.filter((i) => i.state === 'done');
  // Not done: in progress first (problems first), then not started, record order inside each.
  const rank = (i: RecapItem) => (i.state === 'not-started' ? 2 : i.mark === 'failed' ? 0 : 1);
  const notDone = items.filter((i) => i.state !== 'done').sort((a, b) => rank(a) - rank(b));
  const pages: { done: RecapItem[]; notDone: RecapItem[] }[] = [];
  if (items.length <= RECAP_MAX) pages.push({ done, notDone });
  else {
    const n = Math.ceil(items.length / RECAP_MAX);
    const perDone = Math.ceil(done.length / n);
    const perNot = Math.ceil(notDone.length / n);
    for (let i = 0; i < n; i++) pages.push({ done: done.slice(i * perDone, (i + 1) * perDone), notDone: notDone.slice(i * perNot, (i + 1) * perNot) });
  }
  const failing = all.reduce((n, v) => n + v.tests.failed, 0);
  const made = `${sentence} ${s.done > 0 ? 'Each done story shows its proof' : 'No story meets the rule for done yet'}; each one not done shows the most important things it still needs.`;
  return pages.map((p, i) => {
    const blocks: Block[] = [
      { type: 'text', text: sentence + (hiddenNote ? ` ${hiddenNote}` : ''), tone: failing > 0 ? 'warn' : s.done === s.total ? 'good' : 'muted' },
      { type: 'recap', done: p.done, notDone: p.notDone, compact: p.done.length + p.notDone.length > RECAP_ROOMY, doneTotal: done.length, notDoneTotal: notDone.length },
      { type: 'text', text: DONE_RULE, tone: 'small' },
    ];
    return {
      key: i === 0 ? 'recap' : `recap-${i + 1}`,
      title: pages.length === 1 ? 'What is done, what is not' : `What is done, what is not (${i + 1}/${pages.length})`,
      narration: i === 0 ? narration(made) : 'The rest of the stories, the same way.',
      ids: [],
      blocks,
    };
  });
}

// ---------------------------------------------------------------- evidence page

export const TRUST_SENTENCE = 'Made by rehearse from the record and the test runs, not written by hand.';

export const NO_EVIDENCE: DeckEvidence = {
  e2e: { source: 'none', used: 0, dropped: 0, why: 'no test results were looked up' },
  recordings: { found: 0, pictures: 0, picturesLeftOut: 0, picturesBytes: 0 },
  unit: { why: 'no unit report was given' },
  signatures: { file: '.rehearse/allowed_signers', checked: 0, valid: 0 },
};

const kb = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Where each kind of proof comes from, plainly. */
export function evidenceSlide(facts: DeckFacts, ev: DeckEvidence, owner: string, narration: (made: string) => string): Slide {
  const year = facts.commit.date.slice(0, 4);
  const items: { text: string; mark?: Mark }[] = [];
  items.push({
    text: `The plan: the record of this EPIC as committed at ${facts.commit.sha} on ${facts.commit.branch}, ${shortDate(facts.commit.date)}.${facts.uncommitted ? ' It includes changes that are not committed yet.' : ''}`,
  });
  const e = ev.e2e;
  const span = e.oldest && e.newest ? (e.oldest.slice(0, 10) === e.newest.slice(0, 10) ? `, all run on ${shortDate(e.oldest, year)}` : `, run between ${shortDate(e.oldest, year)} and ${shortDate(e.newest, year)}`) : '';
  const dropped = e.dropped > 0 ? ` ${plural(e.dropped, 'saved result')} ${e.dropped === 1 ? 'was' : 'were'} left out because ${e.dropped === 1 ? 'it no longer matches' : 'they no longer match'} a test.` : '';
  if (e.source === 'saved')
    items.push({ text: `E2E test results: Birdview's saved results, the file ${e.file ?? 'of the project'}${e.project ? `, for the test project ${e.project}` : ''}${e.note ? ` (${e.note})` : ''}. ${plural(e.used, 'result')} used${span}.${dropped}` });
  else if (e.source === 'player') items.push({ text: `E2E test results: the running Birdview player${e.project ? `, test project ${e.project}` : ''}. ${plural(e.used, 'result')} used${span}.${dropped}` });
  else items.push({ text: `E2E test results: none were found${e.why ? ` (${e.why})` : ''}, so every written test shows as "not run".`, mark: 'not-yet' });

  const r = ev.recordings;
  if (r.found === 0) items.push({ text: 'Recordings: Birdview kept no recording of the test runs used, so this deck has no videos or pictures of them.', mark: 'not-yet' });
  else if (r.copied) items.push({ text: `Recordings: ${plural(r.found, 'video')} copied next to this deck, in the folder ${r.copied}; the links open them.` });
  else if (r.found > 0) items.push({ text: `Recordings: ${plural(r.found, 'video')} of these tests ${r.found === 1 ? 'is' : 'are'} kept by ${owner}, not sent with this deck.` });
  if (r.pictures > 0 || r.picturesLeftOut > 0)
    items.push({ text: `Pictures: ${plural(r.pictures, 'still')} of the last screen, taken from the recordings (${kb(r.picturesBytes)} in total)${r.picturesLeftOut > 0 ? `; ${r.picturesLeftOut} more left out to keep the deck small` : ''}.` });

  const u = ev.unit;
  if (u.file) items.push({ text: `Unit tests: the report ${u.file}${u.date ? `, made ${shortDate(u.date, year)}` : ''}: ${plural(u.tests ?? 0, 'test')}, ${u.passed ?? 0} pass${u.failed ? `, ${u.failed} fail` : ''}.` });
  else items.push({ text: `Unit tests: not used for this deck${u.why ? ` (${u.why})` : ''}.`, mark: 'not-yet' });

  const sg = ev.signatures;
  items.push({
    text:
      sg.checked > 0
        ? `Signatures: the latest sign-off of each signed story was checked against the keys the repo trusts (${sg.file}): ${sg.valid} of ${plural(sg.checked, 'story', 'stories')} check out. The gate checks every approval the same way.`
        : `Signatures: no story is signed off yet, so there was no signature to check (the keys the repo trusts are in ${sg.file}).`,
  });
  items.push({ text: `Built parts: a part counts as built when a commit up to ${facts.commit.sha} says it builds that part.` });
  items.push({ text: 'Simulation: rehearse walks every scenario through the plan, step by step, and lists what does not fit.' });
  return {
    key: 'evidence',
    title: 'Where the proof comes from',
    narration: narration('Every line of proof in this deck comes from one of these sources.'),
    ids: [],
    blocks: [
      { type: 'list', items },
      { type: 'text', text: TRUST_SENTENCE, tone: 'good' },
    ],
  };
}
