import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { findFreePort, LOOPBACK } from '../src/port.js';

describe('findFreePort', () => {
  it('gives a port that can be listened on at 127.0.0.1', async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, LOOPBACK, () => resolve());
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('does not give a port that is in use', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, LOOPBACK, () => resolve()));
    const taken = (server.address() as { port: number }).port;
    const ports = await Promise.all([findFreePort(), findFreePort(), findFreePort()]);
    expect(ports).not.toContain(taken);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
