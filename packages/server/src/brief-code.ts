// The code facts of a brief (T49, box `gather-box-code`): for each box of a story, the code that
// builds it already, by the drill-down's rule (`boxCode` of @rehearse/graph: its builds edges, else
// the code in the files of its Flow-Box commits from box-code.ts), ranked so the box's own code comes
// first; its earlier Flow-Box commits with their branch; the callers and callees of that code by the
// graph's PageRank; the unit tests that call it; and for a box with no code, the graph's nearest
// matches for its title and contract, as guesses. The build brief and the test brief print them
// ("Code you start from", core's code-start.ts).
//
// The graph comes in as a GraphAccess: the server's graph service (one call after the other) or a
// graph the CLI opens. When it cannot open or answer, the facts say so in one line and the brief
// still builds. Nothing here runs tests: coverage is read from the lcov files already written.

import { basename } from 'node:path';
import {
  indexBoxes,
  MAX_CODE_COMMITS,
  MAX_CODE_FUNCTIONS,
  MAX_CODE_GUESSES,
  MAX_CODE_NEIGHBOURS,
  MAX_E2E_HELPERS,
  repoCommands,
  type BoxCode,
  type CodeCommit,
  type CodeCoverage,
  type CodeRef,
  type EpicRecord,
  type TestCodeOptions,
} from '@rehearse/core';
import {
  BOX_CODE_KINDS,
  boxBuilds,
  boxCode as boxCodeOf,
  coverageIndexOf,
  find,
  findTarget,
  isTestPath,
  loadCoverage,
  openGraph,
  recordId,
  splitWords,
  type CoverageIndex,
  type CoverageStats,
  type GraphNode,
  type GraphOptions,
  type Store,
} from '@rehearse/graph';
import { codeIndex, execGit, type GitRunner } from './box-code.js';
import { repoRoot } from './graph-route.js';

/** An up-to-date graph of the repo, with its coverage index. */
export interface OpenGraph {
  store: Store;
  root: string;
  coverage: CoverageIndex;
}

/** Runs `fn` on the graph; rejects when the graph cannot open or update. */
export type GraphAccess = <T>(fn: (g: OpenGraph) => T) => Promise<T>;

/** What the briefs take: `code`, `codeUnavailable`, `cli` and `e2eHelpers`. */
export type BriefCode = TestCodeOptions;

export interface GatherOptions {
  epicDir: string;
  record: EpicRecord;
  /** The box paths to gather, e.g. `briefBoxPaths(record, story)`. */
  boxes: readonly string[];
  graph: GraphAccess;
  git?: GitRunner;
  /** The e2e test project, relative to the repo root: its helpers are listed. */
  testProject?: string;
  /** The repo root; default the nearest folder above the EPIC that holds `.git`. */
  root?: string;
}

/** A graph the caller opens for one gather (the CLI): update it, answer, close it. */
export function openGraphAccess(root: string, opts: GraphOptions = {}): GraphAccess {
  return async (fn) => {
    const graph = openGraph(root, opts);
    try {
      await graph.update();
      return fn({ store: graph.store, root, coverage: coverageIndexOf(graph.store, root, loadCoverage(root)) });
    } finally {
      graph.close();
    }
  };
}

const GLOBAL = ['--literal-pathspecs', '-c', 'core.quotePath=false'];

/** sha → the branch it is on (`git name-rev`, local branches only). */
async function branchesOf(git: GitRunner, top: string, shas: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (shas.length === 0) return out;
  const r = await git([...GLOBAL, 'name-rev', '--name-only', '--refs=refs/heads/*', ...shas], top);
  if (!r.ok) return out;
  r.stdout.trim().split('\n').forEach((name, i) => {
    const branch = name.trim().replace(/[~^].*$/, '');
    if (branch !== '' && branch !== 'undefined' && shas[i]) out.set(shas[i]!, branch);
  });
  return out;
}

/** The code facts of the boxes, or the one line that says why there are none. */
export async function gatherBriefCode(o: GatherOptions): Promise<BriefCode> {
  const git = o.git ?? execGit;
  const root = o.root ?? repoRoot(o.epicDir);
  const cli = repoCommands(root).cli;
  const allPaths = [...indexBoxes(o.record.flow).keys()];
  const index = await codeIndex(git, o.epicDir, allPaths).catch(() => undefined);
  const summaries = index?.ok ? index.boxes : {};
  const top = await git(['rev-parse', '--show-toplevel'], o.epicDir).then((r) => (r.ok ? r.stdout.trim() : root), () => root);
  const newest = new Map(o.boxes.map((b) => [b, [...(summaries[b]?.commits ?? [])].reverse()]));
  const shas = [...new Set([...newest.values()].flatMap((c) => c.slice(0, MAX_CODE_COMMITS).map((x) => x.sha)))];
  const branches = await branchesOf(git, top, shas).catch(() => new Map<string, string>());
  const commits = new Map<string, CodeCommit[]>();
  for (const [b, list] of newest) {
    commits.set(b, list.map((c) => ({ short: c.short, subject: c.subject, ...(branches.has(c.sha) ? { branch: branches.get(c.sha)! } : {}) })));
  }
  const flowBoxFiles = new Map(Object.entries(summaries).map(([b, s]) => [b, s.files] as const));
  try {
    return await o.graph((g) => ({
      cli,
      code: boxFacts(g, { record: o.record, slug: basename(o.epicDir), allPaths, boxes: o.boxes, flowBoxFiles, commits }),
      ...(o.testProject !== undefined ? { e2eHelpers: e2eHelpers(g.store, o.testProject) } : {}),
    }));
  } catch (e) {
    return { cli, codeUnavailable: e instanceof Error ? e.message : String(e) };
  }
}

interface FactsInput {
  record: EpicRecord;
  slug: string;
  allPaths: string[];
  boxes: readonly string[];
  flowBoxFiles: ReadonlyMap<string, readonly string[]>;
  commits: ReadonlyMap<string, CodeCommit[]>;
}

const lineOf = (n: GraphNode): number | undefined => {
  const m = /^(\d+)/.exec(n.range ?? '');
  return m ? Number(m[1]) : undefined;
};

const coverageOf = (s: CoverageStats): CodeCoverage => ({ percent: s.percent, tests: s.tests });

/** Words of a box's title and contract that `find` should look for. */
const STOP = new Set(['the', 'and', 'for', 'from', 'into', 'with', 'one', 'its', 'any', 'all', 'that', 'this', 'what', 'when', 'then', 'not', 'string', 'number', 'boolean', 'list', 'map', 'enum', 'ref']);
export function guessWords(title: string, contract: string[]): string {
  const words = splitWords([title, ...contract].join(' ')).split(' ').map((w) => w.toLowerCase());
  return [...new Set(words.filter((w) => w.length > 2 && !STOP.has(w)))].join(' ');
}

/** The package a box names, as a path prefix test. */
const inPackage = (pkg: string | undefined) => (file: string): boolean =>
  pkg !== undefined && pkg !== '' && (file.startsWith(`packages/${pkg}/`) || file.startsWith(`${pkg}/`));

function boxFacts(g: OpenGraph, input: FactsInput): BoxCode[] {
  const { store, coverage } = g;
  const index = indexBoxes(input.record.flow);
  const { builds } = boxBuilds(store, input.slug);
  const defined = (file: string) => store.nodesWhere('file = ? AND target_only = 0', file);
  const code = boxCodeOf({ paths: input.allPaths, builds, defined, flowBoxFiles: input.flowBoxFiles });
  // node → the boxes whose code holds it: code many boxes share is less the box's own.
  const holders = new Map<string, string[]>();
  for (const [p, nodes] of code) for (const n of nodes) holders.set(n.id, [...(holders.get(n.id) ?? []), p]);
  const related = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

  return input.boxes.map((path): BoxCode => {
    const box = index.get(path)?.box;
    const mine = inPackage(typeof box?.package === 'string' ? box.package : undefined);
    const all = code.get(path) ?? [];
    // Code of a listed box inside this one goes under that box.
    const inner = new Set(input.boxes.filter((b) => b.startsWith(`${path}/`)).flatMap((b) => (code.get(b) ?? []).map((n) => n.id)));
    // A constructor says little a reader needs: its class is in the same file.
    const own = all.filter((n) => !inner.has(n.id) && !(n.kind === 'method' && n.name === 'constructor'));
    const shared = (n: GraphNode) => (holders.get(n.id) ?? []).filter((p) => !related(p, path)).length;
    const ranked = rankCode(store, own, mine, shared);
    const shown = ranked.slice(0, MAX_CODE_FUNCTIONS);
    const facts: BoxCode = {
      box: path,
      functions: ranked.map((n) => ({ ...codeRef(n), coverage: coverageOf(coverage.node(n.id)) })),
      total: ranked.length,
      commits: input.commits.get(path) ?? [],
      callers: [],
      callees: [],
      testedBy: [],
      target: boxTarget(store, input.slug, path),
    };
    const named = shown.find((n) => findTarget(store, n.name)?.node.id === n.id);
    if (shown.length > 0) facts.show = named ? named.name : shown[0]!.id;
    if (all.length > 0) facts.coverage = coverageOf(coverage.stats(all.flatMap((n) => coverage.part(n.id) ?? [])));
    if (own.length === 0 && all.length > 0) facts.inChildren = true;
    if (shown.length > 0) {
      const inBox = new Set(all.map((n) => n.id));
      facts.callers = neighbours(store, shown, inBox, 'in');
      facts.callees = neighbours(store, shown, inBox, 'out');
      facts.testedBy = testsOf(store, coverage, shown);
    } else if (all.length === 0 && box) {
      const words = guessWords(String(box.title ?? path), [...Object.keys(box.inputs ?? {}), ...Object.keys(box.outputs ?? {})]);
      facts.guessWords = words;
      facts.guesses = guesses(store, words, mine);
    }
    return facts;
  });
}

/**
 * A box's code, most relevant first: code in the box's package; then the files that hold most of
 * its code that no other box shares (a box's own files, not the helpers a busy commit touched), a
 * few functions from each in turn; in a file, the entry points (called from other files) first.
 */
function rankCode(store: Store, own: GraphNode[], mine: (file: string) => boolean, shared: (n: GraphNode) => number): GraphNode[] {
  const PER_TURN = 3;
  const used = new Map(own.map((n) => [n.id, outsideCallers(store, n)]));
  const byFile = new Map<string, GraphNode[]>();
  for (const n of own) byFile.set(n.file!, [...(byFile.get(n.file!) ?? []), n]);
  const weight = (file: string) => byFile.get(file)!.filter((n) => shared(n) === 0).length;
  const files = [...byFile.keys()].sort(
    (a, b) => Number(mine(b)) - Number(mine(a)) || weight(b) - weight(a) || byFile.get(b)!.length - byFile.get(a)!.length || a.localeCompare(b),
  );
  const fileIndex = new Map(files.map((f, i) => [f, i]));
  const place = new Map<string, number>();
  for (const nodes of byFile.values()) {
    nodes.sort((a, b) => used.get(b.id)! - used.get(a.id)! || shared(a) - shared(b) || b.rank - a.rank || (lineOf(a) ?? 0) - (lineOf(b) ?? 0));
    nodes.forEach((n, i) => place.set(n.id, i));
  }
  const turn = (n: GraphNode) => Math.floor(place.get(n.id)! / PER_TURN);
  return [...own].sort(
    (a, b) =>
      Number(mine(b.file!)) - Number(mine(a.file!)) ||
      turn(a) - turn(b) ||
      fileIndex.get(a.file!)! - fileIndex.get(b.file!)! ||
      place.get(a.id)! - place.get(b.id)!,
  );
}

/** A node as the brief names it: a method with its class, `StoryThreadError.constructor`. */
function codeRef(n: GraphNode): CodeRef {
  const owner = n.kind === 'method' ? /\/([^/#]+)#[^/#]*$/.exec(n.id)?.[1] : undefined;
  const ref: CodeRef = { name: n.route ?? (owner ? `${owner}.${n.name}` : n.name), file: n.file! };
  const line = lineOf(n);
  if (line !== undefined) ref.line = line;
  return ref;
}

/** Exact `calls` edges into a node from code in other files, tests left out. */
function outsideCallers(store: Store, n: GraphNode): number {
  return store
    .edgesWhere('kind = ? AND to_id = ? AND trust = ?', 'calls', n.id, 'exact')
    .filter((e) => {
      const from = store.node(e.from);
      return isCode(from) && from.file !== n.file;
    }).length;
}

/** What `context` takes for a box: its path, or the record ID when the path picks another node. */
function boxTarget(store: Store, slug: string, path: string): string {
  const t = findTarget(store, path)?.node;
  return t?.kind === 'box' && (t.file ?? '').startsWith(`docs/epics/${slug}/`) ? path : recordId(slug, 'box', path);
}

const isCode = (n: GraphNode | undefined): n is GraphNode =>
  n !== undefined && !n.targetOnly && n.file !== undefined && n.kind !== 'test' && BOX_CODE_KINDS.includes(n.kind) && !isTestPath(n.file);

/** Code outside the box that calls the shown code (in) or that it calls (out), by rank. */
function neighbours(store: Store, shown: GraphNode[], inBox: Set<string>, way: 'in' | 'out'): CodeRef[] {
  const found = new Map<string, GraphNode>();
  for (const n of shown) {
    // Exact edges only: a name match (`add` of a Set) is too often another function of that name.
    const edges = store.edgesWhere(`kind = ? AND ${way === 'in' ? 'to_id' : 'from_id'} = ? AND trust = ?`, 'calls', n.id, 'exact');
    for (const e of edges) {
      const other = store.node(way === 'in' ? e.from : e.to);
      if (isCode(other) && !inBox.has(other.id)) found.set(other.id, other);
    }
  }
  return [...found.values()]
    .sort((a, b) => b.rank - a.rank || a.file!.localeCompare(b.file!) || (lineOf(a) ?? 0) - (lineOf(b) ?? 0))
    .slice(0, MAX_CODE_NEIGHBOURS)
    .map((n) => codeRef(n));
}

/** The unit tests that call the shown code: direct callers first. */
function testsOf(store: Store, coverage: CoverageIndex, shown: GraphNode[]): CodeRef[] {
  const tests = new Map<string, { name: string; file?: string; range?: string; direct: boolean }>();
  for (const n of shown) for (const t of coverage.testedBy(n.id)) if (!tests.has(t.id)) tests.set(t.id, t);
  return [...tests.values()]
    .sort((a, b) => Number(b.direct) - Number(a.direct))
    .slice(0, MAX_CODE_NEIGHBOURS)
    .map((t) => {
      const name = t.name.length > 60 ? `${t.name.slice(0, 59)}…` : t.name;
      const line = /^(\d+)/.exec(t.range ?? '')?.[1];
      return { name, file: t.file ?? '', ...(line ? { line: Number(line) } : {}) };
    });
}

/** The graph's best matches for the words, the box's package first. */
function guesses(store: Store, words: string, mine: (file: string) => boolean): CodeRef[] {
  if (words === '') return [];
  const hits = find(store, words, 60).nodes.filter((n) => isCode(n as GraphNode) && !n.file!.startsWith('docs/'));
  return [...hits]
    .map((n, i) => ({ n, i }))
    .sort((a, b) => Number(mine(b.n.file!)) - Number(mine(a.n.file!)) || a.i - b.i)
    .slice(0, MAX_CODE_GUESSES)
    .map(({ n }) => codeRef(n as GraphNode));
}

/** Functions and classes of the test project outside its spec files: helpers a test can reuse. */
function e2eHelpers(store: Store, testProject: string): CodeRef[] {
  const prefix = `${testProject.replace(/\/+$/, '')}/`;
  return store
    .nodesWhere('file LIKE ? AND target_only = 0', `${prefix}%`)
    .filter((n) => ['function', 'class'].includes(n.kind) && !/\.(spec|test)\.[cm]?[jt]sx?$/.test(n.file!))
    .sort((a, b) => a.file!.localeCompare(b.file!) || (lineOf(a) ?? 0) - (lineOf(b) ?? 0))
    .slice(0, MAX_E2E_HELPERS)
    .map((n) => codeRef(n));
}
