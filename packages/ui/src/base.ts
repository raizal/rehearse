// Where the UI sends its requests (T67). Usually the UI page and `rehearse serve` have the same
// origin, so a relative path such as `api/epic` is correct. Through the relay of the bb plugin
// (packages/bb-plugin/src/relay.ts), the page has `<meta name="rehearse-base">`. Then each
// request goes to that base, with the serve path as an encoded query value.

const BASE_META = 'rehearse-base';

function relayBase(): string | null {
  if (typeof document === 'undefined') return null;
  const content = document.querySelector(`meta[name="${BASE_META}"]`)?.getAttribute('content');
  return content ? content : null;
}

/** True when the UI comes through the relay of the bb plugin. */
export function relayed(): boolean {
  return relayBase() !== null;
}

/** The address of a serve path such as `api/epic`. Without the relay, the path stays the same. */
export function at(path: string): string {
  const base = relayBase();
  if (base === null) return path;
  return `${base}${encodeURIComponent(`/${path.replace(/^\.?\//, '')}`)}`;
}
