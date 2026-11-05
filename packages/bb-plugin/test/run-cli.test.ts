import { describe, expect, it } from 'vitest';
import { EXIT_INTERNAL, OUTPUT_LIMIT, runCli } from '../src/run-cli.js';
import { fakeInvocation, tempRepo } from './helpers.js';

describe('runCli: command pass-through', () => {
  it('runs rehearse with the arguments unchanged, in the given folder', async () => {
    const repo = tempRepo();
    const r = await runCli(fakeInvocation, ['gate', 'check', 'x', '--json'], repo, { ...process.env, SSH_AUTH_SOCK: '/agent' });
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ argv: ['gate', 'check', 'x', '--json'], cwd: repo, sshAuthSock: '/agent' });
  });

  it.each([0, 1, 2, 3])('keeps exit code %i', async (code) => {
    const r = await runCli(fakeInvocation, ['exit', String(code), 'out'], tempRepo(), process.env);
    expect(r).toEqual({ exitCode: code, stdout: 'out', stderr: '' });
  });

  it('exits 3 when rehearse cannot be started', async () => {
    const r = await runCli({ command: '/nonexistent/rehearse', prefix: [] }, ['validate', 'x'], tempRepo(), process.env);
    expect(r.exitCode).toBe(EXIT_INTERNAL);
    expect(r.stderr).toContain('cannot run /nonexistent/rehearse');
  });

  it('bounds the output under the bb CLI limit', async () => {
    const r = await runCli(fakeInvocation, ['big', String(OUTPUT_LIMIT + 1000)], tempRepo(), process.env);
    expect(r.stdout.length).toBeLessThan(OUTPUT_LIMIT + 200);
    expect(r.stdout).toContain('[bb rehearse: 1000 more bytes not shown]');
  });

  it('stops a command that runs too long', async () => {
    const r = await runCli(fakeInvocation, ['sleep'], tempRepo(), process.env, 300);
    expect(r.exitCode).toBe(EXIT_INTERNAL);
    expect(r.stderr).toContain('longer than 300 ms');
  });
});
