// The build brief of a signed story (T44, box `build-brief`): Markdown a coding agent can build
// the story from on its own. It holds the signed state, the story sentence, its requirements and
// criteria, the approved scenarios (drafts apart), the boxes that serve the story with their
// contracts and edges, the decisions and entities they rest on, and how to work in a rehearse
// repo (HOW_TO_WORK). It refuses an unsigned or stale story unless the caller allows it. Pure:
// the decision texts come in as an option (`decisionTexts` reads them from brainstorm.md).
//
// The change notice (`storyChangeMessage`) tells a running thread what changed in its plan: the
// T39 content diff from the content the thread started from to the content now.

import { indexBoxes } from '../flow-index.js';
import type { AcceptanceCriterion, Box, EntityDef, EpicRecord, Hash, Id, Requirement, Role, Scenario, ScenarioStep, Story } from '../types.js';
import { asArray, isObject } from '../util.js';
import { codeStartSection, MAX_CODE_SECTION_CHARS, type CodeStartOptions } from './code-start.js';
import { howToWorkMarkdown } from './how-to-work.js';
import { diffStoryContent, type ContentChange } from './signoff-preview.js';
import { allScenarios, detectStale, scenarioTrust, signOffRule } from './stale.js';
import { servingBoxes, storyContentV2, storyHashV2 } from './story-hash.js';
import { CURRENT_HASH_RULE, type SignOffWithRule } from './types.js';

/** The most a build brief holds: about 6k tokens at four characters a token (T44). */
export const MAX_BRIEF_CHARS = 24_000;

/** `code`, `codeUnavailable` and `cli`: the "Code you start from" section (T49), gathered by the caller. */
export interface BuildBriefOptions extends CodeStartOptions {
  /** Make a brief of a story that is not signed or is stale; it says so on top. */
  allowUnsigned?: boolean;
  /** Decision id → text (`decisionTexts`). A cited id without text is listed by id. */
  decisions?: Record<string, string>;
}

/** Where the story stands against its sign-off. */
export interface BriefSignState {
  status: 'signed' | 'stale' | 'draft';
  /** Signed under the current hash rule and unchanged since: an agent may build from it. */
  buildable: boolean;
  by?: string;
  at?: string;
  hashRule?: number;
  /** The hash in the latest sign-off of the story. */
  signedHash?: Hash;
  /** Story hash rule 2 of the content now: the plan hash a thread is started from. */
  currentHash: Hash;
  /** Why an agent may not build from it, in plain words. */
  refusal?: string;
}

export type BuildBrief =
  | {
      ok: true;
      storyId: Id;
      markdown: string;
      /** Story hash rule 2 of the content the brief was made from. */
      hash: Hash;
      /** That content (`storyContentV2`), for the change list later. */
      content: Record<string, unknown>;
      sign: BriefSignState;
    }
  | { ok: false; storyId: Id; reason: string; sign?: BriefSignState };

const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
const shortHash = (h: string | undefined): string => (h ? `${h.slice(0, 19)}…` : 'none');
/** Longest decision text the brief keeps. */
const MAX_DECISION_CHARS = 400;
/** Longest compact JSON of one example or expected state. */
const MAX_JSON_CHARS = 400;

/** Compact JSON of a value, cut when long. */
function compact(v: unknown): string {
  const text = JSON.stringify(v) ?? '';
  return text.length > MAX_JSON_CHARS ? `${text.slice(0, MAX_JSON_CHARS - 1)}…` : text;
}

/** The sign-off state of a story. */
export function briefSignState(record: EpicRecord, storyId: Id): BriefSignState | undefined {
  const story = asArray<Story>(record.prd?.stories).find((s) => isObject(s) && s.id === storyId);
  if (!story || !record.prd) return undefined;
  const currentHash = storyHashV2(story, record.prd, record.flow, allScenarios(record));
  const trust = detectStale(record).stories.find((s) => s.id === storyId);
  const latest = [...asArray<SignOffWithRule>(record.signoff?.signOffs).filter(isObject)]
    .reverse()
    .find((s) => isObject(s.storyHashes) && typeof s.storyHashes[storyId] === 'string');
  const state: BriefSignState = { status: trust?.status ?? 'draft', buildable: false, currentHash };
  if (latest) {
    state.by = str(latest.by);
    state.at = str(latest.at);
    state.hashRule = signOffRule(latest);
    state.signedHash = latest.storyHashes[storyId];
  }
  if (state.status === 'draft') state.refusal = `story ${storyId} is not signed off; the owner signs it off in the rehearse UI before an agent builds it`;
  else if (state.status === 'stale') state.refusal = `story ${storyId} changed since it was signed off on ${state.at}; the owner must sign it off again before an agent builds it`;
  else if (state.hashRule !== CURRENT_HASH_RULE) state.refusal = `story ${storyId} was signed under hash rule ${state.hashRule}, which does not cover its boxes; the owner must sign it off again`;
  else state.buildable = true;
  return state;
}

/** The build brief of one story, or why there is none. */
export function storyBuildBrief(record: EpicRecord, storyId: Id, opts: BuildBriefOptions = {}): BuildBrief {
  const prd = record.prd;
  const story = asArray<Story>(prd?.stories).find((s) => isObject(s) && s.id === storyId);
  const sign = briefSignState(record, storyId);
  if (!story || !prd || !sign) return { ok: false, storyId, reason: `no story ${storyId} in prd.yaml` };
  if (!sign.buildable && !opts.allowUnsigned) return { ok: false, storyId, reason: sign.refusal ?? `story ${storyId} cannot be built yet`, sign };
  const content = storyContentV2(story, prd, record.flow, allScenarios(record));
  const before = [header(record, story, sign), storySection(record, story), scenarioSection(record, story), boxSection(record, story)];
  const after = [decisionSection(record, story, opts.decisions ?? {}), entitySection(record, story), `## How to work in this repo\n\n${howToWorkMarkdown()}`];
  // The code section gets what the rest leaves under the budget (T49).
  const rest = [...before, ...after].filter((s) => s !== '').join('\n\n').length;
  const room = Math.min(MAX_CODE_SECTION_CHARS, MAX_BRIEF_CHARS - rest - 4);
  const markdown = [...before, codeStartSection(briefBoxPaths(record, story.id), opts, room), ...after].filter((s) => s !== '').join('\n\n');
  return { ok: true, storyId, markdown: `${markdown}\n`, hash: sign.currentHash, content, sign };
}

function header(record: EpicRecord, story: Story, sign: BriefSignState): string {
  const lines = [`# Build brief: story ${story.id} of the EPIC ${record.slug}`, ''];
  if (sign.status === 'signed') {
    lines.push(`Signed off by ${sign.by} on ${sign.at}, at story hash ${shortHash(sign.signedHash)} (rule ${sign.hashRule}).`);
    lines.push(sign.buildable ? 'This brief matches the signed story.' : `**Do not build from it yet:** ${sign.refusal}.`);
  } else if (sign.status === 'stale') {
    lines.push(`Signed off by ${sign.by} on ${sign.at}, at story hash ${shortHash(sign.signedHash)} (rule ${sign.hashRule}).`);
    lines.push(`**The story changed since it was signed.** This brief shows the plan now (hash ${shortHash(sign.currentHash)}), which the owner has not signed.`);
  } else {
    lines.push('**The story is not signed off.** This brief shows a plan the owner has not agreed to: ask before you build.');
  }
  lines.push(`Record: \`docs/epics/${record.slug}/\` (prd.yaml, flow.yaml, scenarios/${story.id}.yaml). Plan hash: ${shortHash(sign.currentHash)}.`);
  return lines.join('\n');
}

function roleName(record: EpicRecord, id: string): string {
  const role = asArray<Role>(record.prd?.roles).find((r) => isObject(r) && r.id === id);
  return role && typeof role.name === 'string' ? role.name : id;
}

function storySection(record: EpicRecord, story: Story): string {
  const lines = ['## Story', '', `As ${roleName(record, story.role)}, I want ${oneLine(str(story.want))}, so that ${oneLine(str(story.soThat))}.`];
  const reqs = asArray<Requirement>(record.prd?.requirements).filter((r) => isObject(r) && asArray(story.requirements).includes(r.id));
  if (reqs.length > 0) {
    lines.push('', '### Requirements', '');
    for (const r of reqs) lines.push(`- ${r.id} (${r.kind}): ${oneLine(str(r.text))}${r.provenBy ? ` Proven by: ${oneLine(r.provenBy)}.` : ''}`);
  }
  const criteria = asArray<AcceptanceCriterion>(story.acceptance).filter(isObject);
  if (criteria.length > 0) {
    lines.push('', '### Acceptance criteria', '');
    for (const c of criteria) lines.push(`- ${c.id}: given ${oneLine(str(c.given))}; when ${oneLine(str(c.when))}; then ${oneLine(str(c.then))}.`);
  }
  return lines.join('\n');
}

function stepText(s: ScenarioStep): string {
  return s.branch ? `${s.name} [${s.branch}]` : s.name;
}

function scenarioSection(record: EpicRecord, story: Story): string {
  const criteria = new Map(asArray<AcceptanceCriterion>(story.acceptance).filter(isObject).map((c) => [c.id, c]));
  const mine = record.scenarioFiles.flatMap((f) => asArray<Scenario>(f.scenarios).filter((s) => isObject(s) && s.story === story.id).map((s) => ({ s, trust: scenarioTrust(s, f.file) })));
  const approved = mine.filter((m) => m.trust.status === 'approved').map((m) => m.s);
  const others = mine.filter((m) => m.trust.status !== 'approved');
  const lines = ['## Approved scenarios', ''];
  if (approved.length === 0) lines.push('None yet. Build nothing to a scenario the owner has not approved.');
  else lines.push('Build to these. Write one e2e test per scenario, named after its id; each step of the test starts with the box it walks.');
  for (const s of approved) {
    lines.push('', `### ${s.id}: ${oneLine(str(s.title))}`, '');
    const c = s.expect?.criterion ? criteria.get(s.expect.criterion) : undefined;
    if (c) lines.push(`- Checks ${c.id}: given ${oneLine(str(c.given))}; when ${oneLine(str(c.when))}; then ${oneLine(str(c.then))}.`);
    lines.push(`- Steps: ${asArray<ScenarioStep>(s.steps).filter(isObject).map(stepText).join(' → ')}`);
    asArray<ScenarioStep>(s.steps).forEach((st, i) => {
      if (!isObject(st) || !isObject(st.example)) return;
      const ex = st.example;
      lines.push(`- Step ${i + 1} \`${st.name}\`: given ${compact(ex.given ?? {})} → then ${compact(ex.then ?? {})}${ex.stateAfter ? `; state after ${compact(ex.stateAfter)}` : ''}`);
    });
    if (isObject(s.expect)) lines.push(`- Expect (what the e2e test checks): ${compact(s.expect.state ?? {})}`);
  }
  if (others.length > 0) {
    lines.push('', '### Not approved, do not build to them', '');
    for (const { s, trust } of others) lines.push(`- ${s.id} (${trust.status}${trust.reason ? `: ${trust.reason}` : ''}): ${oneLine(str(s.title))}`);
  }
  return lines.join('\n');
}

/** `a: string, b: list X` */
function fields(map: unknown): string {
  return isObject(map) ? Object.entries(map).map(([k, v]) => `${k}: ${str(v)}`).join(', ') : '';
}

function contract(box: Box, indent: string): string[] {
  const lines: string[] = [];
  const add = (label: string, value: string) => {
    if (value !== '') lines.push(`${indent}- ${label}: ${value}`);
  };
  add('inputs', fields(box.inputs));
  add('outputs', fields(box.outputs));
  add('reads', asArray<string>(box.reads).join(', '));
  add('writes', asArray<string>(box.writes).join(', '));
  add('side effects', asArray<string>(box.sideEffects).join('; '));
  add('error exits', asArray<string>(box.errorExits).join(', '));
  add('decisions', asArray<string>(box.decisions).join(', '));
  return lines;
}

function boxLine(record: EpicRecord, path: string, box: Box): string {
  const bits = [str(box.kind), `lane ${roleName(record, str(box.lane))}`];
  if (box.package) bits.push(`package ${box.package}`);
  return `\`${path}\` (${bits.join(', ')}): ${oneLine(str(box.title))}`;
}

/** Paths of the boxes the brief lists: the serving boxes and every box inside one, in flow order. */
export function briefBoxPaths(record: EpicRecord, storyId: Id): string[] {
  const serving = servingBoxes(record.flow, storyId);
  return [...indexBoxes(record.flow).keys()].filter((p) => serving.some((s) => p === s || p.startsWith(`${s}/`)));
}

function boxSection(record: EpicRecord, story: Story): string {
  const index = indexBoxes(record.flow);
  const serving = servingBoxes(record.flow, story.id);
  const listed = new Set(briefBoxPaths(record, story.id));
  const lines = ['## Boxes', ''];
  if (serving.length === 0) return [...lines, 'No box serves this story yet.'].join('\n');
  lines.push(`The boxes that serve ${story.id}, with their contracts. Each commit that builds one names it: \`Flow-Box: <path>\`. flow.yaml keeps notes as comments next to each box; read them there.`);
  for (const path of listed) {
    const entry = index.get(path)!;
    const depth = path.split('/').length - (serving.find((s) => path === s || path.startsWith(`${s}/`))!.split('/').length);
    const indent = '  '.repeat(depth);
    if (depth === 0) {
      const parent = entry.parent ? ` Inside \`${entry.parent}\` (${oneLine(str(index.get(entry.parent)?.box.title))}).` : '';
      lines.push('', `### ${boxLine(record, path, entry.box)}${parent}`);
      lines.push(...contract(entry.box, ''));
    } else {
      lines.push(`${'  '.repeat(depth - 1)}- child ${boxLine(record, path, entry.box)}`);
      lines.push(...contract(entry.box, indent));
    }
  }
  // The edges that touch a listed box, per diagram.
  const edges: string[] = [];
  const seen = new Set<string>();
  for (const path of listed) {
    const entry = index.get(path)!;
    const prefix = entry.parent ? `${entry.parent}/` : '';
    for (const e of asArray<{ from: string; to: string; label?: string; kind?: string }>(entry.diagram.edges)) {
      if (!isObject(e)) continue;
      const from = `${prefix}${e.from}`;
      const to = `${prefix}${e.to}`;
      if (!listed.has(from) && !listed.has(to)) continue;
      const key = `${from}>${to}>${e.label ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const tag = e.kind && e.kind !== 'normal' ? ` (${e.kind}${e.label ? `: ${e.label}` : ''})` : e.label ? ` (${e.label})` : '';
      const name = (p: string) => (listed.has(p) ? `\`${p}\`` : `\`${p}\` ${oneLine(str(index.get(p)?.box.title))}`);
      edges.push(`- ${name(from)} → ${name(to)}${tag}`);
    }
  }
  if (edges.length > 0) lines.push('', '### Edges', '', ...edges);
  return lines.join('\n');
}

/** Decision ids the story cites: on its boxes, or written in its text, e.g. `(D26)`. */
function citedDecisions(record: EpicRecord, story: Story): string[] {
  const index = indexBoxes(record.flow);
  const out = new Set<string>();
  for (const p of briefBoxPaths(record, story.id)) for (const d of asArray<string>(index.get(p)?.box.decisions)) out.add(d);
  const reqs = asArray<Requirement>(record.prd?.requirements).filter((r) => isObject(r) && asArray(story.requirements).includes(r.id));
  const text = JSON.stringify([story, reqs]);
  for (const m of text.matchAll(/\b([DG][0-9]{1,3})\b/g)) out.add(m[1]!);
  return [...out].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

function decisionSection(record: EpicRecord, story: Story, texts: Record<string, string>): string {
  const ids = citedDecisions(record, story);
  if (ids.length === 0) return '';
  const lines = ['## Decisions', ''];
  for (const id of ids) {
    const t = texts[id];
    if (t === undefined) lines.push(`- ${id} (see the brainstorm.md files in docs/epics/)`);
    else lines.push(`- ${id}: ${t.length > MAX_DECISION_CHARS ? `${t.slice(0, MAX_DECISION_CHARS - 1)}…` : t}`);
  }
  return lines.join('\n');
}

function entitySection(record: EpicRecord, story: Story): string {
  const index = indexBoxes(record.flow);
  const used = new Set<string>();
  for (const p of briefBoxPaths(record, story.id)) {
    const box = index.get(p)!.box;
    for (const ref of [...asArray<string>(box.reads), ...asArray<string>(box.writes)]) if (typeof ref === 'string') used.add(ref.split('.')[0]!);
  }
  const defs = asArray<EntityDef>(record.entities?.entities).filter((e) => isObject(e) && used.has(e.id));
  if (defs.length === 0) return '';
  const lines = ['## Entities the boxes read or write', ''];
  for (const e of defs) lines.push(`- ${e.id}${e.file ? ` (${e.file})` : ''}: ${fields(e.fields)}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- decision texts (pure parse)

/** `- **D41 Signed approvals**: text` → { D41: 'Signed approvals: text' }. */
export function parseDecisionTexts(markdown: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of markdown.matchAll(/^\s*[-*]\s+\*\*([A-Z]+[0-9]+(?:\/[A-Z]+[0-9]+)*)\b\s*([^*]*)\*\*:?\s*(.*)$/gm)) {
    const title = oneLine(m[2] ?? '');
    const text = oneLine(`${title}${title ? ': ' : ''}${m[3] ?? ''}`);
    for (const id of m[1]!.split('/')) if (!(id in out)) out[id] = text;
  }
  return out;
}

// ---------------------------------------------------------------- the change notice

/** The message that tells a thread its plan changed, or undefined when nothing changed. */
export function storyChangeMessage(slug: string, storyId: Id, before: Record<string, unknown>, after: Record<string, unknown>, sign: BriefSignState): { text: string; changes: ContentChange[] } | undefined {
  const changes = diffStoryContent(before, after);
  if (changes.length === 0) return undefined;
  const lines = [`The plan of story ${storyId} changed since this thread started (${changes.length} change${changes.length === 1 ? '' : 's'}):`, ''];
  for (const c of changes) {
    lines.push(`- ${c.text}`);
    if (c.change === 'changed' && (c.before !== undefined || c.after !== undefined)) {
      const cut = (s: string | undefined) => (s === undefined ? '(none)' : s.length > 300 ? `${s.slice(0, 299)}…` : s);
      lines.push(`  - before: ${cut(c.before)}`, `  - now: ${cut(c.after)}`);
    }
  }
  lines.push('');
  lines.push(sign.buildable ? 'The owner signed the new plan off.' : `The new plan is not signed off yet (${sign.refusal}). Hold work that depends on it.`);
  lines.push(`Read the whole plan again with \`rehearse brief ${slug} ${storyId}\`, then say what this changes in your work.`);
  return { text: lines.join('\n'), changes };
}
