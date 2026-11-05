// Pure helpers of the panel (app.tsx), kept apart so they can be tested without bb.

/** The panel route remainder: `<projectId>/<slug>`, either part may be missing. */
export interface PanelRoute {
  projectId: string | null;
  slug: string | null;
}

export function parseSubPath(subPath: string): PanelRoute {
  const [projectId, slug] = subPath.split('/').filter((part) => part !== '');
  return { projectId: projectId ?? null, slug: slug ?? null };
}

export function subPathOf(route: PanelRoute): string {
  if (!route.projectId) return '';
  return route.slug ? `${route.projectId}/${route.slug}` : route.projectId;
}

/** True when the browser runs on the machine itself, so it can open 127.0.0.1 directly. */
export function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

/** Panels renew their lease this often; the host expires it after LEASE_TTL_MS. */
export const RENEW_EVERY_MS = 15_000;
