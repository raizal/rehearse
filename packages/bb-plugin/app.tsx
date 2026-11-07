// bb-plugin-rehearse: the panel. It shows the `rehearse serve` UI in an iframe, so
// the panel and a browser tab on `rehearse serve` are the same UI (R12, D31).
//
// Route: /plugins/<pluginId>/rehearse/<projectId>/<slug>. A missing part shows a picker.
// With an EPIC open, a bar above the iframe switches EPIC or goes back to the picker.

import { useEffect, useState } from 'react';
import { definePluginApp, useBbContext, useBbNavigate, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import type { PluginNavPanelProps } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './server';
import { frameSrc, isLoopbackHost, parseSubPath, startServe, subPathForChoice, subPathOf, switcherOptions, type PanelRoute, type ServeSession } from './src/panel';

const PANEL_PATH = 'rehearse';
const OPEN_CHANNEL = 'open';

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function Picker({ title, items, onPick, onStatus, error }: { title: string; items: { id: string; label: string }[] | null; onPick: (id: string) => void; onStatus?: (id: string) => void; error: string | null }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3 p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {items === null && !error && <p className="text-sm opacity-70">Loading…</p>}
      {items?.length === 0 && <p className="text-sm opacity-70">Nothing here yet.</p>}
      <ul className="flex flex-col gap-1">
        {items?.map((item) => (
          <li key={item.id} className="flex items-center gap-1">
            <button type="button" className="min-w-0 flex-1 rounded px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10" onClick={() => onPick(item.id)}>
              {item.label}
            </button>
            {onStatus && (
              <button type="button" className="shrink-0 rounded px-2 py-2 text-xs opacity-80 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10" title="What is not done yet, per story" onClick={() => onStatus(item.id)}>
                Status
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProjectPicker({ rpc, onPick }: { rpc: Rpc; onPick: (projectId: string) => void }) {
  const [items, setItems] = useState<{ id: string; label: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    rpc.call('projects', null).then((r) => setItems(r.projects.map((p) => ({ id: p.id, label: p.name }))), (e) => setError(message(e)));
  }, [rpc]);
  return <Picker title="Pick a project" items={items} onPick={onPick} error={error} />;
}

function EpicPicker({ rpc, projectId, onPick, onStatus }: { rpc: Rpc; projectId: string; onPick: (slug: string) => void; onStatus: (slug: string) => void }) {
  const [items, setItems] = useState<{ id: string; label: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setItems(null);
    setError(null);
    rpc.call('epics', { projectId }).then((r) => setItems(r.slugs.map((s) => ({ id: s, label: s }))), (e) => setError(message(e)));
  }, [rpc, projectId]);
  return <Picker title="Pick an EPIC (docs/epics/*)" items={items} onPick={onPick} onStatus={onStatus} error={error} />;
}

/** Start or reuse the serve process, renew its lease while mounted, release it on unmount or slug change. */
function useServe(rpc: Rpc, projectId: string, slug: string): { session: ServeSession | null; error: string | null } {
  const [session, setSession] = useState<ServeSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const stop = startServe(
      { open: (input) => rpc.call('open', input), renew: (input) => rpc.call('renew', input), release: (input) => rpc.call('release', input) },
      { projectId, slug, local: isLoopbackHost(window.location.hostname) },
      {
        session: (s) => {
          setError(null);
          setSession(s);
        },
        error: setError,
      },
    );
    return () => {
      stop();
      setSession(null);
      setError(null);
    };
  }, [rpc, projectId, slug]);
  return { session, error };
}

/** A thin bar above the iframe: the open EPIC, a menu of every EPIC, and "All EPICs…" (the picker). */
function EpicSwitcher({ rpc, projectId, slug, onChoose }: { rpc: Rpc; projectId: string; slug: string; onChoose: (value: string) => void }) {
  const [slugs, setSlugs] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    rpc.call('epics', { projectId }).then(
      (r) => live && setSlugs(r.slugs),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [rpc, projectId]);
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
      <label htmlFor="rehearse-epic" className="opacity-70">
        EPIC
      </label>
      <select
        id="rehearse-epic"
        value={slug}
        onChange={(e) => onChoose(e.target.value)}
        className="min-w-0 max-w-full truncate rounded border border-black/10 bg-transparent px-1.5 py-0.5 text-xs dark:border-white/15"
      >
        {switcherOptions(slugs, slug).map((o) => (
          <option key={o.value || 'all'} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ServeFrame({ rpc, projectId, slug, view, onChoose }: { rpc: Rpc; projectId: string; slug: string; view: PanelRoute['view']; onChoose: (value: string) => void }) {
  const { session, error } = useServe(rpc, projectId, slug);
  let body;
  if (error) body = <p className="p-6 text-sm text-red-600">rehearse serve did not start: {error}</p>;
  else if (!session) body = <p className="p-6 text-sm opacity-70">Starting rehearse serve for {slug}…</p>;
  else if (!session.src) body = <p className="p-6 text-sm text-red-600">{session.remoteError}</p>;
  else body = <iframe key={session.leaseId} title={`rehearse ${slug}`} src={frameSrc(session.src, view)} className="min-h-0 w-full flex-1 border-0" />;
  return (
    <div className="flex h-full flex-col">
      <EpicSwitcher rpc={rpc} projectId={projectId} slug={slug} onChoose={onChoose} />
      {session?.src && !session.sshAgent && (
        <p className="px-3 py-1.5 text-xs text-amber-700">
          No ssh-agent found for the serve process: approvals cannot be signed (D41). Start ssh-agent with your signing key and reopen the panel.
        </p>
      )}
      {body}
    </div>
  );
}

function RehearsePanel({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const context = useBbContext();
  const navigate = useBbNavigate();
  const route = parseSubPath(subPath);
  const go = (projectId: string, slug: string | null, view?: 'status'): void => navigate.toPluginPanel(PANEL_PATH, { subPath: subPathOf({ projectId, slug, ...(view ? { view } : {}) }) });

  // The panel opened from a project: skip the project picker.
  const projectId = route.projectId ?? context.projectId;
  useEffect(() => {
    if (!route.projectId && context.projectId) navigate.toPluginPanel(PANEL_PATH, { subPath: context.projectId, replace: true });
  }, [route.projectId, context.projectId, navigate]);

  if (!projectId) return <ProjectPicker rpc={rpc} onPick={(id) => go(id, null)} />;
  if (!route.slug) return <EpicPicker rpc={rpc} projectId={projectId} onPick={(slug) => go(projectId, slug)} onStatus={(slug) => go(projectId, slug, 'status')} />;
  return <ServeFrame rpc={rpc} projectId={projectId} slug={route.slug} view={route.view} onChoose={(value) => navigate.toPluginPanel(PANEL_PATH, { subPath: subPathForChoice(projectId, value) })} />;
}

/** `bb rehearse open` publishes on OPEN_CHANNEL; an open bb window then shows the panel. */
function OpenListener() {
  const navigate = useBbNavigate();
  useRealtime(OPEN_CHANNEL, (payload) => {
    const subPath = (payload as { subPath?: unknown } | null)?.subPath;
    if (typeof subPath === 'string') navigate.toPluginPanel(PANEL_PATH, { subPath: subPathOf(parseSubPath(subPath)) });
  });
  return null;
}

export default definePluginApp((app) => {
  app.slots.navPanel({ id: 'rehearse', title: 'Rehearse', icon: 'Workflow', path: PANEL_PATH, component: RehearsePanel });
  app.slots.experimental_appOverlay({ id: 'rehearse-open', component: OpenListener });
});
