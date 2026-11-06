// The sign-off preview (T39, box `sign-off`): what an owner agrees to when they sign off a story,
// and what changed since the last sign-off of that story. Both read the content that story hash
// rule 2 covers (`storyContentV2`): the story, its requirements, its scenarios, the boxes that
// serve it (with their ancestors and children) and the roles of their lanes. Pure: no files, no git.

import type { AcceptanceCriterion, Requirement, Role, Story } from '../types.js';
import { asArray, isObject } from '../util.js';

/** How a box is in the fingerprint: it serves the story, it holds a serving box, or it is inside one. */
export type PreviewBoxRelation = 'serves' | 'parent' | 'inside';

export interface PreviewBox {
  path: string;
  title: string;
  kind: string;
  /** Lane role id. */
  lane: string;
  relation: PreviewBoxRelation;
}

export interface PreviewScenario {
  id: string;
  title: string;
  /** Box paths of the steps, in order. */
  steps: string[];
}

/** The rule-2 content of one story, in the shape a reader reads it. */
export interface StoryPreviewContent {
  story: { id: string; role: string; want: string; soThat: string };
  requirements: { id: string; kind: string; text: string }[];
  criteria: { id: string; given: string; when: string; then: string }[];
  scenarios: PreviewScenario[];
  boxes: PreviewBox[];
  roles: { id: string; name?: string }[];
}

export interface PreviewCounts {
  requirements: number;
  criteria: number;
  scenarios: number;
  boxes: number;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));

/** Every box of a `storyContentV2` content, flat, in content order (children after their box). */
function flatBoxes(content: Record<string, unknown>): Map<string, { box: Record<string, unknown>; relation: PreviewBoxRelation }> {
  const out = new Map<string, { box: Record<string, unknown>; relation: PreviewBoxRelation }>();
  const story = isObject(content.story) ? (content.story as Story) : undefined;
  const serves = (box: Record<string, unknown>) => story !== undefined && asArray(box.stories).includes(story.id);
  const add = (path: string, box: Record<string, unknown>, relation: PreviewBoxRelation): void => {
    const { children, ...own } = box;
    out.set(path, { box: own, relation: serves(box) ? 'serves' : relation });
    if (!isObject(children)) return;
    for (const c of asArray<Record<string, unknown>>(children.boxes)) if (isObject(c) && typeof c.id === 'string') add(`${path}/${c.id}`, c, 'inside');
  };
  const boxes = isObject(content.boxes) ? content.boxes : {};
  // An ancestor is in without its children; a serving box is in with them.
  for (const [path, box] of Object.entries(boxes)) if (isObject(box) && !out.has(path)) add(path, box, 'parent');
  return out;
}

/** The content of `storyContentV2` as a reader reads it. */
export function previewContent(content: Record<string, unknown>): StoryPreviewContent {
  const story = (isObject(content.story) ? content.story : {}) as Partial<Story>;
  const roles = isObject(content.roles) ? content.roles : {};
  return {
    story: { id: str(story.id), role: str(story.role), want: str(story.want), soThat: str(story.soThat) },
    requirements: asArray<Requirement>(content.requirements)
      .filter(isObject)
      .map((r) => ({ id: str(r.id), kind: str(r.kind), text: str(r.text) })),
    criteria: asArray<AcceptanceCriterion>(story.acceptance)
      .filter(isObject)
      .map((c) => ({ id: str(c.id), given: str(c.given), when: str(c.when), then: str(c.then) })),
    scenarios: asArray<Record<string, unknown>>(content.scenarios)
      .filter(isObject)
      .map((s) => ({ id: str(s.id), title: str(s.title), steps: asArray<Record<string, unknown>>(s.steps).map((st) => (isObject(st) ? str(st.name) : '')) })),
    boxes: [...flatBoxes(content)].map(([path, { box, relation }]) => ({ path, title: str(box.title), kind: str(box.kind), lane: str(box.lane), relation })),
    roles: Object.entries(roles).map(([id, r]) => (isObject(r) && typeof (r as Role).name === 'string' ? { id, name: (r as Role).name } : { id })),
  };
}

export function previewCounts(p: StoryPreviewContent): PreviewCounts {
  return { requirements: p.requirements.length, criteria: p.criteria.length, scenarios: p.scenarios.length, boxes: p.boxes.length };
}

// ---------------------------------------------------------------- word diff

export interface WordPart {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

/** Longest texts (in words and spaces) the word diff compares; longer ones give one removed and one added part. */
const MAX_TOKENS = 800;

/** Word-level difference of two texts. Words and the spaces between them are the tokens. */
export function wordDiff(before: string, after: string): WordPart[] {
  const a = before.match(/\S+|\s+/g) ?? [];
  const b = after.match(/\S+|\s+/g) ?? [];
  const parts: WordPart[] = [];
  const push = (kind: WordPart['kind'], text: string): void => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else if (text !== '') parts.push({ kind, text });
  };
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    push('removed', before);
    push('added', after);
    return parts;
  }
  // Longest common subsequence of the tokens.
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', b[j]!);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) push('removed', a[i++]!);
    else push('added', b[j++]!);
  }
  while (i < n) push('removed', a[i++]!);
  while (j < m) push('added', b[j++]!);
  return parts;
}

// ---------------------------------------------------------------- content diff

export type ChangePart = 'story' | 'requirement' | 'criterion' | 'scenario' | 'box' | 'role';

export interface ContentChange {
  part: ChangePart;
  /** S4, R9, S4-A2, S4-drill, review/drill, builder. */
  id: string;
  change: 'added' | 'removed' | 'changed';
  /** The field that changed, e.g. `then`, `title`, `example of step 2`. */
  field?: string;
  before?: string;
  after?: string;
  /** Word-level difference, when both sides are one line of text. */
  words?: WordPart[];
  /** The change in plain words, e.g. `criterion S4-A2 "then" changed`. */
  text: string;
}

const STORY_FIELDS: Record<string, string> = { role: 'role', want: '"I want"', soThat: '"so that"' };
const CRITERION_FIELDS = ['given', 'when', 'then'];

const same = (a: unknown, b: unknown): boolean => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isObject(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

/** A value as a reader reads it: a string as is, anything else as compact JSON. */
const show = (v: unknown): string | undefined => (v === undefined ? undefined : typeof v === 'string' ? v : JSON.stringify(sortKeys(v)));

function changed(part: ChangePart, id: string, field: string, before: unknown, after: unknown, text: string): ContentChange {
  const b = show(before);
  const a = show(after);
  const c: ContentChange = { part, id, change: 'changed', field, text };
  if (b !== undefined) c.before = b;
  if (a !== undefined) c.after = a;
  if (typeof before === 'string' && typeof after === 'string') c.words = wordDiff(before, after);
  return c;
}

/** Items by id, in order; items without a string id are skipped. */
function byId<T>(list: unknown): Map<string, T & Record<string, unknown>> {
  const out = new Map<string, T & Record<string, unknown>>();
  for (const x of asArray<Record<string, unknown>>(list)) if (isObject(x) && typeof x.id === 'string' && !out.has(x.id)) out.set(x.id, x as T & Record<string, unknown>);
  return out;
}

/** Added, removed and changed items of two id lists. `fields` lists the changes of one item. */
function diffList<T>(
  part: ChangePart,
  name: string,
  before: Map<string, T>,
  after: Map<string, T>,
  fields: (id: string, b: T, a: T) => ContentChange[],
): ContentChange[] {
  const out: ContentChange[] = [];
  for (const [id, b] of before) {
    const a = after.get(id);
    if (a === undefined) out.push({ part, id, change: 'removed', text: `${name} ${id} removed` });
    else if (!same(b, a)) out.push(...fields(id, b, a));
  }
  for (const id of after.keys()) if (!before.has(id)) out.push({ part, id, change: 'added', text: `${name} ${id} added` });
  return out;
}

/** The changed fields of two objects; `label` names a field for the text. */
function diffFields(
  part: ChangePart,
  name: string,
  id: string,
  b: Record<string, unknown>,
  a: Record<string, unknown>,
  skip: string[] = [],
  label: (k: string) => string = (k) => `"${k}"`,
): ContentChange[] {
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !skip.includes(k));
  return keys.filter((k) => !same(b[k], a[k])).map((k) => changed(part, id, k, b[k], a[k], `${name} ${id} ${label(k)} changed`));
}

function stepText(s: unknown): string {
  if (!isObject(s)) return String(s);
  return typeof s.branch === 'string' ? `${str(s.name)} (${s.branch})` : str(s.name);
}

function diffScenario(id: string, b: Record<string, unknown>, a: Record<string, unknown>): ContentChange[] {
  const out = diffFields('scenario', 'scenario', id, b, a, ['steps']);
  const bs = asArray(b.steps);
  const as = asArray(a.steps);
  if (same(bs, as)) return out;
  if (bs.length !== as.length || bs.some((s, i) => !isObject(s) || !isObject(as[i]) || s.name !== (as[i] as Record<string, unknown>).name)) {
    out.push(changed('scenario', id, 'steps', bs.map(stepText).join(' → '), as.map(stepText).join(' → '), `scenario ${id} steps changed (${bs.length} → ${as.length} steps)`));
    return out;
  }
  bs.forEach((s, i) => {
    const t = as[i] as Record<string, unknown>;
    const step = s as Record<string, unknown>;
    for (const k of [...new Set([...Object.keys(step), ...Object.keys(t)])]) {
      if (same(step[k], t[k])) continue;
      const what = k === 'example' ? 'example' : `"${k}"`;
      out.push(changed('scenario', id, `step ${i + 1} ${k}`, step[k], t[k], `scenario ${id} ${what} of step ${i + 1} (${str(t.name)}) changed`));
    }
  });
  return out;
}

/**
 * What changed between two `storyContentV2` contents of one story, in plain words: the story
 * sentence, requirements, acceptance criteria, scenarios, boxes and lane roles that were added,
 * removed or changed. An empty list means the two contents are the same.
 */
export function diffStoryContent(before: Record<string, unknown>, after: Record<string, unknown>): ContentChange[] {
  const out: ContentChange[] = [];
  const bStory = (isObject(before.story) ? before.story : {}) as Record<string, unknown>;
  const aStory = (isObject(after.story) ? after.story : {}) as Record<string, unknown>;
  const storyId = str(aStory.id ?? bStory.id);

  // The story sentence and its other fields (requirement ids show as requirements added/removed).
  out.push(...diffFields('story', 'story', storyId, bStory, aStory, ['id', 'acceptance', 'requirements', 'status', 'signedHash'], (k) => STORY_FIELDS[k] ?? `"${k}"`));

  out.push(
    ...diffList<Record<string, unknown>>('requirement', 'requirement', byId(before.requirements), byId(after.requirements), (id, b, a) =>
      diffFields('requirement', 'requirement', id, b, a, ['id'], (k) => (k === 'text' ? 'text' : `"${k}"`)),
    ),
  );
  out.push(
    ...diffList<Record<string, unknown>>('criterion', 'criterion', byId(bStory.acceptance), byId(aStory.acceptance), (id, b, a) =>
      diffFields('criterion', 'criterion', id, b, a, ['id']).sort((x, y) => fieldOrder(x.field) - fieldOrder(y.field)),
    ),
  );
  out.push(...diffList<Record<string, unknown>>('scenario', 'scenario', byId(before.scenarios), byId(after.scenarios), diffScenario));

  const flat = (c: Record<string, unknown>) => new Map([...flatBoxes(c)].map(([p, e]) => [p, e.box]));
  out.push(
    ...diffList<Record<string, unknown>>('box', 'box', flat(before), flat(after), (id, b, a) => {
      const fields = diffFields('box', 'box', id, b, a, ['id']);
      return fields.map((f) => ({ ...f, text: `box ${id}: ${f.field} changed` }));
    }),
  );

  const roles = (c: Record<string, unknown>) =>
    new Map(Object.entries(isObject(c.roles) ? c.roles : {}).map(([id, r]) => [id, (isObject(r) ? r : { missing: true }) as Record<string, unknown>]));
  out.push(...diffList<Record<string, unknown>>('role', 'role', roles(before), roles(after), (id, b, a) => diffFields('role', 'role', id, b, a, ['id'])));
  return out;
}

function fieldOrder(field: string | undefined): number {
  const i = CRITERION_FIELDS.indexOf(field ?? '');
  return i < 0 ? CRITERION_FIELDS.length : i;
}
