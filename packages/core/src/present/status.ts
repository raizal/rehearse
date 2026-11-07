// The Status page and `rehearse status` (T58, S23). Box status-table: one row per story — signed,
// built, tests on the real screens, automated tests, done, and what is missing and who acts — and
// a header sentence. Box status-sources: where the facts come from and when. The rows come from the
// deck's own story views and its one done rule (proof.ts), so the page and the deck never disagree.
// Pure: the record and the facts the server gathered in, the table out.

import type { EpicRecord, Id, Story } from '../types.js';
import { asArray, isObject } from '../util.js';
import { builtWords, type BoxEvidence } from './built.js';
import { storyView, type DeckFacts, type StoryView } from './deck.js';
import { plain } from './plain.js';
import { LEVEL_WORDS, missingItems, standing, viewDoneState, viewProofLevel, type Actor, type DoneState, type ProofLevel } from './proof.js';

export type SignedState = 'yes' | 'changed' | 'no';

export interface StatusRow {
  id: Id;
  title: string;
  signed: { state: SignedState; text: string };
  built: { built: number; boxes: number; text: string; evidence: BoxEvidence[] };
  /** The approved scenarios' e2e tests on the real screens (Birdview). */
  e2e: { approved: number; passed: number; failed: number; notRun: number; notWritten: number; text: string; tone: 'good' | 'warn' | 'bad' | 'muted' };
  /** Unit tests that name the story's scenarios or criteria, from the unit report. */
  unit: { text: string; tone: 'good' | 'warn' | 'bad' | 'muted'; tests?: number; passed?: number; failed?: number };
  done: { state: DoneState; level?: ProofLevel; text: string };
  /** Done, but not every approved scenario was seen passing on the real screens. */
  seenWorking: boolean;
  missing: { text: string; who: Actor; blocking: boolean }[];
}

export interface StatusSources {
  commit: string;
  e2e: string;
  unit: string;
  graph: string;
}

export interface StatusTable {
  slug: string;
  title: string;
  /** "18 of 21 stories done · 2 seen working on the real screens · 3 not done" */
  header: string;
  counts: { stories: number; done: number; seen: number; notDone: number; doneNotSeen: number };
  /** Not done first, then done but not seen working, then the rest; in record order within each. */
  rows: StatusRow[];
  sources: StatusSources;
}

export type StatusFilter = 'all' | 'not-done' | 'done-not-seen';

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function signedOf(v: StoryView): StatusRow['signed'] {
  if (v.sign?.buildable) return { state: 'yes', text: 'yes' };
  if (v.sign?.status === 'stale') return { state: 'changed', text: 'changed since sign-off' };
  if (v.sign?.status === 'signed') return { state: 'no', text: 'no (signed under an older rule)' };
  return { state: 'no', text: 'no' };
}

function e2eOf(v: StoryView, facts: DeckFacts): StatusRow['e2e'] {
  const t = v.tests;
  const base = { approved: v.approved, passed: t.passed, failed: t.failed, notRun: t['not-run'], notWritten: t['not-written'] };
  if (v.approved === 0) return { ...base, text: v.scenarios.length === 0 ? 'no scenarios yet' : 'no approved scenario yet', tone: 'muted' };
  if (t.failed > 0) return { ...base, text: `${t.failed} failing${t.passed > 0 ? `, ${t.passed} of ${v.approved} passed` : ''}`, tone: 'bad' };
  if (t.passed > 0) return { ...base, text: `${t.passed} of ${v.approved} passed`, tone: t.passed >= v.approved ? 'good' : 'warn' };
  if (t['not-written'] === v.approved) return { ...base, text: 'none yet', tone: 'muted' };
  // Written, never seen run: say whether the results could be read at all.
  if (!facts.testResults && facts.evidence?.e2e.source === 'none') return { ...base, text: 'Birdview results not found', tone: 'muted' };
  return { ...base, text: `${plural(t['not-run'], 'test')} not run yet`, tone: 'muted' };
}

function unitOf(v: StoryView): StatusRow['unit'] {
  const u = v.facts.unit;
  // No unit report was read: the sources line says why.
  if (!u) return { text: 'not run', tone: 'muted' };
  if (u.tests === 0) return { text: 'no test names it', tone: 'muted', tests: 0, passed: 0, failed: 0 };
  if (u.failed > 0) return { text: `${u.failed} failing, ${u.passed} of ${u.tests} passed`, tone: 'bad', ...u };
  return { text: `${u.passed} of ${u.tests} passed`, tone: u.passed >= u.tests ? 'good' : 'warn', ...u };
}

function doneOf(v: StoryView): StatusRow['done'] {
  const state = viewDoneState(v);
  const level = viewProofLevel(v);
  if (state !== 'done') return { state, text: 'not done' };
  const u = v.facts.unit;
  // The deck's level, plus what is known of the automated tests: never claim a check nobody read.
  const caveat = level !== 'automated' ? '' : !u ? ' (no unit report read)' : u.tests === 0 ? ' (no unit test names it)' : '';
  return { state, ...(level ? { level } : {}), text: `done · ${level === 'partly-seen' ? `${LEVEL_WORDS[level]} (${v.tests.passed} of ${v.approved})` : LEVEL_WORDS[level ?? 'automated']}${caveat}` };
}

/** One row of the Status page. */
export function statusRow(v: StoryView, facts: DeckFacts): StatusRow {
  const done = doneOf(v);
  const built = Math.min(v.facts.built, v.boxes);
  return {
    id: v.story.id,
    title: plain(v.title),
    signed: signedOf(v),
    built: { built, boxes: v.boxes, text: builtWords(built, v.boxes), evidence: v.facts.boxes ?? [] },
    e2e: e2eOf(v, facts),
    unit: unitOf(v),
    done,
    seenWorking: done.level === 'seen-working',
    missing: missingItems(v).map(({ text, who, blocking }) => ({ text, who, blocking })),
  };
}

const rank = (r: StatusRow): number => (r.done.state !== 'done' ? 0 : r.seenWorking ? 2 : 1);

/** Box status-sources: where the facts come from and when, in plain words. */
export function statusSources(facts: DeckFacts): StatusSources {
  const ev = facts.evidence;
  const day = (at: string | undefined) => (at ? at.slice(0, 10) : '');
  const e2e = !ev
    ? 'not looked up'
    : ev.e2e.source === 'player'
      ? `the running Birdview player${ev.e2e.newest ? `, last run ${day(ev.e2e.newest)}` : ''}`
      : ev.e2e.source === 'saved'
        ? `Birdview's saved results${ev.e2e.file ? ` (${ev.e2e.file})` : ''}${ev.e2e.newest ? `, newest run ${day(ev.e2e.newest)}` : ''}`
        : `Birdview results not found: ${ev.e2e.why ?? 'nothing to read'}`;
  const unit = !ev ? 'not looked up' : ev.unit.file ? `${ev.unit.file}${ev.unit.date ? `, made ${day(ev.unit.date)}` : ''}` : `no unit report: ${ev.unit.why ?? 'none given'}`;
  const graph = !facts.codeGraph
    ? 'not looked up: "built" counts Flow-Box commits only'
    : facts.codeGraph.ok
      ? `the code graph${facts.codeGraph.at ? `, updated ${facts.codeGraph.at.replace('T', ' ').slice(0, 16)}` : ''}, and Flow-Box commits`
      : `code graph not built yet: "built" counts Flow-Box commits only (${facts.codeGraph.why ?? 'no graph'})`;
  return {
    commit: `${facts.commit.branch} @ ${facts.commit.sha}, ${facts.commit.date}${facts.uncommitted ? ', with uncommitted changes in the EPIC folder' : ''}`,
    e2e,
    unit,
    graph,
  };
}

/** Box status-table: the Status page of an EPIC. */
export function statusTable(record: EpicRecord, facts: DeckFacts): StatusTable {
  const stories = asArray<Story>(record.prd?.stories).filter((s) => isObject(s) && typeof s.id === 'string');
  const views = stories.map((s) => storyView(record, facts, s));
  const st = standing(views);
  const rows = views.map((v) => statusRow(v, facts));
  const order = new Map(rows.map((r, i) => [r.id, i]));
  rows.sort((a, b) => rank(a) - rank(b) || order.get(a.id)! - order.get(b.id)!);
  const notDone = st.total - st.done;
  return {
    slug: record.slug,
    title: plain(record.prd?.epic?.title) || record.slug,
    header: `${st.done} of ${plural(st.total, 'story', 'stories')} done · ${st.seen} seen working on the real screens · ${notDone} not done`,
    counts: { stories: st.total, done: st.done, seen: st.seen, notDone, doneNotSeen: st.done - st.seen },
    rows,
    sources: statusSources(facts),
  };
}

/** The rows a filter keeps. */
export function filterRows(rows: readonly StatusRow[], filter: StatusFilter): StatusRow[] {
  if (filter === 'not-done') return rows.filter((r) => r.done.state !== 'done');
  if (filter === 'done-not-seen') return rows.filter((r) => r.done.state === 'done' && !r.seenWorking);
  return [...rows];
}

/** "2 boxes not built (happy, more-scenarios): builders" */
export const missingLine = (m: StatusRow['missing'][number]): string => `${m.text}: ${m.who}`;

const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));

/** The table as `rehearse status` prints it. */
export function statusText(t: StatusTable, filter: StatusFilter = 'all'): string {
  const rows = filterRows(t.rows, filter);
  const head = ['Story', 'Signed', 'Built', 'Real screens', 'Automated', 'Done', "What's missing — who acts"];
  const cells = rows.map((r) => [r.id, r.signed.text, r.built.text, r.e2e.text, r.unit.text, r.done.text, r.missing.map(missingLine).join('; ') || '—']);
  const widths = head.slice(0, -1).map((h, i) => Math.max(h.length, ...cells.map((c) => c[i]!.length)));
  const line = (c: string[]) => c.map((x, i) => (i < widths.length ? pad(x, widths[i]!) : x)).join('  ').trimEnd();
  const out = [`${t.title} (${t.slug})`, t.header, ''];
  if (filter !== 'all') out.push(filter === 'not-done' ? `Showing the ${plural(rows.length, 'story', 'stories')} not done.` : `Showing the ${plural(rows.length, 'story', 'stories')} done but not seen working.`, '');
  out.push(line(head));
  for (const c of cells) out.push(line(c));
  out.push('', 'Where the facts come from:', `  commit: ${t.sources.commit}`, `  built: ${t.sources.graph}`, `  real screens: ${t.sources.e2e}`, `  automated tests: ${t.sources.unit}`);
  return `${out.join('\n')}\n`;
}

