// The Present button of the EPIC page (T52, box present-view): the deck for a supervisor, made by
// the server from the record, previewed in a frame (← → move between slides) and downloaded as the
// HTML file or a PDF, or (T53, box download-with-recordings) a zip of the HTML and the recordings it
// links. T54: the executive summary by default; Full deck shows (and downloads) the summary followed
// by every story slide. The frame runs the deck's own script only: it has no access to this page.

import { useEffect, useRef, useState } from 'react';
import { HTTP_PRESENT_API, type DeckHtml, type PresentApi } from '../present-api.js';

type State = { kind: 'closed' } | { kind: 'loading' } | { kind: 'error'; error: string } | { kind: 'ready'; deck: DeckHtml };

/** Save a blob under a file name through a temporary link. */
export function download(data: Blob, name: string): void {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Present({ slug, api = HTTP_PRESENT_API, save = download }: { slug: string; api?: PresentApi; save?: (data: Blob, name: string) => void }) {
  const [state, setState] = useState<State>({ kind: 'closed' });
  const [file, setFile] = useState<{ busy?: 'pdf' | 'zip'; error?: string; note?: string }>({});
  const [full, setFull] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  const load = (asFull: boolean) => {
    setFull(asFull);
    setState({ kind: 'loading' });
    setFile({});
    void api.html(slug, { full: asFull }).then((r) => setState(r.ok ? { kind: 'ready', deck: r.body } : { kind: 'error', error: r.error }));
  };
  const open = () => load(false);
  const close = () => setState({ kind: 'closed' });

  useEffect(() => {
    if (state.kind === 'closed') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.kind]);

  const downloadPdf = () => {
    setFile({ busy: 'pdf' });
    void api.pdf(slug, { full }).then((r) => {
      if (r.ok) {
        save(r.body.data, r.body.name);
        setFile({});
      } else setFile({ error: r.error });
    });
  };

  const downloadZip = () => {
    setFile({ busy: 'zip' });
    void api.zip(slug, { full }).then((r) => {
      if (!r.ok) return setFile({ error: r.error });
      save(r.body.data, r.body.name);
      const n = r.body.videos;
      setFile({
        note: n > 0 ? `${r.body.name}: the deck and ${n} recording${n === 1 ? '' : 's'}. Unzip it and keep the folder next to the HTML file.` : `${r.body.name}: Birdview has no recording of these tests, so the zip holds the deck only.`,
      });
    });
  };

  return (
    <>
      <button type="button" className="link" data-testid="present" onClick={open} title="A deck of this EPIC for someone who does not read the record">
        Present
      </button>
      {state.kind !== 'closed' && (
        <div className="present-overlay" role="dialog" aria-modal="true" aria-label="Presentation" data-testid="present-dialog">
          <div className="present-bar">
            <strong>Presentation</strong>
            {state.kind === 'ready' && (
              <span className="muted" data-testid="present-count">
                {state.deck.slides} slides · ← → to move · {state.deck.name}
              </span>
            )}
            <span className="present-actions">
              {state.kind === 'ready' && (
                <>
                  <label className="present-full" title="The summary, then every story slide as an appendix">
                    <input type="checkbox" data-testid="present-full" checked={full} disabled={file.busy !== undefined} onChange={(e) => load(e.target.checked)} /> Full deck
                  </label>
                  <button type="button" data-testid="present-download-html" onClick={() => save(new Blob([state.deck.data], { type: 'text/html' }), state.deck.name)}>
                    Download HTML
                  </button>
                  <button type="button" data-testid="present-download-pdf" disabled={file.busy !== undefined} onClick={downloadPdf}>
                    {file.busy === 'pdf' ? 'rehearse makes the PDF…' : 'Download PDF'}
                  </button>
                  <button type="button" data-testid="present-download-zip" disabled={file.busy !== undefined} onClick={downloadZip} title="The HTML file and the videos of the test runs it links, in one zip">
                    {file.busy === 'zip' ? 'rehearse packs the recordings…' : 'HTML + recordings (zip)'}
                  </button>
                </>
              )}
              <button type="button" className="link" data-testid="present-close" onClick={close}>
                Close
              </button>
            </span>
          </div>
          {file.error && (
            <div className="status-msg error" role="alert" data-testid="present-file-error">
              {file.error}
            </div>
          )}
          {file.note && (
            <div className="status-msg" data-testid="present-zip-note">
              {file.note}
            </div>
          )}
          {state.kind === 'loading' && <div className="status-msg" data-testid="present-loading">rehearse makes the deck from the record…</div>}
          {state.kind === 'error' && (
            <div className="status-msg error" role="alert" data-testid="present-error">
              Could not make the deck: {state.error}
            </div>
          )}
          {state.kind === 'ready' && (
            <iframe
              ref={frame}
              className="present-frame"
              title="Deck preview"
              data-testid="present-frame"
              sandbox="allow-scripts"
              srcDoc={state.deck.data}
              onLoad={() => frame.current?.focus()}
            />
          )}
        </div>
      )}
    </>
  );
}
