// The design, read only, where the owner decides (T50): beside the approve card of a scenario and in
// the sign-off preview of a story, the design PNG of the story next to the latest Birdview result
// of its tests, as the Tests tab knows it. In the box drawer, a box's own design page. Without a
// design link (or without the design API) these show nothing.

import { useEffect, useMemo, useState } from 'react';
import type { Id } from '@rehearse/core';
import { fetchBirdview, type BirdviewInfo } from '../api.js';
import type { ReviewEpicView } from '../contract.js';
import { HTTP_DESIGN_API, type DesignApi, type DesignLinkView } from '../design-api.js';
import { latestRun } from '../model/design.js';
import { testRows } from '../model/tests.js';
import { DesignPicture, useDesign } from './StoryDesign.js';

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
 * A box's own design pages, read only, in the box drawer: for the story open now, else for each
 * story the box serves. Nothing when no story links a page to this box.
 */
export function BoxDesign({ path, storyIds, api = HTTP_DESIGN_API }: { path: string; storyIds: Id[]; api?: DesignApi }) {
  const [links, setLinks] = useState<{ storyId: Id; link: DesignLinkView }[]>([]);
  const key = storyIds.join(',');
  useEffect(() => {
    let live = true;
    setLinks([]);
    const ids = key ? key.split(',') : [];
    void Promise.all(ids.map(async (storyId) => {
      const r = await api.design(storyId);
      const link = r.ok ? r.body.boxes[path] : undefined;
      return link ? [{ storyId, link }] : [];
    })).then((all) => live && setLinks(all.flat()));
    return () => {
      live = false;
    };
  }, [api, key, path]);
  if (links.length === 0) return null;
  return (
    <section aria-labelledby="drawer-design-h" data-testid="drawer-design">
      <h3 id="drawer-design-h">Design</h3>
      {links.map(({ storyId, link }) => (
        <div key={storyId}>
          {links.length > 1 && <p className="small muted">For {storyId}:</p>}
          <DesignPicture link={link} testId={`drawer-design-${storyId}`} />
        </div>
      ))}
    </section>
  );
}
