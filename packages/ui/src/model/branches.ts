// A story's scenarios as branches of its main path (S22, T57), for the story page, the queue and the
// storyboard. The rule lives in core (`storyBranches`); the owner's pick comes from review.yaml,
// which the server sends as `review.mainPath`.

import type { Id } from '@rehearse/core';
import { layoutStoryMap, storyBranches, storyMap, type ScenarioBranch, type StoryBranches, type StoryMap } from '@rehearse/core/layout';
import type { ScenarioView } from '../api.js';
import type { ReviewEpicView } from '../contract.js';
import { changeRef, type ChangeRef } from './changes.js';
import { boxAt } from './diagram.js';

export { branchHeader, branchLabel, layoutStoryMap, type ScenarioBranch, type SmEdge, type SmGhost, type SmLayout, type SmNode, type StoryBranches, type StoryMap } from '@rehearse/core/layout';

type View = Pick<ReviewEpicView, 'flow' | 'prd' | 'scenarios' | 'review'>;

const ofStory = (view: View, storyId: Id): ScenarioView[] => view.scenarios.filter((sv) => sv.scenario.story === storyId);

/** The story's main path and branches, main path first, then in the order they leave it. */
export function branchesOf(view: View, storyId: Id): StoryBranches {
  return storyBranches(view.flow, storyId, ofStory(view, storyId).map((sv) => sv.scenario), view.review?.mainPath?.[storyId]);
}

/** The story map: the union of the story's scenario paths. */
export function mapOf(view: View, storyId: Id): StoryMap {
  return storyMap(view.flow, view.prd, storyId, ofStory(view, storyId).map((sv) => sv.scenario), view.review?.mainPath?.[storyId]);
}

/** Scenario id → its branch, for every story. */
export function branchIndex(view: View): Map<Id, { story: StoryBranches; branch: ScenarioBranch }> {
  const out = new Map<Id, { story: StoryBranches; branch: ScenarioBranch }>();
  const stories = new Set(view.scenarios.map((sv) => sv.scenario.story ?? '?'));
  for (const id of stories) {
    const story = branchesOf(view, id);
    for (const branch of story.branches) out.set(branch.scenarioId, { story, branch });
  }
  return out;
}

/** What a collapsed shared step needs to count as seen: the main path's scenario and how many steps it shares. */
export interface SeenContext {
  main: ScenarioView;
  shared: number;
}

/** The seen context of a branch; undefined for the main path or a branch that shares no step. */
export function seenContext(view: View, sv: ScenarioView, index?: Map<Id, { story: StoryBranches; branch: ScenarioBranch }>): SeenContext | undefined {
  const at = (index ?? branchIndex(view)).get(sv.scenario.id);
  if (!at || at.branch.kind === 'main' || at.branch.shared === 0) return undefined;
  const main = view.scenarios.find((x) => x.scenario.id === at.story.mainId);
  return main ? { main, shared: at.branch.shared } : undefined;
}

const steps = (n: number) => `${n} step${n === 1 ? '' : 's'}`;

/** The collapsed row of a branch's shared opening: "Same as the main path up to <step> (N steps)". */
export function sharedRowText(upTo: string, shared: number): string {
  return `Same as the main path up to ${upTo} (${steps(shared)})`;
}

/** Whether the collapsed steps count as seen: all of them seen (here or on the main path), or how many are left. */
export function sharedSeenText(unseen: number, allOnMain: boolean): string {
  if (unseen > 0) return `not seen yet on the main path — expand to see ${steps(unseen)}`;
  return allOnMain ? 'seen on the main path' : 'seen';
}

/** Box path → the small change that added the box (T62), for the boxes of the story map. */
export function mapChanges(view: Pick<ReviewEpicView, 'flow' | 'changes'>, map: StoryMap): Map<string, ChangeRef> {
  const out = new Map<string, ChangeRef>();
  for (const n of map.nodes) {
    const change = changeRef(view, boxAt(view.flow, n.path));
    if (change) out.set(n.path, change);
  }
  return out;
}
