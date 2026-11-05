// Types of the simulate report (R4–R8). New in wave 1; the frozen types in ../types.ts are unchanged.

import type { Finding, Id, PermissionMatrix, Report, Scenario, ScenarioStatus } from '../types.js';

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

/** Options of the simulate engine. */
export interface SimulateOptions {
  /**
   * Drafts mode (T22): count draft and stale scenarios as if approved, for the checks only.
   * The report is findings, never evidence: the gate does not read it.
   */
  drafts?: boolean;
}

/** First line of a drafts-mode report. */
export const DRAFTS_NOTICE = 'drafts counted for checks only; this is not evidence';

/** A scenario that drafts mode counted, with the status it really has. */
export interface CountedScenario {
  file: string;
  scenario: Id;
  story: Id;
  /** `stale` also for an approved scenario whose content changed after approval. */
  status: ScenarioStatus;
}

/** Output of simulate. Same record → byte-identical `reportToJson` text (R18, S3-A5). */
export interface SimulationReport extends Report {
  command: 'simulate';
  /** Set in drafts mode only. */
  mode?: 'drafts';
  /** Drafts mode only: {@link DRAFTS_NOTICE}. */
  notice?: string;
  permissionMatrix: PermissionMatrix;
  permissionBoxes: PermissionBoxes;
  /** Sorted by file, then scenario id. */
  stale: StaleScenario[];
  /**
   * Drafts mode only: branches, error exits and criteria that only draft or stale scenarios
   * cover. Information on what still needs the builder, not findings: they do not fail the report.
   */
  draftOnly?: Finding[];
  /** Drafts mode only: each scenario counted, sorted by file, then scenario id. */
  counted?: CountedScenario[];
}

/** A scenario that counts as evidence, with the file it came from. */
export interface LoadedScenario {
  file: string;
  scenario: Scenario;
  /** Set in drafts mode only: the status the scenario really has. */
  status?: ScenarioStatus;
}
