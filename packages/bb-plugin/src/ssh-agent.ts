// The serve process signs approvals with the builder's key through the ssh-agent
// (D41). It must see SSH_AUTH_SOCK. Agent threads run in a sandbox that cannot
// reach the agent socket; the plugin host runs as the user, outside it.

import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

export interface SshAgent {
  /** The socket path, or null when no agent is found. */
  socket: string | null;
  /** Where the path came from. */
  source: 'env' | 'launchd' | 'none';
}

export interface SshAgentDeps {
  platform: NodeJS.Platform;
  /** macOS: `launchctl getenv SSH_AUTH_SOCK`. Empty string when unset. */
  launchctlGetenv: () => string;
  isSocket: (path: string) => boolean;
}

const defaultDeps: SshAgentDeps = {
  platform: process.platform,
  launchctlGetenv: () => {
    try {
      return execFileSync('launchctl', ['getenv', 'SSH_AUTH_SOCK'], { encoding: 'utf8', timeout: 2000 }).trim();
    } catch {
      return '';
    }
  },
  isSocket: (path) => {
    try {
      return statSync(path).isSocket();
    } catch {
      return false;
    }
  },
};

/** Find the user's ssh-agent socket: SSH_AUTH_SOCK, then (macOS) the launchd one. */
export function findSshAgent(env: NodeJS.ProcessEnv, deps: SshAgentDeps = defaultDeps): SshAgent {
  const fromEnv = env.SSH_AUTH_SOCK;
  if (fromEnv && deps.isSocket(fromEnv)) return { socket: fromEnv, source: 'env' };
  if (deps.platform === 'darwin') {
    const fromLaunchd = deps.launchctlGetenv();
    if (fromLaunchd && deps.isSocket(fromLaunchd)) return { socket: fromLaunchd, source: 'launchd' };
  }
  return { socket: null, source: 'none' };
}

/** The environment for rehearse processes: the host's, with SSH_AUTH_SOCK set when an agent was found. */
export function serveEnv(env: NodeJS.ProcessEnv, agent: SshAgent): NodeJS.ProcessEnv {
  return agent.socket ? { ...env, SSH_AUTH_SOCK: agent.socket } : { ...env };
}
