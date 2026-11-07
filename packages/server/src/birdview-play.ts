// Play a story's e2e tests in Birdview with one call (T45). The player is shared by every project
// on the machine, so each call first switches it to this repo's test project, then writes the
// story playlist through the player (it lands in the project's playlists folder), then plays.
// One try only: a busy player (409) is said in plain words and the owner tries again; there is
// no queue and no retry here. `rehearse serve` (POST /api/birdview/*) and `rehearse play` use it.

import type { Id } from '@rehearse/core';
import { activeProject, defaultProject, httpPlayerClient, testKey, type BirdviewInfo, type BirdviewSetup, type PlayerClient, type PlayerProject, type PlayerReply } from './birdview.js';
import type { Playlist } from './playlist.js';
import { epicPlaylists, storyPlaylist } from './story-playlist.js';

/** Why a call did not happen, for the UI and the CLI. */
export type BirdviewFailure = 'busy' | 'off' | 'not-found' | 'bad-request' | 'refused';

export const BIRDVIEW_NOT_RUNNING = 'Birdview is not running; open it from the bb sidebar.';
export const BIRDVIEW_BUSY = 'Birdview is busy, try again.';

/** A call that did not happen: the HTTP status for `rehearse serve`, the kind, and plain words. */
export class BirdviewError extends Error {
  constructor(
    readonly status: number,
    readonly kind: BirdviewFailure,
    message: string,
  ) {
    super(message);
    this.name = 'BirdviewError';
  }
}

/** What a play did: the project the player switched to, the playlist it wrote, and what it plays. */
export interface PlayOutcome {
  project: PlayerProject;
  playlist: { id: string; name: string; tests: number };
  played: { playlist: string } | { keys: string[] };
  /** The player's project and playlist after the play, from its answer. */
  active?: BirdviewInfo['active'];
  /** Steps of a test that name a box its scenario does not walk (as `rehearse playlists` says). */
  problems: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The player's `{ "error": "…" }`, without its last full stop. */
function detail(body: unknown): string {
  const e = isObject(body) ? body.error : undefined;
  return typeof e === 'string' ? e.trim().replace(/\.$/, '') : '';
}

/** One player call, its answer mapped to plain words. `what` names the thing asked for ("the test x"). */
async function call(what: string, f: () => Promise<PlayerReply>): Promise<unknown> {
  let reply: PlayerReply;
  try {
    reply = await f();
  } catch {
    throw new BirdviewError(503, 'off', BIRDVIEW_NOT_RUNNING);
  }
  if (reply.status >= 200 && reply.status < 300) return reply.body;
  const why = detail(reply.body);
  const tail = why ? `: ${why}.` : '.';
  if (reply.status === 409) throw new BirdviewError(409, 'busy', why ? `${BIRDVIEW_BUSY} (${why})` : BIRDVIEW_BUSY);
  if (reply.status === 404) throw new BirdviewError(404, 'not-found', `Birdview could not find ${what}${tail}`);
  if (reply.status === 400) throw new BirdviewError(400, 'bad-request', `Birdview did not take ${what}${tail}`);
  if (reply.status === 403) throw new BirdviewError(502, 'refused', `Birdview refused the call from rehearse (it takes calls from its own host only)${tail}`);
  throw new BirdviewError(502, 'refused', `Birdview answered HTTP ${reply.status} for ${what}${tail}`);
}

function clientOf(setup: BirdviewSetup): PlayerClient {
  return setup.client ?? httpPlayerClient(setup.port);
}

/** This repo's test project, as the player is told it. */
function ourProject(setup: BirdviewSetup): PlayerProject {
  if (setup.projectDir === undefined) {
    throw new BirdviewError(404, 'not-found', 'This EPIC has no e2e test project (no e2e/playwright.config.ts above the EPIC folder).');
  }
  return { projectDir: setup.projectDir, ...(setup.playlistsDir ? { playlistsDir: setup.playlistsDir } : {}) };
}

/** Switch the player to a project. */
async function switchTo(client: PlayerClient, project: PlayerProject): Promise<void> {
  await call(`the test project ${project.projectDir}`, () => client.useProject(project));
}

/** Write a playlist through the player; its id and name as the player made them. */
async function write(client: PlayerClient, playlist: Playlist): Promise<{ id: string; name: string }> {
  const body = await call(`the playlist "${playlist.name}"`, () => client.writePlaylist(playlist));
  const b = isObject(body) ? body : {};
  const name = typeof b.name === 'string' && b.name !== '' ? b.name : playlist.name;
  return { id: typeof b.id === 'string' && b.id !== '' ? b.id : name, name };
}

/**
 * The one button: switch the player to this repo's test project, write the story playlist through
 * it, and play the playlist, or only `test` (a `file:line` key of the playlist).
 */
export async function playStory(setup: BirdviewSetup, epicDir: string, storyId: Id, test?: string): Promise<PlayOutcome> {
  const project = ourProject(setup);
  const { playlist, problems } = storyPlaylist(epicDir, project.projectDir, storyId);
  if (playlist.tests.length === 0) {
    throw new BirdviewError(404, 'not-found', `${storyId} has no e2e test yet: name a test in ${project.projectDir} after one of its scenario ids.`);
  }
  if (test !== undefined && !playlist.tests.some((t) => testKey(t) === test)) {
    throw new BirdviewError(400, 'bad-request', `${test} is not a test of ${storyId} (its tests: ${playlist.tests.map(testKey).join(', ')}).`);
  }
  const client = clientOf(setup);
  await switchTo(client, project);
  const written = await write(client, playlist);
  // By id: the player takes an exact id first, so an older file with the same name is not played.
  const played = test !== undefined ? { keys: [test] } : { playlist: written.id };
  const state = await call(test !== undefined ? `the test ${test}` : `the playlist "${written.name}"`, () => client.play(played));
  const active = activeProject(state);
  return { project, playlist: { ...written, tests: playlist.tests.length }, played, ...(active ? { active } : {}), problems };
}

/** Switch the player only: to this repo's test project, or back to the player's default project. */
export async function useProject(setup: BirdviewSetup, to: 'this' | 'default'): Promise<{ project: PlayerProject }> {
  const client = clientOf(setup);
  if (to === 'this') {
    const project = ourProject(setup);
    await switchTo(client, project);
    return { project };
  }
  const project = defaultProject(await call('its list of projects', () => client.projects()));
  if (!project) throw new BirdviewError(404, 'not-found', 'Birdview names no default project (its projectDir setting).');
  // Only the folder: the player keeps a known project's config and playlists folder, and refuses
  // a playlists folder outside the project (the default one may sit in the player's data folder).
  await switchTo(client, { projectDir: project.projectDir });
  return { project };
}

/** `rehearse playlists --push`: switch the player to the test project and write every story playlist through it. */
export async function pushPlaylists(
  setup: BirdviewSetup,
  epicDir: string,
): Promise<{ project: PlayerProject; slug: string; written: { story: Id; id: string; name: string; tests: number }[]; problems: string[] }> {
  const project = ourProject(setup);
  const { slug, stories } = epicPlaylists(epicDir, project.projectDir);
  if (stories.length === 0) throw new BirdviewError(404, 'not-found', `No test in ${project.projectDir} is named after a scenario of ${slug}.`);
  const client = clientOf(setup);
  await switchTo(client, project);
  const written = [];
  for (const { story, build } of stories) written.push({ story, ...(await write(client, build.playlist)), tests: build.playlist.tests.length });
  return { project, slug, written, problems: stories.flatMap((s) => s.build.problems) };
}
