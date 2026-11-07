// The Code map tab (T40): the whole repo as a map, one level at a time. The packages (bigger box:
// more of the code depends on it), then one package's files grouped by folder with stubs to the
// packages they use, then one file's code with the other files it calls or is called by, one node
// per file. A click goes one level in or selects a node; the side panel says what the node is, who
// calls it, what it calls, which tests cover it and which plan boxes it serves. Search with `find`,
// and a path from A to B. Edges are faint until a node is hovered or selected: then its own edges
// show, with their counts. The view opens at a zoom where the names can be read. Read only. The
// level and the selected node are in the URL (#/code/…).

import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps, type NodeTypes } from '@xyflow/react';
import { CodeMapApiContext, type CodeMap as CodeMapAnswer, type FindAnswer, type GraphStatus, type MapBox, type MapMember, type MapNode, type MapOutcome } from '../codemap-api.js';
import { GraphApiContext, type GraphOutcome, type PanelAnswer } from '../graph-api.js';
import { callGraph, nodePlace, type CallLink } from '../model/codegraph.js';
import {
  callsWord, fileLoc, focusNode, layoutCodeMap, mapClick, mapKindWord, mapNodeLabel, mapNodeTitle, mapView, mapViewport, OUTSIDE_GROUP, placeLoc, plainWords, shortTestName, upLoc,
  type MapLayout, type MapView, type Viewport,
} from '../model/codemap.js';
import type { CodeLoc } from '../model/nav.js';
import { sumStats, type CoverageStats } from '../model/coverage.js';
import { CoverageBadge, CoverageHint, CoverageSummary, TestedBy } from './CoverageBadge.js';
import { isServerRestarted, ServerRestarted } from './ServerRestarted.js';
import type { AnswerNode, QueryAnswer } from '@rehearse/server';

interface MapData extends Record<string, unknown> {
  node: MapNode;
  label: string;
  selected: boolean;
  clickable: boolean;
}

interface FrameData extends Record<string, unknown> {
  title: string;
  kind: 'folder' | 'outside';
  onClose?: () => void;
  /** A folder: the unit test coverage of its files added up (T43). */
  coverage?: CoverageStats;
}

type MapFlowNode = Node<MapData, 'map'>;
type FrameFlowNode = Node<FrameData, 'frame'>;

/** A folder of the package, or the opened outside packages (with a button to fold them again). */
function FrameView({ data }: NodeProps<FrameFlowNode>) {
  return (
    <div className={`cm-frame is-${data.kind}`} data-testid={`code-map-frame-${data.title}`}>
      <span className="cm-frame-title">
        {data.title}
        {data.coverage && <CoverageBadge stats={data.coverage} testId={`code-map-frame-coverage-${data.title}`} />}
        {data.onClose && (
          <button type="button" className="link small nopan nodrag" data-testid="code-map-outside-close" onClick={data.onClose}>
            fold
          </button>
        )}
      </span>
    </div>
  );
}

function MapNodeView({ data }: NodeProps<MapFlowNode>) {
  const { node, label, selected, clickable } = data;
  const calls = callsWord(node);
  const cls = [
    'cg-node',
    'cm-node',
    `kind-${node.kind}`,
    node.outside && 'is-outside',
    node.kind === 'more' && 'is-more',
    node.id === OUTSIDE_GROUP && 'is-group',
    node.test && 'is-test',
    selected && 'is-center',
  ]
    .filter(Boolean)
    .join(' ');
  const title = mapNodeTitle(node);
  const body = (
    <>
      {node.kind !== 'more' && <span className="cg-kind">{mapKindWord(node)}</span>}
      <span className="cg-name">
        {label}
        {calls && <span className="cm-calls"> · {calls}</span>}
      </span>
      {node.boxes.length > 0 && (
        <span className="cm-badge" data-testid={`code-map-badge-${node.id}`} title={`Serves ${node.boxes.map((b) => b.path).join(', ')}`}>
          ▣ {node.boxes.length}
        </span>
      )}
      {node.coverage && <CoverageBadge stats={node.coverage} testId={`code-map-coverage-${node.id}`} />}
    </>
  );
  const common = { className: cls, title, 'data-testid': `code-map-node-${node.id}`, 'data-kind': node.kind };
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      {clickable ? (
        <button type="button" {...common} className={`${cls} nopan nodrag`} aria-label={title} {...(selected ? { 'aria-current': 'true' as const } : {})}>
          {body}
        </button>
      ) : (
        <div {...common} aria-label={title}>
          {body}
        </div>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}

const nodeTypes: NodeTypes = { map: MapNodeView, frame: FrameView };

/**
 * React Flow nodes and edges of a laid-out map level. Every edge is faint and thin; the edges of
 * the hovered node (else the selected one) are lit, with their counts. At the packages and package
 * levels an edge is grey and thicker for more code edges; at the file level, where an edge is one
 * call, it keeps its trust style (exact solid, name-match dashed, unresolved dotted).
 */
export function mapElements(
  view: MapView,
  layout: MapLayout,
  selected: string | undefined,
  hover?: string,
  onCloseOutside?: () => void,
): { nodes: (MapFlowNode | FrameFlowNode)[]; edges: Edge[] } {
  const frames: FrameFlowNode[] = layout.frames.map((f) => ({
    id: f.id, type: 'frame' as const, position: { x: f.rect.x, y: f.rect.y }, width: f.rect.w, height: f.rect.h, zIndex: -1,
    draggable: false, selectable: false, focusable: false,
    data: { title: f.title, kind: f.kind, ...(f.kind === 'outside' && onCloseOutside ? { onClose: onCloseOutside } : {}), ...folderCoverage(view, f) },
  }));
  const nodes: MapFlowNode[] = view.nodes.flatMap((n) => {
    const r = layout.nodes[n.id];
    if (!r) return [];
    const data: MapData = { node: n, label: mapNodeLabel(view.level, n), selected: n.id === selected, clickable: mapClick(view, n) !== undefined };
    return [{ id: n.id, type: 'map' as const, position: { x: r.x, y: r.y }, width: r.w, height: r.h, draggable: false, selectable: false, focusable: false, data }];
  });
  const focus = hover ?? selected;
  const counted = view.level !== 'file';
  const edges: Edge[] = view.edges.map((e, i) => {
    const lit = focus !== undefined && (e.from === focus || e.to === focus);
    const thick = counted ? Math.log2(e.count) : 0;
    return {
      id: `e${i}`,
      source: e.from,
      target: e.to,
      className: ['cg-edge', 'cm-edge', counted ? 'is-counted' : `trust-${e.trust}`, lit ? 'is-lit' : 'is-faint'].join(' '),
      focusable: false,
      selectable: false,
      zIndex: lit ? 1 : 0,
      style: { strokeWidth: lit ? Math.min(7, 1.75 + thick) : Math.min(2.5, 0.75 + thick / 3) },
      // The arrow keeps one size whatever the stroke (React Flow scales markers by the stroke by default).
      ...(lit ? { label: String(e.count), markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, markerUnits: 'userSpaceOnUse' } } : {}),
      data: { trust: e.trust, count: e.count, kinds: e.kinds },
    };
  });
  return { nodes: [...frames, ...nodes], edges };
}

/** A folder's badge: the coverage of its files and of its folders' files added up; none when none has any. */
function folderCoverage(view: MapView, f: { id: string; kind: string }): { coverage?: CoverageStats } {
  if (f.kind !== 'folder') return {};
  const within = (g: string | undefined) => g !== undefined && (g === f.id || g.startsWith(`${f.id}/`));
  const sum = sumStats(view.nodes.filter((n) => within(view.folderOf[n.id])).map((n) => n.coverage));
  return sum ? { coverage: sum } : {};
}

export interface CodeMapProps {
  loc: CodeLoc;
  onLoc: (loc: CodeLoc) => void;
  /** The EPIC this page serves: its boxes open in the box drawer. */
  epic?: string;
  onOpenBox: (path: string) => void;
}

interface Filters {
  /** Unset: the tests are hidden at the package level (unless it has only tests), shown elsewhere. */
  hideTests?: boolean;
  hideOutside: boolean;
  epic?: string;
}

const testsAsked = (loc: CodeLoc, f: Filters): boolean | 'auto' => f.hideTests ?? (loc.level?.kind === 'package' ? 'auto' : false);
const levelKey = (loc: CodeLoc, f: Filters) => JSON.stringify([loc.level ?? null, testsAsked(loc, f), f.hideOutside, f.epic ?? null]);
/** The size of the canvas before it is measured (and in tests, where nothing has a size). */
const SCREEN = { w: 1000, h: 600 };

export function CodeMap({ loc, onLoc, epic, onOpenBox }: CodeMapProps) {
  const api = useContext(CodeMapApiContext);
  const [filters, setFilters] = useState<Filters>({ hideOutside: false });
  const key = levelKey(loc, filters);
  const [outcome, setOutcome] = useState<{ key: string; outcome: MapOutcome<CodeMapAnswer> } | undefined>();
  const [status, setStatus] = useState<GraphStatus | undefined>();
  const [laid, setLaid] = useState<{ view: MapView; layout: MapLayout } | undefined>();
  // The level (key) whose outside group is open: another level opens with it folded.
  const [outsideAt, setOutsideAt] = useState<string | undefined>();
  const outsideOpen = outsideAt === key;
  const [hover, setHover] = useState<string | undefined>();
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void api.status().then((s) => live && s.ok && setStatus(s.value));
    return () => {
      live = false;
    };
  }, [api]);
  useEffect(() => {
    let live = true;
    const level = loc.level;
    void api
      .map({ level: level ? level.kind : 'packages', ...(level ? { target: level.target } : {}), hideTests: testsAsked(loc, filters), hideOutside: filters.hideOutside, ...(filters.epic ? { epic: filters.epic } : {}) })
      .then((o) => {
        if (!live) return;
        setOutcome({ key, outcome: o });
        // The first map indexes the repo: the status says so afterwards.
        if (o.ok) setStatus((s) => (s && !s.indexed ? { ...s, indexed: true } : s));
      });
    return () => {
      live = false;
    };
    // `key` holds the level and the filters.
  }, [api, key]);

  const current = outcome?.key === key ? outcome.outcome : undefined;
  const map = current?.ok ? current.value : undefined;
  const view = useMemo(() => (map ? mapView(map, outsideOpen) : undefined), [map, outsideOpen]);
  useEffect(() => {
    if (!view) return;
    let live = true;
    layoutCodeMap(view).then(
      (layout) => live && setLaid({ view, layout }),
      () => live && setLaid({ view, layout: { width: 0, height: 0, nodes: {}, groups: {}, edges: [], frames: [] } }),
    );
    return () => {
      live = false;
    };
  }, [view]);
  useEffect(() => setHover(undefined), [key]);
  const ready = laid && laid.view === view ? laid : undefined;
  const elements = useMemo(() => (ready ? mapElements(ready.view, ready.layout, loc.node, hover, () => setOutsideAt(undefined)) : undefined), [ready, loc.node, hover]);
  // The first view of a level: readable names, on the selected node or the biggest one, for the
  // canvas as measured. Kept while the level stays (opening the outside group does not move it).
  const [opened, setOpened] = useState<{ key: string; viewport: Viewport } | undefined>();
  useLayoutEffect(() => {
    if (!ready || opened?.key === key) return;
    const el = canvasRef.current;
    const screen = el && el.clientWidth > 0 && el.clientHeight > 0 ? { w: el.clientWidth, h: el.clientHeight } : SCREEN;
    setOpened({ key, viewport: mapViewport(ready.layout, ready.layout.nodes[focusNode(ready.view, loc.node) ?? ''], screen) });
  }, [ready, opened, key, loc.node]);
  const viewport = opened?.key === key ? opened.viewport : undefined;
  const selectedNode = view?.nodes.find((n) => n.id === loc.node);

  const onNodeClick = (n: MapNode) => {
    if (!map) return;
    const click = mapClick(map, n);
    if (!click) return;
    if ('toggle' in click) setOutsideAt(key);
    else if ('go' in click) onLoc(click.go);
    else onLoc({ ...loc, node: click.select });
  };
  const levelName = map?.name ?? loc.level?.target ?? 'the repo';
  const hiddenTests = map?.hiddenTests ?? 0;
  const testsHidden = map ? hiddenTests > 0 : testsAsked(loc, filters) === true;
  const filtered = testsHidden || filters.hideOutside || filters.epic !== undefined;
  // The EPICs of the boxes: from the last map that answered, so the select keeps its choices.
  const [epics, setEpics] = useState<string[]>([]);
  useEffect(() => {
    if (map) setEpics(map.epics);
  }, [map]);

  return (
    <section className="code-map" data-testid="code-map">
      <header className="cm-head">
        <h2 className="cm-title">Code map</h2>
        <p className="cm-plain" data-testid="code-map-plain">
          {map ? plainWords(map) : 'Your repo as a map: packages, then files, then the code in a file. Bigger box = more of the code depends on it.'}
        </p>
        <nav className="cm-crumbs" aria-label="Code map level" data-testid="code-map-crumbs">
          {loc.level && (
            <button type="button" className="link" data-testid="code-map-back" onClick={() => onLoc(upLoc(map, loc))}>
              ← Back
            </button>
          )}
          <Crumbs loc={loc} map={map} onLoc={onLoc} />
        </nav>
        <Search onLoc={onLoc} />
        <div className="cm-filters" role="group" aria-label="Filters" data-testid="code-map-filters">
          <Chip on={testsHidden} testId="code-map-hide-tests" onClick={() => setFilters((f) => ({ ...f, hideTests: !testsHidden }))}>
            {testsHidden && hiddenTests > 0 ? `Show ${hiddenTests} ${map?.level === 'file' ? 'test' : 'test file'}${hiddenTests === 1 ? '' : 's'}` : testsHidden ? 'Show tests' : 'Hide tests'}
          </Chip>
          <Chip on={filters.hideOutside} testId="code-map-hide-outside" onClick={() => setFilters((f) => ({ ...f, hideOutside: !f.hideOutside }))}>
            Hide outside packages
          </Chip>
          <label className="cm-epic">
            <span className="muted small">Only code serving the boxes of</span>{' '}
            <select
              data-testid="code-map-epic"
              value={filters.epic ?? ''}
              onChange={(e) => setFilters((f) => {
                const { epic: _old, ...rest } = f;
                return e.target.value ? { ...rest, epic: e.target.value } : rest;
              })}
            >
              <option value="">any EPIC (show all)</option>
              {[...new Set([...epics, ...(filters.epic ? [filters.epic] : [])])].map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <ul className="cg-legend" aria-hidden="true">
            {map?.level === 'file' ? (
              <>
                <li><span className="cg-swatch is-exact" /> exact</li>
                <li><span className="cg-swatch is-name-match" /> name match</li>
                <li><span className="cg-swatch is-unresolved" /> unresolved</li>
              </>
            ) : (
              <li><span className="cg-swatch is-counted" /> thicker = more calls and imports</li>
            )}
            <li className="muted">hover a box to see its edges</li>
            <li><span className="cg-dot kind-test" /> test</li>
            <li><span className="cg-dot is-outside" /> outside</li>
            <li><span className="cm-badge">▣</span> serves a plan box</li>
            {map?.coverage?.found && <li><span className="cov-badge cov-good">%</span> unit test coverage: lines run · tests</li>}
          </ul>
        </div>
        <CoverageHint info={map?.coverage} testId="code-map-coverage-hint" />
      </header>
      <div className="cm-body">
        <div className="cm-canvas-wrap">
          {current === undefined ? (
            <p className="muted" data-testid="code-map-loading">
              {status && !status.indexed ? 'Indexing your repo for the first time. This can take a minute; the map shows when it is done.' : `Drawing the map of ${levelName}…`}
            </p>
          ) : !current.ok ? (
            current.notFound ? (
              <div className="warn" data-testid="code-map-not-found">
                <p>{loc.level?.target ?? 'This place'} is not on the map. It may have moved or been deleted since the link was made.</p>
                <button type="button" className="action small" onClick={() => onLoc({ tab: 'code' })}>
                  Show the packages of the repo
                </button>
              </div>
            ) : isServerRestarted(current.error) ? (
              <ServerRestarted testId="code-map-error" />
            ) : (
              <div className="warn" data-testid="code-map-error">
                <p>Could not draw the code map: {current.error}</p>
                {status && !status.indexed && (
                  <p>
                    The repo is not indexed yet. Run <code>rehearse find main</code> in the repo to index it, then open this tab again.
                  </p>
                )}
              </div>
            )
          ) : map && map.nodes.length === 0 ? (
            filtered ? (
              <div className="muted" data-testid="code-map-empty-filtered">
                <p>Nothing here matches the filters.</p>
                <button type="button" className="action small" data-testid="code-map-clear-filters" onClick={() => setFilters({ hideOutside: false })}>
                  Clear the filters
                </button>
              </div>
            ) : (
              <p className="muted" data-testid="code-map-empty">
                {map.totals.files === 0
                  ? 'No code yet: the code graph found no TypeScript or Python files in this repo. Add some, then open this tab again.'
                  : `${levelName} has no code to draw.`}
              </p>
            )
          ) : (
            <div
              ref={canvasRef}
              className="cm-canvas"
              data-testid="code-map-canvas"
              data-level={map?.level}
              data-zoom={viewport ? viewport.zoom.toFixed(2) : undefined}
              data-focus={hover ?? loc.node}
              role="group"
              aria-label={`Code map of ${levelName}`}
            >
              {elements && viewport && (
                <ReactFlow
                  key={key}
                  nodes={elements.nodes}
                  edges={elements.edges}
                  nodeTypes={nodeTypes}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  nodesFocusable={false}
                  edgesFocusable={false}
                  elementsSelectable={false}
                  defaultViewport={viewport}
                  minZoom={0.1}
                  maxZoom={2.5}
                  proOptions={{ hideAttribution: true }}
                  onNodeClick={(_, n) => n.type === 'map' && onNodeClick((n as MapFlowNode).data.node)}
                  onNodeMouseEnter={(_, n) => n.type === 'map' && setHover(n.id)}
                  onNodeMouseLeave={() => setHover(undefined)}
                >
                  <Background gap={24} size={1} />
                  <Controls showInteractive={false} />
                </ReactFlow>
              )}
              {map && (
                <ul className="sr-only" data-testid="code-map-list">
                  {map.nodes.map((n) => (
                    <li key={n.id}>{mapNodeTitle(n)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        {loc.node !== undefined && (
          selectedNode?.members ? (
            <GroupPanel key={loc.node} node={selectedNode} file={map?.name ?? ''} onLoc={onLoc} onClose={() => onLoc({ ...loc, node: undefined })} />
          ) : (
            <SidePanel key={loc.node} id={loc.node} mapNode={selectedNode} epic={epic} onOpenBox={onOpenBox} onLoc={onLoc} onClose={() => onLoc({ ...loc, node: undefined })} />
          )
        )}
      </div>
    </section>
  );
}

function Chip({ on, testId, onClick, children }: { on: boolean; testId: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`cm-chip${on ? ' is-on' : ''}`} aria-pressed={on} data-testid={testId} onClick={onClick}>
      {children}
    </button>
  );
}

function Crumbs({ loc, map, onLoc }: { loc: CodeLoc; map: CodeMapAnswer | undefined; onLoc: (l: CodeLoc) => void }) {
  const crumbs: { label: string; to?: CodeLoc }[] = [{ label: 'Repo', to: { tab: 'code' } }];
  if (loc.level?.kind === 'package') crumbs.push({ label: map?.name ?? loc.level.target });
  if (loc.level?.kind === 'file') {
    if (map?.unit) crumbs.push({ label: map.unit.name, to: { tab: 'code', level: { kind: 'package', target: map.unit.key } } });
    crumbs.push({ label: loc.level.target });
  }
  return (
    <ol className="crumbs cm-crumb-list">
      {crumbs.map((c, i) => (
        <li key={i}>
          {c.to && i < crumbs.length - 1 ? (
            <button type="button" className="link" data-testid={`code-map-crumb-${i}`} onClick={() => onLoc(c.to!)}>
              {c.label}
            </button>
          ) : (
            <span aria-current="location" data-testid={`code-map-crumb-${i}`}>
              {c.label}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Search with `find`: a hit jumps to its level and is selected. And a path from A to B with `path`. */
function Search({ onLoc }: { onLoc: (l: CodeLoc) => void }) {
  const api = useContext(CodeMapApiContext);
  const [words, setWords] = useState('');
  const [found, setFound] = useState<{ words: string; outcome: MapOutcome<FindAnswer> } | undefined>();
  const [pathOpen, setPathOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [chain, setChain] = useState<MapOutcome<QueryAnswer> | undefined>();

  const find = async () => {
    const w = words.trim();
    if (!w) return;
    setFound({ words: w, outcome: await api.find(w) });
  };
  const path = async () => {
    if (!from.trim() || !to.trim()) return;
    setChain(await api.path(from.trim(), to.trim()));
  };
  const hits = found?.outcome.ok ? found.outcome.value.nodes.slice(0, 12) : [];
  return (
    <div className="cm-search">
      <form
        role="search"
        className="cm-search-row"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <input type="search" placeholder="Find a function, class, route or file" aria-label="Find in the code" value={words} data-testid="code-map-find" onChange={(e) => setWords(e.target.value)} />
        <button type="submit" className="action small" data-testid="code-map-find-go">
          Find
        </button>
        <button type="button" className="link small" aria-expanded={pathOpen} data-testid="code-map-path-toggle" onClick={() => setPathOpen((o) => !o)}>
          Path from A to B
        </button>
      </form>
      {found && (
        <div className="cm-results" data-testid="code-map-results">
          {!found.outcome.ok ? (
            <p className="warn">Could not search: {found.outcome.error}</p>
          ) : hits.length === 0 ? (
            <p className="muted small">Nothing found for “{found.words}”.</p>
          ) : (
            <ul className="drawer-list">
              {hits.map((n) => {
                const to = placeLoc(n.id, (found.outcome as { ok: true; value: FindAnswer }).value.places[n.id]);
                return (
                  <li key={n.id}>
                    {to ? (
                      <button
                        type="button"
                        className="link"
                        data-testid={`code-map-hit-${n.id}`}
                        onClick={() => {
                          setFound(undefined);
                          onLoc(to);
                        }}
                      >
                        {n.route ?? n.name}
                      </button>
                    ) : (
                      <span data-testid={`code-map-hit-${n.id}`}>{n.route ?? n.name}</span>
                    )}{' '}
                    <span className="muted small">
                      {n.kind} · {nodePlace(n)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {pathOpen && (
        <form
          className="cm-search-row"
          data-testid="code-map-path"
          onSubmit={(e) => {
            e.preventDefault();
            void path();
          }}
        >
          <input aria-label="From" placeholder="From (a name)" value={from} data-testid="code-map-path-from" onChange={(e) => setFrom(e.target.value)} />
          <span aria-hidden="true">→</span>
          <input aria-label="To" placeholder="To (a name)" value={to} data-testid="code-map-path-to" onChange={(e) => setTo(e.target.value)} />
          <button type="submit" className="action small" data-testid="code-map-path-go">
            Show the path
          </button>
        </form>
      )}
      {pathOpen && chain && (
        <div className="cm-results" data-testid="code-map-path-result">
          {!chain.ok ? (
            <p className="warn">{chain.notFound ? 'One of the two names is not in the code graph.' : `Could not find a path: ${chain.error}`}</p>
          ) : chain.value.nodes.length === 0 ? (
            <p className="muted small">No path: nothing in the code graph leads from the first to the second.</p>
          ) : (
            <ol className="cm-path">
              {chain.value.nodes.map((n) => (
                <li key={n.id}>
                  <NodeLink node={n} onLoc={onLoc} testId={`code-map-path-${n.id}`} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function NodeLink({ node, onLoc, testId }: { node: { id: string; name: string; file?: string; route?: string }; onLoc: (l: CodeLoc) => void; testId?: string }) {
  const to = fileLoc(node);
  const label = node.route ?? node.name;
  return to ? (
    <button type="button" className="link" data-testid={testId} title={nodePlace(node)} onClick={() => onLoc(to)}>
      {label}
    </button>
  ) : (
    <span data-testid={testId} title="outside the repo">
      {label}
    </span>
  );
}

/** A test: its short title (the whole describe chain on hover) and its test file. */
function TestLink({ node, onLoc }: { node: { id: string; name: string; file?: string }; onLoc: (l: CodeLoc) => void }) {
  const to = fileLoc(node);
  const short = shortTestName(node.name);
  return (
    <span className="cm-test">
      {to ? (
        <button type="button" className="link cm-test-name" title={node.name} onClick={() => onLoc(to)}>
          {short}
        </button>
      ) : (
        <span className="cm-test-name" title={node.name}>
          {short}
        </span>
      )}
      {node.file && <span className="muted small cm-test-file"> {node.file.split('/').pop()}</span>}
    </span>
  );
}

const TOP = 6;

/** An other file (or outside package) at the file level: the code in it this file calls, and the code in it that calls this file. */
function GroupPanel({ node, file, onLoc, onClose }: { node: MapNode; file: string; onLoc: (l: CodeLoc) => void; onClose: () => void }) {
  const members = node.members ?? [];
  const base = file.split('/').pop();
  const list = (title: string, testId: string, rows: MapMember[], count: (m: MapMember) => number) => (
    <section data-testid={testId}>
      <h4>
        {title} <span className="muted">({rows.length})</span>
      </h4>
      {rows.length === 0 ? (
        <p className="muted small">None.</p>
      ) : (
        <ul className="drawer-list">
          {rows.map((m) => (
            <li key={m.id}>
              {m.kind === 'test' ? <TestLink node={m} onLoc={onLoc} /> : <NodeLink node={m} onLoc={onLoc} />}
              {count(m) > 1 && <span className="muted small"> × {count(m)}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <aside className="cm-panel" aria-label={`About ${node.name}`} data-testid="code-map-panel">
      <div className="cm-panel-head">
        <h3 data-testid="code-map-panel-name">{node.name}</h3>
        <button type="button" className="drawer-close" aria-label="Close" data-testid="code-map-panel-close" onClick={onClose}>
          ×
        </button>
        <p className="muted small" data-testid="code-map-panel-place">
          {mapKindWord(node)} · {node.file ?? 'outside the repo'} · {callsWord(node)} with {base}
        </p>
      </div>
      <div className="drawer-body cm-panel-body">
        {list(`What ${base} uses in it`, 'code-map-panel-members-to', members.filter((m) => m.to > 0), (m) => m.to)}
        {list(`What in it uses ${base}`, 'code-map-panel-members-from', members.filter((m) => m.from > 0), (m) => m.from)}
      </div>
    </aside>
  );
}

/** The selected node: what it is, where it is, who calls it, what it calls, its tests, its HTTP calls and its boxes. */
function SidePanel({ id, mapNode, epic, onOpenBox, onLoc, onClose }: { id: string; mapNode: MapNode | undefined; epic: string | undefined; onOpenBox: (path: string) => void; onLoc: (l: CodeLoc) => void; onClose: () => void }) {
  const graph = useContext(GraphApiContext);
  const [near, setNear] = useState<GraphOutcome | undefined>();
  useEffect(() => {
    let live = true;
    void graph.near(id, 1).then((o) => live && setNear(o));
    return () => {
      live = false;
    };
  }, [graph, id]);
  const answer = near?.ok ? near.answer : undefined;
  const me: AnswerNode | undefined = answer?.nodes.find((n) => n.id === id) ?? answer?.nodes.find((n) => n.distance === 0);
  const lists = answer ? callGraph(answer) : undefined;
  const nodeOf = (link: CallLink) => answer?.nodes.find((n) => n.id === link.id) ?? { id: link.id, name: link.name };
  const http = lists ? [...lists.callers, ...lists.callees].filter((l) => l.kind === 'http-calls') : [];
  const boxes = mapNode?.boxes ?? (answer ? boxesOf(answer, id) : []);
  const name = me?.route ?? me?.name ?? mapNode?.name ?? id;
  const kind = me?.kind ?? mapNode?.kind;

  return (
    <aside className="cm-panel" aria-label={`About ${name}`} data-testid="code-map-panel">
      <div className="cm-panel-head">
        <h3 data-testid="code-map-panel-name">{name}</h3>
        <button type="button" className="drawer-close" aria-label="Close" data-testid="code-map-panel-close" onClick={onClose}>
          ×
        </button>
        <p className="muted small" data-testid="code-map-panel-place">
          {kind}
          {' · '}
          {me ? nodePlace(me) : mapNode?.file ? nodePlace(mapNode) : 'outside the repo'}
        </p>
      </div>
      {near === undefined ? (
        <p className="muted small">Asking the code graph about {name}…</p>
      ) : !near.ok ? (
        isServerRestarted(near.error) ? <ServerRestarted /> : <p className="warn">{near.notFound ? `${name} is not in the code graph any more.` : `Could not read ${name}: ${near.error}`}</p>
      ) : (
        lists && (
          <div className="drawer-body cm-panel-body">
            <PanelCoverage answer={near.answer} onLoc={onLoc} />
            <Links title="Called by" testId="code-map-panel-callers" links={lists.callers.filter((l) => l.kind !== 'http-calls')} nodeOf={nodeOf} onLoc={onLoc} empty="Nothing in the repo calls it." />
            <Links title="Calls" testId="code-map-panel-callees" links={lists.callees.filter((l) => l.kind !== 'http-calls')} nodeOf={nodeOf} onLoc={onLoc} empty="It calls nothing the graph knows." />
            <Links title="Tests" testId="code-map-panel-tests" links={lists.tests} nodeOf={nodeOf} onLoc={onLoc} empty="No test covers it." tests />
            {(http.length > 0 || kind === 'route') && (
              <Links title={kind === 'route' ? 'Called over HTTP by' : 'HTTP calls and routes'} testId="code-map-panel-http" links={http} nodeOf={nodeOf} onLoc={onLoc} empty="No HTTP calls." />
            )}
          </div>
        )
      )}
      <section className="cm-panel-boxes" data-testid="code-map-panel-boxes">
        <h4>Plan boxes it serves</h4>
        {boxes.length === 0 ? (
          <p className="muted small">None: no commit with a Flow-Box trailer changed it.</p>
        ) : (
          <ul className="drawer-list">
            {boxes.map((b) => (
              <li key={b.id}>
                {b.epic === undefined || b.epic === epic ? (
                  <button type="button" className="link" data-testid={`code-map-box-${b.path}`} onClick={() => onOpenBox(b.path)}>
                    ▣ {b.path}
                  </button>
                ) : (
                  <span data-testid={`code-map-box-${b.path}`} title="A box of another EPIC: open that EPIC's review to see it">
                    ▣ {b.path}
                  </span>
                )}
                {b.epic && <span className="muted small"> · {b.epic}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

function Links({ title, links, testId, nodeOf, onLoc, empty, tests = false }: { title: string; links: CallLink[]; testId: string; nodeOf: (l: CallLink) => { id: string; name: string; file?: string; kind?: string }; onLoc: (l: CodeLoc) => void; empty: string; tests?: boolean }) {
  return (
    <section data-testid={testId}>
      <h4>
        {title} <span className="muted">({links.length})</span>
      </h4>
      {links.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <ul className="drawer-list">
          {links.slice(0, TOP).map((l) => (
            <li key={l.id} className={`trust-${l.trust}`}>
              {tests || nodeOf(l).kind === 'test' ? <TestLink node={{ ...nodeOf(l), name: l.name }} onLoc={onLoc} /> : <NodeLink node={{ ...nodeOf(l), name: l.name }} onLoc={onLoc} />}
              {l.trust !== 'exact' && <span className="muted small"> · {l.trust}</span>}
            </li>
          ))}
          {links.length > TOP && <li className="muted small">and {links.length - TOP} more</li>}
        </ul>
      )}
    </section>
  );
}

/** The boxes a node serves, from the builds edges of a `near` answer (when the node is not on the map). */
function boxesOf(answer: { edges: { from: string; to: string; kind: string; fromName: string }[] }, id: string): MapBox[] {
  return answer.edges
    .filter((e) => e.kind === 'builds' && e.to === id && e.from.includes(' box:'))
    .map((e) => {
      const parts = e.from.split(' ');
      return { id: e.from, path: e.fromName, ...(parts[1] === 'record' && parts[2] ? { epic: parts[2] } : {}) };
    });
}

/** The selected code's unit test coverage in the side panel: badge, lines not run, tested by (T43). */
function PanelCoverage({ answer, onLoc }: { answer: PanelAnswer; onLoc: (l: CodeLoc) => void }) {
  const cov = answer.coverage;
  if (!cov && !answer.coverageInfo) return null;
  const open = (id: string) => {
    const t = cov?.testedBy.find((x) => x.id === id);
    const to = t ? fileLoc(t) : undefined;
    if (to) onLoc(to);
  };
  return (
    <section className="cm-panel-coverage" data-testid="code-map-panel-coverage">
      <h4>Unit test coverage</h4>
      <CoverageSummary coverage={cov} info={answer.coverageInfo} testId="code-map-panel-cov" />
      {cov && cov.stats.percent !== null && (
        <p className="small" data-testid="code-map-panel-uncovered">
          {cov.uncovered.length === 0 ? 'Every line of it runs in a test.' : `Lines not run: ${cov.uncovered.join(', ')}`}
        </p>
      )}
      {cov && <TestedBy tests={cov.testedBy} onOpen={open} testId="code-map-tested-by" />}
    </section>
  );
}
