// The code map (T40): the whole repo's code graph in three levels, never a hairball.
//   packages  one node per package (nearest package.json / pyproject.toml), sized by summed PageRank;
//             outside packages (node_modules, the venv) as faded nodes. Edges: the imports and calls
//             between two packages, counted.
//   package   the files of one package, the edges among them, and a stub node for each other
//             package its files use or are used by.
//   file      the classes, functions, methods, routes and tests of one file and their calls; the
//             callers and callees elsewhere as one outside node per other file (per package
//             outside the repo), with the code in it listed and its calls counted.
// A level draws at most `limit` nodes; the rest fold into one "+N more" node. Every node says which
// plan boxes it serves: the boxes whose `builds` edges (Flow-Box trailers, the git linker) reach the
// code in it. Read only: it reads the store and changes nothing.
//
// A package inside another package's folder (a test fixture with its own package.json) counts as
// part of the outer one. A file of no package belongs to the package around it, else to its top folder.

import { posix } from 'node:path';
import type { CoverageInfo, CoverageStats } from './coverage.js';
import type { Store } from './store.js';
import type { EdgeKind, GraphEdge, GraphNode, NodeKind, Trust } from './types.js';

export const MAP_LEVELS = ['packages', 'package', 'file'] as const;
export type MapLevel = (typeof MAP_LEVELS)[number];

/** The most nodes one level draws. */
export const MAP_LIMIT = 150;

/** The edges the map counts. `defines` is the structure, `tests` repeats a test's calls, `builds` and `changes` are the plan's. */
export const MAP_EDGE_KINDS: readonly EdgeKind[] = ['imports', 'calls', 'http-calls', 'references', 'extends', 'implements'];
/** The file level draws what runs: calls, not the imports of the file. */
const FILE_EDGE_KINDS: readonly EdgeKind[] = ['calls', 'http-calls', 'references', 'extends', 'implements'];

const CODE_KINDS: readonly NodeKind[] = ['file', 'module', 'class', 'function', 'method', 'route', 'test'];
/** The most outside nodes (outside packages, stubs, other files) one level draws; the rest fold. The UI groups them. */
export const OUTSIDE_LIMIT: Record<MapLevel, number> = { packages: 60, package: 40, file: 40 };
const TRUST_ORDER: readonly Trust[] = ['exact', 'name-match', 'unresolved'];

/** A test file of vitest or pytest, or a file below a test folder (fixtures too). */
export const isTestPath = (path: string): boolean =>
  /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(test_[^/]*|[^/]*_test|conftest)\.py$/.test(path);

/** A plan box a node serves. `path` opens the box drawer; `epic` is the EPIC folder of a record box. */
export interface MapBox {
  id: string;
  path: string;
  epic?: string;
}

export type MapNodeKind = NodeKind | 'package' | 'outside' | 'stub' | 'more';

export interface MapNode {
  /** A package key, a file path or a graph node ID; `more:<what>` for a "+N more" node. */
  id: string;
  kind: MapNodeKind;
  name: string;
  file?: string;
  range?: string;
  /** Summed PageRank of the code in it; a code node's own rank. */
  rank: number;
  /** Not the subject of the level: an outside package, a stub of another package, code in another file. Drawn faded. */
  outside: boolean;
  /** A test, a test file, or a package of tests only. */
  test: boolean;
  /** The package key a stub, outside node or code node belongs to: a click on a stub goes there. */
  unit?: string;
  /** The code nodes in it (package and file levels). */
  files?: number;
  functions?: number;
  tests?: number;
  boxes: MapBox[];
  /** A "+N more" node: how many nodes it folds. */
  more?: number;
  /** An other file (or outside package) at the file level: the code in it the file calls or is called by. */
  members?: MapMember[];
  /** The calls between the file and an other file node, both ways. */
  calls?: number;
  /** Unit test coverage of the code in it (T43): packages, files and code nodes, when the repo has lcov files. */
  coverage?: CoverageStats;
}

/** Code in an other file, linked to the shown file. `to`: calls from the file to it; `from`: calls from it to the file. */
export interface MapMember {
  id: string;
  name: string;
  kind: NodeKind;
  file?: string;
  range?: string;
  to: number;
  from: number;
}

/** The edges between two map nodes, counted. `trust` is the best one among them. */
export interface MapEdge {
  from: string;
  to: string;
  count: number;
  /** How many of them a resolver confirmed. */
  exact: number;
  trust: Trust;
  kinds: EdgeKind[];
}

export interface MapTotals {
  packages: number;
  files: number;
  /** Functions and methods, tests left out. */
  functions: number;
  tests: number;
}

export interface MapQuery {
  level: MapLevel;
  /** The package key (package level) or the file path (file level). */
  target?: string;
  /** `auto`: hide the tests unless nothing else is left. */
  hideTests?: boolean | 'auto';
  /** Leave out the target-only nodes: outside packages and outside code. */
  hideOutside?: boolean;
  /** Only the nodes that serve a box of this EPIC folder. */
  epic?: string;
  limit?: number;
}

export interface CodeMap {
  level: MapLevel;
  ok: boolean;
  target?: string;
  /** What the level shows: "the repo", a package name, a file path. */
  name: string;
  /** The package of the shown package or file, for the breadcrumb. */
  unit?: { key: string; name: string };
  nodes: MapNode[];
  edges: MapEdge[];
  /** The whole repo, whatever the level and filters. */
  totals: MapTotals;
  /** The EPICs whose boxes some code serves, for the filter. */
  epics: string[];
  /** How many tests the filter left out: test files (packages and package level), tests (file level). */
  hiddenTests: number;
  notes: string[];
  /** The lcov files read, or the line that says how to make one (T43). */
  coverage?: CoverageInfo;
}

/** Where a code node is on the map: its package and its file. */
export interface MapPlace {
  unit: string;
  file?: string;
}

interface Unit {
  key: string;
  name: string;
  dir: string;
  outside: boolean;
  /** The code nodes in it. */
  ids: string[];
}

/** A code node of the map, with its package. */
interface Code {
  node: GraphNode;
  unit: string;
  test: boolean;
}

/** The map's view of the store, built once per written index run. */
export class MapIndex {
  readonly units = new Map<string, Unit>();
  readonly code = new Map<string, Code>();
  /** The map edges, both ends code nodes. */
  readonly edges: GraphEdge[] = [];
  readonly boxes = new Map<string, MapBox[]>();
  readonly epics: string[];
  readonly totals: MapTotals;

  constructor(nodes: GraphNode[], edges: GraphEdge[]) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const codeNodes = nodes.filter((n) => CODE_KINDS.includes(n.kind) && (n.language === 'typescript' || n.language === 'python'));
    const inRepo = codeNodes.filter((n) => !n.targetOnly && n.file !== undefined);

    // Packages and their folders: the folder all their files share.
    const dirs = new Map<string, string>();
    for (const n of inRepo) {
      const pkg = packageOf(n.id);
      if (pkg === '.') continue;
      const dir = posix.dirname(n.file!);
      const old = dirs.get(pkg);
      dirs.set(pkg, old === undefined ? dir : commonDir(old, dir));
    }
    const named = [...dirs].map(([key, dir]) => ({ key, dir: dir === '.' ? '' : dir })).sort((a, b) => a.dir.length - b.dir.length || (a.key < b.key ? -1 : 1));
    const outer = new Map<string, { key: string; dir: string }>();
    for (const p of named) {
      const host = named.find((q) => q !== p && q.dir !== '' && within(p.dir, q.dir) && outer.get(q.key)?.key === q.key);
      outer.set(p.key, host ? outer.get(host.key)! : p);
    }
    const unitFor = (n: GraphNode): { key: string; name: string; dir: string; outside: boolean } => {
      const pkg = packageOf(n.id);
      if (n.targetOnly || n.file === undefined) return { key: `outside:${pkg}`, name: pkg, dir: '', outside: true };
      const own = outer.get(pkg);
      if (own) return { key: own.key, name: own.key, dir: own.dir, outside: false };
      const host = [...outer.values()].find((q) => q.dir !== '' && within(posix.dirname(n.file!), q.dir) && outer.get(q.key) === q);
      if (host) return { key: host.key, name: host.key, dir: host.dir, outside: false };
      const top = n.file.includes('/') ? n.file.split('/')[0]! : '.';
      return { key: `dir:${top}`, name: top === '.' ? '(repo root)' : `${top}/`, dir: top === '.' ? '' : top, outside: false };
    };
    for (const n of codeNodes) {
      const u = unitFor(n);
      let unit = this.units.get(u.key);
      if (!unit) this.units.set(u.key, (unit = { ...u, ids: [] }));
      unit.ids.push(n.id);
      this.code.set(n.id, { node: n, unit: u.key, test: n.kind === 'test' || (n.file !== undefined && isTestPath(n.file)) });
    }

    const epics = new Set<string>();
    for (const e of edges) {
      if (MAP_EDGE_KINDS.includes(e.kind) && e.from !== e.to && this.code.has(e.from) && this.code.has(e.to)) this.edges.push(e);
      if (e.kind !== 'builds' || !this.code.has(e.to)) continue;
      const box = byId.get(e.from);
      if (box?.kind !== 'box') continue;
      const epic = /^rehearse record (\S+) \. box:/.exec(box.id)?.[1];
      if (epic) epics.add(epic);
      const list = this.boxes.get(e.to) ?? [];
      if (!list.some((b) => b.id === box.id)) list.push({ id: box.id, path: box.name, ...(epic ? { epic } : {}) });
      this.boxes.set(e.to, list);
    }
    this.epics = [...epics].sort();
    let files = 0;
    let functions = 0;
    let tests = 0;
    for (const n of inRepo) {
      if (n.kind === 'file') files++;
      else if (n.kind === 'test') tests++;
      else if ((n.kind === 'function' || n.kind === 'method') && !isTestPath(n.file!)) functions++;
    }
    this.totals = { packages: [...this.units.values()].filter((u) => !u.outside).length, files, functions, tests };
  }

  static fromStore(store: Store): MapIndex {
    return new MapIndex(store.allNodes(), store.allEdges());
  }

  /** The files of a package that are not test files: the code its coverage adds up (T43). */
  unitFiles(key: string): string[] {
    const files = new Set<string>();
    for (const id of this.units.get(key)?.ids ?? []) {
      const c = this.code.get(id)!;
      if (!c.test && !c.node.targetOnly && c.node.file !== undefined) files.add(c.node.file);
    }
    return [...files].sort();
  }

  /** The package and file of a code node; undefined for a node the map does not draw. */
  place(id: string): MapPlace | undefined {
    const c = this.code.get(id);
    if (!c || this.units.get(c.unit)!.outside) return undefined;
    return { unit: c.unit, ...(c.node.file !== undefined ? { file: c.node.file } : {}) };
  }

  /** One level of the map. */
  level(q: MapQuery): CodeMap {
    if (q.hideTests !== 'auto') return this.levelOf(q, q.hideTests === true);
    // Tests hidden, unless the level is all tests (a package of tests only, a test file).
    const hidden = this.levelOf(q, true);
    return hidden.ok && hidden.hiddenTests > 0 && !hidden.nodes.some((n) => !n.outside) ? this.levelOf(q, false) : hidden;
  }

  private levelOf(q: MapQuery, hideTests: boolean): CodeMap {
    const limit = Math.max(10, q.limit ?? MAP_LIMIT);
    const base = { level: q.level, totals: this.totals, epics: this.epics };
    const keep = (c: Code) => !(hideTests && c.test) && !(q.hideOutside && c.node.targetOnly);
    // The tests the filter leaves out: test files at the packages and package levels, tests at the file level.
    const hiddenOf = (codes: Iterable<Code>) => {
      if (!hideTests) return 0;
      const hidden = new Set<string>();
      for (const c of codes) if (c.test && !c.node.targetOnly && (q.level !== 'file' || c.node.kind === 'test')) hidden.add(q.level === 'file' ? c.node.id : c.node.file!);
      return hidden.size;
    };
    const missing = (target: string): CodeMap => ({ ...base, ok: false, target, name: target, nodes: [], edges: [], hiddenTests: 0, notes: ['not found'] });
    if (q.level === 'packages') {
      const inner = [...this.code.values()].filter((c) => !this.units.get(c.unit)!.outside);
      return { ...base, ok: true, name: 'the repo', ...this.packagesLevel(q, keep, limit), hiddenTests: hiddenOf(inner), notes: [] };
    }
    const target = q.target ?? '';
    if (q.level === 'package') {
      const unit = this.units.get(target);
      if (!unit || unit.outside) return missing(target);
      const hiddenTests = hiddenOf(unit.ids.map((id) => this.code.get(id)!));
      return { ...base, ok: true, target, name: unit.name, unit: { key: unit.key, name: unit.name }, ...this.packageLevel(unit, q, keep, limit), hiddenTests, notes: [] };
    }
    const inFile = [...this.code.values()].filter((c) => c.node.file === target && !c.node.targetOnly);
    if (inFile.length === 0) return missing(target);
    const unit = this.units.get(inFile[0]!.unit)!;
    return { ...base, ok: true, target, name: target, unit: { key: unit.key, name: unit.name }, ...this.fileLevel(inFile, q, keep, limit), hiddenTests: hiddenOf(inFile), notes: [] };
  }

  private packagesLevel(q: MapQuery, keep: (c: Code) => boolean, limit: number): Pick<CodeMap, 'nodes' | 'edges'> {
    const groups = new Map<string, Code[]>();
    for (const u of this.units.values()) groups.set(u.key, u.ids.map((id) => this.code.get(id)!).filter(keep));
    const inner = [...this.units.values()].filter((u) => !u.outside && groups.get(u.key)!.length > 0)
      .map((u) => groupNode(u.key, 'package', u.name, groups.get(u.key)!, this.boxes, false, u.key))
      .filter((n) => serves(n, q.epic));
    const edges = this.aggregate((c) => (keep(c) ? c.unit : undefined));
    const outside = q.hideOutside ? [] : [...this.units.values()].filter((u) => u.outside && groups.get(u.key)!.length > 0)
      .map((u) => groupNode(u.key, 'outside', u.name, groups.get(u.key)!, this.boxes, true, u.key));
    return fold(inner, outside, edges, limit, 'packages', OUTSIDE_LIMIT.packages);
  }

  private packageLevel(unit: Unit, q: MapQuery, keep: (c: Code) => boolean, limit: number): Pick<CodeMap, 'nodes' | 'edges'> {
    const byFile = new Map<string, Code[]>();
    for (const id of unit.ids) {
      const c = this.code.get(id)!;
      if (!keep(c)) continue;
      const list = byFile.get(c.node.file!) ?? [];
      list.push(c);
      byFile.set(c.node.file!, list);
    }
    const prefix = unit.dir === '' ? '' : `${unit.dir}/`;
    const files = [...byFile].map(([path, codes]) => ({
      ...groupNode(path, 'file', path.startsWith(prefix) ? path.slice(prefix.length) : path, codes, this.boxes, false, unit.key),
      file: path,
      test: isTestPath(path),
    })).filter((n) => serves(n, q.epic));
    const shown = new Set(files.map((f) => f.id));
    const stubKey = (key: string) => `unit:${key}`;
    const edges = this.aggregate((c) => {
      if (!keep(c)) return undefined;
      if (c.unit === unit.key) return shown.has(c.node.file!) ? c.node.file! : undefined;
      return stubKey(c.unit);
    }).filter((e) => shown.has(e.from) || shown.has(e.to));
    const stubs = [...new Set(edges.flatMap((e) => [e.from, e.to]).filter((id) => !shown.has(id)))].map((id) => {
      const u = this.units.get(id.slice('unit:'.length))!;
      return { id, kind: (u.outside ? 'outside' : 'stub') as MapNodeKind, name: u.name, rank: 0, outside: true, test: false, unit: u.key, boxes: [] };
    });
    return fold(files, stubs, edges, limit, 'files', OUTSIDE_LIMIT.package);
  }

  private fileLevel(inFile: Code[], q: MapQuery, keep: (c: Code) => boolean, limit: number): Pick<CodeMap, 'nodes' | 'edges'> {
    const own = inFile.filter(keep).map((c) => codeNode(c, this.boxes, false)).filter((n) => serves(n, q.epic));
    const shown = new Set(own.map((n) => n.id));
    const calls = this.aggregate((c) => (keep(c) ? c.node.id : undefined), FILE_EDGE_KINDS).filter((e) => shown.has(e.from) || shown.has(e.to));
    // The file node itself only when its top level calls something.
    const nodes = own.filter((n) => n.kind !== 'file' || calls.some((e) => e.from === n.id || e.to === n.id)).map((n) => (n.kind === 'file' ? { ...n, name: '(top level)' } : n));
    // The code elsewhere: one node per other file, or per package outside the repo, listing the code in it.
    const groupOf = (c: Code) => `group:${c.node.targetOnly || c.node.file === undefined ? c.unit : c.node.file}`;
    const groups = new Map<string, { codes: Code[]; members: Map<string, MapMember>; calls: number }>();
    for (const e of calls) {
      for (const [id, side] of [[e.to, 'to'], [e.from, 'from']] as const) {
        if (shown.has(id)) continue;
        const c = this.code.get(id)!;
        const key = groupOf(c);
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { codes: [], members: new Map(), calls: 0 }));
        let m = g.members.get(id);
        if (!m) {
          g.codes.push(c);
          const n = c.node;
          g.members.set(id, (m = { id, name: n.route ?? n.name, kind: n.kind, ...(n.file !== undefined ? { file: n.file } : {}), ...(n.range !== undefined ? { range: n.range } : {}), to: 0, from: 0 }));
        }
        m[side] += e.count;
        g.calls += e.count;
      }
    }
    const others = [...groups].map(([id, g]): MapNode => {
      const c = g.codes[0]!;
      const away = c.node.targetOnly || c.node.file === undefined;
      const unit = this.units.get(c.unit)!;
      return {
        id, kind: away ? 'outside' : 'file', name: away ? unit.name : posix.basename(c.node.file!), rank: 0, outside: true,
        test: g.codes.every((x) => x.test), unit: c.unit, ...(away ? {} : { file: c.node.file! }),
        boxes: [], calls: g.calls,
        members: [...g.members.values()].sort((a, b) => b.to + b.from - (a.to + a.from) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      };
    });
    const at = (id: string) => (shown.has(id) ? id : groupOf(this.code.get(id)!));
    return fold(nodes, others, merge(calls.map((e) => ({ ...e, from: at(e.from), to: at(e.to) }))), limit, 'code', OUTSIDE_LIMIT.file);
  }

  /** The map edges between two groups, counted; `group` says which group a code node is in, or undefined to leave it out. */
  private aggregate(group: (c: Code) => string | undefined, kinds: readonly EdgeKind[] = MAP_EDGE_KINDS): MapEdge[] {
    const one: MapEdge[] = [];
    for (const e of this.edges) {
      if (!kinds.includes(e.kind)) continue;
      const from = group(this.code.get(e.from)!);
      const to = group(this.code.get(e.to)!);
      if (from === undefined || to === undefined) continue;
      one.push({ from, to, count: 1, exact: e.trust === 'exact' ? 1 : 0, trust: e.trust, kinds: [e.kind] });
    }
    return merge(one);
  }
}

/** The edges with the same two ends as one edge: counts added, the best trust, the kinds together. Self edges go. */
function merge(edges: MapEdge[]): MapEdge[] {
  const out = new Map<string, MapEdge>();
  for (const e of edges) {
    if (e.from === e.to) continue;
    const key = `${e.from}\u0000${e.to}`;
    const m = out.get(key);
    if (!m) {
      out.set(key, { ...e, kinds: [...e.kinds] });
      continue;
    }
    m.count += e.count;
    m.exact += e.exact;
    if (TRUST_ORDER.indexOf(e.trust) < TRUST_ORDER.indexOf(m.trust)) m.trust = e.trust;
    for (const k of e.kinds) if (!m.kinds.includes(k)) m.kinds.push(k);
  }
  return [...out.values()].map((e) => ({ ...e, kinds: [...e.kinds].sort() })).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
}

/** `scip-typescript npm <package> <version> …`: the package of a symbol ID, `.` for none. */
export function packageOf(id: string): string {
  return id.split(' ')[2] ?? '.';
}

const within = (dir: string, outer: string): boolean => dir === outer || dir.startsWith(`${outer}/`);

function commonDir(a: string, b: string): string {
  const x = a.split('/');
  const y = b.split('/');
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i === 0 ? '.' : x.slice(0, i).join('/');
}

const round = (n: number): number => Math.round(n * 1e6) / 1e6 + 0;

function unionBoxes(codes: Code[], boxes: Map<string, MapBox[]>): MapBox[] {
  const out = new Map<string, MapBox>();
  for (const c of codes) for (const b of boxes.get(c.node.id) ?? []) out.set(b.id, b);
  return [...out.values()].sort((a, b) => (a.epic ?? '').localeCompare(b.epic ?? '') || a.path.localeCompare(b.path) || a.id.localeCompare(b.id));
}

function groupNode(id: string, kind: MapNodeKind, name: string, codes: Code[], boxes: Map<string, MapBox[]>, outside: boolean, unit: string): MapNode {
  let rank = 0;
  let files = 0;
  let functions = 0;
  let tests = 0;
  for (const c of codes) {
    rank += c.node.rank;
    if (c.node.kind === 'file') files++;
    else if (c.node.kind === 'test') tests++;
    else if ((c.node.kind === 'function' || c.node.kind === 'method') && !c.test) functions++;
  }
  return {
    id, kind, name, rank: round(rank), outside, test: codes.length > 0 && codes.every((c) => c.test), unit,
    ...(outside ? {} : { files, functions, tests }),
    boxes: unionBoxes(codes, boxes),
  };
}

function codeNode(c: Code, boxes: Map<string, MapBox[]>, outside: boolean): MapNode {
  const n = c.node;
  return {
    id: n.id, kind: n.kind, name: n.route ?? n.name, rank: n.rank, outside: outside || n.targetOnly, test: c.test, unit: c.unit,
    ...(n.file !== undefined ? { file: n.file } : {}),
    ...(n.range !== undefined ? { range: n.range } : {}),
    boxes: unionBoxes([c], boxes),
  };
}

const serves = (n: MapNode, epic: string | undefined): boolean => epic === undefined || n.boxes.some((b) => b.epic === epic);

/**
 * At most `limit` nodes: the inner ones by rank, then at most `outsideLimit` outside ones by how many edges they have.
 * The rest fold into a "+N more" node per side; their edges go. An outside node with no edge to a
 * kept inner node goes too.
 */
function fold(inner: MapNode[], outside: MapNode[], edges: MapEdge[], limit: number, what: string, outsideLimit: number): Pick<CodeMap, 'nodes' | 'edges'> {
  const byRank = (a: MapNode, b: MapNode) => b.rank - a.rank || (a.id < b.id ? -1 : 1);
  const innerCap = outside.length === 0 ? limit : Math.max(Math.ceil(limit * 0.7), limit - Math.min(outside.length, outsideLimit + 1));
  const keptInner = [...inner].sort(byRank).slice(0, inner.length > innerCap ? innerCap - 1 : innerCap);
  const innerIds = new Set(keptInner.map((n) => n.id));
  const degree = new Map<string, number>();
  for (const e of edges) {
    if (innerIds.has(e.from)) degree.set(e.to, (degree.get(e.to) ?? 0) + e.count);
    if (innerIds.has(e.to)) degree.set(e.from, (degree.get(e.from) ?? 0) + e.count);
  }
  const linked = outside.filter((n) => degree.has(n.id) && !innerIds.has(n.id));
  const outsideCap = Math.min(outsideLimit, limit - keptInner.length - (inner.length > keptInner.length ? 1 : 0));
  const keptOutside = [...linked].sort((a, b) => degree.get(b.id)! - degree.get(a.id)! || (a.id < b.id ? -1 : 1)).slice(0, linked.length > outsideCap ? Math.max(0, outsideCap - 1) : outsideCap);
  const nodes = [...keptInner, ...keptOutside];
  const more = (side: string, count: number): MapNode => ({ id: `more:${side}`, kind: 'more', name: `+${count} more`, rank: 0, outside: side !== what, test: false, boxes: [], more: count });
  if (inner.length > keptInner.length) nodes.push(more(what, inner.length - keptInner.length));
  if (linked.length > keptOutside.length) nodes.push(more('outside', linked.length - keptOutside.length));
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to) && (innerIds.has(e.from) || innerIds.has(e.to))) };
}
