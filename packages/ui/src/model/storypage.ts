// The story pages as the design draws them (design pages 2, 3 and 12–15): the compact review
// queue (one row per story), the story's state chip, the HOW card as a vertical flow, and the
// summary on each scenario card (step dots coloured by lane).

import type { Flow, Id } from '@rehearse/core';
import type { ScenarioView } from '../api.js';
import type { ReviewEpicView } from '../contract.js';
import { boxAt, laneColor, roleName } from './diagram.js';
import { servedStories } from './features.js';
import { storiesOf } from './review.js';
import { approvalState } from './storyboard.js';
import type { StoryDetail } from './storyview.js';

/** `text` cut to `max` characters, with "…" when it was cut. */
export function shorten(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}…`;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** "3 scenarios · approvals not signed", in words. */
export function approvalsNote(done: number, total: number): string {
  if (total === 0) return 'no scenarios yet';
  const what = done === 0 ? 'approvals not signed' : done === total ? 'all approvals signed' : `${done} of ${total} approvals signed`;
  return `${plural(total, 'scenario')} · ${what}`;
}

export interface QueueRow {
  storyId: Id;
  /** The want, cut to one line. */
  want: string;
  /** "n scenarios · approvals not signed". */
  note: string;
  scenarios: number;
  /** Scenarios approved with a valid signature. */
  done: number;
  /** The colour of the story's role lane. */
  color: string;
}

/** One row per story: stories in prd.yaml order, then stories that only scenarios name. */
export function queueRows(view: ReviewEpicView): QueueRow[] {
  const rows = new Map<Id, { want: string; role?: string; scenarios: ScenarioView[] }>();
  for (const s of storiesOf(view.prd)) rows.set(s.id, { want: typeof s.want === 'string' ? s.want : '', role: s.role, scenarios: [] });
  for (const sv of view.scenarios) {
    const id = sv.scenario.story ?? '?';
    if (!rows.has(id)) rows.set(id, { want: '', scenarios: [] });
    rows.get(id)!.scenarios.push(sv);
  }
  return [...rows].map(([storyId, r]) => {
    const done = r.scenarios.filter((sv) => approvalState(sv, view.approvals).done).length;
    return {
      storyId,
      want: shorten(r.want || '(not in prd.yaml)', 30),
      note: approvalsNote(done, r.scenarios.length),
      scenarios: r.scenarios.length,
      done,
      color: laneColor(view.flow, r.role),
    };
  });
}

export type StoryStateKind = 'none' | 'unsigned' | 'partial' | 'signed';

/** Whether the story's scenarios carry signed approvals, as a chip text. */
export function storyState(view: ReviewEpicView, storyId: Id): { kind: StoryStateKind; text: string } {
  const own = view.scenarios.filter((sv) => sv.scenario.story === storyId);
  const done = own.filter((sv) => approvalState(sv, view.approvals).done).length;
  if (own.length === 0) return { kind: 'none', text: 'No scenarios yet' };
  if (done === 0) return { kind: 'unsigned', text: 'Not signed' };
  if (done < own.length) return { kind: 'partial', text: `${done} of ${own.length} signed` };
  return { kind: 'signed', text: 'Signed' };
}

/** The colour of a story's role lane. */
export function storyColor(view: ReviewEpicView, storyId: Id): string {
  return laneColor(view.flow, storiesOf(view.prd).find((s) => s.id === storyId)?.role);
}

// ---------------------------------------------------------------- HOW, as a vertical flow

export interface HowStep {
  path: string;
  title: string;
  decision: boolean;
  /** Role name of the box lane. */
  lane: string;
  color: string;
  /** Other stories this box serves: it is shared. */
  also: Id[];
  /** Title of the parent box, for a nested box. */
  parent?: string;
}

export interface HowLink {
  from: string;
  to: string;
  label?: string;
  kind: string;
  /** Titles of boxes of other stories the edge passes through. */
  via: string[];
}

export interface HowFlow {
  steps: HowStep[];
  /** `links[i]` joins step i and step i + 1; undefined when no edge joins them. */
  links: (HowLink | undefined)[];
  /** Edges that do not join two steps next to each other (loops back, jumps ahead). */
  jumps: HowLink[];
}

/** The HOW boxes top to bottom in flow order, with the edge between neighbours and the other edges apart. */
export function howFlow(view: ReviewEpicView, d: StoryDetail): HowFlow {
  const titles = new Map(d.how.boxes.map((b) => [b.path, typeof b.box.title === 'string' ? b.box.title : b.path]));
  const steps: HowStep[] = d.how.boxes.map((b) => ({
    path: b.path,
    title: titles.get(b.path)!,
    decision: b.box.kind === 'decision',
    lane: roleName(view.prd, b.box.lane),
    color: laneColor(view.flow, b.box.lane),
    also: servedStories(b.box).filter((s) => s !== d.storyId),
    ...(b.parent && titles.has(b.parent) ? { parent: titles.get(b.parent)! } : b.parent ? { parent: b.parent } : {}),
  }));
  const at = new Map(steps.map((s, i) => [s.path, i]));
  const links: (HowLink | undefined)[] = steps.slice(1).map(() => undefined);
  const jumps: HowLink[] = [];
  for (const e of d.how.edges) {
    const link: HowLink = { from: e.from, to: e.to, ...(e.label !== undefined ? { label: e.label } : {}), kind: e.kind, via: e.via };
    const i = at.get(e.from)!;
    if (at.get(e.to) === i + 1 && links[i] === undefined) links[i] = link;
    else jumps.push(link);
  }
  return { steps, links, jumps };
}

// ---------------------------------------------------------------- scenario cards

export interface ScenarioSummary {
  id: Id;
  title: string;
  steps: number;
  criterion?: Id;
  /** One dot per step, in the colour of the step's lane. */
  dots: { lane: string; color: string }[];
}

export function scenarioSummary(view: ReviewEpicView, sv: ScenarioView): ScenarioSummary {
  const { scenario } = sv;
  const steps = Array.isArray(scenario.steps) ? scenario.steps : [];
  const dots = steps.map((step) => {
    const lane = typeof step?.name === 'string' ? boxAt(view.flow, step.name)?.lane : undefined;
    return { lane: roleName(view.prd, lane), color: laneColor(view.flow, lane) };
  });
  return {
    id: scenario.id,
    title: typeof scenario.title === 'string' ? scenario.title : scenario.id,
    steps: steps.length,
    ...(scenario.expect?.criterion ? { criterion: scenario.expect.criterion } : {}),
    dots,
  };
}

/** A storyboard step's title: "Parent → Box" for a nested box, as design page 3 writes it. */
export function stepTitle(flow: Flow | undefined, path: string): string {
  const box = boxAt(flow, path);
  if (!box) return `No box at ${path}`;
  const title = typeof box.title === 'string' ? box.title : path;
  const cut = path.lastIndexOf('/');
  const parent = cut > 0 ? boxAt(flow, path.slice(0, cut)) : undefined;
  return parent && typeof parent.title === 'string' ? `${parent.title} → ${title}` : title;
}

// ---------------------------------------------------------------- OUTPUT: the status state machine

export interface StatusMachine {
  /** `Entity.field`, e.g. `Scenario.status`. */
  target: string;
  /** States in the order the moves first name them; `new` for a created item. */
  states: string[];
  moves: { from: string; to: string; by: string }[];
}

/** The field this story moves through the most states, with its moves; undefined when no write is a state change. */
export function statusMachine(d: StoryDetail): StatusMachine | undefined {
  const by = new Map<string, StatusMachine>();
  for (const c of d.output.changes) {
    if (c.to === undefined) continue;
    const m = by.get(c.target) ?? { target: c.target, states: [], moves: [] };
    by.set(c.target, m);
    const from = c.from || 'new';
    for (const s of [from, c.to]) if (!m.states.includes(s)) m.states.push(s);
    m.moves.push({ from, to: c.to, by: c.boxTitle });
  }
  return [...by.values()].sort((a, b) => b.states.length - a.states.length || b.moves.length - a.moves.length)[0];
}
