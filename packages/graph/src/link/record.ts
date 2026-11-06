// The record linker (G4, G30): nodes for the requirements, stories, boxes and scenarios of every
// EPIC in docs/epics/*/, and their `references` edges: story → requirement, box → story,
// scenario → box. It reads prd.yaml, flow.yaml and scenarios/*.yaml; nothing else.
//
// Incremental: it keeps the hash of each record file. When none changed it keeps its rows; when one
// changed it reads every record file again (they are few and small). Code changes never make it run.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Node as YamlNode, type YAMLMap } from 'yaml';
import type { Linker, LinkOutput } from '../extend.js';
import { splitWords } from '../terms.js';
import type { GraphEdge, GraphNode, NodeKind } from '../types.js';
import { EdgeSet, sha256 } from './nodes.js';

export const EPICS_DIR = 'docs/epics';

type RecordKind = Extract<NodeKind, 'requirement' | 'story' | 'box' | 'scenario'>;

/** `rehearse record <epic> . box:update-graph/link`: the ID of one record node. */
export function recordId(epic: string, kind: RecordKind, id: string): string {
  return `rehearse record ${epic} . ${kind}:${id}`;
}

/** The EPIC folder of a record node (from its file), e.g. 2026-11-05-code-graph. */
export function epicOf(node: GraphNode): string | undefined {
  const m = /^docs\/epics\/([^/]+)\//.exec(node.file ?? '');
  return m?.[1];
}

interface RecordState {
  files: Record<string, string>;
}

export function recordLinker(): Linker {
  return {
    name: 'record',
    source: 'record',
    async stale({ root, state }) {
      return !sameHashes(state.get<RecordState>()?.files, hashRecordFiles(root));
    },
    async link({ root, mode, state }) {
      const files = hashRecordFiles(root);
      if (mode !== 'cold' && sameHashes(state.get<RecordState>()?.files, files)) return 'keep';
      state.set({ files } satisfies RecordState);
      return readRecord(root);
    },
  };
}

/** Every record file below docs/epics/*, with its content hash. */
function hashRecordFiles(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of recordFiles(root)) {
    try {
      out[path] = sha256(readFileSync(join(root, path), 'utf8'));
    } catch {
      // gone between the walk and the read
    }
  }
  return out;
}

function recordFiles(root: string): string[] {
  const dir = join(root, EPICS_DIR);
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const epic of list(dir)) {
    const base = posix.join(EPICS_DIR, epic);
    for (const f of ['prd.yaml', 'flow.yaml']) if (existsSync(join(root, base, f))) out.push(posix.join(base, f));
    for (const f of list(join(root, base, 'scenarios'))) if (f.endsWith('.yaml')) out.push(posix.join(base, 'scenarios', f));
  }
  return out;
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

function sameHashes(a: Record<string, string> | undefined, b: Record<string, string>): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

/** One parsed record file: its YAML items with their lines. */
class RecordFile {
  readonly lines = new LineCounter();
  readonly doc;

  constructor(
    readonly path: string,
    text: string,
  ) {
    this.doc = parseDocument(text, { lineCounter: this.lines, uniqueKeys: false });
  }

  /** The maps of the sequence at `keys`, e.g. ['root', 'boxes']. */
  items(keys: string[], from: YamlNode | null = this.doc.contents): YAMLMap[] {
    let node: unknown = from;
    for (const k of keys) node = isMap(node) ? node.get(k, true) : undefined;
    return isSeq(node) ? node.items.filter((i): i is YAMLMap => isMap(i)) : [];
  }

  range(node: YamlNode): string | undefined {
    if (!node.range) return undefined;
    const start = this.lines.linePos(node.range[0]).line;
    const end = this.lines.linePos(Math.max(node.range[0], node.range[1] - 1)).line;
    return `${start}-${Math.max(start, end)}`;
  }
}

function text(map: YAMLMap, key: string): string | undefined {
  const v = map.get(key);
  return typeof v === 'string' || typeof v === 'number' ? String(v) : undefined;
}

function strings(map: YAMLMap, key: string): string[] {
  const v = map.get(key);
  return isSeq(v) ? v.items.flatMap((i) => (isScalar(i) ? [String(i.value)] : [])) : [];
}

function readFile(root: string, path: string): RecordFile | undefined {
  try {
    return new RecordFile(path, readFileSync(join(root, path), 'utf8'));
  } catch {
    return undefined;
  }
}

/** The nodes and `references` edges of every EPIC below root. */
export function readRecord(root: string): LinkOutput {
  const nodes = new Map<string, GraphNode>();
  const edges = new EdgeSet();
  const files = recordFiles(root);
  const epics = [...new Set(files.map((f) => f.split('/')[2]!))];
  for (const epic of epics) {
    const base = posix.join(EPICS_DIR, epic);
    const add = (file: RecordFile, item: YAMLMap, kind: RecordKind, id: string, about: string | undefined) => {
      const node: GraphNode = {
        id: recordId(epic, kind, id), kind, name: id, terms: splitWords(`${id} ${about ?? ''}`.trim()), language: 'record',
        file: file.path, targetOnly: false, rank: 0,
      };
      const range = file.range(item);
      if (range !== undefined) node.range = range;
      if (!nodes.has(node.id)) nodes.set(node.id, node);
    };
    const pending: GraphEdge[] = [];
    const ref = (fromKind: RecordKind, from: string, toKind: RecordKind, to: string) =>
      pending.push({ from: recordId(epic, fromKind, from), to: recordId(epic, toKind, to), kind: 'references', trust: 'exact', source: 'record' });

    const prd = files.includes(`${base}/prd.yaml`) ? readFile(root, `${base}/prd.yaml`) : undefined;
    if (prd) {
      for (const r of prd.items(['requirements'])) {
        const id = text(r, 'id');
        if (id !== undefined) add(prd, r, 'requirement', id, text(r, 'text'));
      }
      for (const s of prd.items(['stories'])) {
        const id = text(s, 'id');
        if (id === undefined) continue;
        add(prd, s, 'story', id, text(s, 'want'));
        for (const r of strings(s, 'requirements')) ref('story', id, 'requirement', r);
      }
    }

    const flow = files.includes(`${base}/flow.yaml`) ? readFile(root, `${base}/flow.yaml`) : undefined;
    if (flow) {
      const walk = (boxes: YAMLMap[], parent: string | undefined) => {
        for (const b of boxes) {
          const id = text(b, 'id');
          if (id === undefined) continue;
          const path = parent === undefined ? id : `${parent}/${id}`;
          add(flow, b, 'box', path, text(b, 'title'));
          for (const s of strings(b, 'stories')) ref('box', path, 'story', s);
          walk(flow.items(['children', 'boxes'], b), path);
        }
      };
      walk(flow.items(['root', 'boxes']), undefined);
    }

    for (const path of files.filter((f) => f.startsWith(`${base}/scenarios/`))) {
      const file = readFile(root, path);
      if (!file) continue;
      for (const s of file.items(['scenarios'])) {
        const id = text(s, 'id');
        if (id === undefined) continue;
        add(file, s, 'scenario', id, text(s, 'title'));
        for (const step of file.items(['steps'], s)) {
          const box = text(step, 'name');
          if (box !== undefined) ref('scenario', id, 'box', box);
        }
      }
    }

    // A link to an ID the record does not have is the validator's finding, not an edge.
    for (const e of pending) if (nodes.has(e.from) && nodes.has(e.to)) edges.add(e);
  }
  return { nodes: [...nodes.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), edges: edges.list() };
}
