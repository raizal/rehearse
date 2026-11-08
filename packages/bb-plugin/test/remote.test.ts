// T67: the way a viewer on another device sees the panel. The tunnel first, then the relay, then
// the text with the manual command.

import { describe, expect, it } from 'vitest';
import { noRemoteText, remoteView } from '../src/remote.js';

const fails = async (): Promise<string> => {
  throw new Error('cannot share ports from host h1: no bb connect machine credential');
};

describe('remoteView', () => {
  it('uses the tunnel when it works, also if a relay is possible', async () => {
    expect(await remoteView({ port: 4701, tunnel: async () => 'https://mac--4701.getbb.app/', relay: '/relay?lease=L1&path=%2F' })).toEqual({
      url: 'https://mac--4701.getbb.app/',
      via: 'tunnel',
      remoteError: null,
    });
  });

  it('uses the relay when the tunnel fails', async () => {
    expect(await remoteView({ port: 4701, tunnel: fails, relay: '/relay?lease=L1&path=%2F' })).toEqual({ url: '/relay?lease=L1&path=%2F', via: 'relay', remoteError: null });
  });

  it('with no way, the text gives the cause and the manual command with the port', async () => {
    const view = await remoteView({ port: 4701, tunnel: fails, relay: null });
    expect(view.url).toBeNull();
    expect(view.via).toBeNull();
    expect(view.remoteError).toContain('The cause: cannot share ports from host h1: no bb connect machine credential.');
    expect(view.remoteError).toContain('bb connect expose 4701');
    expect(view.remoteError).toContain('open it in the bb app on the machine that has the repo');
  });

  it('a cause without words still makes a full sentence', () => {
    expect(noRemoteText('  ', 4700)).toContain('The cause: no reason given.');
    expect(noRemoteText('failed.', 4700)).toContain('The cause: failed.');
  });
});
