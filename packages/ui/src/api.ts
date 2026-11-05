// The UI reads one JSON document from `rehearse serve` (R12). The URL is
// relative, so the app also works behind a path prefix (bb panel, bb connect).

import type { EpicView } from '@rehearse/server';

export type { EpicView, ScenarioView } from '@rehearse/server';

export async function fetchEpic(): Promise<EpicView> {
  const res = await fetch('api/epic', { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET api/epic: HTTP ${res.status}`);
  return (await res.json()) as EpicView;
}
