// A small language server client over stdio (JSON-RPC with Content-Length frames), for the warm
// basedpyright server of an update (G15). Only a cold index must not send one request per call site
// (S6-A4); `lspStats` counts the requests so a test can prove it.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

/** Every request sent by any client in this process, by method. */
export const lspStats = { requests: 0, byMethod: new Map<string, number>() };

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class LspClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private closed = false;

  constructor(command: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) {
    this.child = spawn(command, args, { cwd: opts.cwd, env: opts.env, stdio: 'pipe' });
    this.child.stdout.on('data', (chunk: Buffer) => this.read(chunk));
    this.child.stderr.resume();
    this.child.on('exit', () => this.fail(new Error('the language server stopped')));
    this.child.on('error', (e) => this.fail(e));
    this.idle();
  }

  request<T>(method: string, params: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error('the language server is closed'));
    const id = this.nextId++;
    lspStats.requests++;
    lspStats.byMethod.set(method, (lspStats.byMethod.get(method) ?? 0) + 1);
    this.busy();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.closed) this.send({ jsonrpc: '2.0', method, params });
  }

  /** Stop the server now (no shutdown handshake: the process may be about to exit). */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.fail(new Error('the language server is closed'));
    this.child.kill();
  }

  private send(message: unknown): void {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin.write(body);
  }

  private read(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const end = this.buffer.indexOf('\r\n\r\n');
      if (end === -1) return;
      const length = /Content-Length: *(\d+)/i.exec(this.buffer.subarray(0, end).toString('ascii'));
      if (!length) {
        this.buffer = this.buffer.subarray(end + 4);
        continue;
      }
      const size = Number(length[1]);
      if (this.buffer.length < end + 4 + size) return;
      const body = this.buffer.subarray(end + 4, end + 4 + size).toString('utf8');
      this.buffer = this.buffer.subarray(end + 4 + size);
      this.handle(JSON.parse(body) as Message);
    }
  }

  private handle(m: Message): void {
    if (m.method !== undefined && m.id !== undefined) {
      // A request from the server: settings come from the pyrightconfig.json, so every answer is empty.
      const items = (m.params as { items?: unknown[] } | undefined)?.items;
      const result = m.method === 'workspace/configuration' ? (items ?? []).map(() => null) : null;
      this.send({ jsonrpc: '2.0', id: m.id, result });
      return;
    }
    if (m.id === undefined || typeof m.id !== 'number') return;
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    if (this.pending.size === 0) this.idle();
    if (m.error) p.reject(new Error(m.error.message));
    else p.resolve(m.result);
  }

  private fail(error: Error): void {
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
    this.idle();
  }

  // The server must not keep the process alive between requests: a CLI exits once it has its answer.
  // The pipes of a child are sockets, which can be ref'd and unref'd.
  private busy(): void {
    this.child.ref();
    pipe(this.child.stdout).ref?.();
  }

  private idle(): void {
    this.child.unref();
    for (const s of [this.child.stdout, this.child.stdin, this.child.stderr]) pipe(s).unref?.();
  }
}

function pipe(stream: object): { ref?(): void; unref?(): void } {
  return stream as { ref?(): void; unref?(): void };
}

interface Message {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message: string };
}
