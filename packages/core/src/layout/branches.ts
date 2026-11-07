// A story's scenarios as branches of one main path (S22, T57), pure. The main path is derived from
// the scenarios, never written into them: the scenario that takes no error edge and that the other
// scenarios follow the furthest, then the one that walks the most of the story's boxes, then the
// first in file order. The owner may pick another one (review.yaml `mainPath`, not part of the
// signed record). Every other scenario is compared with it: the steps it shares from the start
// (equal name, branch and example), where it leaves the main path and on what condition, and where
// it joins the main path again.

import type { Box, Edge, Flow, Id, Scenario, ScenarioStep } from '../types.js';
import { boxAt, diagramAt, parentPath } from './diagram.js';

/**
 * How a scenario stands to the main path.
 * - `main`: it is the main path.
 * - `branch`: it leaves the main path at a step (another edge, another box, or other example data).
 * - `same`: the same steps as the main path, example data included; it checks another end state.
 * - `apart`: it starts at another box than the main path.
 */
export type BranchKind = 'main' | 'branch' | 'same' | 'apart';

export interface ScenarioBranch {
  scenarioId: Id;
  title: string;
  kind: BranchKind;
  /** Its first `shared` steps are the main path's own: equal name, branch and example. */
  shared: number;
  /** 0-based step where it leaves the main path; the main path has the same step there. Not for `main` or `same`. */
  at?: number;
  /** Box path and title of that step. */
  atPath?: string;
  atTitle?: string;
  /** What makes it leave, in plain words, to read after "when". */
  condition?: string;
  /** It goes the main path's boxes and edges, only with other example data. */
  dataOnly?: boolean;
  /** Where it is back on a box of the main path after leaving it: its step and the main path's. */
  rejoin?: { at: number; mainAt: number; path: string; title: string };
}

/** Who chose the main path. */
export type MainPathSource = 'only' | 'derived' | 'owner' | 'fallback';

export interface StoryBranches {
  storyId: Id;
  mainId?: Id;
  source: MainPathSource;
  /** Said to the owner when the rule could not apply (every scenario takes an error edge). */
  note?: string;
  /** Main path first, then the branches in the order they leave it (file order on a tie). */
  branches: ScenarioBranch[];
}

const stepsOf = (s: Scenario): ScenarioStep[] => (Array.isArray(s?.steps) ? s.steps.filter((x) => x && typeof x.name === 'string') : []);

/** Value equality with keys in any order: example data compared by content. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Two steps are the same step: same box, same branch, same example (other example data is a difference). */
export function sameStep(a: ScenarioStep | undefined, b: ScenarioStep | undefined): boolean {
  return a !== undefined && b !== undefined && a.name === b.name && a.branch === b.branch && same(a.example, b.example);
}

/** The same box and branch, whatever the example: the same place on the map. */
const samePlace = (a: ScenarioStep | undefined, b: ScenarioStep | undefined): boolean => a !== undefined && b !== undefined && a.name === b.name && a.branch === b.branch;

/** Edges out of the box at `path`; a box with none leaves through its parent (scenarios/README.md). */
function outEdges(flow: Flow | undefined, path: string): Edge[] {
  const id = path.split('/').pop()!;
  const parent = parentPath(path);
  const edges = diagramAt(flow, parent)?.edges;
  const out = (Array.isArray(edges) ? edges : []).filter((e) => e && e.from === id);
  return out.length === 0 && parent !== '' ? outEdges(flow, parent) : out;
}

/** The scenario takes an error edge: a step's `branch` is the label of an error edge out of its box. */
export function takesErrorEdge(flow: Flow | undefined, scenario: Scenario): boolean {
  return stepsOf(scenario).some((s) => s.branch !== undefined && outEdges(flow, s.name).some((e) => e.label === s.branch && e.kind === 'error'));
}

/** The boxes of the story the scenario walks: its step boxes and the boxes they sit in, that name the story. */
export function storyBoxesWalked(flow: Flow | undefined, storyId: Id, scenario: Scenario): number {
  const seen = new Set<string>();
  for (const s of stepsOf(scenario)) {
    const ids = s.name.split('/');
    for (let k = 1; k <= ids.length; k++) {
      const p = ids.slice(0, k).join('/');
      const box: Box | undefined = boxAt(flow, p);
      if (box && Array.isArray(box.stories) && box.stories.includes(storyId)) seen.add(p);
    }
  }
  return seen.size;
}

/** How many steps two scenarios share from the start (same step: name, branch, example). */
export function sharedPrefix(a: Scenario, b: Scenario): number {
  return prefix(a, b, sameStep);
}

/** How many steps two scenarios go the same way from the start (same box and branch, any example). */
export function samePlacePrefix(a: Scenario, b: Scenario): number {
  return prefix(a, b, samePlace);
}

function prefix(a: Scenario, b: Scenario, eq: (x: ScenarioStep, y: ScenarioStep) => boolean): number {
  const x = stepsOf(a);
  const y = stepsOf(b);
  let k = 0;
  while (k < x.length && k < y.length && eq(x[k]!, y[k]!)) k++;
  return k;
}

const titleOf = (flow: Flow | undefined, path: string): string => {
  const t = boxAt(flow, path)?.title;
  return typeof t === 'string' ? t : path;
};

/** A branch label in plain words: a yes/no answer says which question it answers. */
function labelWords(flow: Flow | undefined, path: string, label: string): string {
  const box = boxAt(flow, path);
  if (box?.kind === 'decision' && /^(yes|no|true|false)$/i.test(label.trim())) return `the answer to "${titleOf(flow, path)}" is ${label.trim()}`;
  return label;
}

/** The label of the edge from the box at `from` to the box at `to`, when one joins them. */
function edgeLabel(flow: Flow | undefined, from: string, to: string): string | undefined {
  const parent = parentPath(from);
  const toId = (parent === '' ? to : to.startsWith(`${parent}/`) ? to.slice(parent.length + 1) : '').split('/')[0];
  return outEdges(flow, from).find((e) => e.to === toId && e.label !== undefined)?.label;
}

/**
 * What differs between two examples of the same step, in words: another example id, else the
 * fields with other values (`then.slides`), else "it has no example" / "the example data differs".
 */
export function exampleDifference(step: ScenarioStep, mainStep: ScenarioStep): string {
  const a = step.example;
  const b = mainStep.example;
  if (a === undefined) return `it has no example data at ${step.name}`;
  if (a.id !== undefined && a.id !== b?.id) return `the example is "${a.id}"`;
  const fields: string[] = [];
  for (const part of ['given', 'then', 'stateAfter'] as const) {
    const x = (a[part] ?? {}) as Record<string, unknown>;
    const y = (b?.[part] ?? {}) as Record<string, unknown>;
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (!same(x[k], y[k])) fields.push(`${part}.${k}`);
  }
  if (fields.length === 0) return 'the example data differs';
  const shown = fields.slice(0, 3).join(', ');
  return `the example has other data in ${shown}${fields.length > 3 ? ` and ${fields.length - 3} more` : ''}`;
}

/** How `scenario` stands to `main`: shared steps, where and why it leaves, where it comes back. */
export function compareWithMain(flow: Flow | undefined, main: Scenario, scenario: Scenario): ScenarioBranch {
  const m = stepsOf(main);
  const s = stepsOf(scenario);
  const base = { scenarioId: scenario.id, title: typeof scenario.title === 'string' ? scenario.title : scenario.id };
  if (scenario.id === main.id) return { ...base, kind: 'main', shared: s.length };
  const shared = sharedPrefix(main, scenario);
  if (shared === s.length && shared === m.length) return { ...base, kind: 'same', shared };
  // The same place (box and branch) as far as `p`: before it only example data can differ.
  let p = shared;
  while (p < s.length && p < m.length && samePlace(s[p], m[p])) p++;

  let at: number;
  let condition: string;
  let dataOnly = false;
  let kind: BranchKind = 'branch';
  if (p === s.length && p === m.length) {
    // Same boxes and branches all the way: it differs by its example data only.
    at = shared;
    dataOnly = true;
    condition = exampleDifference(s[at]!, m[at]!);
  } else if (p < s.length && p < m.length && s[p]!.name === m[p]!.name) {
    // Same box, another edge out of it.
    at = p;
    const label = s[p]!.branch ?? (s[p + 1] ? edgeLabel(flow, s[p]!.name, s[p + 1]!.name) : undefined);
    condition = label !== undefined ? labelWords(flow, s[p]!.name, label) : s[p + 1] ? `it goes on to ${titleOf(flow, s[p + 1]!.name)}` : `it ends at ${titleOf(flow, s[p]!.name)}`;
  } else if (p === 0) {
    at = 0;
    kind = 'apart';
    condition = `it starts at ${titleOf(flow, s[0]?.name ?? '?')}`;
  } else if (p === s.length) {
    // It stops where the main path goes on.
    at = p - 1;
    condition = `it ends at ${titleOf(flow, s[at]!.name)}`;
  } else {
    // Another box after the same step: the edge out of the step tells why.
    at = p - 1;
    const label = s[at]!.branch ?? edgeLabel(flow, s[at]!.name, s[p]!.name);
    condition = label !== undefined ? labelWords(flow, s[at]!.name, label) : `it goes on to ${titleOf(flow, s[p]!.name)}`;
  }
  const out: ScenarioBranch = { ...base, kind, shared, at, atPath: s[at]?.name ?? '', atTitle: titleOf(flow, s[at]?.name ?? ''), condition };
  if (dataOnly) out.dataOnly = true;
  else {
    // Back on the main path: the first later step on a box the main path reaches after the parting.
    const from = kind === 'apart' ? -1 : at;
    for (let k = Math.max(p, at + 1); k < s.length && !out.rejoin; k++) {
      const j = m.findIndex((x, i) => i > from && x.name === s[k]!.name);
      if (j >= 0) out.rejoin = { at: k, mainAt: j, path: s[k]!.name, title: titleOf(flow, s[k]!.name) };
    }
  }
  return out;
}

/** Where a branch leaves, for the review order: same steps after the last step, apart ones last. */
function leaveKey(b: ScenarioBranch, mainLength: number): number {
  if (b.kind === 'main') return -1;
  if (b.kind === 'same') return mainLength;
  if (b.kind === 'apart') return Number.MAX_SAFE_INTEGER;
  return b.at ?? mainLength;
}

/**
 * The main path of a story and every scenario as a branch of it. `scenarios` in file order, only
 * the story's own. `override`: the owner's pick (review.yaml); ignored when it names no scenario
 * of the story (validate reports it).
 */
export function storyBranches(flow: Flow | undefined, storyId: Id, scenarios: Scenario[], override?: Id): StoryBranches {
  const own = scenarios.filter((s) => s && typeof s.id === 'string');
  if (own.length === 0) return { storyId, source: 'only', branches: [] };
  let main: Scenario;
  let source: MainPathSource;
  let note: string | undefined;
  const picked = override !== undefined ? own.find((s) => s.id === override) : undefined;
  if (own.length === 1) {
    main = own[0]!;
    source = 'only';
  } else if (picked) {
    main = picked;
    source = 'owner';
  } else {
    const clean = own.filter((s) => !takesErrorEdge(flow, s));
    if (clean.length === 0) {
      main = own[0]!;
      source = 'fallback';
      note = 'Every scenario of this story takes an error edge: the first one is shown as the main path.';
    } else {
      // The way the others go the furthest: the sum of the steps each other scenario goes the same
      // way (box and branch) with it from the start. Example data does not count here: it would
      // favour a scenario with fewer examples over the first of the same path.
      const followed = (c: Scenario) => own.reduce((n, o) => (o === c ? n : n + samePlacePrefix(c, o)), 0);
      const score = clean.map((c, i) => ({ c, i, followed: followed(c), boxes: storyBoxesWalked(flow, storyId, c) }));
      score.sort((a, b) => b.followed - a.followed || b.boxes - a.boxes || a.i - b.i);
      main = score[0]!.c;
      source = 'derived';
    }
  }
  const mainLength = stepsOf(main).length;
  const branches = own
    .map((s, i) => ({ b: compareWithMain(flow, main, s), i }))
    .sort((x, y) => leaveKey(x.b, mainLength) - leaveKey(y.b, mainLength) || x.i - y.i)
    .map((x) => x.b);
  return { storyId, mainId: main.id, source, ...(note ? { note } : {}), branches };
}

/** "Main path", or "Branch at <step>: <condition>": what a card or a queue row says. */
export function branchLabel(b: ScenarioBranch): string {
  if (b.kind === 'main') return 'Main path';
  if (b.kind === 'same') return 'Same steps as the main path';
  if (b.kind === 'apart') return `Starts apart from the main path: ${b.condition}`;
  return `Branch at ${b.atTitle}: ${b.condition}`;
}

/** The storyboard header: "Main path", or "Branch of the main path at <step>: when <condition>". */
export function branchHeader(b: ScenarioBranch): string {
  if (b.kind === 'main') return 'Main path';
  if (b.kind === 'same') return 'Same steps as the main path: it checks another end state';
  if (b.kind === 'apart') return `Apart from the main path: ${b.condition}`;
  return `Branch of the main path at ${b.atTitle}: when ${b.condition}`;
}
