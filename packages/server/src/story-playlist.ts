// The Birdview playlists of an EPIC, read from disk (T45): the record and the spec files of its
// test project, put together by buildPlaylist. `rehearse playlists`, `rehearse play` and the
// Tests tab all use these, so a playlist is the same wherever it is made.

import { loadEpic, type Id, type Scenario } from '@rehearse/core';
import { buildPlaylist, storiesWithTests, type PlaylistBuild } from './playlist.js';
import { specTests } from './story-progress.js';

function epicInputs(epicDir: string, projectDir: string) {
  const { record } = loadEpic(epicDir);
  const scenarios: Scenario[] = record.scenarioFiles.flatMap((f) => f.scenarios.map((s) => ({ ...s, story: s.story ?? f.story })));
  return { record, scenarios, specs: specTests(projectDir) };
}

/** One story's playlist: its scenarios that have a test in the test project, in record order. */
export function storyPlaylist(epicDir: string, projectDir: string, storyId: Id): PlaylistBuild {
  const { record, scenarios, specs } = epicInputs(epicDir, projectDir);
  return buildPlaylist(storyId, record.prd, scenarios, specs);
}

/** The playlist of every story with at least one test, in prd order. */
export function epicPlaylists(epicDir: string, projectDir: string): { slug: string; stories: { story: Id; build: PlaylistBuild }[] } {
  const { record, scenarios, specs } = epicInputs(epicDir, projectDir);
  const stories = storiesWithTests(record.prd, scenarios, specs).map((story) => ({ story, build: buildPlaylist(story, record.prd, scenarios, specs) }));
  return { slug: record.slug, stories };
}
