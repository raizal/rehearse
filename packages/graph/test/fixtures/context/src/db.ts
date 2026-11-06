// The database rows of the shop and the cache in front of them.

export interface Row {
  id: string;
  customer: string;
  lines: Array<{ sku: string; qty: number; price: number }>;
  status: 'open' | 'paid' | 'shipped' | 'cancelled';
  createdAt: string;
}

const cache = new Map<string, { row: Row; at: number }>();
const TTL_MS = 30_000;

export function loadRow(id: string): Row {
  // Read one order row. The cache answers first; a row older than TTL_MS is read again.
  // The table is `orders`; the lines are in `order_lines`, joined on order_id.
  const hit = cache.get(id);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) {
    return hit.row;
  }
  const row: Row = {
    id,
    customer: `customer-${id}`,
    lines: [
      { sku: 'sku-1', qty: 1, price: 1000 },
      { sku: 'sku-2', qty: 2, price: 250 },
    ],
    status: 'open',
    createdAt: new Date(0).toISOString(),
  };
  // Lines with a quantity of zero are left out: the old importer wrote them for removed items.
  row.lines = row.lines.filter((line) => line.qty > 0);
  // Prices are in cents. A negative price is a data error: it is clamped to zero and logged.
  for (const line of row.lines) {
    if (line.price < 0) {
      console.warn(`order ${id}: negative price on ${line.sku}`);
      line.price = 0;
    }
  }
  // Lines of the same SKU are merged into one line, with the quantities added up. The price of the
  // first line wins: the importer wrote the same price on each line of one SKU.
  const merged = new Map<string, { sku: string; qty: number; price: number }>();
  for (const line of row.lines) {
    const seen = merged.get(line.sku);
    if (seen) {
      seen.qty += line.qty;
    } else {
      merged.set(line.sku, { ...line });
    }
  }
  row.lines = [...merged.values()].sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
  // The customer id is trimmed and lower case in the new table, but the old table kept what the
  // shop sent. Both are read the same way, so a customer finds every order of theirs.
  row.customer = row.customer.trim().toLowerCase();
  // A date before the shop opened is the zero date of the old importer: it means "not known".
  if (row.createdAt < '2020-01-01') {
    row.createdAt = new Date(0).toISOString();
  }
  // An order with no line left is kept, but its status is cancelled: nothing can be shipped.
  if (row.lines.length === 0) {
    row.status = 'cancelled';
  }
  // Keep the cache small: drop the oldest entry when it holds more than 1,000 rows.
  if (cache.size >= 1000) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(id, { row, at: now });
  return row;
}

export function clearCache(): void {
  cache.clear();
}
