// The relay (T67): the rehearse UI and its API through one HTTP route of this plugin on the
// bb server. bb connect reaches the bb server already, so a phone needs no port share. The bb
// server host often has no bb connect machine credential, and a port share needs one.
//
// - bb plugin routes match an exact path only. So the relay is one route, and the request names
//   the lease and the serve path in the query: `<route>?lease=<id>&path=<serve path>`.
// - The relay goes only to 127.0.0.1, only to the port of a lease that this plugin started on the
//   bb server's machine. Any other lease, host or port gets an error and no request.
// - The page of the UI gets `<meta name="rehearse-base">`. The UI sends each request through
//   that address (packages/ui/src/base.ts). FigCraft does not go through the relay: its web build
//   loads its files by relative paths, and one exact route cannot serve them. Also, it is a
//   downloaded build, and the relay must not run it on the bb origin.
// - The UI page runs on the bb origin. So its answer gets a CSP: scripts only from this origin,
//   no inline script.

/** The route path, under `/api/v1/plugins/<id>/http`. */
export const RELAY_PATH = '/relay';
/** The methods of `rehearse serve`. The UI uses GET and POST only. */
export const RELAY_METHODS = ['GET', 'HEAD', 'POST'] as const;
/** The meta tag that tells the UI where to send its requests. */
export const BASE_META = 'rehearse-base';

const LOOPBACK = '127.0.0.1';
const LEASE_ID = /^[A-Za-z0-9-]{1,100}$/;
const MAX_PATH = 8192;
const FIGCRAFT = '/figcraft';
/** The CSP of the UI page through the relay. */
export const PAGE_CSP = "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'";

/** The address of the relay route on the bb server, as an absolute path. */
export function relayRoute(pluginId: string): string {
  return `/api/v1/plugins/${encodeURIComponent(pluginId)}/http${RELAY_PATH}`;
}

/** The relay address of one serve path of a lease. */
export function relayUrl(route: string, leaseId: string, path = '/'): string {
  return `${relayBase(route, leaseId)}${encodeURIComponent(path)}`;
}

/** The relay address without the path value: the UI adds the encoded path. */
export function relayBase(route: string, leaseId: string): string {
  return `${route}?lease=${encodeURIComponent(leaseId)}&path=`;
}

/** A lease that the relay can reach: a serve process on this machine. */
export interface RelayLease {
  port: number;
}

export type RelayTarget = { ok: true; leaseId: string; path: string; url: URL } | { ok: false; status: number; error: string };

/** Read the lease and the path of a relay request, and check them. No request goes out here. */
export function relayTarget(requestUrl: URL, find: (leaseId: string) => RelayLease | undefined): RelayTarget {
  const leaseId = requestUrl.searchParams.get('lease') ?? '';
  const path = requestUrl.searchParams.get('path') ?? '';
  if (!LEASE_ID.test(leaseId)) return { ok: false, status: 400, error: 'the relay needs a lease id' };
  const lease = find(leaseId);
  if (!lease) return { ok: false, status: 404, error: 'no rehearse serve process of this plugin has this lease on the bb server' };
  if (!Number.isInteger(lease.port) || lease.port < 1 || lease.port > 65535) return { ok: false, status: 400, error: 'the lease has no valid port' };
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path) || path.length > MAX_PATH) {
    return { ok: false, status: 400, error: 'the path must be a path of rehearse serve, such as /api/epic' };
  }
  if (path === FIGCRAFT || path.startsWith(`${FIGCRAFT}/`) || path.startsWith(`${FIGCRAFT}?`)) {
    return { ok: false, status: 404, error: 'FigCraft does not open through the relay' };
  }
  const origin = `http://${LOOPBACK}:${lease.port}`;
  let url: URL;
  try {
    url = new URL(path, origin);
  } catch {
    return { ok: false, status: 400, error: 'the path is not a valid path' };
  }
  if (url.origin !== origin) return { ok: false, status: 400, error: 'the relay goes only to the serve process of the lease' };
  return { ok: true, leaseId, path, url };
}

/** Request headers that stay at the relay: the connection, the bb login and the bb headers. */
const DROP_REQUEST = new Set([
  'host',
  'connection',
  'keep-alive',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'accept-encoding',
  'cookie',
  'authorization',
  'forwarded',
]);
const dropRequestHeader = (name: string): boolean => DROP_REQUEST.has(name) || name.startsWith('proxy-') || name.startsWith('x-forwarded-') || name.startsWith('x-bb-');

/** Response headers that stay at the relay. The serve process cannot set a cookie on the bb origin. */
const DROP_RESPONSE = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'content-encoding', 'set-cookie']);

export interface RelayOptions {
  /** The absolute path of the relay route (relayRoute). */
  route: string;
  fetch?: typeof fetch;
}

/**
 * Send one request to the serve process and give back its answer. The method, the headers
 * (except the ones in DROP_REQUEST) and the body stay the same. The answer body streams, so
 * events pass when they come.
 *
 * The Origin check of `rehearse serve` compares the Origin with the Host. Here the Host is
 * 127.0.0.1:<port>, and the Origin is the bb page. So the relay sets X-Forwarded-Host to the host
 * of the Origin. This is safe: bb checked the Origin before this route ran ("local" auth: only a
 * bb app origin), and the relay refuses a POST that the browser marks as cross-site.
 */
export async function relay(request: Request, target: Extract<RelayTarget, { ok: true }>, opts: RelayOptions): Promise<Response> {
  const method = request.method.toUpperCase();
  if (!(RELAY_METHODS as readonly string[]).includes(method)) return text(405, `the relay takes only ${RELAY_METHODS.join(', ')}`, { allow: RELAY_METHODS.join(', ') });
  // A request without Sec-Fetch-Site (an old browser, or no browser) passes this check. bb's
  // "local" auth and the session token of serve still protect it.
  const site = request.headers.get('sec-fetch-site');
  if (method === 'POST' && site !== null && site !== 'same-origin') return text(403, 'the relay takes a POST only from a page of the same origin');
  const headers = new Headers();
  request.headers.forEach((value, name) => {
    if (!dropRequestHeader(name)) headers.set(name, value);
  });
  const origin = request.headers.get('origin');
  if (origin !== null) {
    try {
      headers.set('x-forwarded-host', new URL(origin).host);
    } catch {
      return text(403, 'the Origin header is not a valid origin');
    }
  }
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();
  let answer: Response;
  try {
    answer = await (opts.fetch ?? fetch)(target.url, { method, headers, ...(body ? { body } : {}), redirect: 'manual' });
  } catch {
    return text(502, 'rehearse serve did not answer');
  }
  const out = new Headers();
  answer.headers.forEach((value, name) => {
    if (!DROP_RESPONSE.has(name)) out.set(name, value);
  });
  const location = answer.headers.get('location');
  if (location !== null && location.startsWith('/') && !location.startsWith('//')) out.set('location', relayUrl(opts.route, target.leaseId, location));
  if (method !== 'HEAD' && isAppPage(answer.headers.get('content-type'))) {
    out.set('content-security-policy', PAGE_CSP);
    return new Response(appPage(await answer.text(), opts.route, target.leaseId), { status: answer.status, headers: out });
  }
  return new Response(method === 'HEAD' ? null : answer.body, { status: answer.status, headers: out });
}

/** The UI page (index.html). relayTarget refuses the FigCraft pages. */
function isAppPage(type: string | null): boolean {
  return (type ?? '').toLowerCase().startsWith('text/html');
}

/** The UI page with its asset links through the relay, and the base for the UI's requests. */
export function appPage(html: string, route: string, leaseId: string): string {
  const base = escapeAttr(relayBase(route, leaseId));
  const linked = html.replace(/\b(src|href)="\.\/([^"]*)"/g, (_m, attr: string, rest: string) => `${attr}="${base}${encodeURIComponent(`/${rest}`)}"`);
  const meta = `<meta name="${BASE_META}" content="${base}" />`;
  return /<head(\s[^>]*)?>/i.test(linked) ? linked.replace(/<head(\s[^>]*)?>/i, (head) => `${head}\n    ${meta}`) : `${meta}\n${linked}`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function text(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(`${message}\n`, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}
