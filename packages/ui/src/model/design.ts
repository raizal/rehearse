// The Design tab and the embedded FigCraft editor (T50), pure: the words of a link, the editor's
// address, the host-mode messages FigCraft sends, which of its saves rehearse writes and which
// it offers as a download, base64 for the save call, and the latest test run beside a design.

import type { TestRow } from './tests.js';
import { testSummary } from './tests.js';

type Page = number | string;

/** "page 13", or "page “Story code”" for a page named in links.yaml. */
export function pageWords(page: Page): string {
  return typeof page === 'number' ? `page ${page}` : `page “${page}”`;
}

/** "design/rehearse-review.figcraft · page 14", under the picture. */
export function designCaption(link: { file: string; page: Page }): string {
  return `${link.file} · ${pageWords(link.page)}`;
}

/** "Open page 13": FigCraft starts on its home screen and cannot open the page itself. */
export function openPageHint(page: Page): string {
  return `Open ${pageWords(page)}`;
}

/** `design/x.figcraft` → `x.figcraft`: the name FigCraft gets, and must save under. */
export function baseName(file: string): string {
  return file.slice(file.lastIndexOf('/') + 1);
}

/** The editor's address: same origin as the UI (relative), host mode, the owner as the author. */
export function figcraftSrc(url: string, author: string): string {
  const base = url.replace(/^\/+/, '');
  return `${base.endsWith('/') ? base : `${base}/`}?host=parent&author=${encodeURIComponent(author)}`;
}

/** A host-mode message from the FigCraft page. */
export type FigcraftMessage =
  | { type: 'figcraft:ready'; version?: string; appVersion?: string }
  | { type: 'figcraft:save'; name: string; saveAs: boolean; bytes: Uint8Array }
  | { type: 'figcraft:dirty'; dirty: boolean }
  | { type: 'figcraft:failed'; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** The bytes of a message: an ArrayBuffer or a typed array; undefined otherwise. */
export function asBytes(v: unknown): Uint8Array | undefined {
  // Not `instanceof`: a buffer made in another realm (the iframe, a test runner) fails it.
  if (Object.prototype.toString.call(v) === '[object ArrayBuffer]') return new Uint8Array(v as ArrayBuffer);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return undefined;
}

/** Read a message from the page; anything else (other apps, malformed) is undefined. */
export function readFigcraftMessage(data: unknown): FigcraftMessage | undefined {
  if (!isRecord(data) || typeof data.type !== 'string') return undefined;
  switch (data.type) {
    case 'figcraft:ready':
      return {
        type: 'figcraft:ready',
        ...(typeof data.version === 'string' ? { version: data.version } : {}),
        ...(typeof data.appVersion === 'string' ? { appVersion: data.appVersion } : {}),
      };
    case 'figcraft:save': {
      const bytes = asBytes(data.bytes);
      if (!bytes || typeof data.name !== 'string') return undefined;
      return { type: 'figcraft:save', name: data.name, saveAs: data.saveAs === true, bytes };
    }
    case 'figcraft:dirty':
      return { type: 'figcraft:dirty', dirty: data.dirty === true };
    case 'figcraft:failed':
      return { type: 'figcraft:failed', error: typeof data.error === 'string' && data.error !== '' ? data.error : 'no reason given' };
    default:
      return undefined;
  }
}

/**
 * Where a save goes. Only a plain Save of the file rehearse sent (saveAs false, the same name) is
 * written to the repo; Save As, exports and copies under another name are a download.
 */
export function saveTarget(save: { name: string; saveAs: boolean }, sent: { name: string; file: string } | undefined): { kind: 'write'; file: string } | { kind: 'download'; name: string } {
  if (sent && !save.saveAs && save.name === sent.name) return { kind: 'write', file: sent.file };
  return { kind: 'download', name: save.name || 'figcraft-download' };
}

/** "Saved to design/x.figcraft — commit it when you are happy". */
export function savedWords(file: string): string {
  return `Saved to ${file} — commit it when you are happy`;
}

export const DOWNLOAD_NOTE = 'Saved as a download, not written to the repo';

/** "FigCraft could not start: <error>. …" */
export function failedWords(error: string): string {
  return `FigCraft could not start: ${error}. Close the editor and try again; if the error is about WebGL, open figcraft/?webgl to check what this browser can draw.`;
}

export const UNSAVED_CONFIRM = 'FigCraft has unsaved changes. Close it anyway? The changes are lost.';

// Whether the open FigCraft editor has unsaved changes. The editor covers the page, so the only
// way out besides its Close button is the browser's back or forward; App asks through this first.
let unsaved = false;
export function setDesignUnsaved(dirty: boolean): void {
  unsaved = dirty;
}
/** True when it is fine to leave: nothing unsaved, or the owner says to drop the changes. */
export function leaveDesignOk(confirm: (text: string) => boolean = (t) => window.confirm(t)): boolean {
  if (!unsaved) return true;
  if (!confirm(UNSAVED_CONFIRM)) return false;
  unsaved = false;
  return true;
}

/** Base64 of bytes, in chunks so a large file does not overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** The latest run of a story's tests, as the Tests tab knows it: a run, or none yet. */
export type LatestRun = { ran: false; text: string } | { ran: true; text: string; rows: TestRow[] };

export function latestRun(rows: TestRow[]): LatestRun {
  const ran = rows.filter((r) => r.status === 'passed' || r.status === 'failed' || r.status === 'running');
  if (ran.length === 0) return { ran: false, text: 'No run yet' };
  return { ran: true, text: testSummary(rows), rows: ran };
}
