// T16: GET /api/epic carries the system as built (docs/system/), the EPIC's change and the
// compare the before / after views draw. No new route.

import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { REAL_EPIC, SHOP } from '../../core/test/helpers.js';
import { buildEpicView, startServer, type RunningServer } from '../src/index.js';

const CODE_GRAPH_REPO = fileURLToPath(new URL('../../core/test/fixtures/code-graph', import.meta.url));
const CODE_GRAPH = join(CODE_GRAPH_REPO, 'docs/epics/2026-11-05-code-graph');

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe('T16 1 /api/epic: system, change and compare', () => {
  it('T16 1 an EPIC with a change gets docs/system/, the change and the compare', () => {
    const view = buildEpicView(CODE_GRAPH);
    expect(view.architecture?.components?.length).toBe(6);
    expect(view.system?.dir).toBe('docs/system');
    expect(view.system?.report.ok).toBe(true);
    expect(view.system?.architecture?.zones.map((z) => z.id)).toEqual(['bb', 'agent', 'repo', 'ci']);
    expect(view.compare?.hasChange).toBe(true);
    expect(view.compare?.boxes.find((b) => b.path === 'draft-record')?.status).toBe('changed');
    expect(view.compare?.architecture.after?.components.map((c) => c.id)).toContain('graph');
  });

  it('T16 2 an EPIC with no change still gets the as-is, so the Architecture view can draw it', () => {
    const view = buildEpicView(REAL_EPIC);
    expect(view.architecture).toBeUndefined();
    expect(view.system?.architecture?.components.map((c) => c.id)).toContain('host');
    expect(view.compare?.hasChange).toBe(false);
    expect(view.compare?.architecture.parts.every((p) => p.status === 'same')).toBe(true);
  });

  it('T16 2 a repo with no docs/system/ gets no system and no compare', () => {
    const view = buildEpicView(SHOP);
    expect(view.system).toBeUndefined();
    expect(view.compare).toBeUndefined();
    expect(view.report.ok).toBe(true);
  });

  it('T16 1 without docs/system/flow.yaml every box of the EPIC is added', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'rehearse-sys-')), 'repo');
    cpSync(CODE_GRAPH_REPO, root, { recursive: true });
    rmSync(join(root, 'docs/system/flow.yaml'));
    const epic = join(root, 'docs/epics/2026-11-05-code-graph');
    const view = buildEpicView(epic);
    expect(view.system?.flow).toBeUndefined();
    expect(view.compare?.boxes.filter((b) => b.inEpic).every((b) => b.status === 'added' || b.status === 'removed')).toBe(true);
    expect(view.system?.report.ok).toBe(true);
  });

  it('T16 1 GET /api/epic sends the new fields as JSON', async () => {
    running = await startServer({ epicDir: CODE_GRAPH, uiDir: mkdtempSync(join(tmpdir(), 'rehearse-ui-')), port: 0 });
    const res = await fetch(new URL('api/epic', running.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.compare.asIsEpic).toBe('2026-11-05-rehearse');
    expect(body.system.architecture.links.length).toBe(9);
    expect(body.architecture.links.length).toBe(5);
  });
});
