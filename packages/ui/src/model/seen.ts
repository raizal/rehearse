// Which step panels the owner has seen, per scenario. It lives in the browser only
// (sessionStorage). It is not evidence and is never sent to the server: it only gates the
// Approve button, so the owner sees every step before approving (S6-A1).

import type { Id } from '@rehearse/core';
import type { ScenarioView } from '../api.js';

/** scenario id → the content hash the steps were seen at, and the 0-based step indexes seen. */
export type SeenState = Record<Id, { hash: string; steps: number[] }>;

const KEY = 'rehearse:seen';

/** Steps seen of the scenario as it is now. A content change (new hash) clears them. */
export function seenSteps(seen: SeenState, sv: ScenarioView): Set<number> {
  const entry = seen[sv.scenario.id];
  return entry && entry.hash === sv.hash ? new Set(entry.steps) : new Set();
}

export function stepTotal(sv: ScenarioView): number {
  return Array.isArray(sv.scenario.steps) ? sv.scenario.steps.length : 0;
}

/** Every step panel of the scenario was seen. */
export function allSeen(seen: SeenState, sv: ScenarioView): boolean {
  const steps = seenSteps(seen, sv);
  const total = stepTotal(sv);
  for (let i = 0; i < total; i++) if (!steps.has(i)) return false;
  return true;
}

/** The state with step `index` of the scenario seen. Returns the same object when nothing changes. */
export function markSeen(seen: SeenState, sv: ScenarioView, index: number): SeenState {
  const steps = seenSteps(seen, sv);
  if (steps.has(index) || index < 0 || index >= stepTotal(sv)) return seen;
  steps.add(index);
  return { ...seen, [sv.scenario.id]: { hash: sv.hash, steps: [...steps].sort((a, b) => a - b) } };
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
