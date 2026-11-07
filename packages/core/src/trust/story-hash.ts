// Story hash rule 2 (correction C11, R15, D23).
// Rule 1 (hash.ts) covers the story, its requirements and its scenarios. Rule 2 also covers
// each box that serves the story, with its ancestor boxes and its children, and the roles
// of the lanes of those boxes. So a change to a box makes the stories it serves stale.
// Rule 3 (T62) adds the small changes of the story (`changes/C<n>.yaml`): see `storyContentV3`.

import { indexBoxes } from '../flow-index.js';
import { scenarioContent, sha256, storyHashV1 } from '../hash.js';
import type { AcceptanceCriterion, Box, Diagram, Flow, Hash, Prd, Role, Scenario, Story } from '../types.js';
import { asArray, isObject } from '../util.js';
import { changeOf } from '../change/load.js';
import type { ChangeDoc } from '../change/types.js';
import type { HashRule } from './types.js';

/** A box without the loader-added `path` and `change`, at every depth. With `children: false` the children are dropped too. */
export function boxContent(box: Box, children = true): Record<string, unknown> {
  const { path: _path, change: _change, children: kids, ...rest } = box;
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

/** The story, the scenarios and the flow without the items that the loader merged from change files. */
export function withoutChanges(story: Story, flow: Flow | undefined, scenarios: Scenario[]): { story: Story; flow: Flow | undefined; scenarios: Scenario[] } {
  const base: Story = { ...story, acceptance: asArray<AcceptanceCriterion>(story.acceptance).filter((c) => changeOf(c) === undefined) };
  const own = scenarios.filter((s) => changeOf(s) === undefined);
  if (!isObject(flow) || !isObject(flow.root)) return { story: base, flow, scenarios: own };
  const root = flow.root;
  const boxes = asArray<Box>(root.boxes);
  const fresh = new Set(boxes.filter((b) => changeOf(b) !== undefined).map((b) => b.id));
  if (fresh.size === 0) return { story: base, flow, scenarios: own };
  const edges = asArray<{ from: string; to: string }>(root.edges).filter((e) => !isObject(e) || (!fresh.has(e.from) && !fresh.has(e.to)));
  return { story: base, flow: { ...flow, root: { ...root, boxes: boxes.filter((b) => changeOf(b) === undefined), edges } as Diagram }, scenarios: own };
}

/** The content of one change that rule 3 hashes: the change file, each scenario without status and approval. */
export function changeContent(doc: ChangeDoc): Record<string, unknown> {
  return {
    ...doc,
    scenarios: asArray<Scenario>(doc.scenarios).map((s) => (isObject(s) ? scenarioContent(s) : s)),
  };
}

/**
 * The content that rule 3 hashes (T62). A story without changes has the rule-2 content, so the
 * same hash under both rules. A story with changes has the rule-2 content of the story without
 * its changes, plus `rule: 3`, the roles of the lanes of the change boxes, and each change
 * (`changeContent`) in change number order. An approval of a change scenario does not change it.
 */
export function storyContentV3(story: Story, prd: Prd, flow: Flow | undefined, scenarios: Scenario[], changes: ChangeDoc[]): Record<string, unknown> {
  const mine = changes.filter((c) => isObject(c) && c.story === story.id);
  if (mine.length === 0) return storyContentV2(story, prd, flow, scenarios);
  const base = withoutChanges(story, flow, scenarios);
  const content = storyContentV2(base.story, prd, base.flow, base.scenarios);
  const roles = { ...(content.roles as Record<string, Role | null>) };
  for (const c of mine) {
    for (const b of asArray<Box>(c.boxes)) {
      if (isObject(b) && typeof b.lane === 'string' && !(b.lane in roles)) roles[b.lane] = asArray<Role>(prd.roles).find((r) => isObject(r) && r.id === b.lane) ?? null;
    }
  }
  return { ...content, rule: 3, roles, changes: mine.map(changeContent) };
}

/** Story hash, rule 3 (T62). */
export function storyHashV3(story: Story, prd: Prd, flow: Flow | undefined, scenarios: Scenario[], changes: ChangeDoc[]): Hash {
  return sha256(storyContentV3(story, prd, flow, scenarios, changes));
}

/** Story content under the given rule. Rule 1 has no content function of its own here. */
export function storyContent(rule: HashRule, story: Story, prd: Prd, flow: Flow | undefined, scenarios: Scenario[], changes: ChangeDoc[] = []): Record<string, unknown> {
  return rule === 3 ? storyContentV3(story, prd, flow, scenarios, changes) : storyContentV2(story, prd, flow, scenarios);
}

/** Story hash under the given rule. Rules 1 and 2 read the merged changes as part of the story. */
export function storyHash(rule: HashRule, story: Story, prd: Prd, flow: Flow | undefined, scenarios: Scenario[], changes: ChangeDoc[] = []): Hash {
  if (rule === 1) return storyHashV1(story, prd, scenarios);
  if (rule === 2) return storyHashV2(story, prd, flow, scenarios);
  return storyHashV3(story, prd, flow, scenarios, changes);
}
