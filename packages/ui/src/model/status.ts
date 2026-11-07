// The words and filters of the Status page (T58, boxes status-table and whats-missing). The rows
// and their order come from the server (core's statusTable, the deck's done rule); this only
// filters them and words the filters. Pure: the component and the tests share it.

import type { StatusRow, StatusTable } from '@rehearse/core';

export const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'not-done', label: 'Not done' },
  { id: 'done-not-seen', label: 'Done but not seen working' },
] as const;

export type StatusFilterId = (typeof STATUS_FILTERS)[number]['id'];

/** The rows a filter keeps, in the server's order (not done first). The same rule as core's filterRows. */
export function filterStatusRows(rows: readonly StatusRow[], filter: StatusFilterId): StatusRow[] {
  if (filter === 'not-done') return rows.filter((r) => r.done.state !== 'done');
  if (filter === 'done-not-seen') return rows.filter((r) => r.done.state === 'done' && !r.seenWorking);
  return [...rows];
}

/** How many rows each filter keeps, for its button: "Not done (3)". */
export function filterCount(t: Pick<StatusTable, 'counts'>, filter: StatusFilterId): number {
  return filter === 'not-done' ? t.counts.notDone : filter === 'done-not-seen' ? t.counts.doneNotSeen : t.counts.stories;
}

/** The tone of a row's Done cell. */
export function doneTone(r: StatusRow): 'good' | 'warn' | 'bad' {
  return r.done.state !== 'done' ? 'bad' : r.seenWorking ? 'good' : 'warn';
}

/** The tone of the Signed cell. */
export function signedTone(r: StatusRow): 'good' | 'warn' | 'bad' {
  return r.signed.state === 'yes' ? 'good' : r.signed.state === 'changed' ? 'warn' : 'bad';
}

/** The tone of the Built cell. */
export function builtTone(r: StatusRow): 'good' | 'bad' | 'muted' {
  return r.built.boxes === 0 ? 'muted' : r.built.built >= r.built.boxes ? 'good' : 'bad';
}
