// A read-only client of the FigCraft desktop app's control port (T51, box `refresh-design-pictures`):
// newline-delimited JSON `{id, method, params}` → `{ok, result, error}` over TCP on 127.0.0.1:4800.
// It sends two things only: `engine.execute {command: "doc.list"}` (which tab is active) and
// `ui.render {ids, format: "png", scale}` (a picture of a frame). Anything else is refused here,
// before a byte is sent: rehearse never changes a document in FigCraft.

import { connect } from 'node:net';

export const FIGCRAFT_CONTROL_HOST = '127.0.0.1';
export const FIGCRAFT_CONTROL_PORT = 4800;

/** Where the FigCraft control port listens. */
export interface FigcraftControlAddress {
  host: string;
  port: number;
  /** Per call, in ms. Default 15 s. */
  timeoutMs?: number;
}

/** FigCraft does not answer (not running, no control port): the connection failed. */
export class FigcraftNotRunning extends Error {}

/** One open tab of FigCraft, as `doc.list` says it. */
export interface FigcraftDoc {
  id: string | number;
  name: string;
  path?: string | null;
  active: boolean;
}

type Call = { method: 'engine.execute'; params: { command: 'doc.list'; params: Record<string, never> } } | { method: 'ui.render'; params: { ids: (string | number)[]; format: 'png'; scale: number } };

/** True for the two calls rehearse may send. */
export function isReadOnlyCall(method: string, params: unknown): boolean {
  if (method === 'ui.render') return true;
  return method === 'engine.execute' && typeof params === 'object' && params !== null && (params as { command?: unknown }).command === 'doc.list';
}

let nextId = 0;

/** Send one call and read its one-line answer. */
function call(addr: FigcraftControlAddress, c: Call): Promise<unknown> {
  if (!isReadOnlyCall(c.method, c.params)) return Promise.reject(new Error(`refused to send ${c.method} to FigCraft: rehearse only reads`));
  return new Promise((resolve, reject) => {
    const socket = connect({ host: addr.host, port: addr.port });
    const chunks: Buffer[] = [];
    let connected = false;
    let done = false;
    const finish = (err: Error | undefined, value?: unknown) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(value);
    };
    socket.setTimeout(addr.timeoutMs ?? 15_000, () => finish(connected ? new Error(`FigCraft did not answer ${c.method} in time`) : new FigcraftNotRunning('timed out connecting')));
    socket.on('connect', () => {
      connected = true;
      socket.write(`${JSON.stringify({ id: ++nextId, method: c.method, params: c.params })}\n`);
    });
    socket.on('data', (d: Buffer) => {
      chunks.push(d);
      const text = Buffer.concat(chunks).toString('utf8');
      const nl = text.indexOf('\n');
      if (nl < 0) return;
      let answer: { ok?: unknown; result?: unknown; error?: unknown };
      try {
        answer = JSON.parse(text.slice(0, nl));
      } catch {
        finish(new Error(`FigCraft sent an answer that is not JSON to ${c.method}`));
        return;
      }
      if (answer.ok !== true) finish(new Error(`FigCraft refused ${c.method}: ${typeof answer.error === 'string' ? answer.error : JSON.stringify(answer.error)}`));
      else finish(undefined, answer.result);
    });
    socket.on('error', (e: NodeJS.ErrnoException) => finish(connected ? e : new FigcraftNotRunning(e.code ?? e.message)));
    socket.on('close', () => finish(new Error(`FigCraft closed the connection before answering ${c.method}`)));
  });
}

/** The open tabs of FigCraft. */
export async function listFigcraftDocs(addr: FigcraftControlAddress): Promise<FigcraftDoc[]> {
  const result = await call(addr, { method: 'engine.execute', params: { command: 'doc.list', params: {} } });
  if (!Array.isArray(result)) throw new Error('FigCraft answered doc.list with something that is not a list');
  return result.filter((d): d is FigcraftDoc => typeof d === 'object' && d !== null && 'active' in d);
}

/** A node id as FigCraft knows it: a number when it is all digits. */
const nodeId = (id: string): string | number => (/^\d+$/.test(id) ? Number(id) : id);

/** The PNG of one node of the active tab. */
export async function renderFigcraftPng(addr: FigcraftControlAddress, id: string, scale = 1): Promise<Buffer> {
  const result = await call(addr, { method: 'ui.render', params: { ids: [nodeId(id)], format: 'png', scale } });
  const data = typeof result === 'object' && result !== null ? (result as { data?: unknown }).data : undefined;
  if (typeof data !== 'string' || data === '') throw new Error('FigCraft answered ui.render without a picture');
  const png = Buffer.from(data, 'base64');
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('FigCraft answered ui.render with something that is not a PNG');
  return png;
}
