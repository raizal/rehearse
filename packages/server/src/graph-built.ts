// What the code graph maps to each box of an EPIC (T58, box box-evidence): the code its `builds`
// edges reach, read straight from .rehearse/graph.db, read-only. It never indexes, migrates or
// writes the store: a missing or unreadable graph is said in plain words (the error exit "code graph
// not built yet" of box-evidence), and "built" then counts Flow-Box commits only.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { NO_GRAPH, type GraphBuilds, type GraphCode } from '@rehearse/core';

export const GRAPH_FILE = '.rehearse/graph.db';

/** Code kinds a `builds` edge may reach that count as code of a box. */
const CODE_KINDS = new Set(['file', 'module', 'class', 'function', 'method', 'route', 'test']);

/** The `builds` edges of every box node of the EPIC `slug`, by box path. */
export function readGraphBuilds(repoTop: string, slug: string): GraphBuilds {
  const file = join(repoTop, GRAPH_FILE);
  if (!existsSync(file)) return { ok: false, why: NO_GRAPH };
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const indexed = db.prepare(`SELECT 1 AS one FROM meta WHERE key = 'indexed'`).get();
    if (!indexed) return { ok: false, why: NO_GRAPH };
    const rows = db
      .prepare(
        `SELECT b.name AS box, c.kind AS kind, c.name AS name, c.file AS file, c.start_line AS line
           FROM nodes b JOIN edges e ON e.from_id = b.id AND e.kind = 'builds' JOIN nodes c ON c.id = e.to_id
          WHERE b.kind = 'box' AND b.file = ?`,
      )
      .all(`docs/epics/${slug}/flow.yaml`) as { box: string; kind: string; name: string; file: string | null; line: number | null }[];
    const builds: Record<string, GraphCode[]> = {};
    for (const r of rows) {
      if (!r.file || !CODE_KINDS.has(r.kind)) continue;
      const code: GraphCode = { file: r.file, ...(r.kind !== 'file' && r.kind !== 'module' ? { symbol: r.name } : {}), ...(r.line ? { line: r.line } : {}) };
      (builds[r.box] ??= []).push(code);
    }
    const run = db.prepare(`SELECT started_at AS at FROM runs ORDER BY id DESC LIMIT 1`).get() as { at?: string } | undefined;
    return { ok: true, ...(run?.at ? { at: run.at } : {}), builds };
  } catch (e) {
    return { ok: false, why: `the code graph could not be read (${e instanceof Error ? e.message.split('\n')[0] : String(e)}), so only Flow-Box commits were looked at` };
  } finally {
    db?.close();
  }
}

/** A repo file as text, for the decision check; undefined when it is not there or too big. */
export function repoFileReader(repoTop: string, maxBytes = 2 * 1024 * 1024): (file: string) => string | undefined {
  const cache = new Map<string, string | undefined>();
  return (file) => {
    if (cache.has(file)) return cache.get(file);
    let text: string | undefined;
    try {
      const buf = readFileSync(join(repoTop, file));
      text = buf.length <= maxBytes ? buf.toString('utf8') : undefined;
    } catch {
      text = undefined;
    }
    cache.set(file, text);
    return text;
  };
}
