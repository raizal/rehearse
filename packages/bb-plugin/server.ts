// bb-plugin-rehearse: the server entry.
//
// - The panel (app.tsx) asks for a serve process over RPC. The host worker
//   (host.ts) on the repo's machine starts or reuses `rehearse serve`, and the
//   panel shows its URL in an iframe: the same UI as a browser tab (R12, D31).
// - `bb rehearse` opens the panel; `bb rehearse validate|simulate|gate check|new`
//   run the rehearse CLI. No approve and no sign-off command (R13, R14, D41).
// - A viewer on another device (a phone through bb connect) gets the machine tunnel. If the host
//   cannot share a port and the serve process runs on the bb server's machine, the viewer gets
//   the relay route of this plugin (src/remote.ts, src/relay.ts, T67).

import { defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { hostContract } from './contract.js';
import { parseBbRehearse, USAGE } from './src/cli-args.js';
import { machineFingerprint } from './src/machine.js';
import { relay, relayRoute, relayTarget, relayUrl, RELAY_METHODS, RELAY_PATH } from './src/relay.js';
import { remoteView } from './src/remote.js';
import { cliTarget, projectRepo, sharedPortUrl, type HostPath } from './src/targets.js';

const slug = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).max(200);
const id = z.string().min(1).max(100);

export const rpcContract = defineRpcContract({
  projects: {
    input: z.null(),
    output: z.object({ projects: z.array(z.object({ id: z.string(), name: z.string() })) }),
  },
  epics: {
    input: z.object({ projectId: id }).strict(),
    output: z.object({ repoPath: z.string(), slugs: z.array(z.string()) }),
  },
  open: {
    input: z.object({ projectId: id, slug, remote: z.boolean() }).strict(),
    output: z.object({
      leaseId: z.string(),
      /** What the iframe shows: the loopback URL, or the bb connect URL for a remote viewer. */
      url: z.string().nullable(),
      localUrl: z.string(),
      /** Why `url` is null for a remote viewer. */
      remoteError: z.string().nullable(),
      sshAgent: z.boolean(),
    }),
  },
  renew: {
    input: z.object({ leaseId: id }).strict(),
    output: z.object({ alive: z.boolean() }),
  },
  release: {
    input: z.object({ leaseId: id }).strict(),
    output: z.object({ stopped: z.boolean() }),
  },
});

/** Realtime channel: `bb rehearse open` asks open windows to show the panel. */
export const OPEN_CHANNEL = 'open';
export const PANEL_PATH = 'rehearse';

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    rehearseCommand: {
      type: 'string',
      label: 'rehearse command',
      default: '',
    },
    threadModel: {
      type: 'string',
      label: 'model of story threads (empty: bb default)',
      default: '',
    },
    threadReasoning: {
      type: 'string',
      label: 'reasoning level of story threads (empty: bb default)',
      default: '',
    },
  });
  const host = bb.hosts.experimental_client({ contract: hostContract });

  /** leaseId → where its process runs. Drives the bb connect port declarations and the relay. */
  const leases = new Map<string, { hostId: string; port: number; relay: boolean }>();
  /** This machine, once. Null if it cannot be read: then there is no relay. */
  let here: string | null | undefined;
  const thisMachine = (): string | null => {
    if (here === undefined) {
      try {
        here = machineFingerprint();
      } catch {
        here = null;
      }
    }
    return here;
  };
  const route = relayRoute(bb.pluginId);
  /** The port of the bb server itself. The relay never goes to it, also if a lease names it. */
  const bbPort = (): number | null => {
    try {
      const url = new URL(bb.server.loopbackBaseUrl);
      return Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    } catch {
      return null;
    }
  };
  const portsOn = (hostId: string): number[] => [...new Set([...leases.values()].filter((l) => l.hostId === hostId).map((l) => l.port))];
  const declarePorts = (hostId: string): void => {
    try {
      bb.hosts.declareSharedPorts(hostId, portsOn(hostId));
    } catch {
      // Not enrolled in bb connect: only local viewers can see the panel.
    }
  };
  const dropLease = (leaseId: string): void => {
    const lease = leases.get(leaseId);
    if (!lease) return;
    leases.delete(leaseId);
    declarePorts(lease.hostId);
  };
  host.experimental_onWorkerExit(({ hostId }) => {
    for (const [leaseId, lease] of [...leases]) if (lease.hostId === hostId) leases.delete(leaseId);
    declarePorts(hostId);
  });

  async function repoOf(projectId: string): Promise<HostPath> {
    const project = await bb.sdk.projects.get({ projectId });
    const repo = projectRepo(project.sources);
    if (!repo) throw new Error(`project ${project.name} has no source folder`);
    return repo;
  }

  bb.rpc.register(rpcContract, {
    async projects() {
      const list = await bb.sdk.projects.list();
      return { projects: list.map((p) => ({ id: p.id, name: p.name })) };
    },
    async epics({ projectId }) {
      const repo = await repoOf(projectId);
      const { slugs } = await host.call('listEpics', { repoPath: repo.path }, { hostId: repo.hostId });
      return { repoPath: repo.path, slugs };
    },
    async open({ projectId, slug, remote }) {
      const repo = await repoOf(projectId);
      const { rehearseCommand, threadModel, threadReasoning } = await settings.get();
      const opened = await host.call(
        'open',
        {
          repoPath: repo.path,
          slug,
          command: rehearseCommand,
          projectId,
          ...(threadModel ? { threadModel } : {}),
          ...(threadReasoning ? { threadReasoning } : {}),
        },
        { hostId: repo.hostId, timeoutMs: 30_000 },
      );
      // The relay can reach the process only if it runs on this machine (the bb server's).
      const sameMachine = opened.machine !== undefined && opened.machine === thisMachine();
      leases.set(opened.leaseId, { hostId: repo.hostId, port: opened.port, relay: sameMachine });
      let url: string | null = opened.url;
      let remoteError: string | null = null;
      if (remote) {
        const view = await remoteView({
          port: opened.port,
          tunnel: async () => {
            const tunnel = await bb.hosts.ensureSharedPortTunnel(repo.hostId);
            bb.hosts.declareSharedPorts(repo.hostId, portsOn(repo.hostId));
            return sharedPortUrl(tunnel, opened.port);
          },
          relay: sameMachine ? relayUrl(route, opened.leaseId) : null,
        });
        url = view.url;
        remoteError = view.remoteError;
      }
      return { leaseId: opened.leaseId, url, localUrl: opened.url, remoteError, sshAgent: opened.sshAgent.available };
    },
    async renew({ leaseId }) {
      const lease = leases.get(leaseId);
      if (!lease) return { alive: false };
      const { alive } = await host.call('renew', { leaseId }, { hostId: lease.hostId });
      if (!alive) dropLease(leaseId);
      return { alive };
    },
    async release({ leaseId }) {
      const lease = leases.get(leaseId);
      if (!lease) return { stopped: false };
      dropLease(leaseId);
      return host.call('release', { leaseId }, { hostId: lease.hostId });
    },
  });

  // The relay (T67): "local" auth, so bb refuses a request from a page that is not a bb app page.
  for (const method of RELAY_METHODS) {
    bb.http.route(
      method,
      RELAY_PATH,
      async (c) => {
        const request = c.req.raw;
        const target = relayTarget(new URL(request.url), (leaseId) => {
          const lease = leases.get(leaseId);
          return lease?.relay && lease.port !== bbPort() ? { port: lease.port } : undefined;
        });
        if (!target.ok) return new Response(`${target.error}\n`, { status: target.status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
        return relay(request, target, { route });
      },
      { auth: 'local' },
    );
  }

  /** The checkout a CLI call works in: the thread's environment, else the project's repo. */
  async function checkoutOf(ctx: { threadId?: string; projectId?: string }): Promise<HostPath | undefined> {
    if (ctx.threadId) {
      const thread = await bb.sdk.threads.get({ threadId: ctx.threadId });
      if (thread.environmentId) {
        const env = await bb.sdk.environments.get({ environmentId: thread.environmentId });
        if (env.hostId && env.path) return { hostId: env.hostId, path: env.path };
      }
      return repoOf(thread.projectId);
    }
    return ctx.projectId ? repoOf(ctx.projectId) : undefined;
  }

  bb.cli.register({
    name: 'rehearse',
    summary: 'Open the rehearse panel, or run a read-only rehearse command (validate, simulate, gate check, new, brief, progress)',
    commands: [
      { name: 'open', summary: 'Open the rehearse panel (the same UI as rehearse serve)', usage: 'bb rehearse [open] [<slug>]' },
      { name: 'validate', summary: 'Check the record files of one EPIC', usage: 'bb rehearse validate <epic-dir-or-slug> [--json]' },
      { name: 'simulate', summary: 'Simulate the scenarios of one EPIC', usage: 'bb rehearse simulate <epic-dir-or-slug> [--json]' },
      { name: 'gate', summary: 'Check the gate (only `gate check`). Never signs off', usage: 'bb rehearse gate check <epic-dir-or-slug> [--json]' },
      { name: 'new', summary: 'Create docs/epics/<slug>/', usage: 'bb rehearse new <slug> --title "<title>"' },
    ],
    async run(argv, ctx) {
      const parsed = parseBbRehearse(argv);
      if (parsed.kind === 'help') return { exitCode: 0, stdout: USAGE };
      if (parsed.kind === 'usage') return { exitCode: 2, stderr: `${parsed.message}\n\n${USAGE}` };
      if (parsed.kind === 'open') {
        const projectId = ctx.projectId ?? (ctx.threadId ? (await bb.sdk.threads.get({ threadId: ctx.threadId })).projectId : undefined);
        if (!projectId) return { exitCode: 2, stderr: 'bb rehearse open: no project here. Run it in a bb thread.\n' };
        const subPath = parsed.slug ? `${projectId}/${parsed.slug}` : projectId;
        bb.realtime.publish(OPEN_CHANNEL, { subPath });
        return { exitCode: 0, stdout: `Opened the rehearse panel in bb: /plugins/${bb.pluginId}/${PANEL_PATH}/${subPath}\n` };
      }
      const checkout = await checkoutOf(ctx);
      if (!checkout) return { exitCode: 2, stderr: 'bb rehearse: no thread or project here. Run it in a bb thread.\n' };
      const target = cliTarget(checkout, ctx.cwd);
      const { rehearseCommand } = await settings.get();
      const result = await host.call(
        'runCli',
        { cwd: target.path, args: parsed.args, command: rehearseCommand },
        { hostId: target.hostId, timeoutMs: 30_000 },
      );
      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    },
  });
}
