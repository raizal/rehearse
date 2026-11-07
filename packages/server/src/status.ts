// The Status page's facts (T58, S23, boxes status-table and status-sources): the deck's own facts,
// gathered light (no pictures, stills or videos), turned into the status table by core. Read-only:
// it runs git and reads files; it never writes, signs or calls Birdview's player with a POST.

import { statusTable, type StatusTable } from '@rehearse/core';
import { gatherDeckFacts, type DeckOptions } from './present.js';

/** The status table of the EPIC of `opts.epicDir`, from the same facts and rule as the deck. */
export async function buildStatus(opts: DeckOptions): Promise<StatusTable> {
  const { record, facts } = await gatherDeckFacts({ ...opts, light: true, committedOnly: false });
  return statusTable(record, facts);
}
