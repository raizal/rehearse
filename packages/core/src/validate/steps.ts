// Box `validate/refs`, scenario step continuity (R3, R21).
// Consecutive steps must be joined by an edge. For nested boxes, entering a box
// enters its child with no incoming edge, and leaving it leaves from its child
// with no outgoing edge (scenarios/README.md). A `branch` must match the edge label.

import { indexBoxes, nextLeaves } from '../flow-index.js';
import type { EpicRecord, Finding, ScenarioStep } from '../types.js';
import { asArray, isObject } from '../util.js';

export function checkSteps(record: EpicRecord): Finding[] {
  const out: Finding[] = [];
  if (!isObject(record.flow)) return out;
  const index = indexBoxes(record.flow);
  const isLeaf = (name: unknown): name is string => {
    if (typeof name !== 'string') return false;
    const e = index.get(name);
    return e !== undefined && !isObject(e.box.children);
  };

  for (const sf of record.scenarioFiles) {
    for (const sc of sf.scenarios) {
      if (!isObject(sc) || typeof sc.id !== 'string') continue;
      const steps = asArray<ScenarioStep>(sc.steps);
      steps.forEach((step, i) => {
        if (!isObject(step) || !isLeaf(step.name)) return; // unknown and parent paths are reported by refs
        const at = `${sc.id}/step-${i + 1}`;
        const name = step.name;
        const branch = typeof step.branch === 'string' ? step.branch : undefined;
        const options = nextLeaves(index, name);

        if (branch !== undefined && !options.some((o) => o.edge.label === branch)) {
          const labels = [...new Set(options.map((o) => o.edge.label).filter((l) => l !== undefined))];
          out.push({
            kind: 'reference',
            file: sf.file,
            path: at,
            message: `branch ${branch} is not a label of an edge from ${name}${labels.length ? ` (labels: ${labels.join(', ')})` : ''}`,
            refs: [],
          });
          return;
        }

        const next = steps[i + 1];
        if (!isObject(next) || !isLeaf(next.name)) return;
        if (index.get(name)!.box.kind === 'decision' && branch === undefined) {
          out.push({ kind: 'reference', file: sf.file, path: at, message: `decision ${name}: the step needs a branch`, refs: [] });
          return;
        }
        const hit = options.some((o) => o.to === next.name && (branch === undefined || o.edge.label === branch));
        if (!hit) {
          out.push({
            kind: 'reference',
            file: sf.file,
            path: at,
            message: `no edge from ${name} to ${next.name}${branch !== undefined ? ` with label ${branch}` : ''} (step ${i + 1} -> ${i + 2})`,
            refs: [],
          });
        }
      });
    }
  }
  return out;
}
