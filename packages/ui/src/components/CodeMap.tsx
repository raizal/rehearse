// The Code map tab (T40): the whole repo as a map, one level at a time. The packages (bigger box:
// more of the code depends on it), then one package's files with stubs to the packages they use,
// then one file's code with its outside callers and callees faded at the edge. A click goes one
// level in or selects a node; the side panel says what the node is, who calls it, what it calls,
// which tests cover it and which plan boxes it serves. Search with `find`, and a path from A to B.
// Read only. The level and the selected node are in the URL (#/code/…).

import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps, type NodeTypes } from '@xyflow/react';
import { CodeMapApiContext, type CodeMap as CodeMapAnswer, type FindAnswer, type GraphStatus, type MapBox, type MapNode, type MapOutcome } from '../codemap-api.js';
import { GraphApiContext, type GraphOutcome } from '../graph-api.js';
import { callGraph, nodePlace, type CallLink } from '../model/codegraph.js';
import { fileLoc, layoutCodeMap, mapClick, mapKindWord, mapNodeSize, mapNodeTitle, maxRank, placeLoc, plainWords, upLoc } from '../model/codemap.js';
import type { GraphLayout } from '../model/graph.js';
import type { CodeLoc } from '../model/nav.js';
import { isServerRestarted, ServerRestarted } from './ServerRestarted.js';
import type { AnswerNode, QueryAnswer } from '@rehearse/server';

interface MapData extends Record<string, unknown> {
  node: MapNode;
  selected: boolean;
  clickable: boolean;
}

type MapFlowNode = Node<MapData, 'map'>;

function MapNodeView({ data }: NodeProps<MapFlowNode>) {
  const { node, selected, clickable } = data;
  const cls = [
    'cg-node',
    'cm-node',
    `kind-${node.kind}`,
    node.outside && 'is-outside',
    node.kind === 'more' && 'is-more',
    node.test && 'is-test',
    selected && 'is-center',
  ]
    .filter(Boolean)
    .join(' ');
  const title = mapNodeTitle(node);
  const body = (
    <>
      {node.kind !== 'more' && <span className="cg-kind">{mapKindWord(node)}</span>}
      <span className="cg-name">{node.name}</span>
      {node.boxes.length > 0 && (
        <span className="cm-badge" data-testid={`code-map-badge-${node.id}`} title={`Serves ${node.boxes.map((b) => b.path).join(', ')}`}>
          ▣ {node.boxes.length}
        </span>
      )}
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

const nodeTypes: NodeTypes = { map: MapNodeView };

/** React Flow nodes and edges of a laid-out map level. Edges carry their best trust; thicker for more edges. */
export function mapElements(map: CodeMapAnswer, layout: GraphLayout, selected: string | undefined): { nodes: MapFlowNode[]; edges: Edge[] } {
  const top = maxRank(map);
  const outside = new Set(map.nodes.filter((n) => n.outside).map((n) => n.id));
  const nodes: MapFlowNode[] = map.nodes.flatMap((n) => {
    const r = layout.nodes[n.id];
    if (!r) return [];
    const { w, h } = mapNodeSize(n, top);
    const data: MapData = { node: n, selected: n.id === selected, clickable: mapClick(map, n) !== undefined };
    return [{ id: n.id, type: 'map' as const, position: { x: r.x, y: r.y }, width: w, height: h, draggable: false, selectable: false, focusable: false, data }];
  });
  const edges: Edge[] = map.edges.map((e, i) => ({
    id: `e${i}`,
    source: e.from,
    target: e.to,
    // Edges to the outside are faded, so the edges inside the level stand out.
    className: `cg-edge cm-edge trust-${e.trust}${outside.has(e.from) || outside.has(e.to) ? ' is-outside' : ''}`,
    focusable: false,
    selectable: false,
    style: { strokeWidth: Math.min(6, 1 + Math.log2(e.count)) },
    // The count of the code edges between two packages; finer levels have too many edges for labels.
    ...(e.count > 1 && map.level === 'packages' ? { label: String(e.count) } : {}),
    data: { trust: e.trust, count: e.count, kinds: e.kinds },
    markerEnd: { type: MarkerType.ArrowClosed },
  }));
  return { nodes, edges };
}

export interface CodeMapProps {
  loc: CodeLoc;
  onLoc: (loc: CodeLoc) => void;
  /** The EPIC this page serves: its boxes open in the box drawer. */
  epic?: string;
  onOpenBox: (path: string) => void;
}

interface Filters {
  hideTests: boolean;
  hideOutside: boolean;
  epic?: string;
}

const levelKey = (loc: CodeLoc, f: Filters) => JSON.stringify([loc.level ?? null, f.hideTests, f.hideOutside, f.epic ?? null]);

export function CodeMap({ loc, onLoc, epic, onOpenBox }: CodeMapProps) {
  const api = useContext(CodeMapApiContext);
  const [filters, setFilters] = useState<Filters>({ hideTests: false, hideOutside: false });
  const key = levelKey(loc, filters);
  const [outcome, setOutcome] = useState<{ key: string; outcome: MapOutcome<CodeMapAnswer> } | undefined>();
  const [status, setStatus] = useState<GraphStatus | undefined>();
  const [laid, setLaid] = useState<{ map: CodeMapAnswer; layout: GraphLayout } | undefined>();

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
      .map({ level: level ? level.kind : 'packages', ...(level ? { target: level.target } : {}), hideTests: filters.hideTests, hideOutside: filters.hideOutside, ...(filters.epic ? { epic: filters.epic } : {}) })
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
  useEffect(() => {
    if (!map) return;
    let live = true;
    layoutCodeMap(map).then(
      (layout) => live && setLaid({ map, layout }),
      () => live && setLaid({ map, layout: { width: 0, height: 0, nodes: {}, groups: {}, edges: [] } }),
    );
    return () => {
      live = false;
    };
  }, [map]);
  const elements = useMemo(() => (laid && laid.map === map ? mapElements(laid.map, laid.layout, loc.node) : undefined), [laid, map, loc.node]);
  const selectedNode = map?.nodes.find((n) => n.id === loc.node);

  const onNodeClick = (n: MapNode) => {
    if (!map) return;
    const click = mapClick(map, n);
    if (!click) return;
    if ('go' in click) onLoc(click.go);
    else onLoc({ ...loc, node: click.select });
  };
  const levelName = map?.name ?? loc.level?.target ?? 'the repo';
  const filtered = filters.hideTests || filters.hideOutside || filters.epic !== undefined;
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
          <Chip on={filters.hideTests} testId="code-map-hide-tests" onClick={() => setFilters((f) => ({ ...f, hideTests: !f.hideTests }))}>
            Hide tests
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
            <li><span className="cg-swatch is-exact" /> exact</li>
            <li><span className="cg-swatch is-name-match" /> name match</li>
            <li><span className="cg-swatch is-unresolved" /> unresolved</li>
            <li><span className="cg-dot kind-test" /> test</li>
            <li><span className="cg-dot is-outside" /> outside</li>
            <li><span className="cm-badge">▣</span> serves a plan box</li>
          </ul>
        </div>
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
                <button type="button" className="action small" data-testid="code-map-clear-filters" onClick={() => setFilters({ hideTests: false, hideOutside: false })}>
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
            <div className="cm-canvas" data-testid="code-map-canvas" data-level={map?.level} role="group" aria-label={`Code map of ${levelName}`}>
              {elements && (
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
                  fitView
                  fitViewOptions={{ padding: 0.08, maxZoom: 1.2 }}
                  minZoom={0.1}
                  maxZoom={2.5}
                  proOptions={{ hideAttribution: true }}
                  onNodeClick={(_, n) => onNodeClick((n as MapFlowNode).data.node)}
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
          <SidePanel key={loc.node} id={loc.node} mapNode={selectedNode} epic={epic} onOpenBox={onOpenBox} onLoc={onLoc} onClose={() => onLoc({ ...loc, node: undefined })} />
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

const TOP = 6;

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
            <Links title="Called by" testId="code-map-panel-callers" links={lists.callers.filter((l) => l.kind !== 'http-calls')} nodeOf={nodeOf} onLoc={onLoc} empty="Nothing in the repo calls it." />
            <Links title="Calls" testId="code-map-panel-callees" links={lists.callees.filter((l) => l.kind !== 'http-calls')} nodeOf={nodeOf} onLoc={onLoc} empty="It calls nothing the graph knows." />
            <Links title="Tests" testId="code-map-panel-tests" links={lists.tests} nodeOf={nodeOf} onLoc={onLoc} empty="No test covers it." />
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

function Links({ title, links, testId, nodeOf, onLoc, empty }: { title: string; links: CallLink[]; testId: string; nodeOf: (l: CallLink) => { id: string; name: string; file?: string }; onLoc: (l: CodeLoc) => void; empty: string }) {
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
              <NodeLink node={{ ...nodeOf(l), name: l.name }} onLoc={onLoc} />
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
