// T51 on the server: the Design tab's index, suggestions and links by frame name; the owner's link /
// change / unlink (`POST /api/design/link`), which rewrites design/links.yaml keeping its comments;
// and "Refresh pictures" (`POST /api/design/refresh`) against a fake FigCraft control server that
// records every call, so a test can check no command that changes a document is ever sent.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeEpic } from '../../core/test/helpers.js';
import { ME } from '../../core/test/trust/helpers.js';
import { inRepo, VERIFIER } from '../../core/test/trust/keys.js';
import { FIGCRAFT_NOT_RUNNING, isReadOnlyCall, newToken, startServer, type FigcraftControlAddress, type RunningServer, type ServerSession } from '../src/index.js';
import { makeZip } from './zip.js';

const UI = mkdtempSync(join(tmpdir(), 'rehearse-ui-'));
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

/** design/shop.figcraft: 1 Cart, 2 Pay (frames "Pay form", "[S2] Ship label"), 3 Ship order; a thumbnail. */
function shopFigcraft(extraFrame?: string): Buffer {
  const payChildren = [20, 21, ...(extraFrame ? [22] : [])];
  const nodes: Record<string, unknown> = {
    1: { type: 'page', name: '1 Cart', children: [10] },
    10: { type: 'frame', name: 'Cart', children: [] },
    2: { type: 'page', name: '2 Pay', children: payChildren },
    20: { type: 'frame', name: 'Pay form', children: [] },
    21: { type: 'frame', name: '[S2] Ship label', children: [] },
    3: { type: 'page', name: '3 Ship order', children: [] },
  };
  if (extraFrame) nodes[22] = { type: 'frame', name: extraFrame, children: [] };
  return makeZip([
    { name: 'document.json', data: JSON.stringify({ pages: [1, 2, 3], nodes }), deflate: true },
    { name: 'thumbnail.png', data: PNG },
  ]);
}

const LINKS = `# The owner's notes stay.
epics:
  2026-11-05-shop:
    # S1 pays.
    S1: { file: design/shop.figcraft, page: 1 } # cart first
  2026-01-01-other:
    S9: { file: design/shop.figcraft, page: 3 }
`;

let running: RunningServer | undefined;
const controls: Server[] = [];
afterEach(async () => {
  await running?.close();
  running = undefined;
  for (const c of controls.splice(0)) await new Promise((r) => c.close(r));
});

function shop(): { dir: string; top: string } {
  const dir = inRepo(makeEpic());
  const top = dirname(dir);
  mkdirSync(join(top, 'design'));
  writeFileSync(join(top, 'design', 'links.yaml'), LINKS);
  writeFileSync(join(top, 'design', 'shop.figcraft'), shopFigcraft());
  writeFileSync(join(top, 'design', 'broken.figcraft'), 'not a zip');
  writeFileSync(join(top, 'design', '1-cart.png'), PNG);
  return { dir, top };
}

async function serve(dir: string, figcraftControl?: FigcraftControlAddress): Promise<{ url: string; token: string }> {
  const session: ServerSession = { token: newToken(), identity: ME, signer: { ok: false, reason: 'no key in this test' } };
  running = await startServer({ epicDir: dir, uiDir: UI, port: 0, session, verifier: VERIFIER, ...(figcraftControl ? { figcraftControl } : {}) });
  return { url: running.url, token: session.token };
}

function post(url: string, path: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return fetch(new URL(path, url), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

const get = async (url: string, path: string, token: string) => (await fetch(new URL(path, url), { headers: { 'x-rehearse-token': token } })).json();

/** A fake FigCraft control port: answers doc.list with `docs` and ui.render with a PNG; records every call. */
async function fakeFigcraft(docs: unknown[], opts: { renderError?: string } = {}): Promise<{ addr: FigcraftControlAddress; calls: { method: string; params: unknown }[] }> {
  const calls: { method: string; params: unknown }[] = [];
  const server = createServer((sock) => {
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      const req = JSON.parse(buf.slice(0, nl)) as { id: number; method: string; params: { command?: string } };
      calls.push({ method: req.method, params: req.params });
      let answer: unknown;
      if (req.method === 'engine.execute' && req.params.command === 'doc.list') answer = { id: req.id, ok: true, result: docs };
      else if (req.method === 'ui.render') answer = opts.renderError ? { id: req.id, ok: false, error: opts.renderError } : { id: req.id, ok: true, result: { data: PNG.toString('base64') } };
      else answer = { id: req.id, ok: false, error: 'unknown' };
      sock.end(`${JSON.stringify(answer)}\n`);
    });
  });
  controls.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { addr: { host: '127.0.0.1', port, timeoutMs: 2000 }, calls };
}

/** A port nothing listens on. */
async function closedPort(): Promise<FigcraftControlAddress> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as { port: number }).port;
  await new Promise((r) => s.close(r));
  return { host: '127.0.0.1', port, timeoutMs: 2000 };
}

describe('GET /api/design with the design index (T51, boxes design-index, suggest-design, frame-tag-links)', () => {
  it('the picker: every design file under design/ with pages, frames and pictures; an unreadable file is left out', async () => {
    const { dir } = shop();
    const { url, token } = await serve(dir);
    const v = await get(url, 'api/design?story=S1', token);
    expect(v.index.map((f: { file: string }) => f.file)).toEqual(['design/shop.figcraft']);
    expect(v.index[0].pages.map((p: { number: number; name: string; png?: string }) => [p.number, p.name, p.png ?? null])).toEqual([
      [1, '1 Cart', 'design/1-cart.png'],
      [2, '2 Pay', null],
      [3, '3 Ship order', null],
    ]);
    expect(v.index[0].pages[1].frames).toEqual([
      { id: '20', name: 'Pay form' },
      { id: '21', name: '[S2] Ship label' },
    ]);
    expect(v.storySource).toEqual({ source: 'links.yaml' });
    expect(v.storyPicture).toEqual({ kind: 'page', png: 'design/1-cart.png' });
    expect(v.suggestions).toEqual([]);
  });

  it('an unlinked story gets ranked suggestions with a reason; a tagged frame links its story "by frame name"', async () => {
    const { dir } = shop();
    const { url, token } = await serve(dir);
    const s2 = await get(url, 'api/design?story=S2', token);
    // S2 is linked by the frame "[S2] Ship label": no suggestions for it.
    expect(s2.story).toEqual({ file: 'design/shop.figcraft', page: 2, frame: '[S2] Ship label' });
    expect(s2.storySource).toEqual({ source: 'frame name', frameName: '[S2] Ship label' });
    expect(s2.storyPicture).toEqual({ kind: 'file thumbnail', file: 'design/shop.figcraft' });
    expect(s2.suggestions).toEqual([]);
    // The boxes of S2 with no link get suggestions.
    const shipBox = Object.keys(s2.storyBoxes)[0]!;
    expect(s2.boxSuggestions[shipBox].length).toBeGreaterThan(0);
    expect(s2.boxSuggestions[shipBox][0]).toMatchObject({ file: 'design/shop.figcraft', page: 3, pageName: '3 Ship order', reason: expect.stringMatching(/^matches: /) });
  });

  it('the suggestions of an unlinked story: top 3, page and frame, never linked by themselves', async () => {
    const { dir, top } = shop();
    writeFileSync(join(top, 'design', 'links.yaml'), 'epics: {}\n');
    const before = readFileSync(join(top, 'design', 'links.yaml'), 'utf8');
    const { url, token } = await serve(dir);
    const s1 = await get(url, 'api/design?story=S1', token);
    expect(s1.story).toBeNull();
    expect(s1.suggestions.length).toBeGreaterThan(0);
    expect(s1.suggestions.length).toBeLessThanOrEqual(3);
    expect(s1.suggestions.map((x: { pageName: string; frame?: { name: string } }) => x.frame?.name ?? x.pageName)).toContain('Pay form');
    expect(readFileSync(join(top, 'design', 'links.yaml'), 'utf8')).toBe(before);
  });

  it('serves the thumbnail of an indexed file and the PNGs the index shows; nothing else', async () => {
    const { dir, top } = shop();
    writeFileSync(join(top, 'design', '3-ship-order.png'), PNG);
    const { url } = await serve(dir);
    const thumb = await fetch(new URL('design-thumbnail?file=design/shop.figcraft', url));
    expect(thumb.status).toBe(200);
    expect(Buffer.from(await thumb.arrayBuffer())).toEqual(PNG);
    for (const f of ['design/broken.figcraft', 'design/links.yaml', '../x.figcraft', 'design/none.figcraft']) expect((await fetch(new URL(`design-thumbnail?file=${encodeURIComponent(f)}`, url))).status, f).toBe(404);
    expect((await fetch(new URL('design/3-ship-order.png', url))).status).toBe(200);
    writeFileSync(join(top, 'design', 'loose.png'), PNG);
    expect((await fetch(new URL('design/loose.png', url))).status).toBe(404);
  });
});

describe('POST /api/design/link (T51, box link-design)', () => {
  it('links, changes and unlinks a story, keeping the comments and order of links.yaml', async () => {
    const { dir, top } = shop();
    const { url, token } = await serve(dir);
    const h = { 'x-rehearse-token': token };
    const linksFile = join(top, 'design', 'links.yaml');

    const add = await post(url, 'api/design/link', { epic: '2026-11-05-shop', story: 'S2', file: 'design/shop.figcraft', page: 3 }, h);
    expect(add.status).toBe(200);
    expect(await add.json()).toEqual({ ok: true, link: { file: 'design/shop.figcraft', page: 3 }, linksFile: 'design/links.yaml' });
    expect(readFileSync(linksFile, 'utf8')).toBe(LINKS.replace('    S1: { file: design/shop.figcraft, page: 1 } # cart first\n', '    S1: { file: design/shop.figcraft, page: 1 } # cart first\n    S2: { file: design/shop.figcraft, page: 3 }\n'));

    const change = await post(url, 'api/design/link', { epic: '2026-11-05-shop', story: 'S1', file: 'design/shop.figcraft', page: 2, frame: 'Pay form' }, h);
    expect((await change.json()).link).toEqual({ file: 'design/shop.figcraft', page: 2, frame: 'Pay form' });
    const text = readFileSync(linksFile, 'utf8');
    expect(text).toContain("# The owner's notes stay.\n");
    expect(text).toContain('    # S1 pays.\n    S1: { file: design/shop.figcraft, page: 2, frame: Pay form } # cart first\n');
    expect(text.indexOf('S1:')).toBeLessThan(text.indexOf('S2:'));
    expect(text).toContain('  2026-01-01-other:\n    S9: { file: design/shop.figcraft, page: 3 }\n');
    expect((await get(url, 'api/design?story=S1', token)).story).toEqual({ file: 'design/shop.figcraft', page: 2, frame: 'Pay form' });

    const un = await post(url, 'api/design/link', { epic: '2026-11-05-shop', story: 'S2', unlink: true }, h);
    expect(await un.json()).toEqual({ ok: true, link: null, linksFile: 'design/links.yaml' });
    expect(readFileSync(linksFile, 'utf8')).not.toContain('S2:');
  });

  it('links a box, with the page PNG as its picture; unlinking it leaves the story', async () => {
    const { dir, top } = shop();
    const { url, token } = await serve(dir);
    const h = { 'x-rehearse-token': token };
    const box = Object.keys((await get(url, 'api/design?story=S1', token)).storyBoxes)[0]!;
    const r = await post(url, 'api/design/link', { epic: '2026-11-05-shop', story: 'S1', box, file: 'design/shop.figcraft', page: 1 }, h);
    expect((await r.json()).link).toEqual({ file: 'design/shop.figcraft', page: 1, png: 'design/1-cart.png' });
    const v = await get(url, 'api/design?story=S1', token);
    expect(v.boxes[box]).toEqual({ file: 'design/shop.figcraft', page: 1, png: 'design/1-cart.png' });
    expect(v.boxSources[box]).toEqual({ source: 'links.yaml' });
    await post(url, 'api/design/link', { epic: '2026-11-05-shop', story: 'S1', box, unlink: true }, h);
    const after = readFileSync(join(top, 'design', 'links.yaml'), 'utf8');
    expect(after).toContain('S1:');
    expect(after).not.toContain(`${box}:`);
  });

  it('a links.yaml entry wins over a frame name: linking S2 explicitly replaces the frame-name link', async () => {
    const { dir } = shop();
    const { url, token } = await serve(dir);
    await post(url, 'api/design/link', { epic: '2026-11-05-shop', story: 'S2', file: 'design/shop.figcraft', page: 3 }, { 'x-rehearse-token': token });
    const v = await get(url, 'api/design?story=S2', token);
    expect(v.story).toEqual({ file: 'design/shop.figcraft', page: 3 });
    expect(v.storySource).toEqual({ source: 'links.yaml' });
  });

  it('refuses files outside design/ or not in the index, unknown pages, frames, stories, boxes and EPICs; links.yaml stays', async () => {
    const { dir, top } = shop();
    const { url, token } = await serve(dir);
    const h = { 'x-rehearse-token': token };
    const before = readFileSync(join(top, 'design', 'links.yaml'), 'utf8');
    const base = { epic: '2026-11-05-shop', story: 'S2', page: 1 };
    const cases: [unknown, number, string][] = [
      [{ ...base, file: '../secrets.figcraft' }, 400, 'file not in design/'],
      [{ ...base, file: 'design/../x.figcraft' }, 400, 'file not in design/'],
      [{ ...base, file: '/etc/x.figcraft' }, 400, 'file not in design/'],
      [{ ...base, file: 'design/links.yaml' }, 400, 'file not in design/'],
      [{ ...base, file: 'design/none.figcraft' }, 404, 'file not in design/'],
      [{ ...base, file: 'design/broken.figcraft' }, 404, 'file not in design/'],
      [{ ...base, file: 'design/shop.figcraft', page: 9 }, 404, 'unknown page'],
      [{ ...base, file: 'design/shop.figcraft', page: 2, frame: 'Nope' }, 404, 'unknown frame'],
      [{ ...base, story: 'S99', file: 'design/shop.figcraft' }, 404, 'unknown story'],
      [{ ...base, box: 'no-box', file: 'design/shop.figcraft' }, 404, 'unknown box'],
      [{ ...base, epic: '2026-01-01-other', file: 'design/shop.figcraft' }, 400, 'other epic'],
      [{ story: 'S2' }, 400, 'bad body'],
      [{ ...base, unlink: 'yes' }, 400, 'bad body'],
    ];
    for (const [body, status, reason] of cases) {
      const r = await post(url, 'api/design/link', body, h);
      expect([r.status, (await r.json()).reason], JSON.stringify(body)).toEqual([status, reason]);
    }
    expect(readFileSync(join(top, 'design', 'links.yaml'), 'utf8')).toBe(before);
  });

  it('refuses to write through a links.yaml symlinked out of design/, and an invalid links.yaml', async () => {
    const { dir, top } = shop();
    const outside = join(mkdtempSync(join(tmpdir(), 'rehearse-out-')), 'links.yaml');
    writeFileSync(outside, LINKS);
    const { rmSync } = await import('node:fs');
    rmSync(join(top, 'design', 'links.yaml'));
    symlinkSync(outside, join(top, 'design', 'links.yaml'));
    const { url, token } = await serve(dir);
    const h = { 'x-rehearse-token': token };
    const r = await post(url, 'api/design/link', { epic: '2026-11-05-shop', story: 'S2', file: 'design/shop.figcraft', page: 1 }, h);
    expect([r.status, (await r.json()).reason]).toEqual([403, 'outside design']);
    expect(readFileSync(outside, 'utf8')).toBe(LINKS);
    rmSync(join(top, 'design', 'links.yaml'));
    writeFileSync(join(top, 'design', 'links.yaml'), 'epics: [1]\n');
    const bad = await post(url, 'api/design/link', { epic: '2026-11-05-shop', story: 'S2', file: 'design/shop.figcraft', page: 1 }, h);
    expect([bad.status, (await bad.json()).reason]).toEqual([409, 'links.yaml invalid']);
  });

  it('makes design/links.yaml when it does not exist', async () => {
    const { dir, top } = shop();
    const { rmSync } = await import('node:fs');
    rmSync(join(top, 'design', 'links.yaml'));
    const { url, token } = await serve(dir);
    const r = await post(url, 'api/design/link', { epic: '2026-11-05-shop', story: 'S1', file: 'design/shop.figcraft', page: '2 Pay' }, { 'x-rehearse-token': token });
    expect(r.status).toBe(200);
    expect(readFileSync(join(top, 'design', 'links.yaml'), 'utf8')).toContain('epics:\n  2026-11-05-shop:\n    S1: { file: design/shop.figcraft, page: 2 }\n');
  });

  it('needs the token and a same-origin Origin', async () => {
    const { dir, top } = shop();
    const { url, token } = await serve(dir);
    const body = { epic: '2026-11-05-shop', story: 'S2', file: 'design/shop.figcraft', page: 1 };
    expect((await post(url, 'api/design/link', body, {})).status).toBe(403);
    expect((await post(url, 'api/design/link', body, { 'x-rehearse-token': 'wrong' })).status).toBe(403);
    expect((await post(url, 'api/design/link', body, { 'x-rehearse-token': token, origin: 'http://evil.example' })).status).toBe(403);
    expect((await fetch(new URL('api/design/link', url), { headers: { 'x-rehearse-token': token } })).status).toBe(405);
    expect(readFileSync(join(top, 'design', 'links.yaml'), 'utf8')).toBe(LINKS);
  });
});

describe('POST /api/design/refresh (T51, box refresh-design-pictures)', () => {
  const activeShop = (top: string) => [
    { id: 1, name: 'other', path: '/somewhere/else.figcraft', active: false, index: 0 },
    { id: 2, name: 'shop', path: realpathSync(join(top, 'design', 'shop.figcraft')), active: true, index: 1 },
  ];

  it('the linked file is the active tab: renders the page frame and a frame link, writes the PNGs, says what it wrote; read-only calls only', async () => {
    const { dir, top } = shop();
    const fig = await fakeFigcraft(activeShop(top));
    const { url, token } = await serve(dir, fig.addr);
    const h = { 'x-rehearse-token': token };
    const box = Object.keys((await get(url, 'api/design?story=S1', token)).storyBoxes)[0]!;
    await post(url, 'api/design/link', { epic: '2026-11-05-shop', story: 'S1', box, file: 'design/shop.figcraft', page: 2, frame: 'Pay form' }, h);
    const r = await post(url, 'api/design/refresh', { story: 'S1' }, h);
    expect(r.status).toBe(200);
    const out = await r.json();
    expect(out.wrote).toEqual(['design/1-cart.png', 'design/frames/pay-form.png']);
    expect(out.message).toBe('Wrote design/1-cart.png, design/frames/pay-form.png.');
    expect(readFileSync(join(top, 'design', 'frames', 'pay-form.png'))).toEqual(PNG);
    expect(fig.calls).toEqual([
      { method: 'engine.execute', params: { command: 'doc.list', params: {} } },
      { method: 'ui.render', params: { ids: [10], format: 'png', scale: 1 } },
      { method: 'ui.render', params: { ids: [20], format: 'png', scale: 1 } },
    ]);
    expect(fig.calls.every((c) => isReadOnlyCall(c.method, c.params))).toBe(true);
    // The new frame PNG is the picture of the frame in the index now.
    expect((await get(url, 'api/design?story=S1', token)).index[0].pages[1].frames[0]).toEqual({ id: '20', name: 'Pay form', png: 'design/frames/pay-form.png' });
  });

  it('the linked file is not the active tab: nothing rendered or written, "file not the active tab"', async () => {
    const { dir, top } = shop();
    const fig = await fakeFigcraft([{ id: 1, name: 'other', path: '/somewhere/else.figcraft', active: true, index: 0 }]);
    const { url, token } = await serve(dir, fig.addr);
    const r = await post(url, 'api/design/refresh', { story: 'S1' }, { 'x-rehearse-token': token });
    expect(r.status).toBe(409);
    const out = await r.json();
    expect(out.reason).toBe('file not the active tab');
    expect(out.error).toBe('design/shop.figcraft is not the active tab in FigCraft (the active tab is other); open it there, then refresh pictures');
    expect(fig.calls.map((c) => c.method)).toEqual(['engine.execute']);
    expect(existsSync(join(top, 'design', 'frames'))).toBe(false);
  });

  it('FigCraft not running: "Open the file in FigCraft (port 4800) to refresh pictures"', async () => {
    const { dir } = shop();
    const { url, token } = await serve(dir, await closedPort());
    const r = await post(url, 'api/design/refresh', { story: 'S1' }, { 'x-rehearse-token': token });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ ok: false, reason: 'FigCraft not running', error: FIGCRAFT_NOT_RUNNING });
    expect(FIGCRAFT_NOT_RUNNING).toBe('Open the file in FigCraft (port 4800) to refresh pictures');
  });

  it('a render FigCraft refuses is skipped and said; nothing linked or a bad body is refused; token and Origin', async () => {
    const { dir, top } = shop();
    const fig = await fakeFigcraft(activeShop(top), { renderError: 'no such node' });
    const { url, token } = await serve(dir, fig.addr);
    const h = { 'x-rehearse-token': token };
    const r = await post(url, 'api/design/refresh', { story: 'S1' }, h);
    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe('the story: FigCraft refused ui.render: no such node');
    writeFileSync(join(top, 'design', 'links.yaml'), 'epics: {}\n');
    writeFileSync(join(top, 'design', 'shop.figcraft'), shopFigcraft().subarray(0)); // no tag change; S1 has no link now
    expect((await post(url, 'api/design/refresh', { story: 'S1' }, h)).status).toBe(400);
    expect((await post(url, 'api/design/refresh', { story: '../x' }, h)).status).toBe(400);
    expect((await post(url, 'api/design/refresh', { story: 'S99' }, h)).status).toBe(404);
    expect((await post(url, 'api/design/refresh', { story: 'S1' }, {})).status).toBe(403);
    expect((await post(url, 'api/design/refresh', { story: 'S1' }, { ...h, origin: 'http://evil.example' })).status).toBe(403);
  });

  it('the client refuses any call that is not doc.list or ui.render', () => {
    expect(isReadOnlyCall('engine.execute', { command: 'doc.list', params: {} })).toBe(true);
    expect(isReadOnlyCall('ui.render', { ids: [1] })).toBe(true);
    for (const [m, p] of [
      ['engine.execute', { command: 'page.select', params: { id: 1 } }],
      ['engine.execute', { command: 'node.create' }],
      ['engine.execute', {}],
      ['command.batch', []],
      ['doc.save', {}],
    ] as const)
      expect(isReadOnlyCall(m, p), m).toBe(false);
  });
});
