// Which machine a process runs on (T67). The host worker sends this value with each serve
// process. The plugin server makes the same value. If the two are equal, the serve process runs
// on the bb server itself, so the relay (relay.ts) can reach it on 127.0.0.1.

import { createHash } from 'node:crypto';
import { hostname, networkInterfaces } from 'node:os';

/** A hash of the host name and the hardware addresses of the network interfaces. */
export function machineFingerprint(): string {
  const macs = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i !== undefined && !i.internal && i.mac !== '00:00:00:00:00:00')
    .map((i) => i!.mac);
  return createHash('sha256')
    .update([hostname(), ...[...new Set(macs)].sort()].join('\n'))
    .digest('hex');
}
