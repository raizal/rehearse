// The Present button of the EPIC page (T52, box present-view): the deck for a supervisor, made by
// the server from the record, previewed in a frame (← → move between slides) and downloaded as the
// HTML file or a PDF. The frame runs the deck's own script only: it has no access to this page.

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
  const [pdf, setPdf] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const frame = useRef<HTMLIFrameElement>(null);

  const open = () => {
    setState({ kind: 'loading' });
    setPdf({ busy: false });
    void api.html(slug).then((r) => setState(r.ok ? { kind: 'ready', deck: r.body } : { kind: 'error', error: r.error }));
  };
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
    setPdf({ busy: true });
    void api.pdf(slug).then((r) => {
      if (r.ok) {
        save(r.body.data, r.body.name);
        setPdf({ busy: false });
      } else setPdf({ busy: false, error: r.error });
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
                  <button type="button" data-testid="present-download-html" onClick={() => save(new Blob([state.deck.data], { type: 'text/html' }), state.deck.name)}>
                    Download HTML
                  </button>
                  <button type="button" data-testid="present-download-pdf" disabled={pdf.busy} onClick={downloadPdf}>
                    {pdf.busy ? 'Making the PDF…' : 'Download PDF'}
                  </button>
                </>
              )}
              <button type="button" className="link" data-testid="present-close" onClick={close}>
                Close
              </button>
            </span>
          </div>
          {pdf.error && (
            <div className="status-msg error" role="alert" data-testid="present-pdf-error">
              {pdf.error}
            </div>
          )}
          {state.kind === 'loading' && <div className="status-msg" data-testid="present-loading">Making the deck from the record…</div>}
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
