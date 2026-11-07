// The small changes of a story (T62): a file `changes/C<n>.yaml` adds criteria, scenarios and root
// boxes to a signed story. The loader marks each added item with `change`; the server lists the
// changes in `view.changes` and in the sign-off preview. Pure: the components and the tests share it.

import type { Id, StoryPreviewContent } from '@rehearse/core';
import type { SinceSignOff } from '../api.js';
import type { ReviewEpicView } from '../contract.js';

/** The change that added an item, with its title when the record lists it. */
export interface ChangeRef {
  id: Id;
  title?: string;
}

type Changes = Pick<ReviewEpicView, 'changes'>;

/** The change mark of a criterion, scenario or box; undefined when no change added it. */
export function changeRef(view: Changes, item: { change?: unknown } | undefined): ChangeRef | undefined {
  const id = item?.change;
  if (typeof id !== 'string' || id === '') return undefined;
  const title = view.changes?.find((c) => c.id === id)?.title;
  return title ? { id, title } : { id };
}

/** The changes of a story, in change number order. */
export function storyChanges(view: Changes, storyId: Id): ChangeRef[] {
  return (view.changes ?? []).filter((c) => c.story === storyId).map((c) => (c.title ? { id: c.id, title: c.title } : { id: c.id }));
}

/** The changes that no sign-off covers (T62); empty when the story has none or this is its first sign-off. */
export function newChangesOf(since: SinceSignOff | undefined): Id[] {
  return since && (since.kind === 'changed' || since.kind === 'unavailable') ? (since.newChanges ?? []) : [];
}

export interface NewChangePart {
  id: Id;
  title: string;
  why: string;
  criteria: StoryPreviewContent['criteria'];
  scenarios: StoryPreviewContent['scenarios'];
  boxes: StoryPreviewContent['boxes'];
}

/**
 * The preview split for a sign-off of new changes: per new change the items it added, and the
 * rest of the story (the content that the last sign-off covers) without them.
 */
export function splitNewChanges(content: StoryPreviewContent, ids: readonly Id[]): { added: NewChangePart[]; rest: StoryPreviewContent } {
  const isNew = (x: { change?: Id }) => x.change !== undefined && ids.includes(x.change);
  const added = ids.map((id) => {
    const c = content.changes?.find((x) => x.id === id);
    const of = <T extends { change?: Id }>(xs: T[]) => xs.filter((x) => x.change === id);
    return { id, title: c?.title ?? '', why: c?.why ?? '', criteria: of(content.criteria), scenarios: of(content.scenarios), boxes: of(content.boxes) };
  });
  const rest = { ...content, criteria: content.criteria.filter((x) => !isNew(x)), scenarios: content.scenarios.filter((x) => !isNew(x)), boxes: content.boxes.filter((x) => !isNew(x)) };
  return { added, rest };
}
