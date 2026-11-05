// A free TCP port on 127.0.0.1, for `rehearse serve --port N` (R20: loopback only).

import { createServer } from 'node:net';

export const LOOPBACK = '127.0.0.1';

/** Ask the OS for a free port: listen on port 0, read the port, close. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, LOOPBACK, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('the OS gave no port'))));
    });
  });
}
