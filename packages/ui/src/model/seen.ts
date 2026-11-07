// Which step panels the owner has seen, per scenario. It lives in the browser only
// (sessionStorage). It is not evidence and is never sent to the server: it only gates the
// Approve button, so the owner sees every step before approving (S6-A1).
//
// A branch's opening that is the same as the main path's (S22, T57) is collapsed on its storyboard.
// Such a shared step counts as seen when it was seen there, or when the owner saw that same step on
// the main path's storyboard: the same step means the same box, branch and example, so each seen
// step is also kept by its content (`content`), not only by its index.

import type { Id, ScenarioStep } from '@rehearse/core';
import type { ScenarioView } from '../api.js';

/**
 * scenario id → the content hash the steps were seen at, the 0-based step indexes seen and the
 * content keys of those steps (stepKey).
 */
export type SeenState = Record<Id, { hash: string; steps: number[]; content?: string[] }>;

/** What a branch's collapsed opening needs: the main path's scenario and how many steps the branch shares with it. */
export interface SharedOpening {
  main: ScenarioView;
  shared: number;
}

/** JSON with object keys sorted, so equal values give equal text. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** The content of a step, as a key: its box, branch and example. Two steps are the same step when their keys are equal. */
export function stepKey(step: ScenarioStep | undefined): string {
  return canonical({ name: step?.name ?? '', branch: step?.branch ?? null, example: step?.example ?? null });
}

const stepsOf = (sv: ScenarioView): ScenarioStep[] => (Array.isArray(sv.scenario.steps) ? sv.scenario.steps : []);

/** Content keys of the steps seen on the scenario as it is now. */
function seenContent(seen: SeenState, sv: ScenarioView): Set<string> {
  const entry = seen[sv.scenario.id];
  if (!entry || entry.hash !== sv.hash) return new Set();
  return new Set(entry.content ?? entry.steps.map((i) => stepKey(stepsOf(sv)[i])));
}

/**
 * The shared steps (0-based indexes below `opening.shared`) that count as seen because the owner
 * saw the same step on the main path's storyboard, as it is now.
 */
export function seenOnMain(seen: SeenState, sv: ScenarioView, opening: SharedOpening | undefined): Set<number> {
  const out = new Set<number>();
  if (!opening) return out;
  const onMain = seenContent(seen, opening.main);
  const steps = stepsOf(sv);
  for (let i = 0; i < opening.shared && i < steps.length; i++) if (onMain.has(stepKey(steps[i]))) out.add(i);
  return out;
}

const KEY = 'rehearse:seen';

/**
 * Steps seen of the scenario as it is now: seen here, or (a shared step of a branch's opening) seen
 * as the same step on the main path. A content change (new hash) clears them.
 */
export function seenSteps(seen: SeenState, sv: ScenarioView, opening?: SharedOpening): Set<number> {
  const entry = seen[sv.scenario.id];
  const here = entry && entry.hash === sv.hash ? new Set(entry.steps) : new Set<number>();
  for (const i of seenOnMain(seen, sv, opening)) here.add(i);
  return here;
}

export function stepTotal(sv: ScenarioView): number {
  return Array.isArray(sv.scenario.steps) ? sv.scenario.steps.length : 0;
}

/** Every step of the scenario was seen: here, or a shared opening step on the main path. */
export function allSeen(seen: SeenState, sv: ScenarioView, opening?: SharedOpening): boolean {
  const steps = seenSteps(seen, sv, opening);
  const total = stepTotal(sv);
  for (let i = 0; i < total; i++) if (!steps.has(i)) return false;
  return true;
}

/** The state with step `index` of the scenario seen here. Returns the same object when nothing changes. */
export function markSeen(seen: SeenState, sv: ScenarioView, index: number): SeenState {
  const steps = seenSteps(seen, sv);
  if (steps.has(index) || index < 0 || index >= stepTotal(sv)) return seen;
  steps.add(index);
  const sorted = [...steps].sort((a, b) => a - b);
  const content = [...new Set(sorted.map((i) => stepKey(stepsOf(sv)[i])))];
  return { ...seen, [sv.scenario.id]: { hash: sv.hash, steps: sorted, content } };
}

/** The seen state of one EPIC from the store, or empty when there is none or it cannot be read. */
export function loadSeen(storage: Storage | undefined, slug: string): SeenState {
  try {
    const all = JSON.parse(storage?.getItem(KEY) ?? '{}') as Record<string, SeenState>;
    const mine = all && typeof all === 'object' ? all[slug] : undefined;
    return mine && typeof mine === 'object' ? mine : {};
  } catch {
    return {};
  }
}

export function saveSeen(storage: Storage | undefined, slug: string, seen: SeenState): void {
  try {
    let all: Record<string, SeenState> = {};
    try {
      const parsed = JSON.parse(storage?.getItem(KEY) ?? '{}') as unknown;
      if (parsed && typeof parsed === 'object') all = parsed as Record<string, SeenState>;
    } catch {
      // A broken entry is replaced.
    }
    storage?.setItem(KEY, JSON.stringify({ ...all, [slug]: seen }));
  } catch {
    // No storage (private mode, quota): the state lives until the page reloads.
  }
}

/** The browser's sessionStorage, when there is one. */
export function browserStorage(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}
