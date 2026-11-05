// Small read-only renderers for contract fields and example values.

export function show(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function KeyValues({ values, testId, empty = '—' }: { values: Record<string, unknown> | undefined; testId?: string; empty?: string }) {
  const entries = values && typeof values === 'object' ? Object.entries(values) : [];
  if (entries.length === 0) return <div className="muted" data-testid={testId}>{empty}</div>;
  return (
    <dl className="kv" data-testid={testId}>
      {entries.map(([k, v]) => (
        <div key={k} className="kv-row">
          <dt>{k}</dt>
          <dd>{show(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tags({ items, testId, kind }: { items: string[] | undefined; testId?: string; kind?: string }) {
  if (!items || items.length === 0) return <div className="muted" data-testid={testId}>—</div>;
  return (
    <ul className={`tags ${kind ?? ''}`} data-testid={testId}>
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}
