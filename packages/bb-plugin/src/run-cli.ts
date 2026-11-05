// Run one rehearse CLI command and capture its output, for `bb rehearse <command>`.

import { spawn } from 'node:child_process';
import type { Invocation } from './resolve-bin.js';

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** bb rejects plugin CLI output over 1 MiB; keep well under it. */
export const OUTPUT_LIMIT = 512 * 1024;

/** Exit code when rehearse cannot start (missing binary): the CLI's "internal error". */
export const EXIT_INTERNAL = 3;

export function runCli(invocation: Invocation, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs = 25000): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(invocation.command, [...invocation.prefix, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = new Capture();
    const err = new Capture();
    child.stdout.on('data', (b: Buffer) => out.add(b));
    child.stderr.on('data', (b: Buffer) => err.add(b));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    let settled = false;
    const settle = (r: CliResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    child.on('error', (e) =>
      settle({ exitCode: EXIT_INTERNAL, stdout: '', stderr: `bb rehearse: cannot run ${invocation.command}: ${e.message}\n` }),
    );
    child.on('close', (code, signal) => {
      const killed = signal === 'SIGKILL' ? `bb rehearse: rehearse ran longer than ${timeoutMs} ms and was stopped\n` : '';
      settle({ exitCode: code ?? EXIT_INTERNAL, stdout: out.text(), stderr: err.text() + killed });
    });
  });
}

class Capture {
  private chunks: Buffer[] = [];
  private size = 0;
  private dropped = 0;
  add(b: Buffer): void {
    const room = OUTPUT_LIMIT - this.size;
    if (room <= 0) {
      this.dropped += b.length;
      return;
    }
    const part = b.length > room ? b.subarray(0, room) : b;
    this.chunks.push(part);
    this.size += part.length;
    this.dropped += b.length - part.length;
  }
  text(): string {
    const s = Buffer.concat(this.chunks).toString('utf8');
    return this.dropped > 0 ? `${s}\n[bb rehearse: ${this.dropped} more bytes not shown]\n` : s;
  }
}
