// The host worker: bb's daemon runs it on the machine that has the repo, as the
// user, outside any agent sandbox. It owns the `rehearse serve` processes, so
// they can reach the user's ssh-agent to sign approvals (D41).

import { experimental_defineHostEntry, type ExperimentalHostRpcContext } from '@get-bb/plugin-sdk/host';
import { hostContract } from './contract.js';
import { createHostService, SWEEP_EVERY_MS } from './src/host-service.js';

type Lease = ReturnType<ExperimentalHostRpcContext['experimental_retainWorker']>;

let lease: Lease | undefined;
let sweeper: ReturnType<typeof setInterval> | undefined;
let lastContext: ExperimentalHostRpcContext | undefined;

const service = createHostService({
  // Keep the worker (and so the processes) alive while a process runs; let it idle out after.
  onCountChange: (running) => {
    if (running > 0 && !lease && lastContext) lease = lastContext.experimental_retainWorker();
    if (running > 0 && !sweeper) {
      sweeper = setInterval(() => void service.sweep(), SWEEP_EVERY_MS);
      sweeper.unref();
    }
    if (running === 0) {
      if (sweeper) clearInterval(sweeper);
      sweeper = undefined;
      void lease?.dispose();
      lease = undefined;
    }
  },
});

function track(context: ExperimentalHostRpcContext): void {
  if (lastContext === context) return;
  lastContext = context;
  context.lifecycle.signal.addEventListener('abort', () => void service.stopAll(), { once: true });
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    listEpics: ({ repoPath }) => ({ slugs: service.listEpics(repoPath) }),
    open: async ({ repoPath, slug, command, projectId, threadModel, threadReasoning }, context) => {
      track(context);
      return service.open(repoPath, slug, command, {
        ...(projectId ? { projectId } : {}),
        ...(threadModel ? { threadModel } : {}),
        ...(threadReasoning ? { threadReasoning } : {}),
      });
    },
    renew: ({ leaseId }) => ({ alive: service.renew(leaseId) }),
    release: async ({ leaseId }) => ({ stopped: await service.release(leaseId) }),
    runCli: ({ cwd, args, command }) => service.runCli(cwd, args, command),
    status: () => {
      const s = service.status();
      return { sshAgent: s.sshAgent, processes: s.processes.map((p) => ({ ...p, pid: p.pid ?? null })) };
    },
  },
  dispose: () => service.stopAll(),
});
