// The diagram inside a box as swimlanes (R9, S4-A1), drawn in the box drawer (T38): one lane per
// role its boxes use, each box in its lane, the edges with their labels. A click opens a box.

import { useEffect, useMemo, useState } from 'react';
import { Background, Controls, Handle, Position, ReactFlow, type NodeProps, type NodeTypes } from '@xyflow/react';
import type { Flow, Prd } from '@rehearse/core';
import { KIND_ICON } from '../model/boxdrawer.js';
import { diagramAt, lanesFor } from '../model/diagram.js';
import { toFlowElements, type BoxNode, type LaneNode } from '../model/elements.js';
import { layoutDiagram, type SwimlaneLayout } from '../model/layout.js';
import { BoxCoverageBadge } from './CoverageBadge.js';

export function LaneView({ data }: NodeProps<LaneNode>) {
  const { lane, width, height } = data;
  return (
    <div className={`lane${lane.unknown ? ' lane-unknown' : ''}`} data-testid={`lane-${lane.role}`} data-role={lane.role} style={{ width, height }}>
      <div className="lane-header" style={{ borderLeft: `6px solid ${lane.color}` }}>
        <span className="lane-label">{lane.label}</span>
        <span className="lane-kind">{lane.unknown ? 'unknown lane' : (lane.kind ?? '')}</span>
      </div>
    </div>
  );
}

function BoxView({ data }: NodeProps<BoxNode>) {
  const { box, path, lane, hasChildren, childCount, current, containsCurrent, selected } = data;
  const cls = ['box', `kind-${box.kind}`, current && 'is-current', containsCurrent && 'contains-current', selected && 'is-selected', hasChildren && 'has-children']
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={cls}
      data-testid={`box-${path}`}
      data-lane={lane}
      data-kind={box.kind}
      data-highlighted={current ? 'true' : 'false'}
      title={`${box.title} — click to open`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="box-top">
        <span className="box-kind" data-testid={`box-kind-${path}`}>
          {KIND_ICON[box.kind] ?? '▭'} {box.kind}
        </span>
        <span className="box-id">{box.id}</span>
        <BoxCoverageBadge path={path} testId={`box-coverage-${path}`} compact />
      </div>
      <div className="box-title">{box.title}</div>
      {(hasChildren || (box.errorExits?.length ?? 0) > 0) && (
        <div className="box-foot">
          {hasChildren && <span className="box-open">▸ {childCount} boxes</span>}
          {(box.errorExits ?? []).map((x) => (
            <span key={x} className="box-exit" title="error exit">
              ⚠ {x}
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

const nodeTypes: NodeTypes = { lane: LaneView, box: BoxView };

/** The smallest zoom the diagram opens at. */
const ZOOM = 0.6;

export interface BoxDiagramProps {
  flow: Flow | undefined;
  prd: Prd | undefined;
  /** Path of the box whose diagram this is. */
  diagramPath: string;
  label: string;
  onSelect: (path: string) => void;
}

/** The diagram inside a box, as swimlanes. A click on a box opens it. */
export function BoxDiagram({ flow, prd, diagramPath, label, onSelect }: BoxDiagramProps) {
  const diagram = diagramAt(flow, diagramPath);
  const lanes = useMemo(() => lanesFor(flow, prd, diagram, false), [flow, prd, diagram]);
  const [layout, setLayout] = useState<{ path: string; layout: SwimlaneLayout } | undefined>();

  useEffect(() => {
    let live = true;
    layoutDiagram(diagram, lanes).then(
      (l) => live && setLayout({ path: diagramPath, layout: l }),
      () => live && setLayout({ path: diagramPath, layout: { lanes: [], boxes: [] } }),
    );
    return () => {
      live = false;
    };
  }, [diagram, lanes, diagramPath]);

  const elements = useMemo(
    () => (layout && layout.path === diagramPath ? toFlowElements(diagram, layout.layout, { diagramPath }) : undefined),
    [layout, diagram, diagramPath],
  );
  // Boxes stay readable: a wide diagram shows its start at ZOOM and pans, it does not shrink to fit.
  const height = Math.min(320, Math.max(160, (layout?.layout.lanes.reduce((h, l) => h + l.height, 0) ?? 160) * ZOOM + 24));

  return (
    <div className="canvas box-diagram" data-testid="box-diagram" role="img" aria-label={label} style={{ height }}>
      {elements && (
        <ReactFlow
          key={diagramPath}
          nodes={elements.nodes}
          edges={elements.edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          fitView
          fitViewOptions={{ padding: 0.06, minZoom: ZOOM }}
          minZoom={0.1}
          zoomOnScroll={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => {
            if (node.type === 'box') onSelect((node as BoxNode).data.path);
          }}
        >
          <Background gap={24} size={1} />
          <Controls showInteractive={false} orientation="horizontal" position="top-right" />
        </ReactFlow>
      )}
    </div>
  );
}
