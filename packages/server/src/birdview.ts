// The Birdview e2e player, seen from `rehearse serve` (T13, T45). The UI never calls the player
// across origins: the server reads it on a fixed loopback host and calls it only for the routes in
// PLAYER_ACTIONS (birdview-play.ts). The player's /api/state has the run, the results, the active
// project and the shown playlist; older players name the project only in the first `config` event
// of their /events stream.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Id } from '@rehearse/core';
import { parsePlaylist, type Playlist } from './playlist.js';
import { storyPlaylist } from './story-playlist.js';

export const DEFAULT_BIRDVIEW_PORT = 3298;
/** The only host the proxy talks to. */
export const PLAYER_HOST = '127.0.0.1';
/** What the UI may ask of the player, each through `POST /api/birdview/<action>` (T45). */
export const PLAYER_ACTIONS = ['play-story', 'play-test', 'use-project'] as const;
export type PlayerAction = (typeof PLAYER_ACTIONS)[number];

/** A player answer: the HTTP status and the JSON body (undefined when it is not JSON). */
export interface PlayerReply {
  status: number;
  body: unknown;
}

/** A test project as the player names it. */
export interface PlayerProject {
  projectDir: string;
  config?: string;
  playlistsDir?: string;
}

/** Talks to one running player. Every call throws when the player does not answer. Tests use a fake. */
export interface PlayerClient {
  /** `GET /api/state`. */
  state(): Promise<unknown>;
  /** The `config` and `playlists` events at the start of `/events?lite`. */
  setup(): Promise<{ config?: unknown; playlists?: unknown }>;
  /** `GET /api/projects`: the active project, the default one, and every project the player knows. */
  projects(): Promise<PlayerReply>;
  /** `POST /api/project`: switch the player to a test project. */
  useProject(project: PlayerProject): Promise<PlayerReply>;
  /** `POST /api/playlist`: make or replace a playlist of the active project. */
  writePlaylist(playlist: Playlist): Promise<PlayerReply>;
  /** `POST /api/play`: play some tests, or a playlist by name. */
  play(what: { keys: string[] } | { playlist: string }): Promise<PlayerReply>;
}

/** Where rehearse expects Birdview, and how to reach it. */
export interface BirdviewSetup {
  port: number;
  /** The test project folder of this EPIC (where `playwright test` runs). */
  projectDir?: string;
  /** Folder of the story playlists. Default `<projectDir>/birdview/playlists`. */
  playlistsDir?: string;
  client?: PlayerClient;
}

export interface TestResult {
  last?: 'passed' | 'failed';
  failedStep?: string;
  reason?: string;
  at?: number;
}

/** The player as the Tests tab needs it. */
export type PlayerView =
  | { kind: 'off'; reason: string }
  | { kind: 'other'; projectDir: string }
  | {
      kind: 'ours';
      /** The playlists folder the player reads. */
      playlistsDir?: string;
      /** The playlist picked in the player. */
      selected?: string;
      /** idle | running | paused | held | waiting */
      status: string;
      /** Key (`file:line`) of the test on screen. */
      current?: string;
      /** Results of this story's tests only, by key. */
      results: Record<string, TestResult>;
    };

/** What `GET /api/birdview?story=<id>` returns. */
export interface BirdviewInfo {
  port: number;
  /** `http://127.0.0.1:<port>/` */
  playerUrl: string;
  projectDir?: string;
  playlistsDir?: string;
  storyId: Id;
  /**
   * This story's playlist: built from the record and the spec files like `rehearse playlists` (T45),
   * so the tab shows it before Birdview has it. Without the EPIC folder, the playlist file, if any.
   */
  playlist?: Playlist;
  player: PlayerView;
  /** The project the player plays now and the playlist it shows; absent when it is off or does not say. */
  active?: PlayerProject & { playlist?: { id: string; name: string } };
  /** The player's default project (its `projectDir` setting): where "Switch back" goes. */
  defaultProject?: PlayerProject;
}

/** A test key, as Birdview writes it: `<file relative to the test project>:<line>`. */
export function testKey(t: { file: string; line: number }): string {
  return `${t.file}:${t.line}`;
}

/** The test project of an EPIC: the nearest `e2e/` with a `playwright.config.ts`, from the EPIC folder up. */
export function findTestProject(fromDir: string): string | undefined {
  for (let dir = resolve(fromDir); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'e2e', 'playwright.config.ts'))) return join(dir, 'e2e');
    if (dirname(dir) === dir) return undefined;
  }
}

export function defaultPlaylistsDir(projectDir: string): string {
  return join(projectDir, 'birdview', 'playlists');
}

/** Events of a text/event-stream chunk: `event: x` then `data: {...}`, blank line between. */
export function parseSse(text: string): { event: string; data: unknown }[] {
  const out: { event: string; data: unknown }[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length === 0) continue;
    try {
      out.push({ event, data: JSON.parse(data.join('\n')) });
    } catch {
      // A block cut at the end of the chunk: read again with more text.
    }
  }
  return out;
}

function samePath(a: string, b: string): boolean {
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  return real(a) === real(b);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** Which project the player plays, and this story's results when it is ours. */
export function playerView(projectDir: string | undefined, state: unknown, setup: { config?: unknown; playlists?: unknown }, keys: string[]): PlayerView {
  const config = isObject(setup.config) ? setup.config : {};
  const playlists = isObject(setup.playlists) ? setup.playlists : {};
  const s = isObject(state) ? state : {};
  const playing = activeProject(state)?.projectDir ?? str(config.project) ?? str(playlists.project) ?? '';
  if (projectDir === undefined || playing === '' || !samePath(playing, projectDir)) return { kind: 'other', projectDir: playing };
  const all = isObject(s.results) ? s.results : {};
  const results: Record<string, TestResult> = {};
  for (const k of keys) {
    const r = all[k];
    if (!isObject(r)) continue;
    results[k] = {
      last: r.last === 'passed' || r.last === 'failed' ? r.last : undefined,
      failedStep: str(r.failedStep),
      reason: str(r.reason),
      at: typeof r.at === 'number' ? r.at : undefined,
    };
  }
  const active = activeProject(state);
  const selected = active?.playlist?.id ?? (isObject(playlists.selected) ? str(playlists.selected.id) : undefined);
  return { kind: 'ours', playlistsDir: active?.playlistsDir ?? str(playlists.dir), selected, status: str(s.status) ?? 'idle', current: str(s.current), results };
}

/** A `{projectDir, config?, playlistsDir?}` the player sent; undefined when it is not one. */
export function asProject(v: unknown): PlayerProject | undefined {
  if (typeof v === 'string' && v !== '') return { projectDir: v };
  if (!isObject(v) || str(v.projectDir) === undefined) return undefined;
  return { projectDir: str(v.projectDir)!, ...(str(v.config) ? { config: str(v.config) } : {}), ...(str(v.playlistsDir) ? { playlistsDir: str(v.playlistsDir) } : {}) };
}

/** `state.project` and `state.playlist` of the player's /api/state. */
export function activeProject(state: unknown): BirdviewInfo['active'] {
  if (!isObject(state)) return undefined;
  const project = asProject(state.project);
  if (!project) return undefined;
  const p = isObject(state.playlist) ? state.playlist : undefined;
  const id = str(p?.id);
  return id === undefined ? project : { ...project, playlist: { id, name: str(p?.name) ?? id } };
}

/**
 * The default project in a `GET /api/projects` body, with its config and playlists folder: the
 * player names it in `default` (a path, or a project) and marks it `default: true` in `projects`.
 * The entry of `projects` wins, so a switch back keeps its Playwright config.
 */
export function defaultProject(body: unknown): PlayerProject | undefined {
  if (!isObject(body)) return undefined;
  const named = asProject(body.default);
  const list = Array.isArray(body.projects) ? body.projects.map(asProject).filter((p): p is PlayerProject => p !== undefined) : [];
  const marked = Array.isArray(body.projects) ? asProject(body.projects.find((p) => isObject(p) && p.default === true)) : undefined;
  const entry = named ? list.find((p) => sameProject(p.projectDir, named.projectDir)) : undefined;
  return entry ?? named ?? marked;
}

/** Whether two project folders are the same folder (symlinks and a trailing slash aside). */
export function sameProject(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && samePath(a, b);
}

/** Read this story's playlist file, if any. */
export function readStoryPlaylist(playlistsDir: string | undefined, storyId: Id): Playlist | undefined {
  if (playlistsDir === undefined) return undefined;
  const file = join(playlistsDir, `${storyId}.json`);
  if (!existsSync(file)) return undefined;
  return parsePlaylist(readFileSync(file, 'utf8'));
}

/**
 * Everything the Tests tab shows for one story. With the EPIC folder, the playlist is built from the
 * record and the spec files (T45); without it, it is the story's playlist file.
 */
export async function birdviewInfo(setup: BirdviewSetup, storyId: Id, epicDir?: string): Promise<BirdviewInfo> {
  const client = setup.client ?? httpPlayerClient(setup.port);
  const playlistsDir = setup.playlistsDir ?? (setup.projectDir ? defaultPlaylistsDir(setup.projectDir) : undefined);
  const built = epicDir !== undefined && setup.projectDir !== undefined ? storyPlaylist(epicDir, setup.projectDir, storyId).playlist : undefined;
  const playlist = built && built.tests.length > 0 ? built : readStoryPlaylist(playlistsDir, storyId);
  const base = { port: setup.port, playerUrl: `http://${PLAYER_HOST}:${setup.port}/`, projectDir: setup.projectDir, playlistsDir, storyId, playlist };
  let state: unknown;
  let head: { config?: unknown; playlists?: unknown };
  try {
    [state, head] = await Promise.all([client.state(), client.setup()]);
  } catch (e) {
    return { ...base, player: { kind: 'off', reason: e instanceof Error ? e.message : String(e) } };
  }
  // An older player has no /api/projects: then there is no "Switch back".
  const projects = await client.projects().catch(() => undefined);
  const fallback = defaultProject(projects?.status === 200 ? projects.body : undefined);
  const active = activeProject(state);
  return {
    ...base,
    player: playerView(setup.projectDir, state, head, (playlist?.tests ?? []).map(testKey)),
    ...(active ? { active } : {}),
    ...(fallback ? { defaultProject: fallback } : {}),
  };
}

/** The real client: 127.0.0.1:<port>, a short timeout on every read, a longer one on a switch, a write or a play. */
export function httpPlayerClient(port: number, timeoutMs = 2000, postTimeoutMs = 15000): PlayerClient {
  const base = `http://${PLAYER_HOST}:${port}`;
  return {
    async state() {
      const res = await fetch(`${base}/api/state`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`player /api/state: HTTP ${res.status}`);
      return res.json();
    },
    async setup() {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(`${base}/events?lite`, { signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(`player /events: HTTP ${res.status}`);
        const decoder = new TextDecoder();
        let text = '';
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          text += decoder.decode(chunk, { stream: true });
          const events = parseSse(text);
          const config = events.find((e) => e.event === 'config')?.data;
          const playlists = events.find((e) => e.event === 'playlists')?.data;
          if (config !== undefined && playlists !== undefined) return { config, playlists };
        }
        throw new Error('player /events ended before its config');
      } finally {
        clearTimeout(timer);
        ctrl.abort();
      }
    },
    async projects() {
      const res = await fetch(`${base}/api/projects`, { signal: AbortSignal.timeout(timeoutMs) });
      return { status: res.status, body: await res.json().catch(() => undefined) };
    },
    useProject: (project) => post('project', project),
    writePlaylist: (playlist) => post('playlist', playlist),
    play: (what) => post('play', what),
  };
  // No Origin header: the player takes POSTs from a backend on its own loopback host only.
  async function post(path: string, body: unknown): Promise<PlayerReply> {
    const res = await fetch(`${base}/api/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(postTimeoutMs),
    });
    return { status: res.status, body: await res.json().catch(() => undefined) };
  }
}
