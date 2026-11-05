// Box `simulate/coverage` (R5, S3-A2): each decision branch and each error exit, at every
// nesting level, must be taken by at least one approved scenario.

import { edgeKind, knownEdges, type BoxEntry } from '../flow-index.js';
import { RECORD_FILES, type Diagram, type Edge, type Finding, type Flow } from '../types.js';
import { asArray, cmp, isObject } from '../util.js';
import type { LoadedScenario } from './types.js';
import { walkScenario } from './walk.js';

export function checkCoverage(flow: Flow, index: Map<string, BoxEntry>, scenarios: LoadedScenario[]): Finding[] {
  const taken = new Set<Edge>();
  for (const { scenario } of scenarios) {
    for (const step of walkScenario(index, scenario)) if (step.edge) taken.add(step.edge);
  }

  const out: Finding[] = [];
  const visit = (diagram: Diagram, prefix: string): void => {
    for (const edge of knownEdges(diagram)) {
      const kind = edgeKind(edge);
      if (kind === 'normal' || taken.has(edge)) continue;
      const from = prefix + edge.from;
      const what = kind === 'branch' ? `branch ${edge.label ?? ''} of decision ${from}` : `error exit ${edge.label ?? ''} of ${from}`;
      const stories = asArray<string>(index.get(from)?.box.stories).filter((s) => typeof s === 'string');
      out.push({
        kind: 'coverage',
        file: RECORD_FILES.flow,
        path: from,
        message: `${what} (to ${prefix + edge.to}): no approved scenario takes it`,
        refs: [...new Set(stories)].sort(cmp),
      });
    }
    for (const box of asArray(diagram.boxes)) {
      if (isObject(box) && isObject(box.children)) visit(box.children as Diagram, `${prefix}${box.id}/`);
    }
  };
  if (isObject(flow.root)) visit(flow.root, '');
  return out;
}

