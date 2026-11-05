// Swimlanes for one diagram (R9, S4-A1) and the breadcrumb back up (S4-A2).

import { useEffect, useMemo, useState } from 'react';
import { Background, Controls, Handle, Position, ReactFlow, type NodeProps, type NodeTypes } from '@xyflow/react';
import type { Flow, Prd } from '@rehearse/core';
import { breadcrumb, diagramAt, lanesFor } from '../model/diagram.js';
import { toFlowElements, type BoxNode, type LaneNode } from '../model/elements.js';
import { layoutDiagram, type SwimlaneLayout } from '../model/layout.js';

const KIND_ICON: Record<string, string> = {
  start: '●',
  end: '◉',
  process: '▭',
  decision: '◇',
  input: '⇥',
  output: '⇤',
  external: '☁',
};

function LaneView({ data }: NodeProps<LaneNode>) {
  const { lane, width, height } = data;
  return (
    <div className={`lane${lane.unknown ? ' lane-unknown' : ''}`} data-testid={`lane-${lane.role}`} data-role={lane.role} style={{ width, height }}>
      <div className="lane-header">
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
      title={hasChildren ? `${box.title} — click to open` : box.title}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="box-top">
        <span className="box-kind" data-testid={`box-kind-${path}`}>
          {KIND_ICON[box.kind] ?? '▭'} {box.kind}
        </span>
        <span className="box-id">{box.id}</span>
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

export interface FlowViewProps {
  flow: Flow | undefined;
  prd: Prd | undefined;
  /** '' for the root diagram. */
  diagramPath: string;
  current?: string;
  selected?: string;
  onOpen: (path: string) => void;
  onSelect: (path: string) => void;
}

export function FlowView({ flow, prd, diagramPath, current, selected, onOpen, onSelect }: FlowViewProps) {
  const diagram = diagramAt(flow, diagramPath);
  const lanes = useMemo(() => lanesFor(flow, prd, diagram, diagramPath === ''), [flow, prd, diagram, diagramPath]);
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
    () => (layout && layout.path === diagramPath ? toFlowElements(diagram, layout.layout, { diagramPath, current, selected }) : undefined),
    [layout, diagram, diagramPath, current, selected],
  );
  const crumbs = breadcrumb(flow, diagramPath);

  return (
    <section className="flow-view" data-testid="flow-view">
      <nav className="breadcrumb" data-testid="breadcrumb" aria-label="Diagram path">
        {crumbs.map((c, i) => (
          <span key={c.path} className="crumb">
            {i > 0 && <span className="crumb-sep">›</span>}
            {i < crumbs.length - 1 ? (
              <button type="button" data-testid={c.path === '' ? 'breadcrumb-root' : `breadcrumb-${c.path}`} title={c.title} onClick={() => onOpen(c.path)}>
                {c.label}
              </button>
            ) : (
              <span className="crumb-current" data-testid={c.path === '' ? 'breadcrumb-root' : `breadcrumb-${c.path}`} title={c.title} aria-current="page">
                {c.label}
              </span>
            )}
          </span>
        ))}
        {diagramPath !== '' && <span className="crumb-title">{crumbs[crumbs.length - 1]?.title}</span>}
      </nav>
      <div className="canvas" data-testid="canvas">
        {!diagram && <div className="empty">No diagram at {diagramPath === '' ? 'root' : diagramPath}.</div>}
        {elements && (
          <ReactFlow
            key={diagramPath}
            nodes={elements.nodes}
            edges={elements.edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            fitView
            fitViewOptions={{ padding: 0.08 }}
            minZoom={0.1}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => {
              if (node.type !== 'box') return;
              const data = (node as BoxNode).data;
              onSelect(data.path);
              if (data.hasChildren) onOpen(data.path);
            }}
          >
            <Background gap={24} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
    </section>
  );
}
