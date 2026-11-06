// The call graph of the code drill-down as a node graph (S9, box drill-code, T36): the shown code
// node in the center, callers left, callees right, tests as their own kind, from `near` at depth 1
// or 2. Edges show their trust. A click on a node makes it the center; a "+N more" node opens its
// group. Read only. A visually hidden list says the same for screen readers.

import { useContext, useEffect, useMemo, useState } from 'react';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps, type NodeTypes } from '@xyflow/react';
import { GraphApiContext, type GraphOutcome } from '../graph-api.js';
import { callGraphModel, cgNodeSize, cgNodeTitle, layoutCallGraph, type CallGraphModel, type CgNode } from '../model/callgraph.js';
import { callGraph, type CallLink } from '../model/codegraph.js';
import type { GraphLayout } from '../model/graph.js';
import { isServerRestarted, ServerRestarted } from './ServerRestarted.js';

interface CgData extends Record<string, unknown> {
  node: CgNode;
  center: boolean;
}

type CgFlowNode = Node<CgData, 'cg'>;

/** What a click on the node does: make it the center, or open its "+N more" group. */
const clickable = (n: CgNode, center: boolean): boolean => !center && (n.type === 'more' || (n.type === 'code' && n.known));

function CgNodeView({ data }: NodeProps<CgFlowNode>) {
  const { node, center } = data;
  const cls = [
    'cg-node',
    `is-${node.type}`,
    node.kind && `kind-${node.kind}`,
    node.side && `side-${node.side}`,
    center && 'is-center',
    node.outside && 'is-outside',
    node.via && `via-${node.via.trust}`,
  ]
    .filter(Boolean)
    .join(' ');
  const title = cgNodeTitle(node);
  const body = (
    <>
      {node.type === 'code' && <span className="cg-kind">{node.outside ? `outside · ${node.kind}` : node.kind}</span>}
      <span className="cg-name">{node.name}</span>
    </>
  );
  const common = { className: cls, title, 'data-testid': `cg-node-${node.id}`, 'data-kind': node.kind ?? node.type, 'data-side': node.side ?? 'center' };
  // The button's click (mouse, Enter or Space) reaches the flow's onNodeClick.
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      {clickable(node, center) ? (
        <button type="button" {...common} className={`${cls} nopan nodrag`} aria-label={node.type === 'more' ? title : `Show ${title}`}>
          {body}
        </button>
      ) : (
        <div {...common} aria-label={title} {...(center ? { 'aria-current': 'true' as const } : {})}>
          {body}
        </div>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}

const nodeTypes: NodeTypes = { cg: CgNodeView };

/** React Flow nodes and edges of a laid-out call graph. Edge classes carry the kind and the trust. */
export function flowElements(model: CallGraphModel, layout: GraphLayout): { nodes: CgFlowNode[]; edges: Edge[] } {
  const nodes: CgFlowNode[] = model.nodes.flatMap((n) => {
    const r = layout.nodes[n.id];
    if (!r) return [];
    const { w, h } = cgNodeSize(n, model.center);
    return [{ id: n.id, type: 'cg' as const, position: { x: r.x, y: r.y }, width: w, height: h, draggable: false, selectable: false, focusable: false, data: { node: n, center: n.id === model.center } }];
  });
  const edges: Edge[] = model.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    className: e.ghost ? 'cg-edge is-ghost' : `cg-edge kind-${e.kind} trust-${e.trust}`,
    focusable: false,
    selectable: false,
    data: { kind: e.kind, trust: e.trust },
    ...(e.ghost ? {} : { markerEnd: { type: MarkerType.ArrowClosed } }),
  }));
  return { nodes, edges };
}

type Laid = { model: CallGraphModel; layout: GraphLayout };

/** The canvas is as tall as the laid-out graph, within bounds; taller graphs zoom out. */
const canvasHeight = (layout: GraphLayout | undefined): number => Math.min(640, Math.max(240, (layout?.height ?? 0) + 24));

export interface CallGraphViewProps {
  id: string;
  name: string;
  /** 1 or 2: kept by the drill-down when the center moves. */
  depth: number;
  onDepth: (depth: number) => void;
  onCenter: (id: string) => void;
}

export function CallGraphView({ id, name, depth, onDepth, onCenter }: CallGraphViewProps) {
  const api = useContext(GraphApiContext);
  // The opened "+N more" groups belong to one center.
  const [opened, setOpened] = useState<{ id: string; groups: ReadonlySet<string> }>({ id, groups: new Set() });
  const open = useMemo(() => (opened.id === id ? opened.groups : new Set<string>()), [opened, id]);
  const [outcome, setOutcome] = useState<{ depth: number; outcome: GraphOutcome } | undefined>();
  const [laid, setLaid] = useState<Laid | undefined>();

  useEffect(() => {
    let live = true;
    void api.near(id, depth).then((o) => live && setOutcome({ depth, outcome: o }));
    return () => {
      live = false;
    };
  }, [api, id, depth]);

  const answer = outcome?.depth === depth && outcome.outcome.ok ? outcome.outcome.answer : undefined;
  const model = useMemo(() => (answer ? callGraphModel(answer, depth, open) : undefined), [answer, depth, open]);
  useEffect(() => {
    if (!model) return;
    let live = true;
    layoutCallGraph(model).then(
      (layout) => live && setLaid({ model, layout }),
      () => live && setLaid({ model, layout: { width: 0, height: 0, nodes: {}, groups: {}, edges: [] } }),
    );
    return () => {
      live = false;
    };
  }, [model]);

  const elements = useMemo(() => (laid && laid.model === model ? flowElements(laid.model, laid.layout) : undefined), [laid, model]);
  const onNodeClick = (n: CgNode, center: boolean) => {
    if (!clickable(n, center)) return;
    if (n.type === 'more') setOpened({ id, groups: new Set([...open, n.more!.group]) });
    else onCenter(n.id);
  };
  const lists = answer ? callGraph(answer) : undefined;

  return (
    <>
      <div className="cg-bar">
        <h6>Call graph</h6>
        <div className="cg-depth" role="group" aria-label="Depth of the call graph" data-testid="call-graph-depth">
          <span className="muted small">Depth</span>
          {[1, 2].map((d) => (
            <button key={d} type="button" className={`cg-depth-btn${d === depth ? ' is-on' : ''}`} aria-pressed={d === depth} data-testid={`call-graph-depth-${d}`} onClick={() => onDepth(d)}>
              {d}
            </button>
          ))}
        </div>
        <ul className="cg-legend" aria-hidden="true">
          <li><span className="cg-swatch is-exact" /> exact</li>
          <li><span className="cg-swatch is-name-match" /> name match</li>
          <li><span className="cg-swatch is-unresolved" /> unresolved</li>
          <li><span className="cg-dot kind-test" /> test</li>
          <li><span className="cg-dot is-outside" /> outside</li>
        </ul>
      </div>
      {outcome === undefined || outcome.depth !== depth ? (
        <p className="muted small">Asking the code graph what calls {name}…</p>
      ) : !outcome.outcome.ok ? (
        isServerRestarted(outcome.outcome.error) ? (
          <ServerRestarted testId="call-graph-error" />
        ) : (
          <p className="warn" data-testid="call-graph-error">
            Could not load the call graph of {name}: {outcome.outcome.error}
          </p>
        )
      ) : (
        <div className="cg-canvas" style={{ height: canvasHeight(laid?.layout) }} data-testid="call-graph-canvas" role="group" aria-label={`Call graph of ${name}: callers left, callees right`}>
          {elements && (
            <ReactFlow
              key={`${id}:${depth}:${open.size}`}
              nodes={elements.nodes}
              edges={elements.edges}
              nodeTypes={nodeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              nodesFocusable={false}
              edgesFocusable={false}
              elementsSelectable={false}
              fitView
              fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
              minZoom={0.2}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
              onNodeClick={(_, n) => onNodeClick((n as CgFlowNode).data.node, (n as CgFlowNode).data.center)}
            >
              <Background gap={24} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>
      )}
      {lists && (
        <div className="sr-only" data-testid="call-graph-text">
          <CallList title={`Called by ${name}`} testId="call-graph-callers" links={lists.callers} empty="no callers" />
          <CallList title={`${name} calls`} testId="call-graph-callees" links={lists.callees} empty="no callees" />
          {lists.tests.length > 0 && <CallList title={`Tests of ${name}`} testId="call-graph-tests" links={lists.tests} empty="no tests" />}
        </div>
      )}
    </>
  );
}

function CallList({ title, links, testId, empty }: { title: string; links: CallLink[]; testId: string; empty: string }) {
  return (
    <div data-testid={testId}>
      <span>{title}:</span>{' '}
      {links.length === 0 ? (
        <span>{empty}</span>
      ) : (
        <ul>
          {links.map((l) => (
            <li key={l.id}>
              {l.name} <span>{l.trust}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
