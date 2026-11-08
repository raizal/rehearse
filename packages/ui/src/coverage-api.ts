// The unit test coverage of the boxes (T43, S12): `GET api/graph?verb=coverage`, once per EPIC.
// The code nodes need no extra read: the map and the drill-down's show carry their numbers. The
// route needs the session token like the other graph reads. Tests give a fake through
// CoverageApiContext, or set BoxCoverageContext.

import { createContext, useContext, useEffect, useState } from 'react';
import type { BoxesCoverage } from '@rehearse/server';
import { sessionClient, TOKEN_HEADER, type SessionClient } from './session-client.js';
import { at } from './base.js';

export type { BoxesCoverage } from '@rehearse/server';

export interface CoverageApi {
  /** Every box of the served EPIC with code; undefined when the read failed. */
  boxes: () => Promise<BoxesCoverage | undefined>;
}

export function httpCoverageApi(client: SessionClient = sessionClient): CoverageApi {
  return {
    boxes: async () => {
      try {
        const r = await client.withToken((token) => fetch(at('api/graph?verb=coverage'), { cache: 'no-store', headers: { [TOKEN_HEADER]: token } }));
        return r.status === 200 && r.body?.ok === true ? (r.body as unknown as BoxesCoverage) : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

export const CoverageApiContext = createContext<CoverageApi>(httpCoverageApi());

/** The boxes' coverage on the page: undefined until read, or when there is no graph. */
export const BoxCoverageContext = createContext<BoxesCoverage | undefined>(undefined);

/** Read the boxes' coverage once per EPIC (and again when `again` changes). */
export function useBoxesCoverage(epic: string | undefined, again?: unknown): BoxesCoverage | undefined {
  const api = useContext(CoverageApiContext);
  const [value, setValue] = useState<{ epic: string; cov: BoxesCoverage | undefined }>();
  useEffect(() => {
    if (epic === undefined) return;
    let live = true;
    void api.boxes().then((cov) => live && setValue({ epic, cov }));
    return () => {
      live = false;
    };
  }, [api, epic, again]);
  return value !== undefined && value.epic === epic ? value.cov : undefined;
}
