// The code drill-down below a leaf box (S9, boxes drill-code and code-view, D19): the code of the
// function the box builds, its AST outline and its call graph, read only, from the same graph the
// agents ask (G8). The box's code comes from its `builds` edges; a box with none yet falls back to
// the functions in the files of its Flow-Box commits (not its test files). No builds edge and no commit: no code yet.

import { useContext, useEffect, useState } from 'react';
import { GraphApiContext, type GraphOutcome, type PanelAnswer } from '../graph-api.js';
import { boxTarget, builtNodes, callGraph, codeLines, definedNodes, isTestFile, nodePlace, NO_CODE_YET, outlineRows, type BoxCode, type BuiltNode, type CallLink } from '../model/codegraph.js';
import { isServerRestarted, ServerRestarted } from './ServerRestarted.js';

/** Files of the Flow-Box fallback that are read at most. */
export const MAX_FALLBACK_FILES = 8;

type Load = { state: 'loading' } | { state: 'error'; error: string } | { state: 'done'; code: BoxCode };

export function BoxCodeGraph({ box, files }: { box: string; files: readonly string[] }) {
  const api = useContext(GraphApiContext);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [picked, setPicked] = useState<string | undefined>();
  const fileKey = files.join('\n');

  useEffect(() => {
    let live = true;
    setLoad({ state: 'loading' });
    setPicked(undefined);
    void (async (): Promise<Load> => {
      const shown = await api.show(boxTarget(box));
      if (!shown.ok && !shown.notFound) return { state: 'error', error: shown.error };
      const built = builtNodes(shown.ok ? shown.answer : undefined);
      if (built.length > 0) return { state: 'done', code: { source: 'builds', nodes: built } };
      const paths = fileKey === '' ? [] : fileKey.split('\n').filter((f) => !isTestFile(f)).slice(0, MAX_FALLBACK_FILES);
      const answers = await Promise.all(paths.map((p) => api.show(p)));
      const failed = answers.find((a): a is Extract<GraphOutcome, { ok: false }> => !a.ok && !a.notFound);
      if (failed) return { state: 'error', error: failed.error };
      const defined = definedNodes(answers.map((a) => (a.ok ? a.answer : undefined)));
      return { state: 'done', code: defined.length > 0 ? { source: 'flow-box', nodes: defined } : { source: 'none' } };
    })().then((l) => live && setLoad(l));
    return () => {
      live = false;
    };
  }, [api, box, fileKey]);

  return (
    <section className="code-graph" data-testid="code-graph" aria-labelledby="code-graph-h">
      <h5 id="code-graph-h">
        Code graph <span className="badge code-graph-ro">read only</span>
        {load.state === 'done' && load.code.source !== 'none' && (
          <span className="muted small" data-testid="code-graph-source">
            {load.code.source === 'builds' ? ' found by builds edges' : ' found by the files of Flow-Box commits (no builds edge yet)'}
          </span>
        )}
      </h5>
      {load.state === 'loading' ? (
        <p className="muted small">Asking the code graph about box {box}…</p>
      ) : load.state === 'error' ? (
        isServerRestarted(load.error) ? (
          <ServerRestarted testId="code-graph-error" />
        ) : (
          <p className="warn" data-testid="code-graph-error">
            Could not ask the code graph: {load.error}
          </p>
        )
      ) : load.code.source === 'none' ? (
        <p className="muted" data-testid="code-graph-none">
          {NO_CODE_YET}
        </p>
      ) : (
        <Built nodes={load.code.nodes} picked={picked ?? load.code.nodes[0]!.id} onPick={setPicked} />
      )}
    </section>
  );
}

function Built({ nodes, picked, onPick }: { nodes: BuiltNode[]; picked: string; onPick: (id: string) => void }) {
  return (
    <>
      {nodes.length > 1 && (
        <div className="code-graph-picks" role="group" aria-label="Code of this box" data-testid="code-graph-picks">
          {nodes.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`code-graph-pick${n.id === picked ? ' is-open' : ''}`}
              aria-pressed={n.id === picked}
              data-testid={`code-graph-pick-${n.name}`}
              title={nodePlace(n)}
              onClick={() => onPick(n.id)}
            >
              <span className="code-graph-kind">{n.kind}</span> {n.name}
            </button>
          ))}
        </div>
      )}
      <NodeView key={picked} id={picked} built={nodes.find((n) => n.id === picked)} />
    </>
  );
}

function NodeView({ id, built }: { id: string; built: BuiltNode | undefined }) {
  const api = useContext(GraphApiContext);
  const [outcome, setOutcome] = useState<GraphOutcome | undefined>();
  useEffect(() => {
    let live = true;
    void api.show(id).then((o) => live && setOutcome(o));
    return () => {
      live = false;
    };
  }, [api, id]);
  if (outcome === undefined) return <p className="muted small">Loading the code of {built?.name ?? id}…</p>;
  if (!outcome.ok) {
    return isServerRestarted(outcome.error) ? (
      <ServerRestarted testId="code-graph-error" />
    ) : (
      <p className="warn" data-testid="code-graph-error">
        {outcome.notFound ? `${built?.name ?? id} is no longer in the code graph.` : `Could not load ${built?.name ?? id}: ${outcome.error}`}
      </p>
    );
  }
  return <NodePanes answer={outcome.answer} trust={built?.trust} />;
}

function NodePanes({ answer, trust }: { answer: PanelAnswer; trust: BuiltNode['trust'] }) {
  const node = answer.nodes[0]!;
  const lines = codeLines(node);
  const rows = outlineRows(answer.outline?.root);
  const calls = callGraph(answer);
  return (
    <div className="code-graph-body" data-testid="code-graph-node">
      <section className="code-graph-pane is-code" aria-label={`Code of ${node.name}, read only`} data-testid="code-graph-code">
        <div className="code-diff-head">
          <code className="code-diff-file">{nodePlace(node)}</code>
          <span className="pill">{node.kind}</span>
          {trust && <span className={`trust-mark is-${trust}`} title="trust of the builds edge">builds · {trust}</span>}
        </div>
        {lines.length === 0 ? (
          <p className="muted small">No code to show: the node is outside the repo.</p>
        ) : (
          <pre className="code-graph-src" tabIndex={0} aria-readonly="true">
            {lines.map((l) => (
              <span key={l.n} className="code-graph-line">
                <span className="ln" aria-hidden="true">
                  {l.n}
                </span>
                <span className="code">{l.text}</span>
                {'\n'}
              </span>
            ))}
          </pre>
        )}
      </section>
      <section className="code-graph-pane is-ast" aria-label={`AST outline of ${node.name}`} data-testid="code-graph-ast">
        <h6>AST outline</h6>
        {rows.length === 0 ? (
          <p className="muted small">No outline for this node.</p>
        ) : (
          <ol className="ast-outline">
            {rows.map((r, i) => (
              <li key={i} style={{ paddingLeft: `calc(${r.depth} * var(--s-3))` }}>
                <span className="ast-type">{r.type}</span>
                {r.name !== undefined && <code className="ast-name">{r.name}</code>}
                <span className="ast-lines">{r.lines}</span>
              </li>
            ))}
          </ol>
        )}
        {answer.outline?.cut && <p className="muted small">The tree is cut at {answer.outline.nodes} nodes.</p>}
      </section>
      <section className="code-graph-pane is-calls" aria-label={`Call graph of ${node.name}`} data-testid="code-graph-calls">
        <h6>Call graph</h6>
        <div className="call-graph">
          <CallList title="Called by" testId="call-graph-callers" links={calls.callers} />
          <div className="call-graph-me" aria-hidden="true">
            <span className="call-arrow">→</span>
            <span className="call-node is-me">{node.name}</span>
            <span className="call-arrow">→</span>
          </div>
          <CallList title="Calls" testId="call-graph-callees" links={calls.callees} />
        </div>
        {calls.tests.length > 0 && <CallList title="Tested by" testId="call-graph-tests" links={calls.tests} />}
      </section>
    </div>
  );
}

function CallList({ title, links, testId }: { title: string; links: CallLink[]; testId: string }) {
  return (
    <div className="call-list" data-testid={testId}>
      <span className="call-list-title">{title}</span>
      {links.length === 0 ? (
        <span className="muted small">none</span>
      ) : (
        <ul>
          {links.map((l) => (
            <li key={l.id} title={l.id}>
              <span className="call-node">{l.name}</span> <span className={`trust-mark is-${l.trust}`}>{l.trust}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
