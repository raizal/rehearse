// The story Design tab (T50): the page of the FigCraft design the story links to in
// design/links.yaml, as its PNG with the file and page under it, and the bad links of the story in
// words. No link: the line to add. "Edit in FigCraft" opens FigCraft's web build in an iframe in
// host mode (served by rehearse serve under figcraft/, same origin): rehearse sends it the linked
// file when it is ready, writes a plain Save of that file back through the server, and offers
// every other save (Save As, exports) as a download. FigCraft starts on its home screen, so a
// banner says which page to open. Unsaved changes are guarded on close and on leaving the page.
//
// T51: no YAML to edit. "Link a design" opens a picker of the design files, pages and frames; one
// click links (Change and Unlink after). An unlinked story shows the top 3 suggested pages and
// frames with a one-click Link. A link that comes from a frame's name says so. "Refresh pictures"
// asks a running FigCraft for fresh PNGs of the linked frames, and says what it wrote or why not.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesignPicture as PictureRef, Id } from '@rehearse/core';
import { HTTP_DESIGN_API, type DesignApi, type DesignInfo, type DesignLinkView, type DesignTarget, type LinkRequest } from '../design-api.js';
import {
  baseName,
  designCaption,
  DOWNLOAD_NOTE,
  failedWords,
  figcraftSrc,
  linkedWords,
  pictureSrc,
  sourceWords,
  openPageHint,
  readFigcraftMessage,
  savedWords,
  saveTarget,
  toBase64,
  setDesignUnsaved,
  UNSAVED_CONFIRM,
} from '../model/design.js';
import { DesignPicker, DesignSuggestions } from './DesignLinker.js';
import { FindingList } from './Review.js';
import { isServerRestarted, ServerRestarted } from './ServerRestarted.js';

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; info: DesignInfo };

/** The story's design links, read again on `reload`. */
export function useDesign(storyId: Id, api: DesignApi = HTTP_DESIGN_API): { load: Load; reload: () => void } {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    void api.design(storyId).then((r) => live && setLoad(r.ok ? { kind: 'ready', info: r.body } : { kind: 'error', message: r.error }));
    return () => {
      live = false;
    };
  }, [api, storyId, n]);
  return { load, reload: useCallback(() => setN((v) => v + 1), []) };
}

/**
 * A page of the design: its PNG, or words when no PNG is linked, and the file and page under it.
 * T51: `picture` is the server's choice (the link's PNG, else the index's page or frame PNG, else
 * the file thumbnail, said under it); `version` makes the browser read a refreshed PNG again.
 */
export function DesignPicture({ link, testId, picture, version = 0 }: { link: DesignLinkView; testId: string; picture?: PictureRef | undefined; version?: number }) {
  const shown: PictureRef | undefined = picture ?? (link.png ? { kind: 'page', png: link.png } : undefined);
  return (
    <figure className="design-figure" data-testid={testId}>
      {shown ? (
        <img src={pictureSrc(shown, version)} alt={`The design, ${designCaption(link)}`} data-testid={`${testId}-png`} />
      ) : (
        <p className="muted small design-no-png" data-testid={`${testId}-no-png`}>
          No PNG of this page is linked: add <code>png: design/&lt;page&gt;.png</code> to the link to see it here.
        </p>
      )}
      <figcaption className="small muted" data-testid={`${testId}-caption`}>
        {designCaption(link)}
        {shown?.kind === 'file thumbnail' && <span data-testid={`${testId}-thumbnail`}> · file thumbnail (no PNG of this page yet)</span>}
      </figcaption>
    </figure>
  );
}

type Msg = { text: string; warn: boolean };

/** Link, change or unlink (target null) a story or a box of it; says what happened. */
export function useDesignLink(api: DesignApi, reload: () => void) {
  const [msg, setMsg] = useState<Msg | undefined>();
  const [busy, setBusy] = useState(false);
  const link = async (who: LinkRequest, target: DesignTarget | null): Promise<boolean> => {
    setBusy(true);
    const name = who.box ? `box ${who.box} of ${who.story}` : who.story;
    const r = await api.link(who, target);
    setBusy(false);
    if (!r.ok) {
      setMsg({ text: `Could not ${target ? 'link' : 'unlink'} ${name}: ${r.error}`, warn: true });
      return false;
    }
    setMsg({ text: r.body.link ? linkedWords(name, r.body.link) : `Unlinked ${name}.`, warn: false });
    reload();
    return true;
  };
  return { msg, setMsg, busy, setBusy, link };
}

export function StoryDesign({ storyId, api = HTTP_DESIGN_API }: { storyId: Id; api?: DesignApi }) {
  const { load, reload } = useDesign(storyId, api);
  const [editing, setEditing] = useState(false);
  const { msg, setMsg, busy, setBusy, link: linkTo } = useDesignLink(api, reload);
  const [pending, setPending] = useState(false);
  const [picking, setPicking] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    setEditing(false);
    setPicking(false);
    setMsg(undefined);
  }, [storyId, setMsg]);

  const pick = async (target: DesignTarget | null) => {
    if (!info) return;
    if (await linkTo({ epic: info.slug, story: storyId }, target)) setPicking(false);
  };
  const refresh = async () => {
    setBusy(true);
    setMsg({ text: 'Asking FigCraft for fresh pictures…', warn: false });
    const r = await api.refresh(storyId);
    setBusy(false);
    setMsg(r.ok ? { text: r.body.message, warn: false } : { text: r.error, warn: true });
    if (r.ok) {
      setVersion((v) => v + 1);
      reload();
    }
  };

  const fetchWeb = async () => {
    setPending(true);
    setMsg({ text: 'Fetching the FigCraft web build…', warn: false });
    const r = await api.fetchFigcraft();
    setMsg(r.ok ? { text: `Fetched FigCraft web${r.body.version ? ` ${r.body.version}` : ''}.`, warn: false } : { text: `Could not fetch FigCraft web: ${r.error}`, warn: true });
    setPending(false);
    reload();
  };

  const info = load.kind === 'ready' ? load.info : undefined;
  const link = info?.story ?? undefined;
  const findings = info?.findings ?? [];
  // A T50 server sends no index: then the tab offers no picker.
  const linkable = info?.index !== undefined;
  const linkedBy = sourceWords(info?.storySource);
  return (
    <section className="story-design" data-testid="story-design" aria-labelledby="story-design-h">
      <header className="story-design-head">
        <h3 id="story-design-h">Design</h3>
        {link && info && (
          <button type="button" className="action small primary" data-testid="design-edit" disabled={!info.figcraft.fetched || editing} onClick={() => setEditing(true)}>
            Edit in FigCraft
          </button>
        )}
      </header>
      {load.kind === 'loading' && (
        <p className="muted" data-testid="design-loading">
          Reading the design links…
        </p>
      )}
      {load.kind === 'error' &&
        (isServerRestarted(load.message) ? (
          <ServerRestarted testId="design-error" />
        ) : (
          <p className="warn" data-testid="design-error">
            Could not read the design links: {load.message}
          </p>
        ))}
      {msg && (
        <p className={`small${msg.warn ? ' warn' : ''}`} role="status" data-testid="design-msg">
          {msg.text}
        </p>
      )}
      {info && link && !info.figcraft.fetched && (
        <div className="story-design-notice" role="note" data-testid="design-not-fetched">
          <p className="small">
            The FigCraft web build is not fetched, so the editor cannot open here. Run <code>{info.figcraft.command}</code> in the repo, or fetch it now.
          </p>
          <button type="button" className="action small" data-testid="design-fetch" disabled={pending} onClick={() => void fetchWeb()}>
            Fetch FigCraft web
          </button>
        </div>
      )}
      {info && link && (
        <>
          <p className="small" data-testid="design-hint">
            In FigCraft: {openPageHint(link.page)} of {link.file}.
          </p>
          {linkedBy && (
            <p className="small muted" data-testid="design-source">
              {linkedBy}: a links.yaml entry for {storyId} would win over it.
            </p>
          )}
          <DesignPicture link={link} testId="design-story" picture={info.storyPicture} version={version} />
          {linkable && (
            <div className="story-design-actions" data-testid="design-actions">
              <button type="button" className="action small" data-testid="design-change" disabled={busy} onClick={() => setPicking((p) => !p)}>
                Change
              </button>
              {!linkedBy && (
                <button type="button" className="action small" data-testid="design-unlink" disabled={busy} onClick={() => void pick(null)}>
                  Unlink
                </button>
              )}
              <button type="button" className="action small" data-testid="design-refresh" disabled={busy} onClick={() => void refresh()}>
                Refresh pictures
              </button>
            </div>
          )}
        </>
      )}
      {info && !link && (
        <div className="story-design-none" data-testid="design-none">
          {linkable ? (
            <>
              <p>
                <strong>No design linked</strong> to {storyId}. Pick a page or frame, or link a suggestion.
              </p>
              {!picking && (
                <button type="button" className="action small primary" data-testid="design-link-open" disabled={busy} onClick={() => setPicking(true)}>
                  Link a design
                </button>
              )}
              <DesignSuggestions suggestions={info.suggestions} busy={busy} onLink={(t) => void pick(t)} testId="design-suggested" />
              <details className="small">
                <summary>Or write the link by hand</summary>
                <p>
                  Add this line to <code>{info.linksFile}</code> under <code>epics: {info.slug}:</code>
                </p>
                <pre className="design-link-line" data-testid="design-link-line">
                  <code>{info.linkLine}</code>
                </pre>
              </details>
            </>
          ) : (
            <>
              <p>
                <strong>No design linked</strong> to {storyId}. To link one, add this line to <code>{info.linksFile}</code> under <code>epics: {info.slug}:</code>
              </p>
              <pre className="design-link-line" data-testid="design-link-line">
                <code>{info.linkLine}</code>
              </pre>
            </>
          )}
        </div>
      )}
      {info && picking && <DesignPicker index={info.index ?? []} busy={busy} onPick={(t) => void pick(t)} onCancel={() => setPicking(false)} testId="design-picker" />}
      {findings.length > 0 && (
        <div data-testid="design-findings">
          <p className="warn small">The design links of {storyId} have problems:</p>
          <FindingList findings={findings} testId="design-findings-list" />
        </div>
      )}
      {editing && info && link && <FigcraftEditor info={info} link={link} api={api} onClose={() => setEditing(false)} />}
    </section>
  );
}

/** The FigCraft web build in host mode, over the page. */
export function FigcraftEditor({ info, link, api, onClose }: { info: DesignInfo; link: DesignLinkView; api: DesignApi; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<Msg | undefined>();
  /** The file rehearse sent, by the name FigCraft saves it under. */
  const sent = useRef<{ name: string; file: string } | undefined>(undefined);

  useEffect(() => {
    const post = (data: unknown) => frame.current?.contentWindow?.postMessage(data, window.location.origin);
    const open = async () => {
      setMsg({ text: `Opening ${link.file}…`, warn: false });
      const r = await api.file(link.file);
      if (!r.ok) {
        setMsg({ text: `Could not read ${link.file}: ${r.error}`, warn: true });
        return;
      }
      const name = baseName(link.file);
      sent.current = { name, file: link.file };
      post({ type: 'figcraft:open', name, bytes: r.body });
      setMsg(undefined);
    };
    const save = async (name: string, saveAs: boolean, bytes: Uint8Array) => {
      const target = saveTarget({ name, saveAs }, sent.current);
      if (target.kind === 'download') {
        download(target.name, bytes);
        setMsg({ text: `${DOWNLOAD_NOTE}: ${target.name}.`, warn: false });
        return;
      }
      setMsg({ text: `Saving ${target.file}…`, warn: false });
      const r = await api.save(target.file, toBase64(bytes));
      setMsg(r.ok ? { text: savedWords(r.body.file || target.file), warn: false } : { text: `Could not save ${target.file}: ${r.error}`, warn: true });
    };
    const onMessage = (e: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || e.source !== win || e.origin !== window.location.origin) return;
      const m = readFigcraftMessage(e.data);
      if (!m) return;
      if (m.type === 'figcraft:ready') void open();
      else if (m.type === 'figcraft:dirty') setDirty(m.dirty);
      else if (m.type === 'figcraft:save') void save(m.name, m.saveAs, m.bytes);
      else setMsg({ text: failedWords(m.error), warn: true });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [api, link.file]);

  // Leaving the page while FigCraft has unsaved changes asks first; so does going back or forward in rehearse (App).
  useEffect(() => {
    setDesignUnsaved(dirty);
    return () => setDesignUnsaved(false);
  }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const close = () => {
    if (dirty && !window.confirm(UNSAVED_CONFIRM)) return;
    onClose();
  };

  return (
    <div className="figcraft-overlay" role="dialog" aria-modal="true" aria-labelledby="figcraft-title" data-testid="figcraft-editor">
      <header className="figcraft-bar">
        <h2 id="figcraft-title">
          FigCraft · {link.file}
          {dirty && (
            <span className="dirty-dot" data-testid="figcraft-dirty" title="Unsaved changes">
              <span aria-hidden="true"> ● </span>Unsaved changes
            </span>
          )}
        </h2>
        <p className="figcraft-banner small" data-testid="figcraft-banner">
          {openPageHint(link.page)}: FigCraft starts on its home screen and cannot open the page itself.
        </p>
        {msg && (
          <p className={`small${msg.warn ? ' warn' : ''}`} role="status" data-testid="figcraft-msg">
            {msg.text}
          </p>
        )}
        <button type="button" className="action small" data-testid="figcraft-close" onClick={close}>
          Close
        </button>
      </header>
      <iframe ref={frame} className="figcraft-frame" data-testid="figcraft-frame" title="FigCraft editor" src={figcraftSrc(info.figcraft.url, info.author)} />
    </div>
  );
}

/** Offer bytes as a file download; nothing is written to the repo. */
function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
