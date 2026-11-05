// Story hash rule 2 (correction C11, R15, D23).
// Rule 1 (hash.ts) covers the story, its requirements and its scenarios. Rule 2 also covers
// each box that serves the story, with its ancestor boxes and its children, and the roles
// of the lanes of those boxes. So a change to a box makes the stories it serves stale.

import { indexBoxes } from '../flow-index.js';
import { scenarioContent, sha256, storyHashV1 } from '../hash.js';
import type { Box, Diagram, Flow, Hash, Prd, Role, Scenario, Story } from '../types.js';
import { asArray, isObject } from '../util.js';
import type { HashRule } from './types.js';

/** A box without the loader-added `path`, at every depth. With `children: false` the children are dropped too. */
export function boxContent(box: Box, children = true): Record<string, unknown> {
  const { path: _path, children: kids, ...rest } = box;
  if (!children || !isObject(kids)) return rest;
  const diagram = kids as Diagram;
  return { ...rest, children: { ...diagram, boxes: asArray<Box>(diagram.boxes).map((b) => (isObject(b) ? boxContent(b) : b)) } };
}

/** Paths of the boxes whose `stories` lists the story, in flow order. */
export function servingBoxes(flow: Flow | undefined, storyId: string): string[] {
  return [...indexBoxes(flow).values()]
    .filter((e) => asArray(e.box.stories).includes(storyId))
    .map((e) => e.path);
}

/** The content that rule 2 hashes. */
export function storyContentV2(story: Story, prd: Prd, flow: Flow | undefined, scenarios: Scenario[]): Record<string, unknown> {
  const index = indexBoxes(flow);
  const boxes: Record<string, unknown> = {};
  const laneRoles = new Set<string>();
  const addLanes = (box: Box): void => {
    if (typeof box.lane === 'string') laneRoles.add(box.lane);
    if (isObject(box.children)) for (const c of asArray<Box>(box.children.boxes)) if (isObject(c)) addLanes(c);
  };
  for (const path of servingBoxes(flow, story.id)) {
    const entry = index.get(path)!;
    boxes[path] = boxContent(entry.box);
    addLanes(entry.box);
    for (let parent = entry.parent; parent !== undefined; parent = index.get(parent)?.parent) {
      const p = index.get(parent)!;
      // A serving ancestor is already in with its children.
      if (!(parent in boxes)) boxes[parent] = boxContent(p.box, false);
      if (typeof p.box.lane === 'string') laneRoles.add(p.box.lane);
    }
  }
  const roles: Record<string, Role | null> = {};
  for (const id of laneRoles) roles[id] = asArray<Role>(prd.roles).find((r) => isObject(r) && r.id === id) ?? null;
  return {
    rule: 2,
    story,
    requirements: asArray<{ id: string }>(prd.requirements).filter((r) => story.requirements.includes(r.id)),
    scenarios: scenarios.filter((s) => s.story === story.id).map(scenarioContent),
    boxes,
    roles,
  };
}

/** Story hash, rule 2 (C11). */
export function storyHashV2(story: Story, prd: Prd, flow: Flow | undefined, scenarios: Scenario[]): Hash {
  return sha256(storyContentV2(story, prd, flow, scenarios));
}

/** Story hash under the given rule. */
export function storyHash(rule: HashRule, story: Story, prd: Prd, flow: Flow | undefined, scenarios: Scenario[]): Hash {
  return rule === 1 ? storyHashV1(story, prd, scenarios) : storyHashV2(story, prd, flow, scenarios);
}
