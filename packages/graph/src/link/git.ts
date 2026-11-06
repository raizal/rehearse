// The git linker (G13, G30, D44): commits with a `Flow-Box:` trailer, and `git blame` on the lines
// of the files they touched. A line that such a commit last changed links
//   commit → the code node of that line   (edge kind `changes`)
//   box    → the code node of that line   (edge kind `builds`), for each box the trailer names.
// Both are `exact`, source `git`. The code node of a line is the smallest node around it (a
// function, method, test, route or class), or the file for a line outside every node.
//
// A trailer value is a box path (`checkout/pay`), or an EPIC folder and a box path
// (`2026-11-05-rehearse/validate/refs`). The box is the record's box node of that path (made by the
// record linker); when the record has no box of that path, the linker makes a box node of its own.
//
// Git runs through an injectable runner (argument arrays, no shell). Outside a git repo, or when git
// fails, the linker gives no rows.
//
// Incremental: it keeps HEAD, the trailer commits and the blame of each file they touched.
//   - HEAD did not move: it blames again only the changed files that a trailer commit touched.
//   - HEAD moved forward: it reads the new commits (old..HEAD) and blames again the files the
//     move changed, plus the changed files.
//   - Otherwise (a cold index, a rebase, a reset): it reads every trailer commit and blames all.
// It maps the blamed lines to nodes again on every update that runs it, because node lines move
// when a file changes. A new commit with no file change makes it stale, so the update runs.

import { execFile } from 'node:child_process';
import type { GraphView, Linker, LinkOutput } from '../extend.js';
import { splitWords } from '../terms.js';
import type { GraphNode } from '../types.js';
import { epicOf } from './record.js';
import { EdgeSet, nodeAtLine } from './nodes.js';

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Runs `git <args>` in `cwd`. Tests pass a fake or run it in a repo they made. */
export type GitRunner = (args: string[], cwd: string) => Promise<GitResult>;

/** The real runner: `git` from PATH, no shell, no pager, no prompts. */
export const execGit: GitRunner = (args, cwd) =>
  new Promise((done) => {
    execFile(
      'git', args,
      { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' } },
      (err, stdout, stderr) => done({ ok: err === null, stdout: String(stdout), stderr: String(stderr) }),
    );
  });

/** Literal paths, unquoted names. */
const GIT = ['--literal-pathspecs', '-c', 'core.quotePath=false'];
const RS = '\x1e';
const FS = '\x1f';
const TS = '\x1d';
const LOG_FORMAT = '%x1e%H%x1f%s%x1f%(trailers:key=Flow-Box,valueonly,separator=%x1d)';
/** Files blamed at the same time. */
const BLAME_JOBS = 8;

export interface TrailerCommit {
  sha: string;
  subject: string;
  /** The Flow-Box trailer values. */
  boxes: string[];
  /** Files the commit touched, relative to the root. */
  files: string[];
}

/** Lines of one file and the trailer commit that last changed them: [first, last, sha]. */
type Blame = Array<[number, number, string]>;

interface GitState {
  head: string;
  commits: Record<string, { subject: string; boxes: string[] }>;
  /** Files a trailer commit touched. */
  touched: string[];
  blame: Record<string, Blame>;
}

export function gitLinker(opts: { run?: GitRunner } = {}): Linker {
  const run = opts.run ?? execGit;
  const git = (root: string, ...args: string[]) => run([...GIT, ...args], root);
  const headOf = async (root: string) => {
    const r = await git(root, 'rev-parse', '--verify', '-q', 'HEAD');
    return r.ok ? r.stdout.trim() : '';
  };
  return {
    name: 'git',
    source: 'git',
    async stale({ root, state }) {
      const old = state.get<GitState>();
      return old === undefined || old.head !== (await headOf(root));
    },
    async link({ root, mode, changed, removed, graph, state }) {
      const head = await headOf(root);
      const old = mode === 'cold' ? undefined : state.get<GitState>();
      const inScope = new Set(graph.nodesOfKind('file').filter((n) => !n.targetOnly && n.file).map((n) => n.file!));
      let next: GitState;
      if (head === '') {
        next = { head, commits: {}, touched: [], blame: {} };
      } else if (old !== undefined && old.head === head) {
        next = { ...old, blame: { ...old.blame } };
        await reblame(next, [...changed, ...removed]);
      } else if (old !== undefined && old.head !== '' && (await git(root, 'merge-base', '--is-ancestor', old.head, head)).ok) {
        next = { ...old, head, commits: { ...old.commits }, blame: { ...old.blame } };
        const added = await trailerCommits(run, root, `${old.head}..${head}`);
        const moved = await git(root, 'diff', '--name-only', '--relative', old.head, head);
        for (const c of added) next.commits[c.sha] = { subject: c.subject, boxes: c.boxes };
        next.touched = [...new Set([...next.touched, ...added.flatMap((c) => c.files)])].sort();
        await reblame(next, [...changed, ...removed, ...lines(moved.stdout)]);
      } else {
        const all = await trailerCommits(run, root, head);
        next = {
          head,
          commits: Object.fromEntries(all.map((c) => [c.sha, { subject: c.subject, boxes: c.boxes }])),
          touched: [...new Set(all.flatMap((c) => c.files))].sort(),
          blame: {},
        };
        await reblame(next, next.touched);
      }
      state.set(next);
      return linkBlame(next, graph);

      /** Blame again those of `paths` that a trailer commit touched and that are in scope. */
      async function reblame(s: GitState, paths: string[]): Promise<void> {
        const touched = new Set(s.touched);
        const todo = [...new Set(paths)].filter((p) => touched.has(p)).sort();
        for (const p of todo) delete s.blame[p];
        const shas = new Set(Object.keys(s.commits));
        const files = todo.filter((p) => inScope.has(p));
        for (let i = 0; i < files.length; i += BLAME_JOBS) {
          const batch = files.slice(i, i + BLAME_JOBS);
          const results = await Promise.all(batch.map((p) => git(root, 'blame', '--porcelain', '--', p)));
          batch.forEach((p, j) => {
            const r = results[j]!;
            const b = r.ok ? parseBlame(r.stdout, shas) : [];
            if (b.length > 0) s.blame[p] = b;
          });
        }
      }
    },
  };
}

function lines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
}

/** The commits of `range` with a Flow-Box trailer, newest first, with the files they touched. */
export async function trailerCommits(run: GitRunner, root: string, range: string): Promise<TrailerCommit[]> {
  const r = await run(
    [...GIT, 'log', '--no-color', '--regexp-ignore-case', '--grep=^Flow-Box:', `--format=${LOG_FORMAT}`, '--name-only', '--relative', range, '--'],
    root,
  );
  return r.ok ? parseTrailerLog(r.stdout) : [];
}

/** Parse `git log --format=LOG_FORMAT --name-only`: one record per commit, the files after the header line. */
export function parseTrailerLog(text: string): TrailerCommit[] {
  const out: TrailerCommit[] = [];
  for (const record of text.split(RS)) {
    const [sha, subject, rest] = record.split(FS);
    if (sha === undefined || !/^[0-9a-f]{40}$/.test(sha) || subject === undefined || rest === undefined) continue;
    const nl = rest.indexOf('\n');
    const boxField = nl < 0 ? rest : rest.slice(0, nl);
    const boxes = [...new Set(boxField.split(TS).flatMap((b) => b.split(',')).map((b) => b.trim()).filter((b) => b !== ''))];
    if (boxes.length === 0) continue;
    out.push({ sha, subject, boxes, files: nl < 0 ? [] : lines(rest.slice(nl + 1)) });
  }
  return out;
}

/** Parse `git blame --porcelain`: the final lines of each commit in `shas`, as ranges. */
export function parseBlame(text: string, shas: Set<string>): Blame {
  const out: Blame = [];
  const header = /^([0-9a-f]{40}) \d+ (\d+)(?: (\d+))?$/;
  for (const line of text.split('\n')) {
    const m = header.exec(line);
    if (!m || !shas.has(m[1]!)) continue;
    const n = Number(m[2]);
    const last = out.at(-1);
    if (last && last[2] === m[1] && last[1] === n - 1) last[1] = n;
    else out.push([n, n, m[1]!]);
  }
  return out;
}

export function commitId(sha: string): string {
  return `rehearse git . . commit:${sha}`;
}

export function gitBoxId(path: string): string {
  return `rehearse git . . box:${path}`;
}

/** The nodes and edges of the blamed lines, against the graph as it is now. */
function linkBlame(s: GitState, graph: GraphView): LinkOutput {
  const nodes = new Map<string, GraphNode>();
  const edges = new EdgeSet();
  const boxCache = new Map<string, string[]>();
  const boxesOf = (value: string): string[] => {
    let ids = boxCache.get(value);
    if (ids) return ids;
    const record = graph.nodesOfKind('box').filter((n) => n.language === 'record');
    const slash = value.indexOf('/');
    const inEpic = slash > 0 ? record.filter((n) => epicOf(n) === value.slice(0, slash) && n.name === value.slice(slash + 1)) : [];
    ids = (inEpic.length > 0 ? inEpic : record.filter((n) => n.name === value)).map((n) => n.id);
    if (ids.length === 0) {
      const id = gitBoxId(value);
      nodes.set(id, { id, kind: 'box', name: value, terms: splitWords(value), language: 'git', targetOnly: false, rank: 0 });
      ids = [id];
    }
    boxCache.set(value, ids);
    return ids;
  };
  for (const file of Object.keys(s.blame).sort()) {
    const inFile = graph.nodesInFile(file).filter((n) => !n.targetOnly);
    if (inFile.length === 0) continue;
    for (const [first, last, sha] of s.blame[file]!) {
      const commit = s.commits[sha];
      if (!commit) continue;
      const cid = commitId(sha);
      if (!nodes.has(cid)) {
        nodes.set(cid, {
          id: cid, kind: 'commit', name: sha.slice(0, 7), terms: splitWords(`${sha.slice(0, 7)} ${commit.subject}`), language: 'git',
          targetOnly: false, rank: 0,
        });
      }
      for (let line = first; line <= last; line++) {
        const code = nodeAtLine(inFile, line);
        if (!code) continue;
        edges.add({ from: cid, to: code.id, kind: 'changes', trust: 'exact', source: 'git' });
        for (const box of commit.boxes) for (const b of boxesOf(box)) edges.add({ from: b, to: code.id, kind: 'builds', trust: 'exact', source: 'git' });
      }
    }
  }
  return { nodes: [...nodes.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), edges: edges.list() };
}
