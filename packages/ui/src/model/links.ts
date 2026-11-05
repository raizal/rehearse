// Every id on the PRD and Tech spec pages is a link to the place in rehearse where it lives
// (T15 feature 2). One colour per kind: requirement → Readiness row, story → Story view,
// box → Flow (and its contract in Tech spec), scenario → Storyboard, entity → Tech spec entity,
// decision (and correction) → decision log.

import type { Id } from '@rehearse/core';
import type { ReviewEpicView } from '../contract.js';
import { boxAt } from './diagram.js';
import { flowPaths } from './features.js';
import { storiesOf } from './review.js';

export type LinkKind = 'requirement' | 'story' | 'box' | 'scenario' | 'entity' | 'decision';

/** An id and its kind. A story id may be an acceptance criterion (`S6-A1`); a decision id may be a correction (`C27`). */
export interface LinkRef {
  kind: LinkKind;
  id: string;
}

/** Where a link goes. `focus` names an item on the PRD or Tech spec page, e.g. `box:approve`. */
export type Place =
  | { view: 'prd'; focus?: string }
  | { view: 'techspec'; focus?: string }
  | { view: 'bigpicture' }
  | { view: 'story'; story: Id }
  | { view: 'storyboard'; scenario: Id }
  | { view: 'usecases' }
  | { view: 'readiness'; requirement?: Id }
  | { view: 'flow'; box: string };

export const LINK_KINDS: readonly LinkKind[] = ['requirement', 'story', 'box', 'scenario', 'entity', 'decision'];

/** Where each kind goes, in words, for the legend under each page title. */
export const LINK_GOES: Record<LinkKind, string> = {
  requirement: 'Readiness row',
  story: 'Story view',
  box: 'Flow / Tech spec contract',
  scenario: 'Storyboard',
  entity: 'Tech spec entity',
  decision: 'Decision log',
};

const KIND_WORD: Record<LinkKind, string> = {
  requirement: 'Requirement',
  story: 'Story',
  box: 'Box',
  scenario: 'Scenario',
  entity: 'Entity',
  decision: 'Decision',
};

const isCriterion = (id: string) => /^S\d+-A\d+$/.test(id);
const isCorrection = (id: string) => /^C\d+$/.test(id);

/** The story of a story or criterion id: `S6-A1` → `S6`. */
export function storyOfId(id: string): Id {
  return isCriterion(id) ? id.replace(/-A\d+$/, '') : id;
}

/** The place a link opens. */
export function placeOf(ref: LinkRef): Place {
  switch (ref.kind) {
    case 'requirement':
      return { view: 'readiness', requirement: ref.id };
    case 'story':
      return { view: 'story', story: storyOfId(ref.id) };
    case 'box':
      return { view: 'flow', box: ref.id };
    case 'scenario':
      return { view: 'storyboard', scenario: ref.id };
    case 'entity':
      return { view: 'techspec', focus: `entity:${ref.id}` };
    case 'decision':
      return { view: 'techspec', focus: `${isCorrection(ref.id) ? 'correction' : 'decision'}:${ref.id}` };
  }
}

/** The name a screen reader says for the link: what the id is and where it goes. */
export function linkName(ref: LinkRef): string {
  if (ref.kind === 'story' && isCriterion(ref.id)) return `Acceptance criterion ${ref.id}: open story ${storyOfId(ref.id)} in the Story view`;
  if (ref.kind === 'decision' && isCorrection(ref.id)) return `Correction ${ref.id}: open it in the corrections`;
  const where: Record<LinkKind, string> = {
    requirement: 'open its Readiness row',
    story: 'open the Story view',
    box: 'open it in Flow',
    scenario: 'open its Storyboard card',
    entity: 'open it in Tech spec',
    decision: 'open it in the decision log',
  };
  return `${KIND_WORD[ref.kind]} ${ref.id}: ${where[ref.kind]}`;
}

/** The ids the view knows, by kind. Text links only ids that exist. */
export interface KnownIds {
  requirements: Set<Id>;
  stories: Set<Id>;
  criteria: Set<Id>;
  scenarios: Set<Id>;
  boxes: Set<string>;
  entities: Set<Id>;
  decisions: Set<Id>;
  corrections: Set<Id>;
}

export function knownIds(view: ReviewEpicView): KnownIds {
  const stories = storiesOf(view.prd);
  return {
    requirements: new Set((view.prd?.requirements ?? []).map((r) => r.id)),
    stories: new Set(stories.map((s) => s.id)),
    criteria: new Set(stories.flatMap((s) => (Array.isArray(s.acceptance) ? s.acceptance.map((c) => c.id) : []))),
    scenarios: new Set(view.scenarios.map((sv) => sv.scenario.id)),
    boxes: new Set(flowPaths(view.flow).filter((p) => boxAt(view.flow, p))),
    entities: new Set((view.entities?.entities ?? []).map((e) => e.id)),
    decisions: new Set((view.decisions ?? []).flatMap((d) => d.ids)),
    corrections: new Set((view.corrections ?? []).map((c) => c.id)),
  };
}

/** A piece of text: plain, or an id link. */
export type TextPart = string | LinkRef;

const TOKEN = /\b(S\d+-A\d+|R\d+|S\d+|D\d+|C\d+)\b/g;

/** Split text into plain parts and links to the ids the view knows (R…, S…, S…-A…, D…, C…). */
export function textParts(text: string, known: KnownIds): TextPart[] {
  const out: TextPart[] = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    const id = m[0];
    const ref = refOfToken(id, known);
    if (!ref) continue;
    if (m.index! > at) out.push(text.slice(at, m.index));
    out.push(ref);
    at = m.index! + id.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function refOfToken(id: string, known: KnownIds): LinkRef | undefined {
  if (known.requirements.has(id)) return { kind: 'requirement', id };
  if (known.stories.has(id) || known.criteria.has(id)) return { kind: 'story', id };
  if (known.decisions.has(id) || known.corrections.has(id)) return { kind: 'decision', id };
  return undefined;
}

/** Decision and correction ids that a text cites, in order, once each. */
export function citedDecisions(text: string | undefined, known: KnownIds): Id[] {
  const out: Id[] = [];
  for (const p of textParts(text ?? '', known)) if (typeof p !== 'string' && p.kind === 'decision' && !out.includes(p.id)) out.push(p.id);
  return out;
}
