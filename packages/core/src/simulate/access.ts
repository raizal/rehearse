// Parse state access strings of a box: `Entity.field`, `Entity.*` or `Entity.field:from->to`.

export interface Access {
  entity: string;
  field: string;
  /** Set on a state change. `''` means the item is created. */
  from?: string;
  to?: string;
}

const ACCESS = /^([A-Z][A-Za-z0-9]*)\.(\*|[A-Za-z][A-Za-z0-9]*)(?::([a-z0-9-]*)->([a-z0-9-]+))?$/;

export function parseAccess(text: unknown): Access | undefined {
  if (typeof text !== 'string') return undefined;
  const m = ACCESS.exec(text);
  if (!m) return undefined;
  const a: Access = { entity: m[1]!, field: m[2]! };
  if (m[4] !== undefined) {
    a.from = m[3] ?? '';
    a.to = m[4];
  }
  return a;
}
