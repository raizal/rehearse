// The Design tab's server side (T50): the story's design links, the linked PNGs and .figcraft
// files, the owner's Save (the only design write), and the FigCraft web build: fetched with a fake
// fetcher and a zip made here, checked against SHA256SUMS.txt, and hosted at /figcraft/.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeEpic } from '../../core/test/helpers.js';
import { ME } from '../../core/test/trust/helpers.js';
import { inRepo, VERIFIER } from '../../core/test/trust/keys.js';
import { FigcraftFetchError, fetchFigcraftWeb, installedFigcraftWeb, newToken, readZip, startServer, type Fetcher, type RunningServer, type ServerSession } from '../src/index.js';
import { fakeFetcher, fakeRelease, makeZip, sha256 } from './zip.js';

const UI = mkdtempSync(join(tmpdir(), 'rehearse-ui-'));
/** A FigCraft file (a zip with document.json): pages 1 Home, 2 Pay (frame "Pay form"), 3 Cart. */
const FIGCRAFT = makeZip([
  {
    name: 'document.json',
    data: JSON.stringify({
      pages: [1, 2, 3],
      nodes: {
        1: { type: 'page', name: 'Home', children: [] },
        2: { type: 'page', name: 'Pay', children: [20] },
        20: { type: 'frame', name: 'Pay form', children: [] },
        3: { type: 'page', name: 'Cart', children: [] },
      },
    }),
  },
]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const LINKS = `epics:
  2026-11-05-shop:
    S1:
      file: design/shop.figcraft
      page: 2
      png: design/s1.png
      boxes:
        cart: { file: design/shop.figcraft, page: Cart }
`;

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

/** The shop in a git repo, with design/links.yaml linking S1 to design/shop.figcraft and design/s1.png. */
function shopWithDesign(): { dir: string; top: string } {
  const dir = inRepo(makeEpic());
  const top = dirname(dir);
  mkdirSync(join(top, 'design'));
  writeFileSync(join(top, 'design', 'links.yaml'), LINKS);
  writeFileSync(join(top, 'design', 'shop.figcraft'), FIGCRAFT);
  writeFileSync(join(top, 'design', 'other.figcraft'), 'not linked');
  writeFileSync(join(top, 'design', 's1.png'), PNG);
  writeFileSync(join(top, 'design', 'loose.png'), PNG);
  return { dir, top };
}

async function serve(dir: string, figcraftFetcher?: Fetcher): Promise<{ url: string; token: string }> {
  const session: ServerSession = { token: newToken(), identity: ME, signer: { ok: false, reason: 'no key in this test' } };
  running = await startServer({ epicDir: dir, uiDir: UI, port: 0, session, verifier: VERIFIER, ...(figcraftFetcher ? { figcraftFetcher } : {}) });
  return { url: running.url, token: session.token };
}

function post(url: string, path: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return fetch(new URL(path, url), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

/** Every file under a folder with its bytes, to check that nothing else changed. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.name === '.git') continue;
      if (e.isDirectory()) walk(p);
      else out[p.slice(root.length + 1)] = readFileSync(p).toString('base64');
    }
  };
  walk(root);
  return out;
}

/** Install a fake web build of `version` under the repo's .rehearse/figcraft-web/. */
function installWeb(top: string, version: string): string {
  const dir = join(top, '.rehearse', 'figcraft-web', version);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), `<!doctype html><title>FigCraft ${version}</title>`);
  writeFileSync(join(dir, 'figcraft-web-abc.js'), 'export {};');
  writeFileSync(join(dir, 'figcraft-web-abc_bg.wasm'), Buffer.from([0, 97, 115, 109]));
  return dir;
}

describe('GET /api/design (T50, box design-tab)', () => {
  it('a linked story: its link, its boxes, no findings, the line to add, the FigCraft state and the author', async () => {
    const { dir } = shopWithDesign();
    const { url, token } = await serve(dir);
    const res = await fetch(new URL('api/design?story=S1', url), { headers: { 'x-rehearse-token': token } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      slug: '2026-11-05-shop',
      story: { file: 'design/shop.figcraft', page: 2, png: 'design/s1.png' },
      boxes: { cart: { file: 'design/shop.figcraft', page: 'Cart' } },
      findings: [],
      linksFile: 'design/links.yaml',
      linkLine: 'S1: { file: design/<name>.figcraft, page: <page number or name>, png: design/<page>.png }',
      figcraft: { fetched: false, url: '/figcraft/', command: 'rehearse figcraft fetch' },
      author: 'a@b.c',
    });
  });

  it('a story without a link: null and no boxes; the fetched version shows; a bad link is a finding of its story', async () => {
    const { dir, top } = shopWithDesign();
    installWeb(top, '0.15.2');
    installWeb(top, '0.16.0');
    writeFileSync(join(top, 'design', 'links.yaml'), `${LINKS}    S2: { file: design/gone.figcraft, page: 1 }\n`);
    const { url, token } = await serve(dir);
    const h = { 'x-rehearse-token': token };
    const s2 = await (await fetch(new URL('api/design?story=S2', url), { headers: h })).json();
    expect(s2).toMatchObject({ ok: true, story: { file: 'design/gone.figcraft', page: 1 }, boxes: {}, figcraft: { fetched: true, version: '0.16.0' } });
    expect(s2.findings.map((f: { message: string }) => f.message)).toEqual(['design/gone.figcraft does not exist']);
    // S1's answer leaves out S2's finding.
    expect((await (await fetch(new URL('api/design?story=S1', url), { headers: h })).json()).findings).toEqual([]);
    writeFileSync(join(top, 'design', 'links.yaml'), 'epics: {}\n');
    expect(await (await fetch(new URL('api/design?story=S1', url), { headers: h })).json()).toMatchObject({ ok: true, story: null, boxes: {}, findings: [] });
  });

  it('needs the token and a same-origin Origin; a bad or unknown story is refused', async () => {
    const { dir } = shopWithDesign();
    const { url, token } = await serve(dir);
    expect((await fetch(new URL('api/design?story=S1', url))).status).toBe(403);
    expect((await fetch(new URL('api/design?story=S1', url), { headers: { 'x-rehearse-token': token, origin: 'http://evil.example' } })).status).toBe(403);
    expect((await fetch(new URL('api/design?story=../x', url), { headers: { 'x-rehearse-token': token } })).status).toBe(400);
    expect((await fetch(new URL('api/design?story=S9', url), { headers: { 'x-rehearse-token': token } })).status).toBe(404);
  });
});

describe('the linked design files (T50)', () => {
  it('GET /design/<file>.png serves a PNG linked in links.yaml only, with no token', async () => {
    const { dir } = shopWithDesign();
    const { url } = await serve(dir);
    const ok = await fetch(new URL('design/s1.png', url));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(PNG);
    expect((await fetch(new URL('design/loose.png', url))).status).toBe(404);
    expect((await fetch(new URL('design/links.yaml', url))).status).toBe(404);
    expect((await fetch(new URL('design/..%2fdesign/s1.png', url))).status).toBe(404);
  });

  it('GET /api/design/file gives the bytes of a linked .figcraft only, with the token', async () => {
    const { dir } = shopWithDesign();
    const { url, token } = await serve(dir);
    const h = { 'x-rehearse-token': token };
    const ok = await fetch(new URL('api/design/file?file=design/shop.figcraft', url), { headers: h });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('application/octet-stream');
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(FIGCRAFT);
    expect((await fetch(new URL('api/design/file?file=design/shop.figcraft', url))).status).toBe(403);
    expect((await fetch(new URL('api/design/file?file=design/other.figcraft', url), { headers: h })).status).toBe(404);
    expect((await fetch(new URL('api/design/file?file=design/links.yaml', url), { headers: h })).status).toBe(404);
  });
});

describe('POST /api/design/save (T50, box design-save): the only design write', () => {
  const bytes = Buffer.from('FIGCRAFT-v2 saved by the owner');
  const good = { file: 'design/shop.figcraft', bytes: bytes.toString('base64') };

  it('writes the bytes of a linked file, and nothing else', async () => {
    const { dir, top } = shopWithDesign();
    const { url, token } = await serve(dir);
    const before = snapshot(top);
    const res = await post(url, 'api/design/save', good, { 'x-rehearse-token': token, origin: new URL(url).origin });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, file: 'design/shop.figcraft', size: bytes.length });
    expect(readFileSync(join(top, 'design', 'shop.figcraft'))).toEqual(bytes);
    expect(snapshot(top)).toEqual({ ...before, 'design/shop.figcraft': bytes.toString('base64') });
  });

  it('refuses without the token or from another Origin, and writes nothing', async () => {
    const { dir, top } = shopWithDesign();
    const { url, token } = await serve(dir);
    const before = snapshot(top);
    expect((await post(url, 'api/design/save', good, {})).status).toBe(403);
    expect((await post(url, 'api/design/save', good, { 'x-rehearse-token': 'nope' })).status).toBe(403);
    expect((await post(url, 'api/design/save', good, { 'x-rehearse-token': token, origin: 'http://evil.example' })).status).toBe(403);
    expect(snapshot(top)).toEqual(before);
  });

  it('refuses a path outside design/, not .figcraft, with `..`, absolute, or not linked, in plain words', async () => {
    const { dir, top } = shopWithDesign();
    const { url, token } = await serve(dir);
    const h = { 'x-rehearse-token': token };
    const before = snapshot(top);
    const b64 = bytes.toString('base64');
    for (const file of ['docs/shop.figcraft', 'design/s1.png', 'design/links.yaml', 'design/../design/shop.figcraft', '../design/shop.figcraft', '/tmp/design/shop.figcraft', 'design\\shop.figcraft']) {
      const res = await post(url, 'api/design/save', { file, bytes: b64 }, h);
      expect(res.status, file).toBe(400);
      expect(await res.json(), file).toMatchObject({ ok: false, reason: 'bad path' });
    }
    const unlinked = await post(url, 'api/design/save', { file: 'design/other.figcraft', bytes: b64 }, h);
    expect(unlinked.status).toBe(403);
    expect(await unlinked.json()).toEqual({ ok: false, reason: 'not linked', error: 'design/other.figcraft is not in design/links.yaml; only linked design files are saved' });
    for (const body of [{ file: 'design/shop.figcraft' }, { bytes: b64 }, { file: 'design/shop.figcraft', bytes: 'not base64!' }, { file: 'design/shop.figcraft', bytes: '' }]) {
      const res = await post(url, 'api/design/save', body, h);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).reason).toBe('bad body');
    }
    expect(snapshot(top)).toEqual(before);
  });

  it('refuses a linked file that is a symlink out of design/', async () => {
    const { dir, top } = shopWithDesign();
    const outside = join(mkdtempSync(join(tmpdir(), 'rehearse-outside-')), 'x.figcraft');
    writeFileSync(outside, 'outside');
    symlinkSync(outside, join(top, 'design', 'link.figcraft'));
    writeFileSync(join(top, 'design', 'links.yaml'), `${LINKS}    S2: { file: design/link.figcraft, page: 1 }\n`);
    const { url, token } = await serve(dir);
    const res = await post(url, 'api/design/save', { file: 'design/link.figcraft', bytes: bytes.toString('base64') }, { 'x-rehearse-token': token });
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe('outside design');
    expect(readFileSync(outside, 'utf8')).toBe('outside');
  });

  it('takes a body larger than the other POSTs (a real design file), up to its own limit', async () => {
    const { dir, top } = shopWithDesign();
    const { url, token } = await serve(dir);
    const big = Buffer.alloc(300 * 1024, 7);
    const res = await post(url, 'api/design/save', { file: 'design/shop.figcraft', bytes: big.toString('base64') }, { 'x-rehearse-token': token });
    expect(res.status).toBe(200);
    expect(readFileSync(join(top, 'design', 'shop.figcraft'))).toEqual(big);
  });
});

describe('GET /figcraft/ (T50, box figcraft-host)', () => {
  it('hosts the newest fetched build: wasm and js types, framed by this origin only', async () => {
    const { dir, top } = shopWithDesign();
    installWeb(top, '0.9.0');
    installWeb(top, '0.16.0');
    const { url } = await serve(dir);
    const index = await fetch(new URL('figcraft/?host=parent&author=a', url));
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('FigCraft 0.16.0');
    expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(index.headers.get('cache-control')).toBe('no-cache');
    expect(index.headers.get('content-security-policy')).toBe("frame-ancestors 'self'");
    expect(index.headers.get('x-frame-options')).toBeNull();
    const wasm = await fetch(new URL('figcraft/figcraft-web-abc_bg.wasm', url));
    expect(wasm.headers.get('content-type')).toBe('application/wasm');
    expect(wasm.headers.get('content-security-policy')).toBe("frame-ancestors 'self'");
    expect((await fetch(new URL('figcraft/figcraft-web-abc.js', url))).headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    const bare = await fetch(new URL('figcraft?host=parent', url), { redirect: 'manual' });
    expect(bare.status).toBe(301);
    expect(bare.headers.get('location')).toBe('/figcraft/?host=parent');
  });

  it('refuses paths out of the build folder', async () => {
    const { dir, top } = shopWithDesign();
    installWeb(top, '0.16.0');
    writeFileSync(join(top, '.rehearse', 'figcraft-web', 'secret.txt'), 'secret');
    const { url } = await serve(dir);
    for (const p of ['figcraft/%2e%2e/secret.txt', 'figcraft/..%2fsecret.txt', 'figcraft/%2e%2e/%2e%2e/%2e%2e/design/shop.figcraft', 'figcraft/nope.js']) {
      const res = await fetch(new URL(p, url));
      expect(res.status, p).toBe(404);
      expect(await res.text(), p).not.toContain('secret');
    }
  });

  it('not fetched: a page that says how to fetch it', async () => {
    const { dir } = shopWithDesign();
    const { url } = await serve(dir);
    const res = await fetch(new URL('figcraft/', url));
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('The FigCraft web build is not fetched. Run <code>rehearse figcraft fetch</code> (or the button on the Design tab), then reload.');
  });
});

describe('fetchFigcraftWeb (T50, box figcraft-host)', () => {
  const noApp = async () => undefined;

  it('a good hash: unpacked into .rehearse/figcraft-web/<v>/ with the top folder stripped', async () => {
    const top = mkdtempSync(join(tmpdir(), 'rehearse-fc-'));
    const { fetcher, urls } = fakeFetcher('0.16.0', fakeRelease('0.16.0'));
    const r = await fetchFigcraftWeb({ top, version: '0.16.0', fetcher });
    const dir = join(top, '.rehearse', 'figcraft-web', '0.16.0');
    expect(r).toMatchObject({ version: '0.16.0', dir });
    expect(readdirSync(dir).sort()).toEqual(['_headers', 'figcraft-web-abc123.js', 'figcraft-web-abc123_bg.wasm', 'index.html']);
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe('<!doctype html><title>FigCraft</title>');
    expect(readFileSync(join(dir, 'figcraft-web-abc123_bg.wasm'))).toEqual(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
    expect(readdirSync(join(top, '.rehearse', 'figcraft-web'))).toEqual(['0.16.0']);
    expect(urls).toEqual([
      'https://github.com/storytold/figcraft/releases/download/v0.16.0/SHA256SUMS.txt',
      'https://github.com/storytold/figcraft/releases/download/v0.16.0/figcraft-web-0.16.0.zip',
    ]);
    expect(installedFigcraftWeb(top)).toEqual({ version: '0.16.0', dir });
  });

  it('the version: the desktop app first, else the latest release tag', async () => {
    const top = mkdtempSync(join(tmpdir(), 'rehearse-fc-'));
    expect((await fetchFigcraftWeb({ top, ...fakeFetcher('0.16.0', fakeRelease('0.16.0')), appVersion: async () => '0.16.0' })).version).toBe('0.16.0');
    const latest = fakeFetcher('0.17.1', fakeRelease('0.17.1'));
    expect((await fetchFigcraftWeb({ top, fetcher: latest.fetcher, appVersion: noApp })).version).toBe('0.17.1');
    expect(latest.urls[0]).toBe('https://api.github.com/repos/storytold/figcraft/releases/latest');
    expect(installedFigcraftWeb(top)?.version).toBe('0.17.1');
  });

  it('a bad hash or no line: kind `hash mismatch`, both hashes in the message, and nothing on disk', async () => {
    const top = mkdtempSync(join(tmpdir(), 'rehearse-fc-'));
    const release = fakeRelease('0.16.0', { hash: 'a'.repeat(64) });
    const err = await fetchFigcraftWeb({ top, version: '0.16.0', fetcher: fakeFetcher('0.16.0', release).fetcher }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FigcraftFetchError);
    expect((err as FigcraftFetchError).kind).toBe('hash mismatch');
    expect((err as Error).message).toBe(`figcraft-web-0.16.0.zip has SHA-256 ${sha256(release.zip)}, but SHA256SUMS.txt says ${'a'.repeat(64)}. Nothing changed.`);
    expect(existsSync(join(top, '.rehearse'))).toBe(false);
    const noLine = { zip: release.zip, sums: `${sha256(release.zip)}  figcraft-web-0.15.0.zip\n` };
    const err2 = await fetchFigcraftWeb({ top, version: '0.16.0', fetcher: fakeFetcher('0.16.0', noLine).fetcher }).catch((e: unknown) => e);
    expect((err2 as FigcraftFetchError).kind).toBe('hash mismatch');
    expect(existsSync(join(top, '.rehearse'))).toBe(false);
  });

  it('a bad hash leaves an older copy of the same version as it was', async () => {
    const top = mkdtempSync(join(tmpdir(), 'rehearse-fc-'));
    const old = installWeb(top, '0.16.0');
    const before = snapshot(old);
    const err = await fetchFigcraftWeb({ top, version: '0.16.0', fetcher: fakeFetcher('0.16.0', fakeRelease('0.16.0', { hash: 'b'.repeat(64) })).fetcher }).catch((e: unknown) => e);
    expect((err as FigcraftFetchError).kind).toBe('hash mismatch');
    expect(snapshot(old)).toEqual(before);
    expect(readdirSync(join(top, '.rehearse', 'figcraft-web'))).toEqual(['0.16.0']);
    // A good fetch replaces it.
    await fetchFigcraftWeb({ top, version: '0.16.0', fetcher: fakeFetcher('0.16.0', fakeRelease('0.16.0')).fetcher });
    expect(readFileSync(join(old, 'index.html'), 'utf8')).toBe('<!doctype html><title>FigCraft</title>');
    expect(readdirSync(join(top, '.rehearse', 'figcraft-web'))).toEqual(['0.16.0']);
  });

  it('a zip with an unsafe path is refused, and nothing is unpacked', async () => {
    for (const name of ['../x', 'figcraft-web-0.16.0/../../x', '/etc/x', 'a\\b', 'C:/x']) {
      const top = mkdtempSync(join(tmpdir(), 'rehearse-fc-'));
      const release = fakeRelease('0.16.0', { entries: [{ name: 'figcraft-web-0.16.0/index.html', data: 'x' }, { name, data: 'evil' }] });
      const err = await fetchFigcraftWeb({ top, version: '0.16.0', fetcher: fakeFetcher('0.16.0', release).fetcher }).catch((e: unknown) => e);
      expect((err as FigcraftFetchError).kind, name).toBe('bad zip');
      expect(existsSync(join(top, '.rehearse')), name).toBe(false);
      expect(existsSync(join(dirname(top), 'x')), name).toBe(false);
    }
  });

  it('a network failure is kind `network`, in plain words', async () => {
    const top = mkdtempSync(join(tmpdir(), 'rehearse-fc-'));
    const err = await fetchFigcraftWeb({ top, version: '0.16.0', fetcher: async () => Promise.reject(new Error('ECONNREFUSED')) }).catch((e: unknown) => e);
    expect((err as FigcraftFetchError).kind).toBe('network');
    expect((err as Error).message).toBe('could not download https://github.com/storytold/figcraft/releases/download/v0.16.0/SHA256SUMS.txt: ECONNREFUSED');
    expect(existsSync(join(top, '.rehearse'))).toBe(false);
  });

  it('readZip: stored and deflate entries, a CRC check', () => {
    const zip = makeZip([{ name: 'a.txt', data: 'stored' }, { name: 'd/b.txt', data: 'deflated '.repeat(50), deflate: true }]);
    expect(readZip(zip).map((f) => [f.name, f.data.toString()])).toEqual([['a.txt', 'stored'], ['d/b.txt', 'deflated '.repeat(50)]]);
    const broken = Buffer.from(zip);
    broken[30 + 'a.txt'.length] = 'S'.charCodeAt(0);
    expect(() => readZip(broken)).toThrow('fails its CRC check');
  });
});

describe('POST /api/figcraft/fetch (T50): the owner button', () => {
  it('fetches with the server fetcher: 200 with the version; 409 on a bad hash; 502 on a network error; token needed', async () => {
    const { dir, top } = shopWithDesign();
    const release = fakeRelease('0.16.0');
    let fetcher: Fetcher = fakeFetcher('0.16.0', release).fetcher;
    const { url, token } = await serve(dir, (u) => fetcher(u));
    const h = { 'x-rehearse-token': token };
    expect((await post(url, 'api/figcraft/fetch', { version: '0.16.0' }, {})).status).toBe(403);
    expect((await post(url, 'api/figcraft/fetch', { version: '../x' }, h)).status).toBe(400);
    const ok = await post(url, 'api/figcraft/fetch', { version: '0.16.0' }, h);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, version: '0.16.0' });
    expect(existsSync(join(top, '.rehearse', 'figcraft-web', '0.16.0', 'index.html'))).toBe(true);
    expect((await fetch(new URL('figcraft/', url))).status).toBe(200);
    fetcher = fakeFetcher('0.17.0', fakeRelease('0.17.0', { hash: 'c'.repeat(64) })).fetcher;
    const bad = await post(url, 'api/figcraft/fetch', { version: '0.17.0' }, h);
    expect(bad.status).toBe(409);
    expect(await bad.json()).toMatchObject({ ok: false, reason: 'hash mismatch' });
    fetcher = async () => Promise.reject(new Error('offline'));
    const down = await post(url, 'api/figcraft/fetch', { version: '0.17.0' }, h);
    expect(down.status).toBe(502);
    expect(await down.json()).toMatchObject({ ok: false, reason: 'network' });
    expect(readdirSync(join(top, '.rehearse', 'figcraft-web'))).toEqual(['0.16.0']);
  });
});
