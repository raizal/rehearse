// Types of the trust core: hash rules, stale state, gate and readiness (R11, R13–R16).
// New types only; types.ts stays frozen.

import type { EpicStatus, Hash, Id, Report, ScenarioStatus, SignOff, StoryStatus } from '../types.js';

/**
 * Story hash rule.
 * 1: the story, its requirements and its scenarios (bootstrap sign-off).
 * 2: rule 1 plus each box that serves the story (with its ancestors and children) and the roles of their lanes (C11).
 */
export type HashRule = 1 | 2;

export const HASH_RULES: readonly HashRule[] = [1, 2];
/** The rule that new sign-offs use. */
export const CURRENT_HASH_RULE: HashRule = 2;

/** A sign-off event that records its hash rule. A missing `hashRule` means rule 1. */
export interface SignOffWithRule extends SignOff {
  hashRule?: HashRule;
}

/** Who approves or signs off: git user.email, plus the bb thread ID when one is set (R13). */
export interface Identity {
  by: string;
  threadId?: string;
}

export interface StoryTrust {
  id: Id;
  status: StoryStatus;
  /** Rule of the latest sign-off that covers the story. Undefined when the story was never signed. */
  hashRule?: number;
  /** Hash in the latest sign-off that covers the story. */
  signedHash?: Hash;
  /** Hash of the current content under `hashRule`. */
  currentHash?: Hash;
  /** False when the sign-off uses a rule older than CURRENT_HASH_RULE: the story must be signed again (C11). */
  trusted: boolean;
}

export interface ScenarioTrust {
  id: Id;
  story: Id;
  /** Path of the scenario file, e.g. `scenarios/S2.yaml`. */
  file: string;
  /** Status derived from the approval hash. `approved` only when the hash matches (S6-A3). */
  status: ScenarioStatus;
  /** Why the scenario is stale. */
  reason?: string;
}

export interface StaleResult {
  stories: StoryTrust[];
  scenarios: ScenarioTrust[];
  /** Ids of stale stories, in prd.yaml order. */
  staleStories: Id[];
  /** Ids of stale scenarios, in file order. */
  staleScenarios: Id[];
  epicStatus: EpicStatus;
}

/** Report of `gate check`. `simulation` names the source of the sim-clean check. */
export interface GateReport extends Report {
  command: 'gate';
  /** `validate-only` until simulate is wired in: then sim-clean checks validate findings only. */
  simulation: 'simulate' | 'validate-only';
}

export type ProofReason = 'no-story' | 'no-approved-scenario';

export interface ReadinessScenario {
  id: Id;
  status: ScenarioStatus;
}

export interface ReadinessStory {
  id: Id;
  status: StoryStatus;
  trusted: boolean;
  /** Paths of the boxes that serve the story, in flow order. */
  boxes: string[];
  scenarios: ReadinessScenario[];
  /** Number of gate findings about this story. Undefined when no gate report was given. */
  gateFindings?: number;
}

export interface ReadinessRequirement {
  id: Id;
  text: string;
  stories: ReadinessStory[];
  proven: boolean;
  reason?: ProofReason;
  /** Human reason, e.g. `no story links R2`. */
  message?: string;
}

export interface CorrectionEntry {
  /** e.g. `C11`. */
  id: string;
  tag: string;
}

export interface CorrectionCounts {
  'caught-in-simulation': number;
  'caught-after-build': number;
  /** Entries whose tag is not a CorrectionTag. */
  invalid: CorrectionEntry[];
}

export interface Readiness {
  requirements: ReadinessRequirement[];
  /** Requirements with no proof, with the reason (S8-A1). */
  noProof: { id: Id; reason: ProofReason; message: string }[];
  /** Box paths that serve no requirement (S8-A2). Start, end and decision boxes are not listed. */
  noRequirement: string[];
  corrections: CorrectionCounts;
  epicStatus: EpicStatus;
  /** Gate result when a gate report was given. */
  gateOk?: boolean;
}
