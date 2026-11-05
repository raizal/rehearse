// Box `simulate/coverage` (R5, S3-A2): each decision branch and each error exit, at every
// nesting level, must be taken by at least one approved scenario.
// Drafts mode (T22, `draftOnly` given): an edge that only drafts take goes to `draftOnly`, not to
// the findings; an edge that no scenario takes at all is the finding.

import { edgeKind, knownEdges, type BoxEntry } from '../flow-index.js';
import { RECORD_FILES, type Diagram, type Edge, type Finding, type Flow } from '../types.js';
import { asArray, cmp, isObject } from '../util.js';
import { draftOnlyNote } from './load.js';
import type { LoadedScenario } from './types.js';
import { walkScenario } from './walk.js';

export function checkCoverage(flow: Flow, index: Map<string, BoxEntry>, scenarios: LoadedScenario[], draftOnly?: Finding[]): Finding[] {
  const taken = new Map<Edge, LoadedScenario[]>();
  for (const s of scenarios) {
    for (const step of walkScenario(index, s.scenario)) if (step.edge) taken.set(step.edge, [...(taken.get(step.edge) ?? []), s]);
  }

  const out: Finding[] = [];
  const visit = (diagram: Diagram, prefix: string): void => {
    for (const edge of knownEdges(diagram)) {
      const kind = edgeKind(edge);
      const takers = taken.get(edge) ?? [];
      const note = draftOnly ? draftOnlyNote(takers) : undefined;
      if (kind === 'normal' || (takers.length > 0 && !note)) continue;
      const from = prefix + edge.from;
      const what = kind === 'branch' ? `branch ${edge.label ?? ''} of decision ${from}` : `error exit ${edge.label ?? ''} of ${from}`;
      const stories = asArray<string>(index.get(from)?.box.stories).filter((s) => typeof s === 'string');
      const why = note ?? (draftOnly ? 'no scenario takes it, not even a draft' : 'no approved scenario takes it');
      (note ? draftOnly! : out).push({
        kind: 'coverage',
        file: RECORD_FILES.flow,
        path: from,
        message: `${what} (to ${prefix + edge.to}): ${why}`,
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

