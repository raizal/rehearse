// The system as built (docs/system/) and the change an EPIC makes to it (architecture.yaml in
// the EPIC folder). D4: a change is a to-be diff on top of the as-is. Proposed decision D43.
// Both files are optional: an EPIC without them loads, validates and hashes as before.

import type { Box, EntityDef, EntityModel, Finding, Flow, Id } from '../types.js';

// ---------------------------------------------------------------- docs/system/architecture.yaml

/** Colour of a zone or a part. A part takes its zone's colour when it has none. */
export type ArchColor = 'blue' | 'purple' | 'green' | 'amber' | 'grey';
/** component: runs code; store: files or a database; person: a person or role; outside: an outside system. */
export type PartKind = 'component' | 'store' | 'person' | 'outside';

/** A machine or trust zone: where parts run and what they can reach. */
export interface Zone {
  id: Id;
  name: string;
  about?: string;
  /** What the zone can or cannot reach, in words. */
  trust?: string;
  color?: ArchColor;
}

/** A component, store, person or outside system. */
export interface Part {
  id: Id;
  name: string;
  /** Missing means `component`. */
  kind?: PartKind;
  /** Ref Zone. People and outside systems may have none. */
  zone?: Id;
  about?: string;
  /** Repo paths of the code that builds it. */
  code?: string[];
  color?: ArchColor;
}

/** A call or data link between two parts. A link is known by its two ends. */
export interface ArchLink {
  from: Id;
  to: Id;
  label?: string;
}

export interface ArchNote {
  text: string;
  zone?: Id;
  kind?: 'info' | 'trust' | 'warning';
}

/** The content of docs/system/architecture.yaml. */
export interface SystemArchitecture {
  version: number;
  title?: string;
  about?: string;
  zones: Zone[];
  components: Part[];
  links: ArchLink[];
  notes?: ArchNote[];
}

// ---------------------------------------------------------------- <epic>/architecture.yaml

export type ChangeKind = 'added' | 'changed' | 'removed';

/** Why a change is made: decision ids (G2, D19) and, once prd.yaml has them, story ids. */
export interface ChangeReason {
  why: Id[];
  stories?: Id[];
  /** For `changed`: what changes, in words. */
  what?: string;
}

export interface ZoneChange extends ChangeReason, Partial<Omit<Zone, 'id'>> {
  id: Id;
  change: ChangeKind;
}

/** Added: the whole part. Changed: only the fields that change. Removed: the id. */
export interface PartChange extends ChangeReason, Partial<Omit<Part, 'id'>> {
  id: Id;
  change: ChangeKind;
}

export interface LinkChange extends ChangeReason {
  from: Id;
  to: Id;
  change: ChangeKind;
  label?: string;
}

/** Why a box of the EPIC's flow.yaml is added or changed, or a box of docs/system/flow.yaml that the EPIC removes. */
export interface BoxNote extends ChangeReason {
  path: string;
  change?: 'removed';
  /** Title to show for a removed box that the as-is flow does not have. */
  title?: string;
}

/** Why an entity of the EPIC's entities.yaml is added or changed, or an as-is entity that the EPIC removes. */
export interface EntityNote extends ChangeReason {
  id: Id;
  change?: 'removed';
}

/** The content of architecture.yaml in an EPIC folder: only the change. */
export interface ArchitectureChange {
  version: number;
  about?: string;
  zones?: ZoneChange[];
  components?: PartChange[];
  links?: LinkChange[];
  boxes?: BoxNote[];
  entities?: EntityNote[];
}

// ---------------------------------------------------------------- docs/system/

export const SYSTEM_FILES = {
  architecture: 'architecture.yaml',
  flow: 'flow.yaml',
  entities: 'entities.yaml',
} as const;

/** The name findings use for the system folder. */
export const SYSTEM_DIR_NAME = 'docs/system';

/** All files of docs/system/. Each one is optional. */
export interface SystemRecord {
  /** Absolute path of docs/system/. */
  dir: string;
  exists: boolean;
  architecture?: SystemArchitecture;
  /** The as-is flow, merged from finished EPICs. `epic` names the EPIC its story ids belong to. */
  flow?: Flow;
  entities?: EntityModel;
  /** Parsed YAML keyed by file name. */
  raw: Record<string, unknown>;
}

export interface SystemLoadResult {
  system: SystemRecord;
  findings: Finding[];
}

// ---------------------------------------------------------------- compare (as-is + change → to-be)

/** `same` is an as-is item the EPIC keeps. */
export type DiffStatus = 'added' | 'changed' | 'same' | 'removed';

export interface DiffReason {
  status: DiffStatus;
  /** What changes, in words. */
  what?: string;
  why: Id[];
  /** Story ids of this EPIC. */
  stories: Id[];
}

export interface ZoneDiff extends DiffReason {
  id: Id;
  before?: Zone;
  after?: Zone;
}

export interface PartDiff extends DiffReason {
  id: Id;
  before?: Part;
  after?: Part;
}

export interface LinkDiff extends DiffReason {
  from: Id;
  to: Id;
  before?: ArchLink;
  after?: ArchLink;
}

export interface ArchitectureCompare {
  /** docs/system/architecture.yaml, or undefined when there is none. */
  before?: SystemArchitecture;
  /** The to-be: the as-is with the change applied. Undefined when there is neither. */
  after?: SystemArchitecture;
  zones: ZoneDiff[];
  parts: PartDiff[];
  links: LinkDiff[];
}

export interface BoxDiff extends DiffReason {
  path: string;
  title: string;
  before?: Box;
  after?: Box;
  /** True when the EPIC's flow.yaml has the box, or architecture.yaml removes it. */
  inEpic: boolean;
  /** Story ids of the as-is box: stories of finished EPICs. */
  asIsStories: Id[];
}

export interface EntityDiff extends DiffReason {
  id: Id;
  before?: EntityDef;
  after?: EntityDef;
  inEpic: boolean;
}

export interface DiffCounts {
  added: number;
  changed: number;
  same: number;
  removed: number;
}

/** Everything the before / after views need. */
export interface SystemCompare {
  /** True when docs/system/ has architecture.yaml. */
  hasSystem: boolean;
  /** True when the EPIC has architecture.yaml. */
  hasChange: boolean;
  /** The EPIC that the as-is flow's story ids belong to (docs/system/flow.yaml `epic`). */
  asIsEpic?: string;
  architecture: ArchitectureCompare;
  boxes: BoxDiff[];
  entities: EntityDiff[];
}
