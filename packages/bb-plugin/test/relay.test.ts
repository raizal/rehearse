// T67: the relay to `rehearse serve`. A real HTTP server on 127.0.0.1 stands in for serve. The
// relay goes only to a known lease's port, and keeps the method, the headers and the body.

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPage, PAGE_CSP, relay, relayRoute, relayTarget, relayUrl, type RelayTarget } from '../src/relay.js';

const ROUTE = relayRoute('rehearse');
const BB = 'https://owner.getbb.app';

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

let server: Server;
let port: number;
const seen: Seen[] = [];
/** The events route waits for this before it sends its second event. */
let second: () => void = () => {};

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'a=b' });
        res.end('<!doctype html><html><head>\n<script type="module" src="./assets/index.js"></script><link rel="stylesheet" href="./assets/index.css"></head><body></body></html>');
      } else if (req.url === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: one\n\n');
        second = () => res.end('data: two\n\n');
      } else if (req.url === '/moved') {
        res.writeHead(302, { location: '/api/epic' });
        res.end();
      } else {
        res.writeHead(200, { 'content-type': 'application/json', 'x-from-serve': 'yes' });
        res.end(JSON.stringify({ ok: true }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const leases = (): Map<string, { port: number }> => new Map([['L1', { port }]]);
const find = (id: string) => leases().get(id);
const target = (path: string, lease = 'L1'): RelayTarget => relayTarget(new URL(`http://bb.test${relayUrl(ROUTE, lease, path)}`), find);
const ok = (path: string) => {
  const t = target(path);
  if (!t.ok) throw new Error(t.error);
  return t;
};

describe('relayTarget', () => {
  it('goes to the port of a known lease on 127.0.0.1, with the path and the query', () => {
    const t = ok('/api/graph?verb=near&id=a%2Fb');
    expect(t.url.href).toBe(`http://127.0.0.1:${port}/api/graph?verb=near&id=a%2Fb`);
  });

  it('refuses an unknown lease, and a lease of a serve process that is not on this machine', () => {
    expect(target('/api/epic', 'L2')).toMatchObject({ ok: false, status: 404 });
    expect(relayTarget(new URL(`http://bb.test${relayUrl(ROUTE, 'L1', '/')}`), () => undefined)).toMatchObject({ ok: false, status: 404 });
    expect(target('/api/epic', '../L1')).toMatchObject({ ok: false, status: 400 });
    expect(relayTarget(new URL(`http://bb.test${ROUTE}?path=%2F`), find)).toMatchObject({ ok: false, status: 400 });
  });

  it('refuses FigCraft: its downloaded build must not run on the bb origin', () => {
    for (const path of ['/figcraft', '/figcraft/', '/figcraft/index.html', '/figcraft?webgl']) expect(target(path), path).toMatchObject({ ok: false, status: 404 });
    // The API route that fetches the FigCraft build is not a FigCraft page.
    expect(target('/api/figcraft/fetch')).toMatchObject({ ok: true });
    expect(target('/figcraft-notes')).toMatchObject({ ok: true });
  });

  it('refuses other hosts and other ports', () => {
    for (const path of ['//evil.example/x', 'http://evil.example/', `http://127.0.0.1:${port + 1}/`, '/\\evil.example', 'api/epic', '', '/a\nb', `/${'a'.repeat(9000)}`]) {
      expect(target(path), path).toMatchObject({ ok: false, status: 400 });
    }
    expect(relayTarget(new URL(`http://bb.test${relayUrl(ROUTE, 'L1', '/')}`), () => ({ port: 0 }))).toMatchObject({ ok: false, status: 400 });
  });
});

describe('relay', () => {
  it('keeps the method, the headers and the body of a POST, and sets X-Forwarded-Host from the Origin', async () => {
    seen.length = 0;
    const request = new Request(`http://bb.test${relayUrl(ROUTE, 'L1', '/api/approve')}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-rehearse-token': 'tok',
        origin: BB,
        'sec-fetch-site': 'same-origin',
        cookie: 'bb_session=secret',
        authorization: 'Bearer secret',
        'x-forwarded-for': '10.0.0.1',
        'x-bb-user': 'someone',
      },
      body: JSON.stringify({ scenarioIds: ['S1-buy'] }),
    });
    const answer = await relay(request, ok('/api/approve'), { route: ROUTE });
    expect(answer.status).toBe(200);
    expect(answer.headers.get('x-from-serve')).toBe('yes');
    expect(await answer.json()).toEqual({ ok: true });
    const got = seen[0]!;
    expect(got.method).toBe('POST');
    expect(got.url).toBe('/api/approve');
    expect(got.body).toBe('{"scenarioIds":["S1-buy"]}');
    expect(got.headers['content-type']).toBe('application/json');
    expect(got.headers['x-rehearse-token']).toBe('tok');
    expect(got.headers.origin).toBe(BB);
    expect(got.headers['x-forwarded-host']).toBe('owner.getbb.app');
    expect(got.headers.host).toBe(`127.0.0.1:${port}`);
    // The bb login and the bb headers stay at the relay.
    expect(got.headers.cookie).toBeUndefined();
    expect(got.headers.authorization).toBeUndefined();
    expect(got.headers['x-forwarded-for']).toBeUndefined();
    expect(got.headers['x-bb-user']).toBeUndefined();
  });

  it('refuses a cross-site POST and other methods, and sends no request', async () => {
    seen.length = 0;
    const post = (site: string) =>
      new Request(`http://bb.test${relayUrl(ROUTE, 'L1', '/api/approve')}`, { method: 'POST', headers: { 'sec-fetch-site': site, origin: 'http://evil.example' }, body: '{}' });
    expect((await relay(post('cross-site'), ok('/api/approve'), { route: ROUTE })).status).toBe(403);
    expect((await relay(post('same-site'), ok('/api/approve'), { route: ROUTE })).status).toBe(403);
    const put = new Request(`http://bb.test${relayUrl(ROUTE, 'L1', '/api/approve')}`, { method: 'PUT', body: '{}' });
    const refused = await relay(put, ok('/api/approve'), { route: ROUTE });
    expect(refused.status).toBe(405);
    expect(refused.headers.get('allow')).toBe('GET, HEAD, POST');
    expect(seen).toHaveLength(0);
  });

  it('passes each event when it comes', async () => {
    const answer = await relay(new Request(`http://bb.test${relayUrl(ROUTE, 'L1', '/events')}`), ok('/events'), { route: ROUTE });
    expect(answer.headers.get('content-type')).toBe('text/event-stream');
    const reader = answer.body!.getReader();
    const text = new TextDecoder();
    // The first event arrives before serve sends the second one.
    expect(text.decode((await reader.read()).value)).toBe('data: one\n\n');
    second();
    let rest = '';
    for (let r = await reader.read(); !r.done; r = await reader.read()) rest += text.decode(r.value);
    expect(rest).toBe('data: two\n\n');
  });

  it('gives the UI page with its files and its requests through the relay, and no cookie of serve', async () => {
    const answer = await relay(new Request(`http://bb.test${relayUrl(ROUTE, 'L1', '/')}`), ok('/'), { route: ROUTE });
    expect(answer.headers.get('set-cookie')).toBeNull();
    expect(answer.headers.get('content-security-policy')).toBe(PAGE_CSP);
    const html = await answer.text();
    const base = `${ROUTE}?lease=L1&amp;path=`;
    expect(html).toContain(`<meta name="rehearse-base" content="${base}" />`);
    expect(html).toContain(`src="${base}${encodeURIComponent('/assets/index.js')}"`);
    expect(html).toContain(`href="${base}${encodeURIComponent('/assets/index.css')}"`);
    expect(html).not.toContain('"./assets');
  });

  it('sends a redirect of serve back through the relay', async () => {
    const answer = await relay(new Request(`http://bb.test${relayUrl(ROUTE, 'L1', '/moved')}`), ok('/moved'), { route: ROUTE });
    expect(answer.status).toBe(302);
    expect(answer.headers.get('location')).toBe(relayUrl(ROUTE, 'L1', '/api/epic'));
  });

  it('says so when serve does not answer', async () => {
    const t = relayTarget(new URL(`http://bb.test${relayUrl(ROUTE, 'L1', '/api/epic')}`), () => ({ port: 1 }));
    if (!t.ok) throw new Error(t.error);
    const answer = await relay(new Request('http://bb.test/'), t, { route: ROUTE, fetch: async () => Promise.reject(new Error('connect ECONNREFUSED')) });
    expect(answer.status).toBe(502);
    // The text does not show the address or the cause.
    expect(await answer.text()).toBe('rehearse serve did not answer\n');
  });
});

describe('appPage', () => {
  it('does not match a <header> tag as the head, and escapes the base', () => {
    const html = appPage('<header>x</header>', '/r', 'L"1');
    expect(html.startsWith('<meta name="rehearse-base" content="/r?lease=L%221&amp;path=" />')).toBe(true);
  });
});
