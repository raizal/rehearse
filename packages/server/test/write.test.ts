// The write API of `rehearse serve` (R13, R14, D41): session token, Origin check, approve and
// sign-off as the server's identity with the server's key, and the trust state in /api/epic.
// Throwaway keys only (see core/test/trust/keys.ts).

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RECORD_FILES } from '@rehearse/core';
import { makeEpic, REAL_EPIC, unsignedApprovals, unsignedRealEpic } from '../../core/test/helpers.js';
import { approvedEpic, ME, SHOP_SCENARIOS } from '../../core/test/trust/helpers.js';
import { inRepo, KEY, STRANGER, VERIFIER } from '../../core/test/trust/keys.js';
import { newToken, startServer, type RunningServer, type ServerSession } from '../src/index.js';

const UI = mkdtempSync(join(tmpdir(), 'rehearse-ui-'));

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

function session(signer: ServerSession['signer'] = { ok: true, signer: KEY.signer }): ServerSession {
  return { token: newToken(), identity: ME, signer };
}

async function serve(epicDir: string, s: ServerSession = session()): Promise<{ url: string; token: string }> {
  running = await startServer({ epicDir, uiDir: UI, port: 0, session: s, verifier: VERIFIER });
  return { url: running.url, token: s.token };
}

function post(url: string, path: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return fetch(new URL(path, url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function scenarioFile(dir: string): string {
  return readFileSync(join(dir, 'scenarios', 'S1.yaml'), 'utf8');
}

describe('rehearse serve: session and request checks', () => {
  it('R13: GET /api/session returns a random token, the server identity and the signing key fingerprint', async () => {
    const dir = inRepo(makeEpic());
    const s = session();
    const { url } = await serve(dir, s);
    const body = await (await fetch(new URL('api/session', url))).json();
    expect(body).toEqual({ token: s.token, identity: ME, signing: { ok: true, keyFingerprint: KEY.signer.keyFingerprint } });
    expect(s.token).toMatch(/^[0-9a-f]{64}$/);
    expect(newToken()).not.toBe(s.token);

    await running!.close();
    const off = session({ ok: false, reason: 'git user.signingkey is not set (see docs/signing.md)' });
    const { url: url2 } = await serve(dir, off);
    expect((await (await fetch(new URL('api/session', url2))).json()).signing).toEqual({ ok: false, reason: 'git user.signingkey is not set (see docs/signing.md)' });
  });

  it('R13: a default session takes a new token on each server start', async () => {
    // No global or system git config, so the test does not read the user's real signing key.
    const noConfig = join(mkdtempSync(join(tmpdir(), 'rehearse-gitconfig-')), 'config');
    writeFileSync(noConfig, '');
    vi.stubEnv('GIT_CONFIG_GLOBAL', noConfig);
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    const dir = inRepo(makeEpic());
    running = await startServer({ epicDir: dir, uiDir: UI, port: 0 });
    const a = (await (await fetch(new URL('api/session', running.url))).json()).token;
    await running.close();
    running = await startServer({ epicDir: dir, uiDir: UI, port: 0 });
    const b = (await (await fetch(new URL('api/session', running.url))).json()).token;
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).not.toBe(a);
    vi.unstubAllEnvs();
  });

  it('R13: a POST without the token, with a wrong token or from another Origin gets 403 and writes nothing', async () => {
    const dir = inRepo(makeEpic());
    const { url, token } = await serve(dir);
    const before = scenarioFile(dir);
    const body = { scenarioIds: ['S1-buy'] };
    expect((await post(url, 'api/approve', body, {})).status).toBe(403);
    expect((await post(url, 'api/approve', body, { 'x-rehearse-token': 'nope' })).status).toBe(403);
    expect((await post(url, 'api/approve', body, { 'x-rehearse-token': token, origin: 'http://evil.example' })).status).toBe(403);
    expect((await post(url, 'api/sign-off', { storyIds: ['S1'] }, { 'x-rehearse-token': token, origin: 'null' })).status).toBe(403);
    expect(scenarioFile(dir)).toBe(before);
    // The same Origin as the Host passes.
    const ok = await post(url, 'api/approve', body, { 'x-rehearse-token': token, origin: new URL(url).origin });
    expect(ok.status).toBe(200);
  });

  it('R13: JSON bodies only; wrong methods get 405 and unknown API paths 404', async () => {
    const dir = inRepo(makeEpic());
    const { url, token } = await serve(dir);
    const h = { 'x-rehearse-token': token };
    expect((await post(url, 'api/approve', 'scenarioIds=S1-buy', { ...h, 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415);
    expect((await post(url, 'api/approve', '{not json', h)).status).toBe(400);
    expect((await post(url, 'api/approve', { scenarioIds: 'S1-buy' }, h)).status).toBe(400);
    expect((await post(url, 'api/sign-off', { storyIds: [1] }, h)).status).toBe(400);
    expect((await post(url, 'api/approve', { scenarioIds: ['x'.repeat(70 * 1024)] }, h)).status).toBe(413);
    for (const method of ['PUT', 'PATCH', 'DELETE', 'POST']) {
      expect((await fetch(new URL('api/epic', url), { method, headers: h })).status).toBe(405);
      expect((await fetch(new URL('api/session', url), { method, headers: h })).status).toBe(405);
    }
    const get = await fetch(new URL('api/approve', url));
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect((await fetch(new URL('api/sign-off', url))).status).toBe(405);
    expect((await post(url, 'api/nope', {}, h)).status).toBe(404);
    expect((await fetch(new URL('api/nope', url))).status).toBe(404);
    expect((await post(url, 'index.html', {}, h)).status).toBe(405);
  });
});

describe('rehearse serve: approve and sign-off', () => {
  it('S6-A1: POST /api/approve approves as the server identity, with a valid signature', async () => {
    const dir = inRepo(makeEpic());
    const { url, token } = await serve(dir);
    // A `by` in the body is ignored: the identity is the server's.
    const res = await post(url, 'api/approve', { scenarioIds: ['S1-buy'], by: 'mallory@evil.example' }, { 'x-rehearse-token': token });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.approved).toHaveLength(1);
    expect(body.approved[0]).toMatchObject({ id: 'S1-buy', file: 'scenarios/S1.yaml', approval: { by: ME.by, threadId: ME.threadId } });
    expect(body.approved[0].approval.hash).toMatch(/^sha256:/);
    expect(body.approved[0].approval.sig).toContain('-----BEGIN SSH SIGNATURE-----');
    expect(scenarioFile(dir)).not.toContain('mallory');

    const view = await (await fetch(new URL('api/epic', url))).json();
    expect(view.approvals['S1-buy']).toMatchObject({ by: ME.by, sigStatus: 'valid', signer: KEY.signer.keyFingerprint });
    expect(view.scenarios.find((s: { scenario: { id: string } }) => s.scenario.id === 'S1-buy').status).toBe('approved');
  });

  it('S6-A1: POST /api/approve of an unknown scenario gets 409 with the findings and writes nothing', async () => {
    const dir = inRepo(makeEpic());
    const { url, token } = await serve(dir);
    const before = scenarioFile(dir);
    const res = await post(url, 'api/approve', { scenarioIds: ['S1-buy', 'S9-nope'] }, { 'x-rehearse-token': token });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.findings.map((f: { message: string }) => f.message)).toContain('scenario S9-nope unknown');
    expect(scenarioFile(dir)).toBe(before);
  });

  it('D41: with no usable signing key, approve and sign-off get 503 with the reason and write nothing', async () => {
    const dir = inRepo(makeEpic());
    const before = scenarioFile(dir);
    const { url, token } = await serve(dir, session({ ok: false, reason: 'git gpg.format is not ssh (see docs/signing.md)' }));
    for (const [path, body] of [['api/approve', { scenarioIds: ['S1-buy'] }], ['api/sign-off', { storyIds: ['S1'] }]] as const) {
      const res = await post(url, path, body, { 'x-rehearse-token': token });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, reason: 'git gpg.format is not ssh (see docs/signing.md)' });
    }
    await running!.close();
    // A key that allowed_signers does not list for the identity.
    const { url: url2, token: token2 } = await serve(dir, session({ ok: true, signer: STRANGER.signer }));
    const res = await post(url2, 'api/approve', { scenarioIds: ['S1-buy'] }, { 'x-rehearse-token': token2 });
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe(`key ${STRANGER.signer.keyFingerprint} is not in .rehearse/allowed_signers for a@b.c (see docs/signing.md)`);
    expect(scenarioFile(dir)).toBe(before);
    expect(existsSync(join(dir, RECORD_FILES.signoff))).toBe(false);
  });

  it('S9-A1: POST /api/sign-off fails with 409 and lists the gate findings', async () => {
    const dir = inRepo(makeEpic());
    const { url, token } = await serve(dir);
    const res = await post(url, 'api/sign-off', { storyIds: ['S1'] }, { 'x-rehearse-token': token });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.findings.length).toBeGreaterThan(0);
    expect(body.findings.every((f: { kind: string }) => typeof f.kind === 'string')).toBe(true);
    expect(existsSync(join(dir, RECORD_FILES.signoff))).toBe(false);
  });

  it('S9-A2: POST /api/sign-off records who, when, a hash per story and a valid signature', async () => {
    const dir = approvedEpic();
    const { url, token } = await serve(dir);
    const res = await post(url, 'api/sign-off', { storyIds: ['S1', 'S2'] }, { 'x-rehearse-token': token });
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.signOff).toMatchObject({ by: ME.by, threadId: ME.threadId, hashRule: 3 });
    expect(Object.keys(body.signOff.storyHashes).sort()).toEqual(['S1', 'S2']);
    expect(body.signOff.sig).toContain('-----BEGIN SSH SIGNATURE-----');

    const view = await (await fetch(new URL('api/epic', url))).json();
    expect(view.signOffs).toHaveLength(1);
    expect(view.signOffs[0]).toMatchObject({ by: ME.by, sigStatus: 'valid', signer: KEY.signer.keyFingerprint });
    expect(view.gate.signers).toEqual([{ by: ME.by, fingerprint: KEY.signer.keyFingerprint, approvals: SHOP_SCENARIOS, signOffs: [0] }]);
  });
});

describe('rehearse serve: GET /api/epic trust state', () => {
  it('R14: /api/epic adds the gate (with simulate), readiness, the permission matrix, approvals and sign-offs', async () => {
    const dir = approvedEpic();
    const { url } = await serve(dir);
    const view = await (await fetch(new URL('api/epic', url))).json();
    expect(view.slug).toBe('2026-11-05-shop');
    expect(view.gate).toMatchObject({ command: 'gate', simulation: 'simulate' });
    expect(Array.isArray(view.gate.findings)).toBe(true);
    expect(view.readiness).toBeTypeOf('object');
    expect(view.simulation.permissionMatrix).toBeTypeOf('object');
    expect(view.simulation.permissionBoxes).toBeTypeOf('object');
    expect(Object.keys(view.approvals).sort()).toEqual(SHOP_SCENARIOS);
    for (const id of SHOP_SCENARIOS) expect(view.approvals[id]).toMatchObject({ by: ME.by, sigStatus: 'valid', signer: KEY.signer.keyFingerprint });
    expect(view.signOffs).toEqual([]);
  });

  it('S6-A1: an approval that the server cannot verify shows its sigStatus and a gate finding', async () => {
    const dir = approvedEpic();
    // Verify against an allowed_signers that lists another key for a@b.c.
    running = await startServer({ epicDir: inRepo(dir, `a@b.c namespaces="rehearse" ${STRANGER.pub}\n`), uiDir: UI, port: 0, session: session() });
    const view = await (await fetch(new URL('api/epic', running.url))).json();
    expect(view.approvals['S1-buy']).toMatchObject({ sigStatus: 'unknown-signer', signer: KEY.signer.keyFingerprint });
    expect(view.gate.ok).toBe(false);
    expect(view.gate.findings.map((f: { message: string }) => f.message)).toContain(
      `approval of S1-buy by a@b.c is not evidence: sigStatus unknown-signer: the key is not in .rehearse/allowed_signers for this email (key ${KEY.signer.keyFingerprint}); approve it again in the UI`,
    );
  });

  it('D41: on the real EPIC, /api/epic reports every approval without a signature as unsigned', async () => {
    // The real record: each approval that carries no sig (the bootstrap ones) is not valid.
    running = await startServer({ epicDir: REAL_EPIC, uiDir: UI, port: 0, session: session({ ok: false, reason: 'test' }) });
    const real = await (await fetch(new URL('api/epic', running.url))).json();
    const noSig = unsignedApprovals(REAL_EPIC);
    for (const id of noSig) expect(real.approvals[id]?.sigStatus, id).toBe('missing');
    await running.close();
    // The same record with every signature removed: nothing is evidence, whatever the owner signed.
    running = await startServer({ epicDir: unsignedRealEpic(), uiDir: UI, port: 0, session: session({ ok: false, reason: 'test' }) });
    const view = await (await fetch(new URL('api/epic', running.url))).json();
    const unsigned = view.gate.findings.filter((f: { message: string }) => f.message.includes('is not evidence: sigStatus missing'));
    const missing = Object.values(view.approvals).filter((a) => (a as { sigStatus: string }).sigStatus === 'missing');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing).toHaveLength(Object.keys(view.approvals).length);
    expect(unsigned.length).toBeGreaterThan(0);
    expect(view.gate.signers).toEqual([]);
  });

  it('S8-A1 (C28): readiness counts only approvals with a valid signature as proof', async () => {
    // The real EPIC with its signatures removed: every requirement loses its proof.
    running = await startServer({ epicDir: unsignedRealEpic(), uiDir: UI, port: 0, session: session({ ok: false, reason: 'test' }) });
    const view = await (await fetch(new URL('api/epic', running.url))).json();
    expect(view.readiness.noProof.length).toBe(view.readiness.requirements.length);
    expect(view.readiness.noProof[0]).toMatchObject({ reason: 'approval-not-signed' });
    expect(view.readiness.noProof[0].message).toMatch(/^approval not signed: .*\(signature missing\)/);
  });

  it('S8-A1 (C28): with signed approvals, readiness proves the requirements and names the sigStatus of each scenario', async () => {
    const { url } = await serve(approvedEpic());
    const view = await (await fetch(new URL('api/epic', url))).json();
    expect(view.readiness.noProof).toEqual([]);
    expect(view.readiness.requirements[0].stories[0].scenarios[0]).toMatchObject({ status: 'approved', sigStatus: 'valid' });
  });
});
