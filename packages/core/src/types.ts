// Frozen contract for wave 1. Mirrors docs/epics/2026-11-05-rehearse/entities.yaml.
//
// Shape rules:
// - The record types mirror the YAML files. A field that a file can omit is
//   optional here, even when entities.yaml lists it without `?`, because the
//   value is derived (for example Story.status comes from sign-off events).
// - The loader adds only `Box.path`, `Scenario.story` and `ScenarioFile.file`.
// - Change this file only through a correction in corrections.md.

// ---------------------------------------------------------------- enums

export type EpicStatus = 'draft' | 'signed' | 'partly-stale';
export type RoleKind = 'human' | 'agent' | 'system' | 'external';
export type RequirementKind = 'functional' | 'performance' | 'security' | 'permission';
export type StoryStatus = 'draft' | 'signed' | 'stale';
export type BoxKind = 'start' | 'end' | 'process' | 'decision' | 'input' | 'output' | 'external';
/** In flow.yaml `kind` is optional on an edge. A missing kind means `normal`. */
export type EdgeKind = 'normal' | 'branch' | 'error';
export type ScenarioStatus = 'draft' | 'approved' | 'stale';
export type CorrectionTag = 'caught-in-simulation' | 'caught-after-build';
export type FindingKind = 'schema' | 'reference' | 'structure' | 'contract' | 'coverage' | 'lifecycle' | 'acceptance' | 'gate';
export type ReportCommand = 'validate' | 'simulate' | 'gate';

export const BOX_KINDS: readonly BoxKind[] = ['start', 'end', 'process', 'decision', 'input', 'output', 'external'];
export const EDGE_KINDS: readonly EdgeKind[] = ['normal', 'branch', 'error'];
export const FINDING_KINDS: readonly FindingKind[] = ['schema', 'reference', 'structure', 'contract', 'coverage', 'lifecycle', 'acceptance', 'gate'];

/** Identifier fields hold the `id` of the referenced item (`ref <Entity>` in entities.yaml). */
export type Id = string;
/** `sha256:<hex>`. */
export type Hash = string;
/** ISO 8601 date-time string. */
export type DateTime = string;

// ---------------------------------------------------------------- prd.yaml

export interface Epic {
  slug: string; // YYYY-MM-DD-<kebab>
  title: string;
  goal: string;
  successMeasure?: string;
  outOfScope?: string[];
  /** Derived from signoff.yaml and stale detection. Not written in prd.yaml. */
  status?: EpicStatus;
  /** Derived from signoff.yaml. Not written in prd.yaml. */
  signOffs?: SignOff[];
}

export interface Role {
  id: Id;
  name: string;
  kind: RoleKind;
  about?: string;
}

export interface Requirement {
  id: Id; // R1, R2, …
  kind: RequirementKind;
  text: string;
  /** Required when kind is not `functional` (D22). */
  provenBy?: string;
}

export interface AcceptanceCriterion {
  id: Id; // S3-A1
  given: string;
  when: string;
  then: string;
  /** Machine-checkable end state for R7. */
  expectedState?: Record<string, unknown>;
}

export interface Story {
  id: Id; // S1, S2, …
  role: Id; // ref Role
  want: string;
  soThat: string;
  requirements: Id[]; // ref Requirement
  acceptance: AcceptanceCriterion[];
  /** Derived. Not written in prd.yaml. */
  status?: StoryStatus;
  /** Derived. Not written in prd.yaml. */
  signedHash?: Hash;
}

export interface ResolvedQuestion {
  question: string;
  answer: string;
  at: string;
}

/** The content of prd.yaml. */
export interface Prd {
  epic: Epic;
  roles: Role[];
  requirements: Requirement[];
  stories: Story[];
  resolvedQuestions?: ResolvedQuestion[];
}

// ---------------------------------------------------------------- entities.yaml

export interface LifecycleTransition {
  from: string;
  to: string;
  by: string;
  when?: string;
}

export interface Lifecycle {
  field: string;
  initial: string;
  transitions: LifecycleTransition[];
}

/** One entity of the entity model (D21). */
export interface EntityDef {
  id: Id;
  about?: string;
  /** field name → type string, e.g. `enum[draft, signed]`, `list ref Story`, `string?`. */
  fields: Record<string, string>;
  lifecycle?: Lifecycle;
}

/** The content of entities.yaml. */
export interface EntityModel {
  entities: EntityDef[];
}

// ---------------------------------------------------------------- flow.yaml

export interface Lane {
  role: Id; // ref Role
  order: number;
}

export interface Example {
  id: Id;
  /** Box path. Implied by the scenario step when the example is inline. */
  box?: string;
  /** Input values and start state. */
  given?: Record<string, unknown>;
  /** Output values, `branch: <label>`, or `exit: <error-exit>`. */
  then?: Record<string, unknown>;
  stateAfter?: Record<string, unknown>;
}

export interface Box {
  id: Id; // ^[a-z0-9][a-z0-9-]*$, unique in its diagram
  /** Added by the loader: ids joined with `/`, e.g. `simulate/contracts`. */
  path: string;
  title: string;
  kind: BoxKind;
  lane: Id; // ref Lane (by role)
  stories?: Id[];
  /** field → type (D10). */
  inputs?: Record<string, string>;
  outputs?: Record<string, string>;
  /** `Entity.field` or `Entity.*`. */
  reads?: string[];
  /** `Entity.field`, `Entity.*` or `Entity.field:from->to`. */
  writes?: string[];
  sideEffects?: string[];
  /** Each one is an edge with this label and kind `error`. */
  errorExits?: string[];
  examples?: Example[];
  children?: Diagram;
}

export interface Edge {
  from: Id; // box id in the same diagram
  to: Id;
  /** Required on decision branches and error exits. */
  label?: string;
  /** Missing means `normal`. */
  kind?: EdgeKind;
}

export interface Diagram {
  boxes: Box[];
  edges: Edge[];
}

/** The content of flow.yaml. */
export interface Flow {
  version: number;
  epic: string;
  lanes: Lane[];
  root: Diagram;
}

// ---------------------------------------------------------------- scenarios/*.yaml

export interface Approval {
  by: string; // git user.email
  threadId?: string;
  at: DateTime;
  hash: Hash;
  note?: string;
}

export interface ScenarioStep {
  /** Box path of a leaf box (R21). */
  name: string;
  example?: Example;
  /** Label of the edge taken (decision branch or error exit). */
  branch?: string;
}

export interface ScenarioExpect {
  /** Acceptance criterion id of the scenario's story. */
  criterion?: Id;
  state: Record<string, unknown>;
}

export interface Scenario {
  id: Id;
  /** Added by the loader from the file-level `story`. */
  story: Id;
  title: string;
  steps: ScenarioStep[];
  status: ScenarioStatus;
  approval?: Approval;
  expect?: ScenarioExpect;
}

/** One file in scenarios/. */
export interface ScenarioFile {
  /** Path relative to the EPIC folder, e.g. `scenarios/S2.yaml`. Added by the loader. */
  file: string;
  story: Id;
  scenarios: Scenario[];
}

// ---------------------------------------------------------------- signoff.yaml

export interface SignOff {
  by: string;
  threadId?: string;
  at: DateTime;
  /** story id → hash */
  storyHashes: Record<Id, Hash>;
  /** e.g. `bootstrap`. */
  kind?: string;
  gateChecks?: string;
}

export interface SignOffLog {
  signOffs: SignOff[];
}

// ---------------------------------------------------------------- corrections.md

export interface Correction {
  at: DateTime;
  tag: CorrectionTag;
  what: string;
  why: string;
  boxes: string[]; // box paths
}

// ---------------------------------------------------------------- reports

export interface Finding {
  kind: FindingKind;
  /** Path relative to the EPIC folder, e.g. `flow.yaml`, `scenarios/S2.yaml`. */
  file: string;
  /** Box path, `<scenario id>/step-<n>`, story id, or YAML path (`stories[0].acceptance`). */
  path: string;
  message: string;
  /** Requirement, story and criterion ids that the finding is about. Sorted. */
  refs: string[];
}

/** role → entity → actions (`read`, `write`). R8. */
export type PermissionMatrix = Record<Id, Record<Id, string[]>>;

/** Output of validate, simulate or gate. Same record → byte-identical report (R18). */
export interface Report {
  command: ReportCommand;
  ok: boolean;
  findings: Finding[];
  permissionMatrix?: PermissionMatrix;
}

// ---------------------------------------------------------------- loaded record

/** Record file names, relative to the EPIC folder. */
export const RECORD_FILES = {
  prd: 'prd.yaml',
  entities: 'entities.yaml',
  flow: 'flow.yaml',
  signoff: 'signoff.yaml',
  scenariosDir: 'scenarios',
} as const;

/**
 * All record files of one EPIC folder. A member is undefined when its file is
 * missing or is not valid YAML; the loader then reports a finding.
 * The typed members are only safe to trust when `validate` gave no schema finding.
 */
export interface EpicRecord {
  /** Absolute path of the EPIC folder. */
  dir: string;
  /** Folder name. */
  slug: string;
  prd?: Prd;
  entities?: EntityModel;
  flow?: Flow;
  signoff?: SignOffLog;
  /** Sorted by file name. */
  scenarioFiles: ScenarioFile[];
  /** Parsed YAML of every file that parsed, keyed by relative path, before the loader adds fields. */
  raw: Record<string, unknown>;
}

export interface LoadResult {
  record: EpicRecord;
  /** YAML syntax and missing-file findings. */
  findings: Finding[];
}
