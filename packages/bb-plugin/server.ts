// bb-plugin-rehearse: the server entry.
//
// - The panel (app.tsx) asks for a serve process over RPC. The host worker
//   (host.ts) on the repo's machine starts or reuses `rehearse serve`, and the
//   panel shows its URL in an iframe: the same UI as a browser tab (R12, D31).
// - `bb rehearse` opens the panel; `bb rehearse validate|simulate|gate check|new`
//   run the rehearse CLI. No approve and no sign-off command (R13, R14, D41).

import { defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { hostContract } from './contract.js';
import { parseBbRehearse, USAGE } from './src/cli-args.js';
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
  });
  const host = bb.hosts.experimental_client({ contract: hostContract });

  /** leaseId → where its process runs. Drives the bb connect port declarations. */
  const leases = new Map<string, { hostId: string; port: number }>();
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
      const { rehearseCommand } = await settings.get();
      const opened = await host.call(
        'open',
        { repoPath: repo.path, slug, command: rehearseCommand },
        { hostId: repo.hostId, timeoutMs: 30_000 },
      );
      leases.set(opened.leaseId, { hostId: repo.hostId, port: opened.port });
      let url: string | null = opened.url;
      let remoteError: string | null = null;
      if (remote) {
        try {
          const tunnel = await bb.hosts.ensureSharedPortTunnel(repo.hostId);
          bb.hosts.declareSharedPorts(repo.hostId, portsOn(repo.hostId));
          url = sharedPortUrl(tunnel, opened.port);
        } catch (e) {
          url = null;
          remoteError = `${e instanceof Error ? e.message : String(e)}. Open the panel in the bb app on the machine that has the repo.`;
        }
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
    summary: 'Open the rehearse panel, or run a read-only rehearse command (validate, simulate, gate check, new)',
    commands: [
      { name: 'open', summary: 'Open the rehearse panel (the same UI as rehearse serve)', usage: 'bb rehearse [open] [<slug>]' },
      { name: 'validate', summary: 'Check the record files of one EPIC', usage: 'bb rehearse validate <epic-dir-or-slug> [--json]' },
      { name: 'simulate', summary: 'Simulate the scenarios of one EPIC', usage: 'bb rehearse simulate <epic-dir-or-slug> [--json]' },
      { name: 'gate check', summary: 'Check the gate. Never signs off', usage: 'bb rehearse gate check <epic-dir-or-slug> [--json]' },
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
