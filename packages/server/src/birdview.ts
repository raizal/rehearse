// The Birdview e2e player, seen from `rehearse serve` (T13). The UI never calls the player
// across origins: the server reads it on a fixed loopback host and forwards only the actions
// in PLAYER_ACTIONS. The player's /api/state has the run and the results; the project folder
// it plays is in the first `config` event of its /events stream.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Id } from '@rehearse/core';
import { parsePlaylist, type Playlist } from './playlist.js';

export const DEFAULT_BIRDVIEW_PORT = 3298;
/** The only host the proxy talks to. */
export const PLAYER_HOST = '127.0.0.1';
/** Player actions the UI may ask for, through POST /api/birdview/action. */
export const PLAYER_ACTIONS = ['playlist-select'] as const;
export type PlayerAction = (typeof PLAYER_ACTIONS)[number];

/** Talks to one running player. Tests use a fake. */
export interface PlayerClient {
  /** `GET /api/state`. Throws when the player does not answer. */
  state(): Promise<unknown>;
  /** The `config` and `playlists` events at the start of `/events?lite`. */
  setup(): Promise<{ config?: unknown; playlists?: unknown }>;
  /** `POST /api/<action>` with a JSON body. */
  action(name: PlayerAction, body: Record<string, unknown>): Promise<{ status: number; body: unknown }>;
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
  /** The playlist id in the player: the file name without `.json`. */
  playlistId: Id;
  /** This story's playlist file, when there is one. */
  playlist?: Playlist;
  player: PlayerView;
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
  const playing = str(config.project) ?? str(playlists.project) ?? '';
  if (projectDir === undefined || playing === '' || !samePath(playing, projectDir)) return { kind: 'other', projectDir: playing };
  const s = isObject(state) ? state : {};
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
  const selected = isObject(playlists.selected) ? str(playlists.selected.id) : undefined;
  return { kind: 'ours', playlistsDir: str(playlists.dir), selected, status: str(s.status) ?? 'idle', current: str(s.current), results };
}

/** Read this story's playlist file, if any. */
export function readStoryPlaylist(playlistsDir: string | undefined, storyId: Id): Playlist | undefined {
  if (playlistsDir === undefined) return undefined;
  const file = join(playlistsDir, `${storyId}.json`);
  if (!existsSync(file)) return undefined;
  return parsePlaylist(readFileSync(file, 'utf8'));
}

/** Everything the Tests tab shows for one story. */
export async function birdviewInfo(setup: BirdviewSetup, storyId: Id): Promise<BirdviewInfo> {
  const client = setup.client ?? httpPlayerClient(setup.port);
  const playlistsDir = setup.playlistsDir ?? (setup.projectDir ? defaultPlaylistsDir(setup.projectDir) : undefined);
  const playlist = readStoryPlaylist(playlistsDir, storyId);
  const base = { port: setup.port, playerUrl: `http://${PLAYER_HOST}:${setup.port}/`, projectDir: setup.projectDir, playlistsDir, storyId, playlistId: storyId, playlist };
  let state: unknown;
  let head: { config?: unknown; playlists?: unknown };
  try {
    [state, head] = await Promise.all([client.state(), client.setup()]);
  } catch (e) {
    return { ...base, player: { kind: 'off', reason: e instanceof Error ? e.message : String(e) } };
  }
  return { ...base, player: playerView(setup.projectDir, state, head, (playlist?.tests ?? []).map(testKey)) };
}

/** The real client: 127.0.0.1:<port>, a short timeout on every call. */
export function httpPlayerClient(port: number, timeoutMs = 2000): PlayerClient {
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
    async action(name, body) {
      const res = await fetch(`${base}/api/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { status: res.status, body: await res.json().catch(() => undefined) };
    },
  };
}
