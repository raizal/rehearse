// Box `simulate/permissions` (R8, S7-A1): role × entity × action from box lanes and state access.
// `reads` give `read`. `writes` give `write`; a state change `Entity.field:from->to` gives
// `write` and `transition`. Every box counts, parents and children. Each cell lists its box paths.

import type { BoxEntry } from '../flow-index.js';
import type { PermissionMatrix } from '../types.js';
import { asArray, cmp } from '../util.js';
import { parseAccess } from './access.js';
import { PERMISSION_ACTIONS, type PermissionAction, type PermissionBoxes } from './types.js';

export function buildPermissions(index: Map<string, BoxEntry>): { matrix: PermissionMatrix; boxes: PermissionBoxes } {
  const cells = new Map<string, Map<string, Map<PermissionAction, Set<string>>>>();
  const mark = (role: string, entity: string, action: PermissionAction, path: string): void => {
    if (!cells.has(role)) cells.set(role, new Map());
    const byEntity = cells.get(role)!;
    if (!byEntity.has(entity)) byEntity.set(entity, new Map());
    const byAction = byEntity.get(entity)!;
    if (!byAction.has(action)) byAction.set(action, new Set());
    byAction.get(action)!.add(path);
  };

  for (const { box, path } of index.values()) {
    if (typeof box.lane !== 'string') continue;
    for (const r of asArray(box.reads)) {
      const a = parseAccess(r);
      if (a) mark(box.lane, a.entity, 'read', path);
    }
    for (const w of asArray(box.writes)) {
      const a = parseAccess(w);
      if (!a) continue;
      mark(box.lane, a.entity, 'write', path);
      if (a.to !== undefined) mark(box.lane, a.entity, 'transition', path);
    }
  }

  // Insert keys in sorted order, so the JSON text is the same on each run (R18).
  const matrix: PermissionMatrix = {};
  const boxes: PermissionBoxes = {};
  for (const role of [...cells.keys()].sort(cmp)) {
    matrix[role] = {};
    boxes[role] = {};
    const byEntity = cells.get(role)!;
    for (const entity of [...byEntity.keys()].sort(cmp)) {
      const byAction = byEntity.get(entity)!;
      const actions = PERMISSION_ACTIONS.filter((a) => byAction.has(a));
      matrix[role][entity] = actions;
      boxes[role][entity] = Object.fromEntries(actions.map((a) => [a, [...byAction.get(a)!].sort(cmp)]));
    }
  }
  return { matrix, boxes };
}
