import { afterEach, describe, expect, it } from 'vitest';
import { createHostService, type HostService } from '../src/host-service.js';
import { FAKE_REHEARSE, listening, tempRepo } from './helpers.js';

const services: HostService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.stopAll()));
});

function service() {
  const s = createHostService({ findAgent: () => ({ socket: '/agent.sock', source: 'launchd' }) });
  services.push(s);
  return s;
}

describe('host service', () => {
  it('R12 the panel shows the URL that rehearse serve prints, so panel and browser show the same UI', async () => {
    const repo = tempRepo('2026-11-05-x');
    const opened = await service().open(repo, '2026-11-05-x', FAKE_REHEARSE);
    expect(opened.url).toBe(`http://127.0.0.1:${opened.port}/`);
    const page = await (await fetch(opened.url)).text();
    expect(page).toContain('data-slug="2026-11-05-x"');
  });

  it('S4-A3 the serve URL opens full screen in a plain browser tab, without bb', async () => {
    const repo = tempRepo('2026-11-05-x');
    const opened = await service().open(repo, '2026-11-05-x', FAKE_REHEARSE);
    const res = await fetch(opened.url, { headers: { accept: 'text/html' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('reuses the process for a second panel and stops it after both release', async () => {
    const s = service();
    const repo = tempRepo('e');
    const a = await s.open(repo, 'e', FAKE_REHEARSE);
    const b = await s.open(repo, 'e', FAKE_REHEARSE);
    expect(b).toMatchObject({ reused: true, port: a.port });
    expect(s.status().processes).toHaveLength(1);
    await s.release(a.leaseId);
    expect(await listening(a.port)).toBe(true);
    await s.release(b.leaseId);
    expect(await listening(a.port)).toBe(false);
  });

  it('gives serve the ssh-agent and reports it (D41)', async () => {
    const s = service();
    const opened = await s.open(tempRepo('e'), 'e', FAKE_REHEARSE);
    expect(opened.sshAgent).toEqual({ available: true, source: 'launchd' });
    const cli = await s.runCli(tempRepo(), ['validate', 'x'], FAKE_REHEARSE);
    expect(JSON.parse(cli.stdout).sshAuthSock).toBe('/agent.sock');
  });

  it('refuses a slug without an EPIC folder', async () => {
    await expect(service().open(tempRepo('e'), 'missing', FAKE_REHEARSE)).rejects.toThrow('no EPIC folder docs/epics/missing');
  });

  it('lists the EPIC folders', () => {
    expect(service().listEpics(tempRepo('b', 'a'))).toEqual(['a', 'b']);
    expect(service().listEpics(tempRepo())).toEqual([]);
  });
});
