// Walk the steps of a scenario: which edge each step takes (scenarios/README.md).
// Simulate runs only on a record that validates, so the steps are joined by edges.

import { edgeKind, nextLeaves, type BoxEntry } from '../flow-index.js';
import type { Edge, Example, Scenario } from '../types.js';
import { isObject } from '../util.js';

export interface WalkStep {
  /** 1-based step number. */
  n: number;
  /** `<scenario id>/step-<n>`. */
  at: string;
  path: string;
  entry: BoxEntry;
  example?: Example;
  /** The edge the step leaves by, when the scenario shows it (next step or `branch`). */
  edge?: Edge;
  /** Box path of the next step. */
  next?: string;
  /** The step leaves by an error exit: the box failed. */
  error: boolean;
  /** Ancestors entered at this step, outermost first (not entered by the step before). */
  entered: string[];
}

export function walkScenario(index: Map<string, BoxEntry>, scenario: Scenario): WalkStep[] {
  const steps = Array.isArray(scenario.steps) ? scenario.steps : [];
  const out: WalkStep[] = [];
  let prevAncestors: string[] = [];
  steps.forEach((step, i) => {
    if (!isObject(step) || typeof step.name !== 'string') return;
    const entry = index.get(step.name);
    if (!entry) return;
    const nextName = isObject(steps[i + 1]) ? steps[i + 1]!.name : undefined;
    const branch = typeof step.branch === 'string' ? step.branch : undefined;
    const options = nextLeaves(index, step.name);
    const taken =
      nextName !== undefined
        ? options.find((o) => o.to === nextName && (branch === undefined ? edgeKind(o.edge) !== 'error' : o.edge.label === branch))
        : branch !== undefined
          ? options.find((o) => o.edge.label === branch)
          : undefined;
    const example = isObject(step.example) ? step.example : undefined;
    const exit = isObject(example?.then) ? example.then.exit : undefined;
    const ancestors = ancestorsOf(step.name);
    const ws: WalkStep = {
      n: i + 1,
      at: `${scenario.id}/step-${i + 1}`,
      path: step.name,
      entry,
      error: (taken !== undefined && edgeKind(taken.edge) === 'error') || exit !== undefined,
      entered: ancestors.filter((a) => !prevAncestors.includes(a)),
    };
    if (example) ws.example = example;
    if (taken) ws.edge = taken.edge;
    if (typeof nextName === 'string' && index.has(nextName)) ws.next = nextName;
    out.push(ws);
    prevAncestors = ancestors;
  });
  return out;
}

/** `a/b/c` → `['a', 'a/b']`. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}
