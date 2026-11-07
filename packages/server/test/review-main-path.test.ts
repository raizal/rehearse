// T57 on the server: the owner picks a story's main path (`POST /api/review/main-path`). It needs the
// token and a same-origin Origin, refuses bad bodies, unknown stories and scenarios of another
// story, keeps every comment of review.yaml, and the view sends the picks (`review.mainPath`).

import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeEpic } from '../../core/test/helpers.js';
import { ME } from '../../core/test/trust/helpers.js';
import { inRepo, VERIFIER } from '../../core/test/trust/keys.js';
import { buildEpicView, newToken, startServer, type RunningServer, type ServerSession } from '../src/index.js';

const UI = mkdtempSync(join(tmpdir(), 'rehearse-ui-'));
const EPIC = '2026-11-05-shop';

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function serve(dir: string): Promise<{ url: string; token: string }> {
  const session: ServerSession = { token: newToken(), identity: ME, signer: { ok: false, reason: 'no key in this test' } };
  running = await startServer({ epicDir: dir, uiDir: UI, port: 0, session, verifier: VERIFIER });
  return { url: running.url, token: session.token };
}

function post(url: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return fetch(new URL('api/review/main-path', url), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

const REVIEW = `# The owner's notes stay.
mainPath:
  # S2 has one scenario.
  S2: S2-out-of-stock # picked by hand
`;

describe('POST /api/review/main-path (T57, box pick-main-path)', () => {
  it('writes the pick into review.yaml, keeping its comments; the view sends it', async () => {
    const dir = inRepo(makeEpic());
    writeFileSync(join(dir, 'review.yaml'), REVIEW);
    const { url, token } = await serve(dir);
    const r = await post(url, { epic: EPIC, story: 'S1', scenario: 'S1-empty' }, { 'x-rehearse-token': token });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, story: 'S1', scenario: 'S1-empty', reviewFile: 'review.yaml' });
    const text = readFileSync(join(dir, 'review.yaml'), 'utf8');
    expect(text).toBe(`# The owner's notes stay.
mainPath:
  # S2 has one scenario.
  S2: S2-out-of-stock # picked by hand
  S1: S1-empty
`);
    expect(buildEpicView(dir).review).toEqual({ mainPath: { S1: 'S1-empty', S2: 'S2-out-of-stock' } });
  });

  it('makes review.yaml when it does not exist; a view without one sends no review', async () => {
    const dir = inRepo(makeEpic());
    expect(buildEpicView(dir).review).toBeUndefined();
    const { url, token } = await serve(dir);
    expect((await post(url, { epic: EPIC, story: 'S1', scenario: 'S1-buy' }, { 'x-rehearse-token': token })).status).toBe(200);
    const text = readFileSync(join(dir, 'review.yaml'), 'utf8');
    expect(text).toContain('# The owner\'s review choices (T57)');
    expect(text).toContain('mainPath:\n  S1: S1-buy\n');
  });

  it('refuses a bad body, another EPIC, an unknown story and a scenario that is not of the story; writes nothing', async () => {
    const dir = inRepo(makeEpic());
    const { url, token } = await serve(dir);
    const h = { 'x-rehearse-token': token };
    const out = async (body: unknown) => {
      const r = await post(url, body, h);
      return [r.status, ((await r.json()) as { reason?: string }).reason];
    };
    expect(await out({ epic: EPIC, story: 'S1' })).toEqual([400, 'bad body']);
    expect(await out({ epic: 'other', story: 'S1', scenario: 'S1-buy' })).toEqual([400, 'other epic']);
    expect(await out({ epic: EPIC, story: 'S9', scenario: 'S1-buy' })).toEqual([404, 'unknown story']);
    expect(await out({ epic: EPIC, story: 'S1', scenario: 'S2-out-of-stock' })).toEqual([404, 'unknown scenario']);
    expect(existsSync(join(dir, 'review.yaml'))).toBe(false);
  });

  it('refuses a review.yaml that is not valid YAML, or a symlink', async () => {
    const dir = inRepo(makeEpic());
    writeFileSync(join(dir, 'review.yaml'), 'mainPath: [unclosed\n');
    const { url, token } = await serve(dir);
    const r = await post(url, { epic: EPIC, story: 'S1', scenario: 'S1-buy' }, { 'x-rehearse-token': token });
    expect([r.status, ((await r.json()) as { reason: string }).reason]).toEqual([409, 'review.yaml invalid']);
    expect(readFileSync(join(dir, 'review.yaml'), 'utf8')).toBe('mainPath: [unclosed\n');
    const other = join(mkdtempSync(join(tmpdir(), 'rehearse-out-')), 'x.yaml');
    writeFileSync(other, REVIEW);
    const { rmSync } = await import('node:fs');
    rmSync(join(dir, 'review.yaml'));
    symlinkSync(other, join(dir, 'review.yaml'));
    const s = await post(url, { epic: EPIC, story: 'S1', scenario: 'S1-buy' }, { 'x-rehearse-token': token });
    expect(s.status).toBe(403);
    expect(readFileSync(other, 'utf8')).toBe(REVIEW);
  });

  it('needs the token and a same-origin Origin, and a JSON body; GET is not allowed', async () => {
    const dir = inRepo(makeEpic());
    writeFileSync(join(dir, 'review.yaml'), REVIEW);
    const { url, token } = await serve(dir);
    const body = { epic: EPIC, story: 'S1', scenario: 'S1-empty' };
    expect((await post(url, body, {})).status).toBe(403);
    expect((await post(url, body, { 'x-rehearse-token': 'wrong' })).status).toBe(403);
    expect((await post(url, body, { 'x-rehearse-token': token, origin: 'http://evil.example' })).status).toBe(403);
    expect((await post(url, body, { 'x-rehearse-token': token, 'content-type': 'text/plain' })).status).toBe(415);
    expect((await fetch(new URL('api/review/main-path', url), { headers: { 'x-rehearse-token': token } })).status).toBe(405);
    expect(readFileSync(join(dir, 'review.yaml'), 'utf8')).toBe(REVIEW);
  });
});
