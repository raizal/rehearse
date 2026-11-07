// Pure helpers of the panel (app.tsx), kept apart so they can be tested without bb.

/** The panel route remainder: `<projectId>/<slug>`, either part may be missing. */
export interface PanelRoute {
  projectId: string | null;
  slug: string | null;
  /** T58: open the EPIC on its Status page (`<project>/<slug>/status`). */
  view?: 'status';
}

export function parseSubPath(subPath: string): PanelRoute {
  const [projectId, slug, view] = subPath.split('/').filter((part) => part !== '');
  return { projectId: projectId ?? null, slug: slug ?? null, ...(slug && view === 'status' ? { view } : {}) };
}

export function subPathOf(route: PanelRoute): string {
  if (!route.projectId) return '';
  if (!route.slug) return route.projectId;
  return route.view === 'status' ? `${route.projectId}/${route.slug}/status` : `${route.projectId}/${route.slug}`;
}

/** The serve UI's address, on the Status page when the route asks for it (T58). */
export function frameSrc(src: string, view: PanelRoute['view']): string {
  return view === 'status' ? `${src.replace(/#.*$/, '')}#/status` : src;
}

/** True when the browser runs on the machine itself, so it can open 127.0.0.1 directly. */
export function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

/** Panels renew their lease this often; the host expires it after LEASE_TTL_MS. */
export const RENEW_EVERY_MS = 15_000;

/** The switcher's value for "All EPICs…": the route with no slug, which shows the picker. */
export const ALL_EPICS = '';

export interface SwitcherOption {
  value: string;
  label: string;
}

/** The switcher menu: every EPIC (the open one even when the list lacks it), then "All EPICs…". */
export function switcherOptions(slugs: readonly string[] | null, current: string): SwitcherOption[] {
  const all = slugs?.includes(current) ? slugs : [current, ...(slugs ?? [])];
  return [...all.map((slug) => ({ value: slug, label: slug })), { value: ALL_EPICS, label: 'All EPICs…' }];
}

/** Where a switcher choice goes: the EPIC's route, or the picker for "All EPICs…". */
export function subPathForChoice(projectId: string, value: string): string {
  return subPathOf({ projectId, slug: value === ALL_EPICS ? null : value });
}

export interface ServeSession {
  leaseId: string;
  src: string | null;
  remoteError: string | null;
  sshAgent: boolean;
}

/** The three lease RPCs the panel uses, so the lease logic runs without bb. */
export interface LeaseCalls {
  open(input: { projectId: string; slug: string; remote: boolean }): Promise<{ leaseId: string; url: string | null; localUrl: string; remoteError: string | null; sshAgent: boolean }>;
  renew(input: { leaseId: string }): Promise<{ alive: boolean }>;
  release(input: { leaseId: string }): Promise<unknown>;
}

/**
 * Start or reuse the serve process for one EPIC and renew its lease. The returned
 * stop() releases the lease; the panel calls it when the slug changes or it closes.
 */
export function startServe(
  calls: LeaseCalls,
  target: { projectId: string; slug: string; local: boolean },
  on: { session: (s: ServeSession) => void; error: (message: string) => void },
): () => void {
  let closed = false;
  let leaseId: string | null = null;
  const open = (): void => {
    calls.open({ projectId: target.projectId, slug: target.slug, remote: !target.local }).then(
      (r) => {
        if (closed) {
          void calls.release({ leaseId: r.leaseId }).catch(() => undefined);
          return;
        }
        leaseId = r.leaseId;
        on.session({ leaseId: r.leaseId, src: target.local ? r.localUrl : r.url, remoteError: r.remoteError, sshAgent: r.sshAgent });
      },
      (e: unknown) => !closed && on.error(e instanceof Error ? e.message : String(e)),
    );
  };
  open();
  const timer = setInterval(() => {
    if (!leaseId) return;
    calls.renew({ leaseId }).then(
      (r) => {
        // The process exited or the lease expired (sleep, network): start again.
        if (!r.alive && !closed) open();
      },
      () => undefined,
    );
  }, RENEW_EVERY_MS);
  return () => {
    closed = true;
    clearInterval(timer);
    if (leaseId) void calls.release({ leaseId }).catch(() => undefined);
  };
}
