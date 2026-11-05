import { describe, expect, it } from 'vitest';
import { findSshAgent, serveEnv, type SshAgentDeps } from '../src/ssh-agent.js';

const deps = (over: Partial<SshAgentDeps>): SshAgentDeps => ({
  platform: 'darwin',
  launchctlGetenv: () => '',
  isSocket: () => false,
  ...over,
});

describe('findSshAgent (D41)', () => {
  it('uses SSH_AUTH_SOCK when it is a socket', () => {
    expect(findSshAgent({ SSH_AUTH_SOCK: '/s' }, deps({ isSocket: (p) => p === '/s' }))).toEqual({ socket: '/s', source: 'env' });
  });
  it('falls back to the launchd agent on macOS', () => {
    const d = deps({ launchctlGetenv: () => '/launchd', isSocket: (p) => p === '/launchd' });
    expect(findSshAgent({ SSH_AUTH_SOCK: '/gone' }, d)).toEqual({ socket: '/launchd', source: 'launchd' });
    expect(findSshAgent({}, d)).toEqual({ socket: '/launchd', source: 'launchd' });
  });
  it('does not ask launchd on Linux', () => {
    const d = deps({ platform: 'linux', launchctlGetenv: () => '/launchd', isSocket: () => true });
    expect(findSshAgent({}, d)).toEqual({ socket: null, source: 'none' });
  });
  it('reports none when nothing is found', () => {
    expect(findSshAgent({}, deps({}))).toEqual({ socket: null, source: 'none' });
  });
});

describe('serveEnv', () => {
  it('sets SSH_AUTH_SOCK to the found agent and keeps the rest', () => {
    expect(serveEnv({ PATH: '/bin', SSH_AUTH_SOCK: '/old' }, { socket: '/new', source: 'launchd' })).toEqual({ PATH: '/bin', SSH_AUTH_SOCK: '/new' });
    expect(serveEnv({ PATH: '/bin' }, { socket: null, source: 'none' })).toEqual({ PATH: '/bin' });
  });
});
