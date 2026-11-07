// Honest "built" (T58, S23). Box box-evidence: one state per box of the plan, with its evidence in
// plain words, used by `rehearse progress`, the deck, the Status page and `rehearse status`.
//   built        a Flow-Box commit names the box (or a box inside it), and/or the code graph maps
//                code to it (its `builds` edges): the commits and the files and symbols are listed.
//   no-code      the box needs no code of its own: a start or end box always; a decision only when
//                a built neighbour (a box an edge joins it to) branches on it in its code, and the
//                file, line and neighbour are named.
//   not-built    no evidence; the words say what was looked for.
// Error exit "code graph not built yet": with no code graph, only the Flow-Box commits are looked at, and it says so.
// Pure: the record, the commits, the graph's answer and a file reader in; the states out.

import { indexBoxes, knownEdges } from '../flow-index.js';
import type { Box, EpicRecord } from '../types.js';
import { isObject } from '../util.js';

export type BuiltState = 'built' | 'no-code' | 'not-built';

export const BUILT_WORDS: Record<BuiltState, string> = { built: 'built', 'no-code': 'no code of its own', 'not-built': 'not built' };

/** A commit with Flow-Box trailers, the branch git reached it from, and the files it touched (when read). */
export interface TrailerCommit {
  sha: string;
  subject: string;
  boxes: string[];
  branch: string;
  files?: string[];
}

/** A piece of code the code graph maps to a box. */
export interface GraphCode {
  file: string;
  symbol?: string;
  line?: number;
}

/** What the code graph says: the code each box path's `builds` edges reach, or why it cannot say. */
export type GraphBuilds = { ok: true; at?: string; builds: Record<string, GraphCode[]> } | { ok: false; why: string };

export const NO_GRAPH = 'the code graph is not built yet, so only Flow-Box commits were looked at (rehearse graph update builds it)';

/** Where a built neighbour branches on a decision. */
export interface BranchLine {
  neighbour: string;
  file: string;
  line: number;
  text: string;
  /** The file is code the graph maps to the neighbour, or a file of the neighbour's Flow-Box commits. */
  via: 'graph' | 'commits';
}

export interface BoxEvidence {
  path: string;
  title: string;
  kind: string;
  state: BuiltState;
  /** Flow-Box commits that name the box or a box inside it. */
  commits: { sha: string; subject: string; branch: string }[];
  /** Code the code graph maps to the box or a box inside it. */
  code: GraphCode[];
  /** A decision with no code of its own: where a built neighbour branches on it. */
  branch?: BranchLine;
  /** The evidence, or what was looked for, in plain words. */
  text: string;
}

export interface EvidenceInput {
  record: EpicRecord;
  /** The boxes to judge. */
  paths: readonly string[];
  commits: readonly TrailerCommit[];
  graph: GraphBuilds;
  /** A file of the repo as text; undefined when it is not there. */
  readFile?: (file: string) => string | undefined;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * The box path a trailer names in this EPIC, or undefined: `2026-11-05-rehearse/validate/refs` is
 * `validate/refs` here; a trailer that names another EPIC's folder is not ours.
 */
export function trailerPath(trailer: string, slug: string): string | undefined {
  if (trailer.startsWith(`${slug}/`)) return trailer.slice(slug.length + 1);
  if (/^\d{4}-\d{2}-\d{2}-[^/]+\//.test(trailer)) return undefined;
  return trailer;
}

const serves = (named: string, path: string): boolean => named === path || named.startsWith(`${path}/`);

/** Folders that hold no product code: drawings of the plan, docs, helper scripts, examples, e2e tests. */
const NOT_PRODUCT = /^(?:design|docs|scripts|examples|e2e|presentations|\.[^/]+)\//;

/** Product code a decision's branch may live in: TypeScript and Python, not tests, not type declarations, not design or docs. */
export function isSourceFile(file: string): boolean {
  return /\.(?:[cm]?tsx?|py)$/.test(file) && !file.endsWith('.d.ts') && !NOT_PRODUCT.test(file) && !/(^|\/)(tests?|__tests__|fixtures?)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$/.test(file);
}

/** The words a decision goes by in code: its id and its inputs of two words or more, squashed: `gate-ok` → `gateok`. */
export function decisionTokens(box: Pick<Box, 'id' | 'inputs'>): string[] {
  const squash = (s: string) => s.toLowerCase().replace(/[-_]/g, '');
  const out = new Set<string>([squash(box.id)]);
  for (const name of Object.keys(isObject(box.inputs) ? box.inputs : {})) if (/[a-z][A-Z]|[-_]/.test(name)) out.add(squash(name));
  return [...out].filter((t) => t.length >= 3);
}

const BRANCH = /\bif\b|\belse\b|\bswitch\b|\bcase\b|\bwhile\b|&&|\|\||[!=]==|\s\?\s/;

/** The code of a line without its comment; empty for a comment line. */
function codeOf(line: string): string {
  const t = line.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('#')) return '';
  return line.replace(/\s\/\/.*$/, '');
}

/** The first line of `text` that branches (if, else, switch, a ternary, a comparison) and names one of the tokens. */
export function branchLine(text: string, tokens: readonly string[]): { line: number; text: string } | undefined {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const code = codeOf(lines[i]!);
    if (code === '' || !BRANCH.test(code)) continue;
    const words = (code.match(/[A-Za-z_][\w-]*/g) ?? []).map((w) => w.toLowerCase().replace(/[-_]/g, ''));
    if (words.some((w) => tokens.some((t) => w.includes(t)))) return { line: i + 1, text: lines[i]!.trim().slice(0, 160) };
  }
  return undefined;
}

function codeWords(code: GraphCode[]): string {
  const files = [...new Set(code.map((c) => c.file))].sort((a, b) => Number(!isSourceFile(a)) - Number(!isSourceFile(b)));
  const shown = files.slice(0, 3).map((f) => {
    const symbols = [...new Set(code.filter((c) => c.file === f && c.symbol).map((c) => c.symbol!))];
    return symbols.length > 0 ? `${f} (${symbols.slice(0, 2).join(', ')}${symbols.length > 2 ? ', …' : ''})` : f;
  });
  return `${shown.join(', ')}${files.length > 3 ? ` and ${files.length - 3} more files` : ''}`;
}

/** Box box-evidence: the built state of each box, with its evidence. */
export function boxEvidence(input: EvidenceInput): BoxEvidence[] {
  const { record, graph } = input;
  const index = indexBoxes(record.flow);
  const named = input.commits.map((c) => ({ c, paths: c.boxes.flatMap((b) => trailerPath(b, record.slug) ?? []) }));
  const direct = new Map<string, BoxEvidence>();

  const builtOf = (path: string): BoxEvidence => {
    const known = direct.get(path);
    if (known) return known;
    const entry = index.get(path);
    const box = entry?.box;
    const commits = named.filter((n) => n.paths.some((p) => serves(p, path))).map(({ c }) => ({ sha: c.sha, subject: c.subject, branch: c.branch }));
    const code = graph.ok ? Object.entries(graph.builds).flatMap(([p, list]) => (serves(p, path) ? list : [])) : [];
    const base = { path, title: typeof box?.title === 'string' ? box.title : path, kind: typeof box?.kind === 'string' ? box.kind : 'unknown', commits, code };
    let ev: BoxEvidence;
    if (commits.length > 0 || code.length > 0) {
      const bits = [commits.length > 0 ? plural(commits.length, 'Flow-Box commit') : '', code.length > 0 ? `code the graph maps to it: ${codeWords(code)}` : ''].filter(Boolean);
      ev = { ...base, state: 'built', text: `built: ${bits.join('; ')}` };
    } else ev = { ...base, state: 'not-built', text: '' };
    direct.set(path, ev);
    return ev;
  };

  const lookedAt = graph.ok ? 'no Flow-Box commit names it or a box inside it, and the code graph maps no code to it' : `no Flow-Box commit names it or a box inside it; ${NO_GRAPH}`;

  /** "; 2 commits name only its parent run-query, which does not say this box is built" */
  const parentNote = (path: string): string => {
    const parents = path.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'));
    const hits = parents.flatMap((p) => {
      const n = named.filter((x) => x.paths.includes(p)).length;
      return n > 0 ? [`${plural(n, 'commit')} name${n === 1 ? 's' : ''} only its parent ${p}`] : [];
    });
    return hits.length > 0 ? `; ${hits.join(', ')}, which does not say this box is built` : '';
  };

  return input.paths.map((path) => {
    const own = builtOf(path);
    if (own.state === 'built') return own;
    const entry = index.get(path);
    if (own.kind === 'start' || own.kind === 'end') return { ...own, state: 'no-code', text: `no code of its own: ${own.kind === 'start' ? 'a start' : 'an end'} box` };
    if (own.kind !== 'decision' || !entry) return { ...own, text: `not built: ${lookedAt}${parentNote(path)}` };

    const near = [...new Set(knownEdges(entry.diagram).flatMap((e) => (e.from === entry.box.id ? [e.to] : e.to === entry.box.id ? [e.from] : [])))];
    const prefix = entry.parent === undefined ? '' : `${entry.parent}/`;
    const built = near.map((id) => builtOf(`${prefix}${id}`)).filter((n) => n.state === 'built');
    const tokens = decisionTokens(entry.box);
    for (const n of built) {
      const graphFiles = new Set(n.code.map((c) => c.file));
      const commitFiles = new Set(input.commits.filter((c) => n.commits.some((x) => x.sha === c.sha)).flatMap((c) => c.files ?? []));
      const files = [...[...graphFiles].map((f) => [f, 'graph'] as const), ...[...commitFiles].filter((f) => !graphFiles.has(f)).map((f) => [f, 'commits'] as const)];
      for (const [file, via] of files.filter(([f]) => isSourceFile(f)).sort((a, b) => a[0].localeCompare(b[0]))) {
        const text = input.readFile?.(file);
        const hit = text === undefined ? undefined : branchLine(text, tokens);
        if (hit) {
          const branch: BranchLine = { neighbour: n.path, file, line: hit.line, text: hit.text, via };
          return { ...own, state: 'no-code', branch, text: `no code of its own: its branch is in the built box ${n.path}, ${file}:${hit.line} (${via === 'graph' ? 'code the graph maps to it' : 'a file of its Flow-Box commits'})` };
        }
      }
    }
    const names = near.join(', ') || 'none';
    const why = built.length === 0 ? `none of its neighbours (${names}) is built` : `the code of its built neighbours (${built.map((n) => n.path).join(', ')}) has no branch on "${tokens.join('" or "')}"`;
    return { ...own, text: `not built: ${lookedAt}${parentNote(path)}; and ${why}, so it does not count as a decision held by a neighbour` };
  });
}

/** Boxes that count toward "built" for the done rule: built, or no code of its own. */
export const countsBuilt = (e: Pick<BoxEvidence, 'state'>): boolean => e.state !== 'not-built';

/** "8 of 8 boxes" or "6 of 8 — 2 left". */
export function builtWords(built: number, boxes: number): string {
  if (boxes === 0) return 'nothing planned';
  return built >= boxes ? `${boxes} of ${plural(boxes, 'box', 'boxes')}` : `${built} of ${boxes} — ${boxes - built} left`;
}

