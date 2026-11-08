// T67: how the plugin server gives the panel to a viewer on another device, with a fake bb.
// - A host with a bb connect machine credential: the machine tunnel.
// - The bb server's machine without a credential: the relay route of the plugin.
// - Another machine without a credential: the panel text with `bb connect expose <port>`.

import { describe, expect, it } from 'vitest';
import plugin, { rpcContract } from '../server.js';
import { machineFingerprint } from '../src/machine.js';
import { relayRoute } from '../src/relay.js';

const PROJECT = { id: 'p1', name: 'tools', sources: [{ hostId: 'mac', path: '/w/repo', isDefault: true }] };

interface Setup {
  /** The machine value that the host worker sends. */
  machine?: string;
  /** The host has a bb connect machine credential. */
  credential: boolean;
  /** The port of the bb server. */
  bbServerPort?: number;
}

type Handler = (input: unknown) => Promise<unknown>;
type RouteHandler = (c: { req: { raw: Request } }) => Promise<Response>;

/** A fake `bb`: only the members that server.ts uses. */
async function start({ machine, credential, bbServerPort = 38886 }: Setup) {
  const rpc: Record<string, Handler> = {};
  const routes: { method: string; path: string; auth: string | undefined; handler: RouteHandler }[] = [];
  const declared: { hostId: string; ports: number[] }[] = [];
  const bb = {
    pluginId: 'rehearse',
    server: { loopbackBaseUrl: `http://127.0.0.1:${bbServerPort}` },
    settings: { define: () => ({ get: async () => ({ rehearseCommand: '', threadModel: '', threadReasoning: '' }) }) },
    hosts: {
      experimental_client: () => ({
        experimental_onWorkerExit: () => () => {},
        call: async (method: string) => {
          if (method === 'open') {
            return {
              leaseId: 'L1',
              port: 4701,
              url: 'http://127.0.0.1:4701/',
              reused: false,
              sshAgent: { available: true, source: 'env' },
              ...(machine !== undefined ? { machine } : {}),
            };
          }
          if (method === 'release') return { stopped: true };
          throw new Error(`no fake for ${method}`);
        },
      }),
      ensureSharedPortTunnel: async (hostId: string) => {
        if (!credential) throw new Error(`cannot share ports from host ${hostId}: no bb connect machine credential`);
        return { label: 'mac', baseDomain: 'getbb.app' };
      },
      declareSharedPorts: (hostId: string, ports: number[]) => {
        if (!credential) throw new Error(`cannot share ports from host ${hostId}: no bb connect machine credential`);
        declared.push({ hostId, ports });
      },
    },
    sdk: { projects: { get: async () => PROJECT, list: async () => [PROJECT] } },
    rpc: {
      register: (_contract: unknown, handlers: Record<string, Handler>) => Object.assign(rpc, handlers),
    },
    http: {
      route: (method: string, path: string, handler: RouteHandler, opts?: { auth?: string }) => routes.push({ method, path, auth: opts?.auth, handler }),
    },
    cli: { register: () => {} },
    realtime: { publish: () => {} },
  };
  await plugin(bb as never);
  const fetchRelay = (query: string): Promise<Response> => {
    const route = routes.find((r) => r.method === 'GET' && r.path === '/relay');
    if (!route) throw new Error('no relay route');
    return route.handler({ req: { raw: new Request(`http://bb.test${relayRoute('rehearse')}?${query}`) } });
  };
  return { rpc, routes, declared, fetchRelay };
}

type Harness = Awaited<ReturnType<typeof start>>;

const open = async (harness: Harness, remote = true) =>
  rpcContract.open.output.parse(await harness.rpc.open!({ projectId: 'p1', slug: '2026-11-05-rehearse', remote }));

describe('T67 the panel for a viewer on another device', () => {
  it('a host with a credential: the machine tunnel, and the port is declared', async () => {
    const harness = await start({ machine: machineFingerprint(), credential: true });
    const view = await open(harness);
    expect(view.url).toBe('https://mac--4701.getbb.app/');
    expect(view.remoteError).toBeNull();
    expect(harness.declared).toContainEqual({ hostId: 'mac', ports: [4701] });
  });

  it('the bb server host without a credential: the relay route of the plugin', async () => {
    const harness = await start({ machine: machineFingerprint(), credential: false });
    const view = await open(harness);
    expect(view.url).toBe(`${relayRoute('rehearse')}?lease=L1&path=%2F`);
    expect(view.remoteError).toBeNull();
  });

  it('another machine without a credential: no relay, and the text has the manual command with the port', async () => {
    for (const machine of ['another-machine', undefined]) {
      const harness = await start({ machine, credential: false });
      const view = await open(harness);
      expect(view.url).toBeNull();
      expect(view.remoteError).toContain('bb connect expose 4701');
      expect(view.remoteError).toContain('The cause: cannot share ports from host mac: no bb connect machine credential.');
    }
  });

  it('a local viewer gets the loopback URL and no tunnel', async () => {
    const harness = await start({ machine: machineFingerprint(), credential: false });
    const view = await open(harness, false);
    expect(view.url).toBe('http://127.0.0.1:4701/');
    expect(view.remoteError).toBeNull();
  });

  it('the relay route has "local" auth and goes only to a lease on this machine', async () => {
    const harness = await start({ machine: 'another-machine', credential: false });
    const routes = harness.routes.filter((r) => r.path === '/relay');
    expect(routes.map((r) => [r.method, r.auth])).toEqual([
      ['GET', 'local'],
      ['HEAD', 'local'],
      ['POST', 'local'],
    ]);
    // No lease yet, then a lease of another machine: the relay refuses both and sends no request.
    expect((await harness.fetchRelay('lease=L1&path=%2F')).status).toBe(404);
    await open(harness);
    expect((await harness.fetchRelay('lease=L1&path=%2F')).status).toBe(404);
  });

  it('the relay never goes to the port of the bb server, also if a lease names it', async () => {
    const harness = await start({ machine: machineFingerprint(), credential: false, bbServerPort: 4701 });
    await open(harness);
    expect((await harness.fetchRelay('lease=L1&path=%2F')).status).toBe(404);
  });

  it('a released lease is gone from the relay', async () => {
    const harness = await start({ machine: machineFingerprint(), credential: false });
    await open(harness);
    expect((await harness.fetchRelay('lease=L1&path=%2F%2Fevil.example')).status).toBe(400);
    await harness.rpc.release!({ leaseId: 'L1' });
    expect((await harness.fetchRelay('lease=L1&path=%2F')).status).toBe(404);
  });
});
