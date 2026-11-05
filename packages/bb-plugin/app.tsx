// bb-plugin-rehearse: the panel. It shows the `rehearse serve` UI in an iframe, so
// the panel and a browser tab on `rehearse serve` are the same UI (R12, D31).
//
// Route: /plugins/<pluginId>/rehearse/<projectId>/<slug>. A missing part shows a picker.

import { useEffect, useState } from 'react';
import { definePluginApp, useBbContext, useBbNavigate, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import type { PluginNavPanelProps } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './server';
import { isLoopbackHost, parseSubPath, RENEW_EVERY_MS, subPathOf } from './src/panel';

const PANEL_PATH = 'rehearse';
const OPEN_CHANNEL = 'open';

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function Picker({ title, items, onPick, error }: { title: string; items: { id: string; label: string }[] | null; onPick: (id: string) => void; error: string | null }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3 p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {items === null && !error && <p className="text-sm opacity-70">Loading…</p>}
      {items?.length === 0 && <p className="text-sm opacity-70">Nothing here yet.</p>}
      <ul className="flex flex-col gap-1">
        {items?.map((item) => (
          <li key={item.id}>
            <button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10" onClick={() => onPick(item.id)}>
              {item.label}
            </button>
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

function EpicPicker({ rpc, projectId, onPick }: { rpc: Rpc; projectId: string; onPick: (slug: string) => void }) {
  const [items, setItems] = useState<{ id: string; label: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setItems(null);
    setError(null);
    rpc.call('epics', { projectId }).then((r) => setItems(r.slugs.map((s) => ({ id: s, label: s }))), (e) => setError(message(e)));
  }, [rpc, projectId]);
  return <Picker title="Pick an EPIC (docs/epics/*)" items={items} onPick={onPick} error={error} />;
}

interface Session {
  leaseId: string;
  src: string | null;
  remoteError: string | null;
  sshAgent: boolean;
}

/** Start or reuse the serve process, renew its lease while mounted, release it on unmount. */
function useServe(rpc: Rpc, projectId: string, slug: string): { session: Session | null; error: string | null } {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let closed = false;
    let leaseId: string | null = null;
    const local = isLoopbackHost(window.location.hostname);
    const open = (): void => {
      rpc.call('open', { projectId, slug, remote: !local }).then(
        (r) => {
          if (closed) {
            void rpc.call('release', { leaseId: r.leaseId }).catch(() => undefined);
            return;
          }
          leaseId = r.leaseId;
          setError(null);
          setSession({ leaseId: r.leaseId, src: local ? r.localUrl : r.url, remoteError: r.remoteError, sshAgent: r.sshAgent });
        },
        (e) => !closed && setError(message(e)),
      );
    };
    open();
    const timer = setInterval(() => {
      if (!leaseId) return;
      rpc.call('renew', { leaseId }).then(
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
      if (leaseId) void rpc.call('release', { leaseId }).catch(() => undefined);
      setSession(null);
    };
  }, [rpc, projectId, slug]);
  return { session, error };
}

function ServeFrame({ rpc, projectId, slug }: { rpc: Rpc; projectId: string; slug: string }) {
  const { session, error } = useServe(rpc, projectId, slug);
  if (error) return <p className="p-6 text-sm text-red-600">rehearse serve did not start: {error}</p>;
  if (!session) return <p className="p-6 text-sm opacity-70">Starting rehearse serve for {slug}…</p>;
  if (!session.src) return <p className="p-6 text-sm text-red-600">{session.remoteError}</p>;
  return (
    <div className="flex h-full flex-col">
      {!session.sshAgent && (
        <p className="px-3 py-1.5 text-xs text-amber-700">
          No ssh-agent found for the serve process: approvals cannot be signed (D41). Start ssh-agent with your signing key and reopen the panel.
        </p>
      )}
      <iframe key={session.leaseId} title={`rehearse ${slug}`} src={session.src} className="min-h-0 w-full flex-1 border-0" />
    </div>
  );
}

function RehearsePanel({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const context = useBbContext();
  const navigate = useBbNavigate();
  const route = parseSubPath(subPath);
  const go = (projectId: string, slug: string | null): void => navigate.toPluginPanel(PANEL_PATH, { subPath: subPathOf({ projectId, slug }) });

  // The panel opened from a project: skip the project picker.
  const projectId = route.projectId ?? context.projectId;
  useEffect(() => {
    if (!route.projectId && context.projectId) navigate.toPluginPanel(PANEL_PATH, { subPath: context.projectId, replace: true });
  }, [route.projectId, context.projectId, navigate]);

  if (!projectId) return <ProjectPicker rpc={rpc} onPick={(id) => go(id, null)} />;
  if (!route.slug) return <EpicPicker rpc={rpc} projectId={projectId} onPick={(slug) => go(projectId, slug)} />;
  return <ServeFrame rpc={rpc} projectId={projectId} slug={route.slug} />;
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
