// The typed calls between the plugin server (server.ts) and its host worker (host.ts).
// The host worker runs on the machine that has the repo, as the user: it owns
// the `rehearse serve` processes and runs the rehearse CLI.

import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

const slug = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).max(200);
const absPath = z.string().min(1).max(4096);
/** The `rehearseCommand` setting: empty means "find it" (see src/resolve-bin.ts). */
const command = z.string().max(4096);
/** The `threadModel` / `threadReasoning` settings: the model and reasoning level of story threads (T44). */
const threadSetting = z.string().max(200).regex(/^[A-Za-z0-9._:\/-]*$/).optional();

const sshAgent = z.object({ available: z.boolean(), source: z.enum(['env', 'launchd', 'none']) }).strict();

export const hostContract = defineRpcContract({
  listEpics: {
    input: z.object({ repoPath: absPath }).strict(),
    output: z.object({ slugs: z.array(z.string()) }).strict(),
  },
  open: {
    input: z.object({ repoPath: absPath, slug, command, threadModel: threadSetting, threadReasoning: threadSetting }).strict(),
    output: z
      .object({ leaseId: z.string(), port: z.number().int(), url: z.string(), reused: z.boolean(), sshAgent })
      .strict(),
  },
  renew: {
    input: z.object({ leaseId: z.string().max(100) }).strict(),
    output: z.object({ alive: z.boolean() }).strict(),
  },
  release: {
    input: z.object({ leaseId: z.string().max(100) }).strict(),
    output: z.object({ stopped: z.boolean() }).strict(),
  },
  runCli: {
    input: z.object({ cwd: absPath, args: z.array(z.string().max(4096)).max(64), command }).strict(),
    output: z.object({ exitCode: z.number().int(), stdout: z.string(), stderr: z.string() }).strict(),
  },
  status: {
    input: z.null(),
    output: z
      .object({
        sshAgent,
        processes: z.array(
          z.object({ repoPath: z.string(), slug: z.string(), pid: z.number().nullable(), port: z.number(), leases: z.number() }).strict(),
        ),
      })
      .strict(),
  },
});
