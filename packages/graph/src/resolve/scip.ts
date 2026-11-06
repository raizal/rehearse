// A reader for the SCIP index that scip-python writes (G15): only the fields the Python resolver needs.
// The schema is https://github.com/sourcegraph/scip/blob/main/scip.proto; the field numbers below are
// from it. Unknown fields are skipped, so a newer index still reads.

import { BinaryReader, WireType } from '@bufbuild/protobuf/wire';

export interface ScipOccurrence {
  /** 0-based: start line, start character, end line, end character. */
  range: [number, number, number, number];
  symbol: string;
  /** Bit 1: definition, bit 2: import (SymbolRole). */
  roles: number;
}

export interface ScipDocument {
  /** Path relative to the project root, `/`-separated. */
  path: string;
  occurrences: ScipOccurrence[];
}

export interface ScipIndex {
  projectRoot: string;
  documents: ScipDocument[];
}

export const SCIP_DEFINITION = 1;

export function readScip(bytes: Uint8Array): ScipIndex {
  const r = new BinaryReader(bytes);
  const index: ScipIndex = { projectRoot: '', documents: [] };
  while (r.pos < r.len) {
    const [field, wire] = r.tag();
    if (field === 1 && wire === WireType.LengthDelimited) index.projectRoot = metadata(r.bytes());
    else if (field === 2 && wire === WireType.LengthDelimited) index.documents.push(document(r.bytes()));
    else r.skip(wire, field);
  }
  return index;
}

function metadata(bytes: Uint8Array): string {
  const r = new BinaryReader(bytes);
  let root = '';
  while (r.pos < r.len) {
    const [field, wire] = r.tag();
    if (field === 3 && wire === WireType.LengthDelimited) root = r.string();
    else r.skip(wire, field);
  }
  return root;
}

function document(bytes: Uint8Array): ScipDocument {
  const r = new BinaryReader(bytes);
  const doc: ScipDocument = { path: '', occurrences: [] };
  while (r.pos < r.len) {
    const [field, wire] = r.tag();
    if (field === 1 && wire === WireType.LengthDelimited) doc.path = r.string();
    else if (field === 2 && wire === WireType.LengthDelimited) {
      const o = occurrence(r.bytes());
      if (o) doc.occurrences.push(o);
    } else r.skip(wire, field);
  }
  return doc;
}

function occurrence(bytes: Uint8Array): ScipOccurrence | undefined {
  const r = new BinaryReader(bytes);
  const range: number[] = [];
  let symbol = '';
  let roles = 0;
  while (r.pos < r.len) {
    const [field, wire] = r.tag();
    if (field === 1 && wire === WireType.LengthDelimited) {
      const packed = new BinaryReader(r.bytes());
      while (packed.pos < packed.len) range.push(packed.int32());
    } else if (field === 1 && wire === WireType.Varint) range.push(r.int32());
    else if (field === 2 && wire === WireType.LengthDelimited) symbol = r.string();
    else if (field === 3 && wire === WireType.Varint) roles = r.int32();
    else r.skip(wire, field);
  }
  if (symbol === '' || (range.length !== 3 && range.length !== 4)) return undefined;
  // Three numbers: the occurrence is on one line.
  const full: [number, number, number, number] = range.length === 3
    ? [range[0]!, range[1]!, range[0]!, range[2]!]
    : [range[0]!, range[1]!, range[2]!, range[3]!];
  return { range: full, symbol, roles };
}
