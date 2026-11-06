// The story Code tab (design page 13): the story's HOW boxes, each with its code (found only
// from git Flow-Box trailers), and the open box below: the compare bar (before and after
// commits), the change in plain words, the files with +/− counts, the diff (unified, or split
// side by side) and the task threads the commits name. The goal: the builder understands the change.

import { useContext, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { CodeApiContext, type BoxCodeOutcome, type BoxCodeView, type CodeIndex } from '../code-api.js';
import { codeChipText, codeStrip, compareChoices, plainWords, splitPath, splitRows, stripBoxText, taskThreads, unifiedRows, type CodeStripBox } from '../model/code.js';
import type { StoryDetail } from '../model/storyview.js';
import { isServerRestarted, ServerRestarted } from './ServerRestarted.js';
import type { DiffLine } from '@rehearse/server';

/** The code index for the story header chip and the Code tab; undefined while it loads. */
export function useCodeIndex(): CodeIndex | undefined {
  const api = useContext(CodeApiContext);
  const [index, setIndex] = useState<CodeIndex | undefined>();
  useEffect(() => {
    let live = true;
    void api.index().then((i) => live && setIndex(i));
    return () => {
      live = false;
    };
  }, [api]);
  return index;
}

/** `Code: N of M boxes have code`. */
export function CodeChip({ d, index }: { d: StoryDetail; index: CodeIndex | undefined }) {
  const strip = useMemo(() => codeStrip(d.how, index), [d, index]);
  const text = index === undefined ? 'Code: loading…' : index.ok ? codeChipText(strip) : 'Code: not available';
  return (
    <span className="code-chip" data-testid="story-code-chip" title={index && !index.ok ? index.reason : undefined}>
      <span aria-hidden="true">{'</> '}</span>
      {text}
    </span>
  );
}

export function StoryCode({ d, index }: { d: StoryDetail; index: CodeIndex | undefined }) {
  const [open, setOpen] = useState<string | undefined>();
  const [range, setRange] = useState<{ box: string; view: BoxCodeView } | undefined>();
  const shown = range?.box === open ? range : undefined;
  const strip = useMemo(() => codeStrip(d.how, index, shown?.view.changedBoxes), [d, index, shown]);
  const openBox = strip.find((b) => b.path === open);
  return (
    <section className="story-code" data-testid="story-code" aria-labelledby="story-code-h">
      <h3 id="story-code-h">Code</h3>
      {index && !index.ok &&
        (isServerRestarted(index.reason) ? (
          <ServerRestarted testId="code-unavailable" />
        ) : (
          <p className="warn" data-testid="code-unavailable">
            No code: {index.reason}.
          </p>
        ))}
      {d.how.boxes.length === 0 ? (
        <p className="muted small">No box in flow.yaml serves {d.storyId}.</p>
      ) : (
        <>
          <p className="muted small" data-testid="code-hint">
            Click a box to see its code.
            {shown && ` Marks compare ${shown.view.before.short} → ${shown.view.after.short}.`}
          </p>
          <ol className="code-strip" aria-label={`Boxes of ${d.storyId} in flow order`}>
            {strip.map((b, i) => (
              <li key={b.path}>
                {i > 0 && (
                  <span className="code-arrow" aria-hidden="true">
                    →
                  </span>
                )}
                <StripBox b={b} open={b.path === open} onOpen={() => setOpen(b.path === open ? undefined : b.path)} />
              </li>
            ))}
          </ol>
        </>
      )}
      {openBox && <BoxPanel key={openBox.path} b={openBox} onLoaded={(view) => setRange({ box: openBox.path, view })} />}
    </section>
  );
}

function StripBox({ b, open, onOpen }: { b: CodeStripBox; open: boolean; onOpen: () => void }) {
  const code = stripBoxText(b);
  return (
    <button
      type="button"
      className={`code-box${open ? ' is-open' : ''}${b.changed ? ' is-changed' : ''}${b.hasCode ? '' : ' no-code'}${b.canHaveCode ? '' : ' is-decision'}`}
      data-testid={`code-box-${b.path}`}
      aria-pressed={open}
      aria-label={`${open ? 'Close' : 'Open'} the code of box ${b.title} (${b.path}): ${code}${b.changed ? ', changed in the compare range' : ''}`}
      onClick={onOpen}
    >
      {b.changed && <span className="code-changed">~ changed</span>}
      <span className="code-box-title">{b.title}</span>
      <span className="code-box-meta">
        {b.kind} · {b.lane}
      </span>
      <span className="code-box-files">{code}</span>
    </button>
  );
}

type Query = { before?: string; after?: string; file?: string };

function BoxPanel({ b, onLoaded }: { b: CodeStripBox; onLoaded: (view: BoxCodeView) => void }) {
  const api = useContext(CodeApiContext);
  const [query, setQuery] = useState<Query>({});
  const [outcome, setOutcome] = useState<BoxCodeOutcome | undefined>();
  const [mode, setMode] = useState<'unified' | 'split'>('unified');
  useEffect(() => {
    if (!b.hasCode) return;
    let live = true;
    void api.box({ box: b.path, ...query }).then((o) => {
      if (!live) return;
      setOutcome(o);
      if (o.ok) onLoaded(o.view);
    });
    return () => {
      live = false;
    };
    // onLoaded changes on each parent render; the query and box decide what to load.
  }, [api, b.path, b.hasCode, query]);

  const view = outcome?.ok ? outcome.view : undefined;
  return (
    <section className="code-panel" data-testid="code-panel" aria-labelledby="code-panel-h">
      <h4 id="code-panel-h">
        {b.title} <code className="code-path">box {b.path}</code>
        {view && (
          <span className="muted small">
            {' '}
            {view.files.length + view.unchanged.length} files · found by Flow-Box trailers
          </span>
        )}
      </h4>
      {!b.canHaveCode ? (
        <p className="muted" data-testid="code-none">
          A {b.kind} box has no code.
        </p>
      ) : !b.hasCode ? (
        <p className="muted" data-testid="code-none">
          No commit names this box in a <code>Flow-Box:</code> trailer.
        </p>
      ) : outcome === undefined ? (
        <p className="muted">Loading the code of {b.path}…</p>
      ) : !outcome.ok ? (
        isServerRestarted(outcome.error) ? (
          <ServerRestarted testId="code-error" />
        ) : (
        <p className="warn" data-testid="code-error">
          Could not load the code: {outcome.error}
        </p>
        )
      ) : (
        view && (
          <>
            <CompareBar view={view} onChange={(q) => setQuery(q)} />
            <PlainWords view={view} />
            <div className="code-body">
              <FileList view={view} onPick={(file) => setQuery({ before: view.before.sha, after: view.after.sha, file })} />
              <DiffView key={`${view.before.sha} ${view.after.sha} ${view.file ?? ''}`} view={view} mode={mode} onMode={setMode} />
            </div>
            <Threads view={view} />
          </>
        )
      )}
    </section>
  );
}

function CompareBar({ view, onChange }: { view: BoxCodeView; onChange: (q: Query) => void }) {
  const choices = compareChoices(view);
  return (
    <div className="compare-bar" data-testid="compare-bar" role="group" aria-label="Compare">
      <span className="compare-label">Compare</span>
      <label className="compare-side">
        <span>Before</span>
        <select data-testid="compare-before" value={view.before.sha} onChange={(e) => onChange({ before: e.target.value, after: view.after.sha })}>
          {choices.before.map((c) => (
            <option key={c.sha} value={c.sha}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <span aria-hidden="true">→</span>
      <label className="compare-side">
        <span>After</span>
        <select data-testid="compare-after" value={view.after.sha} onChange={(e) => onChange({ before: view.before.sha, after: e.target.value })}>
          {choices.after.map((c) => (
            <option key={c.sha} value={c.sha}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <span className="muted small">
        {view.range.length} {view.range.length === 1 ? 'commit' : 'commits'} of this box in the range
      </span>
    </div>
  );
}

function PlainWords({ view }: { view: BoxCodeView }) {
  const words = plainWords(view.range);
  return (
    <section className="plain-words" data-testid="plain-words" aria-labelledby="plain-words-h">
      <h5 id="plain-words-h">
        What changed, in plain words{' '}
        {words.ids.map((id) => (
          <code key={id} className="record-id">
            {id}
          </code>
        ))}
      </h5>
      {words.lines.length === 0 ? (
        <p className="muted small">No commit of this box in the range.</p>
      ) : (
        <ol>
          {words.lines.map((l, i) => (
            <li key={i}>
              {l.text} <code className="muted small">{l.short}</code>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function FileList({ view, onPick }: { view: BoxCodeView; onPick: (file: string) => void }) {
  return (
    <nav className="code-files" data-testid="code-files" aria-label="Files">
      <h5>Files in this change</h5>
      {view.files.length === 0 && <p className="muted small">No file of this box differs in this range.</p>}
      <ul>
        {view.files.map((f) => {
          const { name, dir } = splitPath(f.path);
          const counts = f.binary ? 'binary' : `+${f.added} −${f.removed}`;
          return (
            <li key={f.path}>
              <button
                type="button"
                className={`code-file${f.path === view.file ? ' is-open' : ''}`}
                data-testid={`code-file-${f.path}`}
                aria-current={f.path === view.file ? 'true' : undefined}
                aria-label={`Show the diff of ${f.path}: ${f.binary ? 'binary file' : `${f.added} lines added, ${f.removed} removed`}`}
                onClick={() => onPick(f.path)}
              >
                <span className="code-file-name">{name}</span>
                <span className="code-file-counts">
                  {f.binary ? (
                    counts
                  ) : (
                    <>
                      <span className="is-add">+{f.added}</span> <span className="is-del">−{f.removed}</span>
                    </>
                  )}
                </span>
                <span className="code-file-dir">{f.oldPath ? `${dir} (was ${f.oldPath})` : dir}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {view.unchanged.length > 0 && (
        <>
          <h5>No change in this range</h5>
          <ul data-testid="code-unchanged">
            {view.unchanged.map((p) => {
              const { name, dir } = splitPath(p);
              return (
                <li key={p} className="code-file is-unchanged">
                  <span className="code-file-name">{name}</span>
                  <span className="code-file-dir">{dir}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </nav>
  );
}

const SIGN: Record<DiffLine['kind'], string> = { add: '+', del: '−', context: ' ' };
const WORD: Record<DiffLine['kind'], string> = { add: 'added', del: 'removed', context: 'no change' };

function Code({ line }: { line: DiffLine }) {
  return (
    <>
      <span className="sr-only">{WORD[line.kind]}: </span>
      {line.text}
      {line.noNewline && <span className="muted small"> (no newline at end of file)</span>}
    </>
  );
}

function DiffView({ view, mode, onMode }: { view: BoxCodeView; mode: 'unified' | 'split'; onMode: (m: 'unified' | 'split') => void }) {
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const diff = view.diff;
  const file = view.file;
  if (file === undefined) return <section className="code-diff" data-testid="code-diff" />;
  const note = !diff
    ? 'No diff for this file.'
    : diff.binary
      ? 'Binary file: no text diff.'
      : diff.hunks.length === 0
        ? diff.status === 'renamed'
          ? `Renamed from ${diff.oldPath}${diff.similarity !== undefined ? ` (${diff.similarity}% similar)` : ''}, no line changed.`
          : 'No line changed.'
        : undefined;
  return (
    <section className="code-diff" data-testid="code-diff" aria-label={`Diff of ${file}`}>
      <div className="code-diff-head">
        <code className="code-diff-file">{file}</code>
        {diff?.status === 'renamed' && diff.hunks.length > 0 && <span className="muted small">renamed from {diff.oldPath}</span>}
        {diff?.status === 'added' && <span className="badge status-approved">new file</span>}
        {diff?.status === 'deleted' && <span className="badge status-stale">deleted</span>}
        <span className="diff-mode" role="group" aria-label="Diff layout">
          <button type="button" aria-pressed={mode === 'unified'} className={mode === 'unified' ? 'is-active' : ''} data-testid="diff-unified" onClick={() => onMode('unified')}>
            Unified
          </button>
          <button type="button" aria-pressed={mode === 'split'} className={mode === 'split' ? 'is-active' : ''} data-testid="diff-split" onClick={() => onMode('split')}>
            Split
          </button>
        </span>
      </div>
      {note && <p className="muted small">{note}</p>}
      {diff && diff.hunks.length > 0 && mode === 'unified' && (
        <table className="diff-table" data-testid="diff-table">
          <thead className="sr-only">
            <tr>
              <th>Old line</th>
              <th>New line</th>
              <th>Change</th>
              <th>Code</th>
            </tr>
          </thead>
          <tbody>
            {unifiedRows(diff.hunks, unfolded).map((r, i) =>
              r.kind === 'hunk' ? (
                <tr key={i} className="diff-hunk">
                  <td colSpan={4}>{r.text}</td>
                </tr>
              ) : r.kind === 'fold' ? (
                <tr key={i} className="diff-fold">
                  <td colSpan={4}>
                    <button type="button" data-testid={`diff-fold-${r.id}`} aria-label={`Show ${r.count} lines with no change`} onClick={() => setUnfolded(new Set([...unfolded, r.id]))}>
                      ⋯ {r.count} lines with no change
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={i} className={`diff-line is-${r.line.kind}`}>
                  <td className="ln">{r.line.old ?? ''}</td>
                  <td className="ln">{r.line.new ?? ''}</td>
                  <td className="sign" aria-hidden="true">
                    {SIGN[r.line.kind]}
                  </td>
                  <td className="code">
                    <Code line={r.line} />
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
      {diff && diff.hunks.length > 0 && mode === 'split' && (
        <table className="diff-table is-split" data-testid="diff-split-table">
          <thead className="sr-only">
            <tr>
              <th>Old line</th>
              <th>Before</th>
              <th>New line</th>
              <th>After</th>
            </tr>
          </thead>
          <tbody>
            {splitRows(diff.hunks).map((r, i) =>
              r.kind === 'hunk' ? (
                <tr key={i} className="diff-hunk">
                  <td colSpan={4}>{r.text}</td>
                </tr>
              ) : (
                <tr key={i} className="diff-line">
                  <td className="ln">{r.left?.old ?? ''}</td>
                  <td className={`code ${r.left ? `is-${r.left.kind}` : 'is-empty'}`}>{r.left && <Code line={r.left} />}</td>
                  <td className="ln">{r.right?.new ?? ''}</td>
                  <td className={`code ${r.right ? `is-${r.right.kind}` : 'is-empty'}`}>{r.right && <Code line={r.right} />}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
      {diff && diff.more > 0 && (
        <p className="warn small" data-testid="diff-too-long">
          Diff too long: {diff.more} more {diff.more === 1 ? 'line' : 'lines'} not shown.
        </p>
      )}
    </section>
  );
}

function Threads({ view }: { view: BoxCodeView }) {
  const threads = taskThreads(view.range);
  if (threads.length === 0) return null;
  return (
    <section className="code-threads" data-testid="code-threads" aria-labelledby="code-threads-h">
      <h5 id="code-threads-h">Task threads</h5>
      <ul>
        {threads.map((t) => (
          <li key={t.id}>
            <a className="thread-link" href={`#thread=${t.id}`} aria-label={`@thread:${t.id}: copy the reference to paste in bb`} title={`bb thread ${t.id}, named by ${t.short}; click to copy`} onClick={(e) => copyRef(e, t.id)}>
              @thread:{t.id}
            </a>{' '}
            <span className="muted small">
              {t.short} {t.subject}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A bb thread has no URL a page can open; the link copies `@thread:<id>` to paste into bb. */
function copyRef(e: MouseEvent, id: string) {
  e.preventDefault();
  void navigator.clipboard?.writeText(`@thread:${id}`).catch(() => undefined);
}
