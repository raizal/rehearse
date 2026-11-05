// Types of the simulate report (R4–R8). New in wave 1; the frozen types in ../types.ts are unchanged.

import type { Id, PermissionMatrix, Report, Scenario } from '../types.js';

/** An action of the permission matrix. A transition is also a write. */
export type PermissionAction = 'read' | 'write' | 'transition';
export const PERMISSION_ACTIONS: readonly PermissionAction[] = ['read', 'write', 'transition'];

/** role → entity → action → box paths that give the action (S7-A1: each cell links to its boxes). */
export type PermissionBoxes = Record<Id, Record<Id, Partial<Record<PermissionAction, string[]>>>>;

/**
 * An approved scenario that does not count as evidence: its content hash differs from
 * `approval.hash`, or its status is `stale` (S6-A3). This is information, not a design
 * error, so it is not a Finding and does not make the report fail.
 */
export interface StaleScenario {
  file: string;
  scenario: Id;
  story: Id;
  reason: string;
}

/** Output of simulate. Same record → byte-identical `reportToJson` text (R18, S3-A5). */
export interface SimulationReport extends Report {
  command: 'simulate';
  permissionMatrix: PermissionMatrix;
  permissionBoxes: PermissionBoxes;
  /** Sorted by file, then scenario id. */
  stale: StaleScenario[];
}

/** A scenario that counts as evidence, with the file it came from. */
export interface LoadedScenario {
  file: string;
  scenario: Scenario;
}
