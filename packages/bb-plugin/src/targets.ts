// Where things run. The plugin server may be on another machine than the repo, so
// every path is paired with the host (machine) that has it.

export interface HostPath {
  hostId: string;
  path: string;
}

export interface ProjectSource {
  hostId: string;
  path: string;
  isDefault: boolean;
}

/** The project's repo: its default source, else its first one. */
export function projectRepo(sources: readonly ProjectSource[]): HostPath | undefined {
  const source = sources.find((s) => s.isDefault) ?? sources[0];
  return source ? { hostId: source.hostId, path: source.path } : undefined;
}

/**
 * Where `bb rehearse <command>` runs: the caller's cwd when it is inside the
 * checkout (thread environment, else project repo), otherwise the checkout root.
 */
export function cliTarget(checkout: HostPath, cwd: string | undefined): HostPath {
  if (cwd && isInside(cwd, checkout.path)) return { hostId: checkout.hostId, path: cwd };
  return checkout;
}

function isInside(path: string, root: string): boolean {
  const r = root.endsWith('/') ? root.slice(0, -1) : root;
  return path === r || path.startsWith(r + '/');
}

/** The bb connect address of a loopback port on a host: `https://<label>--<port>.<domain>/`. */
export function sharedPortUrl(tunnel: { label: string; baseDomain: string }, port: number): string {
  return `https://${tunnel.label}--${port}.${tunnel.baseDomain}/`;
}
