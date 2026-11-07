// Data flow diagram, level 1 (D42, design page 6), generated from flow.yaml and entities.yaml:
// external entities (human, agent and external lanes), numbered processes (root boxes that read
// or write data), numbered data stores (entities) and the flows between them.

import { useMemo } from 'react';
import { dataFlow, dataFlowLayout, type DataFlow } from '../model/dataflow.js';
import type { DGraph } from '../model/graph.js';
import type { BigViewProps } from './BigPictureViews.js';
import { GraphDiagram, LegendItem, useGraphLayout } from './GraphDiagram.js';
import { BoxList } from './UserFlowView.js';

/** Rows of processes with their data stores under them, as wide as the page at most. */
const layoutRows = async (g: DGraph) => dataFlowLayout(g as DataFlow).layout;

export function DataFlowView({ view, onOpenBox }: BigViewProps) {
  const df = useMemo(() => dataFlow(view.flow, view.prd, view.entities), [view]);
  const lay = useGraphLayout(df, layoutRows);
  return (
    <section className="page big-picture gd-page" data-testid="data-flow" aria-labelledby="df-title">
      <h2 id="df-title">Data flow diagram</h2>
      <p className="muted gd-sub">Level 1. Squares are people and outside systems, rounded boxes are processes, open boxes are data stores (entities).</p>
      <div className="gd-card">
        <ul className="gd-legend" aria-label="Legend">
          <LegendItem shape="entity">External entity</LegendItem>
          <LegendItem shape="process">Process</LegendItem>
          <LegendItem shape="store">Data store (entity)</LegendItem>
          <LegendItem shape="flow">Data flow</LegendItem>
        </ul>
        {df.processes.length === 0 ? (
          <p className="warn" data-testid="df-empty">
            No root box reads or writes data, so there is no process to draw.
          </p>
        ) : (
          <div className="bp-map-wrap gd-canvas">
            {lay.kind === 'busy' && <p className="muted gd-status">Laying out the data flow…</p>}
            {lay.kind === 'error' && <p className="warn gd-status">Could not lay out the data flow: {lay.message}</p>}
            {lay.kind === 'ready' && <GraphDiagram prefix="df" label="Data flow diagram, level 1" graph={df} layout={lay.layout} onOpenBox={onOpenBox} />}
          </div>
        )}
        <div className="gd-notes">
          {df.onlyWriters.length > 0 && (
            <div className="gd-note gd-note-ok" data-testid="df-only-writers">
              <h3>Only writers</h3>
              <ul>
                {df.onlyWriters.map((w) => (
                  <li key={w.entity}>
                    Only{' '}
                    <button type="button" className="box-link" aria-label={`Open process ${w.process.number} ${w.process.title} (${w.process.path}) in the box drawer`} onClick={() => onOpenBox(w.process.path)}>
                      {w.process.number} {w.process.title}
                    </button>{' '}
                    writes {w.store} {w.entity}.
                  </li>
                ))}
              </ul>
            </div>
          )}
          {df.noData.length > 0 && (
            <div className="gd-note" data-testid="df-no-data">
              <h3>Boxes that read and write nothing</h3>
              <p className="muted small">They list no reads and no writes, so they are not processes here.</p>
              <BoxList rows={df.noData} onOpenBox={onOpenBox} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
