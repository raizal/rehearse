// R20 (listen address), R12 (one UI and a read-only JSON API) and the scenario
// status the playback shows (approved, draft, stale via scenarioHash).

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scenarioHash } from '@rehearse/core';
import { makeEpic, REAL_EPIC, scenario, SHOP } from '../../core/test/helpers.js';
import { buildEpicView, LISTEN_HOST, scenarioStatus, startServer, type RunningServer } from '../src/index.js';

function fakeUi(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rehearse-ui-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="./assets/app.js"></script></body></html>');
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("app")');
  return dir;
}

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe('rehearse serve: HTTP server', () => {
  it('R20: listens on 127.0.0.1 only', async () => {
    running = await startServer({ epicDir: SHOP, uiDir: fakeUi(), port: 0 });
    const address = running.server.address();
    expect(LISTEN_HOST).toBe('127.0.0.1');
    expect(address).toMatchObject({ address: '127.0.0.1', family: 'IPv4' });
    expect(running.url).toBe(`http://127.0.0.1:${running.port}/`);
  });

  it('S4-A3: / returns the app page, and its assets load, with no header that blocks an iframe', async () => {
    running = await startServer({ epicDir: SHOP, uiDir: fakeUi(), port: 0 });
    const page = await fetch(running.url);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('x-frame-options')).toBeNull();
    expect(await page.text()).toContain('<div id="root">');
    const asset = await fetch(new URL('assets/app.js', running.url));
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    // A deep link is the same app page; a missing asset is a 404.
    expect(await (await fetch(new URL('flow/simulate', running.url))).text()).toContain('<div id="root">');
    expect((await fetch(new URL('assets/missing.js', running.url))).status).toBe(404);
  });

  it('GET /api/epic returns the loaded record, the validate report and scenario statuses as JSON', async () => {
    running = await startServer({ epicDir: SHOP, uiDir: fakeUi(), port: 0 });
    const res = await fetch(new URL('api/epic', running.url));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.slug).toBe('shop');
    expect(body.prd.epic.title).toBe('Shop checkout');
    expect(body.flow.lanes.map((l: { role: string }) => l.role)).toEqual(['buyer', 'shop']);
    expect(body.flow.root.boxes.find((b: { id: string }) => b.id === 'ship').children.boxes[0].path).toBe('ship/pack');
    expect(body.report).toEqual({ command: 'validate', ok: true, findings: [] });
    expect(body.scenarios.map((s: { scenario: { id: string }; status: string }) => [s.scenario.id, s.status])).toEqual([
      ['S1-buy', 'draft'],
      ['S1-empty', 'draft'],
      ['S2-out-of-stock', 'draft'],
    ]);
  });

  it('writes only through POST /api/approve and /api/sign-off: other methods get 405, and unknown API paths 404', async () => {
    running = await startServer({ epicDir: SHOP, uiDir: fakeUi(), port: 0 });
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect((await fetch(new URL('api/epic', running.url), { method })).status).toBe(405);
    }
    expect((await fetch(new URL('api/approve', running.url))).status).toBe(405);
    expect((await fetch(new URL('api/unknown', running.url))).status).toBe(404);
  });

  it('does not serve files outside the UI folder', async () => {
    running = await startServer({ epicDir: SHOP, uiDir: fakeUi(), port: 0 });
    const res = await fetch(new URL('%2e%2e/%2e%2e/etc/passwd', running.url));
    expect(await res.text()).not.toContain('root:');
  });

  it('serves a notice page when the UI is not built', async () => {
    running = await startServer({ epicDir: SHOP, uiDir: join(tmpdir(), 'rehearse-no-such-ui'), port: 0 });
    const page = await fetch(running.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('not built');
  });
});

describe('scenario status for playback badges', () => {
  it('approved with a matching hash is approved; a changed scenario is stale; draft stays draft', () => {
    const dir = makeEpic({
      edit: (d) => {
        const s = scenario(d, 'S1-empty');
        s.status = 'approved';
        s.approval = { by: 'a@b.c', at: '2026-11-05T00:00:00Z', hash: 'sha256:0' };
        const t = scenario(d, 'S2-out-of-stock');
        t.status = 'approved';
        t.approval = { by: 'a@b.c', at: '2026-11-05T00:00:00Z', hash: 'sha256:0' };
      },
    });
    // Put the right hash on S2-out-of-stock only.
    const first = buildEpicView(dir);
    const s2 = first.scenarios.find((s) => s.scenario.id === 'S2-out-of-stock')!;
    expect(s2.hash).toBe(scenarioHash(s2.scenario));
    s2.scenario.approval!.hash = s2.hash;
    expect(scenarioStatus(s2.scenario)).toBe('approved');

    const byId = Object.fromEntries(first.scenarios.map((s) => [s.scenario.id, s.status]));
    expect(byId).toEqual({ 'S1-buy': 'draft', 'S1-empty': 'stale', 'S2-out-of-stock': 'stale' });
    expect(scenarioStatus({ ...s2.scenario, status: 'stale' })).toBe('stale');
  });

  it('the bootstrap approvals of the real EPIC give a status for every scenario', () => {
    const view = buildEpicView(REAL_EPIC);
    expect(view.report.ok).toBe(true);
    const playback = view.scenarios.find((s) => s.scenario.id === 'S5-playback')!;
    expect(playback.file).toBe('scenarios/S5.yaml');
    expect(['approved', 'stale']).toContain(playback.status);
    expect(playback.status === 'approved').toBe(playback.scenario.approval?.hash === playback.hash);
  });
});
