// Box `validate/refs`, flow structure part (R3, corrections C1–C5).
// - A start box has no incoming edges. An end box has no outgoing edges. (C1, C4)
// - Each root box is reachable from a start box and reaches an end box. (C5)
// - A decision has 2 or more labeled branches to different boxes.
// - Each error exit has an edge with kind `error` that does not loop to its own box. (C2, C3)

import { edgeKind, entryChildren, exitChildren, hasChildren, knownEdges } from '../flow-index.js';
import { RECORD_FILES, type Box, type Diagram, type Edge, type EpicRecord, type Finding } from '../types.js';
import { asArray, isObject } from '../util.js';

const FLOW = RECORD_FILES.flow;

function finding(path: string, message: string): Finding {
  return { kind: 'structure', file: FLOW, path, message, refs: [] };
}

export function checkStructure(record: EpicRecord): Finding[] {
  const out: Finding[] = [];
  const flow = record.flow;
  if (!isObject(flow) || !isObject(flow.root)) return out;
  checkDiagram(flow.root, '', true, out);
  return out;
}

function checkDiagram(diagram: Diagram, prefix: string, isRoot: boolean, out: Finding[]): void {
  const boxes = asArray<Box>(diagram.boxes).filter((b) => isObject(b) && typeof b.id === 'string');
  const edges = knownEdges(diagram);
  const outgoing = (id: string) => edges.filter((e) => e.from === id);
  const incoming = (id: string) => edges.filter((e) => e.to === id);
  const list = (xs: string[]) => [...new Set(xs)].join(', ');

  for (const box of boxes) {
    const path = prefix + box.id;
    const outs = outgoing(box.id);
    const ins = incoming(box.id);

    if (box.kind === 'start' && ins.length > 0) {
      out.push(finding(path, `start box has incoming edges (from ${list(ins.map((e) => e.from))})`));
    }
    if (box.kind === 'end' && outs.length > 0) {
      out.push(finding(path, `end box has outgoing edges (to ${list(outs.map((e) => e.to))})`));
    }

    if (box.kind === 'decision') {
      const branches = outs.filter((e) => edgeKind(e) === 'branch' && typeof e.label === 'string' && e.label !== '');
      const targets = new Set(branches.map((e) => e.to));
      if (targets.size < 2) {
        out.push(
          finding(path, `decision needs 2 or more labeled branches to different boxes (has ${branches.length} to ${targets.size} box(es))`),
        );
      }
      const labels = branches.map((e) => e.label as string);
      for (const l of [...new Set(labels)].filter((l) => labels.indexOf(l) !== labels.lastIndexOf(l))) {
        out.push(finding(path, `decision has 2 branches with label ${l}`));
      }
      for (const e of outs.filter((e) => edgeKind(e) === 'normal')) {
        out.push(finding(path, `decision edge to ${e.to} needs kind branch and a label`));
      }
    } else {
      for (const e of outs.filter((e) => edgeKind(e) === 'branch')) {
        out.push(finding(path, `branch edge ${e.label ?? ''} to ${e.to}: only a decision box has branches`));
      }
    }

    const exits = asArray<string>(box.errorExits).filter((x) => typeof x === 'string');
    // All edges from the box, also those to an unknown box: refs reports those, so do not report the exit again.
    const allOuts = asArray<Edge>(diagram.edges).filter((e) => isObject(e) && e.from === box.id);
    for (const x of exits) {
      const errEdges = allOuts.filter((e) => edgeKind(e) === 'error' && e.label === x);
      if (errEdges.length === 0) {
        out.push(finding(path, `error exit ${x} has no edge with kind error and label ${x}`));
      } else if (errEdges.some((e) => e.to === box.id)) {
        out.push(finding(path, `error exit ${x} loops to its own box`));
      }
    }
    for (const e of outs.filter((e) => edgeKind(e) === 'error')) {
      if (typeof e.label === 'string' && !exits.includes(e.label)) {
        out.push(finding(path, `error edge ${e.label} to ${e.to} is not in errorExits`));
      }
    }

    if (hasChildren(box)) {
      const children = box.children as Diagram;
      if (entryChildren(children).length === 0) out.push(finding(path, 'children have no entry box (a child with no incoming edge)'));
      if (exitChildren(children).length === 0) out.push(finding(path, 'children have no exit box (a child with no outgoing edge)'));
      checkDiagram(children, `${path}/`, false, out);
    }
  }

  if (!isRoot) return;
  const starts = boxes.filter((b) => b.kind === 'start').map((b) => b.id);
  const ends = boxes.filter((b) => b.kind === 'end').map((b) => b.id);
  const fromStart = reach(starts, (id) => outgoing(id).map((e) => e.to));
  const toEnd = reach(ends, (id) => incoming(id).map((e) => e.from));
  for (const box of boxes) {
    if (!fromStart.has(box.id)) out.push(finding(prefix + box.id, 'box is not reachable from a start box'));
    if (!toEnd.has(box.id)) out.push(finding(prefix + box.id, 'box does not reach an end box'));
  }
}

function reach(seeds: string[], next: (id: string) => string[]): Set<string> {
  const seen = new Set<string>(seeds);
  const queue = [...seeds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const n of next(id)) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
}
