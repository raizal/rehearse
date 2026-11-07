// The design, read only, where the owner decides (T50): beside the approve card of a scenario and in
// the sign-off preview of a story, the design PNG of the story next to the latest Birdview result
// of its tests, as the Tests tab knows it. In the box drawer, a box's own design page. Without a
// design link (or without the design API) these show nothing.
//
// T51: the box drawer also links a box without YAML: "Link a design" (the picker), the suggestions
// for the box, Change and Unlink. It shows for a box that serves the story when the server sends
// the design index.

import { useEffect, useMemo, useState } from 'react';
import type { Id } from '@rehearse/core';
import { fetchBirdview, type BirdviewInfo } from '../api.js';
import type { ReviewEpicView } from '../contract.js';
import { HTTP_DESIGN_API, type DesignApi, type DesignInfo, type DesignLinkView, type DesignTarget } from '../design-api.js';
import { latestRun, sourceWords } from '../model/design.js';
import { testRows } from '../model/tests.js';
import { DesignPicker, DesignSuggestions } from './DesignLinker.js';
import { DesignPicture, useDesign, useDesignLink } from './StoryDesign.js';

/** The story's design beside its latest test run; nothing when the story has no design link. */
export function DesignBeside({ view, storyId, api = HTTP_DESIGN_API }: { view: ReviewEpicView; storyId: Id; api?: DesignApi }) {
  const { load } = useDesign(storyId, api);
  const link = load.kind === 'ready' ? load.info.story : null;
  if (!link) return null;
  return <Beside view={view} storyId={storyId} link={link} />;
}

function Beside({ view, storyId, link }: { view: ReviewEpicView; storyId: Id; link: DesignLinkView }) {
  const [info, setInfo] = useState<BirdviewInfo | undefined>();
  const [read, setRead] = useState(false);
  useEffect(() => {
    let live = true;
    fetchBirdview(storyId).then(
      (i) => live && (setInfo(i), setRead(true)),
      () => live && setRead(true),
    );
    return () => {
      live = false;
    };
  }, [storyId]);
  const scenarios = useMemo(() => view.scenarios.map((sv) => sv.scenario).filter((s) => s.story === storyId), [view, storyId]);
  const run = useMemo(() => latestRun(testRows(scenarios, info)), [scenarios, info]);
  return (
    <section className="design-beside" data-testid={`design-beside-${storyId}`} aria-label={`Design of ${storyId} beside its latest test run`}>
      <div>
        <h4>Design</h4>
        <DesignPicture link={link} testId={`design-beside-picture-${storyId}`} />
      </div>
      <div data-testid={`design-beside-run-${storyId}`}>
        <h4>Latest test run</h4>
        {!read ? (
          <p className="muted small">Reading the player…</p>
        ) : !run.ran ? (
          <p className="muted small">{run.text}: no test of {storyId} has run in Birdview.</p>
        ) : (
          <>
            <p className="small">{run.text}.</p>
            <ul className="design-beside-runs">
              {run.rows.map((r) => (
                <li key={r.scenarioId} className="small">
                  <code>{r.scenarioId}</code> {r.words}
                  {r.reason && <span className="warn"> · {r.reason}</span>}
                </li>
              ))}
            </ul>
            {info && (
              <a className="small" href={info.playerUrl} target="_blank" rel="noopener noreferrer">
                Open the run in Birdview
              </a>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * A box's own design pages in the box drawer: for the story open now, else for each story the box
 * serves. With the design index (T51) an unlinked box can be linked here; without it, nothing
 * shows when no story links a page to this box.
 */
export function BoxDesign({ path, storyIds, api = HTTP_DESIGN_API }: { path: string; storyIds: Id[]; api?: DesignApi }) {
  const [infos, setInfos] = useState<{ storyId: Id; info: DesignInfo }[]>([]);
  const [n, setN] = useState(0);
  const key = storyIds.join(',');
  useEffect(() => {
    let live = true;
    const ids = key ? key.split(',') : [];
    void Promise.all(ids.map(async (storyId) => {
      const r = await api.design(storyId);
      return r.ok ? [{ storyId, info: r.body }] : [];
    })).then((all) => live && setInfos(all.flat()));
    return () => {
      live = false;
    };
  }, [api, key, path, n]);
  useEffect(() => setInfos([]), [key, path]);
  const reload = useMemo(() => () => setN((v) => v + 1), []);
  const shown = infos.filter(({ info }) => info.boxes[path] || (info.index !== undefined && info.storyBoxes?.[path] !== undefined));
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby="drawer-design-h" data-testid="drawer-design">
      <h3 id="drawer-design-h">Design</h3>
      {shown.map(({ storyId, info }) => (
        <div key={storyId}>
          {shown.length > 1 && <p className="small muted">For {storyId}:</p>}
          <BoxLink path={path} storyId={storyId} info={info} api={api} reload={reload} />
        </div>
      ))}
    </section>
  );
}

/** One story's link of the box: its picture with Change and Unlink, or the suggestions and the picker. */
function BoxLink({ path, storyId, info, api, reload }: { path: string; storyId: Id; info: DesignInfo; api: DesignApi; reload: () => void }) {
  const { msg, busy, link } = useDesignLink(api, reload);
  const [picking, setPicking] = useState(false);
  const current: DesignLinkView | undefined = info.boxes[path];
  const linkable = info.index !== undefined;
  const linkedBy = sourceWords(info.boxSources?.[path]);
  const testId = `drawer-design-${storyId}`;
  const pick = async (target: DesignTarget | null) => {
    if (await link({ epic: info.slug, story: storyId, box: path }, target)) setPicking(false);
  };
  return (
    <>
      {msg && (
        <p className={`small${msg.warn ? ' warn' : ''}`} role="status" data-testid={`${testId}-msg`}>
          {msg.text}
        </p>
      )}
      {current ? (
        <>
          {linkedBy && (
            <p className="small muted" data-testid={`${testId}-source`}>
              {linkedBy}
            </p>
          )}
          <DesignPicture link={current} testId={testId} picture={info.boxPictures?.[path]} />
          {linkable && (
            <div className="story-design-actions">
              <button type="button" className="action small" data-testid={`${testId}-change`} disabled={busy} onClick={() => setPicking((p) => !p)}>
                Change
              </button>
              {!linkedBy && (
                <button type="button" className="action small" data-testid={`${testId}-unlink`} disabled={busy} onClick={() => void pick(null)}>
                  Unlink
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="small" data-testid={`${testId}-none`}>
            No design linked to this box for {storyId}.
          </p>
          {!picking && (
            <button type="button" className="action small" data-testid={`${testId}-link-open`} disabled={busy} onClick={() => setPicking(true)}>
              Link a design
            </button>
          )}
          <DesignSuggestions suggestions={info.boxSuggestions?.[path]} busy={busy} onLink={(t) => void pick(t)} testId={`${testId}-suggested`} />
        </>
      )}
      {picking && <DesignPicker index={info.index ?? []} busy={busy} onPick={(t) => void pick(t)} onCancel={() => setPicking(false)} testId={`${testId}-picker`} />}
    </>
  );
}
