// User flow (D42, design page 5): the path the human roles take, generated from flow.yaml.
// Screens and actions in human lanes, decisions with their branch labels, start and end dots;
// boxes of other lanes the path passes through fold into one step. Click any box to open it.

import { useMemo } from 'react';
import type { DGraph } from '../model/graph.js';
import { columnsFor, DIAGRAM_W, layoutGrid, snakeCells } from '../model/grid.js';
import { userFlow } from '../model/userflow.js';
import type { BigViewProps } from './BigPictureViews.js';
import { GraphDiagram, LegendItem, useGraphLayout } from './GraphDiagram.js';

/** Rows that snake left to right, then right to left, as wide as the page. */
const layoutRows = async (g: DGraph) => layoutGrid(g, snakeCells(g, columnsFor(DIAGRAM_W, Math.max(...g.nodes.map((n) => n.w)))));

export function UserFlowView({ view, onOpenBox }: BigViewProps) {
  const uf = useMemo(() => userFlow(view.flow, view.prd), [view]);
  const lay = useGraphLayout(uf, layoutRows);
  const who = uf.humanLanes.map((l) => l.label).join(', ');
  return (
    <section className="page big-picture gd-page" data-testid="user-flow" aria-labelledby="uf-title">
      <h2 id="uf-title">User flow</h2>
      <p className="muted gd-sub">
        The path {who || 'the human roles'} take{uf.humanLanes.length === 1 ? 's' : ''} through the flow, from the first start to the last end. Click a box to open it.
      </p>
      <div className="gd-card">
        <ul className="gd-legend" aria-label="Legend">
          <LegendItem shape="screen">Screen</LegendItem>
          <LegendItem shape="action">User action</LegendItem>
          <LegendItem shape="decision">Decision</LegendItem>
          <LegendItem shape="start">Start / end</LegendItem>
          <LegendItem shape="fold">Steps of other lanes</LegendItem>
          <LegendItem shape="error">Error exit</LegendItem>
        </ul>
        {uf.humanLanes.length === 0 ? (
          <p className="warn" data-testid="uf-empty">
            No lane has a role of kind human, so there is no user path to draw.
          </p>
        ) : (
          <div className="bp-map-wrap gd-canvas">
            {lay.kind === 'busy' && <p className="muted gd-status">Laying out the user flow…</p>}
            {lay.kind === 'error' && <p className="warn gd-status">Could not lay out the user flow: {lay.message}</p>}
            {lay.kind === 'ready' && <GraphDiagram prefix="uf" label={`User flow of ${who}`} graph={uf} layout={lay.layout} onOpenBox={onOpenBox} />}
          </div>
        )}
        {uf.offPath.length > 0 && (
          <div className="gd-notes">
            <div className="gd-note gd-note-later" data-testid="uf-off-path">
              <h3>Not on the human path</h3>
              <p className="small">No human box connects to these boxes.</p>
              <BoxList rows={uf.offPath} onOpenBox={onOpenBox} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function BoxList({ rows, onOpenBox }: { rows: { path: string; title: string; lane: string }[]; onOpenBox: (path: string) => void }) {
  return (
    <ul className="gd-box-list">
      {rows.map((r) => (
        <li key={r.path}>
          <button type="button" className="box-link" data-testid={`box-link-${r.path}`} aria-label={`Open box ${r.title} (${r.path}) in the box drawer`} onClick={() => onOpenBox(r.path)}>
            {r.title}
          </button>{' '}
          <span className="small muted">
            {r.lane} · {r.path}
          </span>
        </li>
      ))}
    </ul>
  );
}
