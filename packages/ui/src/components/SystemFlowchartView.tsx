// System flowchart (D42, design page 7), generated from flow.yaml: one column per system lane,
// root boxes and their nested children as program steps, checks as diamonds, outputs as
// documents, and the edges within and between columns. Boxes of other lanes stand in a last column.

import { useMemo } from 'react';
import { layoutColumns, type DGraph } from '../model/graph.js';
import { OUTSIDE, systemFlowchart, type SystemFlowchart } from '../model/sysflow.js';
import type { BigViewProps } from './BigPictureViews.js';
import { GraphDiagram, LegendItem, useGraphLayout } from './GraphDiagram.js';

const STACK = new Set([OUTSIDE]);
const layoutCols = (g: DGraph) => layoutColumns(g, (g as SystemFlowchart).columns, STACK);

export function SystemFlowchartView({ view, onOpenBox }: BigViewProps) {
  const sf = useMemo(() => systemFlowchart(view.flow, view.prd), [view]);
  const lay = useGraphLayout(sf, layoutCols);
  return (
    <section className="page big-picture gd-page" data-testid="system-flowchart" aria-labelledby="sf-title">
      <h2 id="sf-title">System flowchart</h2>
      <p className="muted gd-sub">The programs, the files and the checks: one column per system lane ({sf.systemLanes.map((l) => l.label).join(', ') || 'none'}). Click a step to open it.</p>
      <div className="gd-card">
        <ul className="gd-legend" aria-label="Legend">
          <LegendItem shape="step">Program step</LegendItem>
          <LegendItem shape="document">File / report</LegendItem>
          <LegendItem shape="decision">Check</LegendItem>
          <LegendItem shape="terminal">Start / end</LegendItem>
          <LegendItem shape="column">Lane</LegendItem>
          <LegendItem shape="connector">Box of another lane</LegendItem>
          <LegendItem shape="error">Error exit</LegendItem>
        </ul>
        {sf.systemLanes.length === 0 ? (
          <p className="warn" data-testid="sf-empty">
            No lane has a role of kind system or external, so there is no program to draw.
          </p>
        ) : (
          <div className="bp-map-wrap gd-canvas">
            {lay.kind === 'busy' && <p className="muted gd-status">Laying out the system flowchart…</p>}
            {lay.kind === 'error' && <p className="warn gd-status">Could not lay out the system flowchart: {lay.message}</p>}
            {lay.kind === 'ready' && <GraphDiagram prefix="sf" label="System flowchart: one column per system lane" graph={sf} layout={lay.layout} onOpenBox={onOpenBox} />}
          </div>
        )}
      </div>
    </section>
  );
}
