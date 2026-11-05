// The path map of a storyboard card (S6-A1): each diagram the scenario's path goes through,
// laid out with the flow view's swimlane layout (elkjs). Path boxes are in their lane colour
// with their step numbers; the other boxes are grey. The edges the path takes are drawn in
// colour with the branch label they take.

import { useEffect, useId, useState } from 'react';
import type { Diagram, Flow, Prd } from '@rehearse/core';
import { lanesFor } from '../model/diagram.js';
import { BOX_H, BOX_W, layoutDiagram, type SwimlaneLayout } from '../model/layout.js';
import type { MapDiagram } from '../model/storyboard.js';
import { wrapLines } from '../model/text.js';

const SCALE = 0.62;
const layouts = new WeakMap<Diagram, Promise<SwimlaneLayout>>();

/** One layout per diagram object: the cards of all scenarios share it. */
function cachedLayout(flow: Flow | undefined, prd: Prd | undefined, map: MapDiagram): Promise<SwimlaneLayout> {
  let p = layouts.get(map.diagram);
  if (!p) {
    p = layoutDiagram(map.diagram, lanesFor(flow, prd, map.diagram, map.path === '')).catch(() => ({ lanes: [], boxes: [] }));
    layouts.set(map.diagram, p);
  }
  return p;
}

export function PathMap({ flow, prd, maps, testId }: { flow: Flow | undefined; prd: Prd | undefined; maps: MapDiagram[]; testId: string }) {
  if (maps.length === 0) return <p className="muted" data-testid={testId}>No diagram: the steps name no box in flow.yaml.</p>;
  return (
    <div className="path-map" data-testid={testId}>
      {maps.map((m) => (
        <MapPanel key={m.path} flow={flow} prd={prd} map={m} testId={`${testId}-${m.path === '' ? 'root' : m.path}`} />
      ))}
    </div>
  );
}

function MapPanel({ flow, prd, map, testId }: { flow: Flow | undefined; prd: Prd | undefined; map: MapDiagram; testId: string }) {
  const [layout, setLayout] = useState<SwimlaneLayout | undefined>();
  const marker = `arrow-${useId().replace(/:/g, '')}`;
  useEffect(() => {
    let live = true;
    setLayout(undefined);
    void cachedLayout(flow, prd, map).then((l) => live && setLayout(l));
    return () => {
      live = false;
    };
  }, [flow, prd, map]);

  const onPath = map.boxes.filter((b) => b.onPath);
  const summary = `${map.path === '' ? 'Top diagram' : `Inside ${map.title}`}: path through ${onPath.map((b) => b.box.title).join(', ') || 'no box'}`;
  return (
    <figure className="map-panel" data-testid={testId}>
      <figcaption>
        {map.path === '' ? 'Top diagram' : <>Inside <strong>{map.title}</strong> <code>{map.path}</code></>}
      </figcaption>
      {!layout ? (
        <p className="muted small">Laying out…</p>
      ) : (
        <MapSvg map={map} layout={layout} marker={marker} label={summary} testId={testId} />
      )}
    </figure>
  );
}

function MapSvg({ map, layout, marker, label, testId }: { map: MapDiagram; layout: SwimlaneLayout; marker: string; label: string; testId: string }) {
  const laneOf = new Map(layout.lanes.map((l) => [l.role, l]));
  const pos = new Map(
    layout.boxes.map((b) => {
      const lane = laneOf.get(b.lane);
      return [b.id, { x: b.x, y: (lane?.y ?? 0) + b.y, color: lane?.color ?? '#8a93a6' }];
    }),
  );
  const width = Math.max(1, ...layout.lanes.map((l) => l.width));
  const height = Math.max(1, ...layout.lanes.map((l) => l.y + l.height));
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      width={width * SCALE}
      height={height * SCALE}
      className="map-svg"
    >
      <defs>
        <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
        </marker>
      </defs>
      {layout.lanes.map((l) => (
        <g key={l.role}>
          <rect x={0} y={l.y} width={l.width} height={l.height} className="map-lane" />
          <rect x={0} y={l.y} width={8} height={l.height} fill={l.color} />
          <text x={16} y={l.y + 24} className="map-lane-label">
            {l.label}
          </text>
        </g>
      ))}
      {map.edges.map((e, i) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        const forward = b.x >= a.x + BOX_W / 2;
        const x1 = forward ? a.x + BOX_W : a.x + BOX_W / 2;
        const y1 = forward ? a.y + BOX_H / 2 : a.y + (b.y >= a.y ? BOX_H : 0);
        const x2 = forward ? b.x : b.x + BOX_W / 2;
        const y2 = forward ? b.y + BOX_H / 2 : b.y + (b.y >= a.y ? 0 : BOX_H);
        const cls = `map-edge${e.taken ? ' is-taken' : ''}${e.kind === 'error' ? ' is-error' : ''}`;
        return (
          <g key={i} className={cls} data-testid={e.taken ? `${testId}-taken-${e.from}-${e.to}` : undefined}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd={`url(#${marker})`} />
            {e.taken && e.label !== undefined && (
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6} textAnchor="middle" className="map-edge-label">
                {e.label}
              </text>
            )}
          </g>
        );
      })}
      {map.boxes.map((b) => {
        const p = pos.get(b.id);
        if (!p) return null;
        return (
          <g key={b.id} className={b.onPath ? 'map-box on-path' : 'map-box'} data-testid={`${testId}-box-${b.id}`} data-on-path={b.onPath ? 'true' : 'false'}>
            <title>{`${b.box.title} (${b.path})${b.onPath ? `, step ${b.steps.join(', ')}` : ', not on the path'}`}</title>
            <rect x={p.x} y={p.y} width={BOX_W} height={BOX_H} rx={8} style={b.onPath ? { stroke: p.color, fill: `${p.color}1f` } : undefined} />
            {wrapLines(b.box.title, 26).map((t, i) => (
              <text key={i} x={p.x + 10} y={p.y + 30 + i * 18} className="map-box-title">
                {t}
              </text>
            ))}
            {b.onPath && (
              <g>
                <rect x={p.x + BOX_W - 8 - 22 * Math.min(3, b.steps.length)} y={p.y - 11} width={22 * Math.min(3, b.steps.length) + 4} height={22} rx={11} fill={p.color} />
                <text x={p.x + BOX_W - 6 - 11 * Math.min(3, b.steps.length)} y={p.y + 5} textAnchor="middle" className="map-step-n">
                  {b.steps.length > 3 ? `${b.steps[0]}…${b.steps[b.steps.length - 1]}` : b.steps.join(',')}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
