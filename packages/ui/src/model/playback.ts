// What one playback step shows (R10, S5-A1): the leaf box of the step (R21),
// the diagram to open for it, and its input, output and state change, from the
// step example and the box contract.

import type { Box, Flow, Scenario, ScenarioStep } from '@rehearse/core';
import { boxAt, parentPath } from './diagram.js';

export interface StepView {
  index: number;
  /** Box path of the step (R21). */
  path: string;
  /** Path of the diagram that shows the box: '' for the root. */
  diagramPath: string;
  box?: Box;
  step: ScenarioStep;
  /** Label of the edge taken: a decision branch or an error exit. */
  branch?: string;
  exampleId?: string;
  /** Example `given`: input values and start state. */
  input?: Record<string, unknown>;
  /** Example `then`: output values, `branch:` or `exit:`. */
  output?: Record<string, unknown>;
  /** Example `stateAfter`. */
  stateAfter?: Record<string, unknown>;
  /** Contract `writes` of the box: the state change the box may make. */
  writes: string[];
  /** The scenario's expected end state, on the last step only. */
  expect?: Record<string, unknown>;
}

export function stepCount(scenario: Scenario | undefined): number {
  return Array.isArray(scenario?.steps) ? scenario.steps.length : 0;
}

export function stepView(flow: Flow | undefined, scenario: Scenario, index: number): StepView | undefined {
  const step = Array.isArray(scenario.steps) ? scenario.steps[index] : undefined;
  if (!step || typeof step.name !== 'string') return undefined;
  const box = boxAt(flow, step.name);
  const ex = step.example;
  const view: StepView = {
    index,
    path: step.name,
    diagramPath: parentPath(step.name),
    step,
    writes: Array.isArray(box?.writes) ? box.writes : [],
  };
  if (box) view.box = box;
  if (step.branch !== undefined) view.branch = step.branch;
  if (ex?.id !== undefined) view.exampleId = ex.id;
  if (ex?.given !== undefined) view.input = ex.given;
  if (ex?.then !== undefined) view.output = ex.then;
  if (ex?.stateAfter !== undefined) view.stateAfter = ex.stateAfter;
  if (index === scenario.steps.length - 1 && scenario.expect?.state) view.expect = scenario.expect.state;
  return view;
}
