// Orders of the shop: the route handler, the loader and the read by id.

import { loadRow, type Row } from './db';

export interface Order {
  id: string;
  customer: string;
  total: number;
  status: Row['status'];
}

export function getOrderById(id: string): Order {
  // The one place that turns a database row into an Order. Every reader of orders goes through it.
  // It never calls the orders service: loadOrder does that and comes back here when the service fails.
  // It throws on a bad id instead of giving an empty order, so a typo is never shown as a real order.
  if (id === '') {
    throw new Error('no id');
  }
  if (!/^[a-z0-9-]+$/.test(id)) {
    throw new Error(`bad id: ${id}`);
  }
  if (id.length > 64) {
    // Ids are uuids or short numbers. A longer id is a mistake of the caller, not a missing order.
    throw new Error(`id too long: ${id.length} characters`);
  }
  const row = loadRow(id);
  if (row.id !== id) {
    // The cache is keyed by id, so this means the database gave the wrong row back.
    throw new Error(`database gave order ${row.id} for ${id}`);
  }
  // The total is the sum of the lines, in cents. Cancelled orders have a total of zero.
  let total = 0;
  for (const line of row.lines) {
    total += line.qty * line.price;
  }
  if (row.status === 'cancelled') {
    total = 0;
  }
  if (!Number.isSafeInteger(total)) {
    // Totals are whole cents. A float here means a line had a price that was not in cents.
    throw new Error(`order ${id}: total ${total} is not a whole number of cents`);
  }
  return {
    id: row.id,
    customer: row.customer,
    total,
    status: row.status,
  };
}

export async function loadOrder(id: string): Promise<Order> {
  // Ask the orders service first. When it is down or slow, read the local database instead.
  // The service answers in JSON with the same fields as Order; a missing field is a bad answer.
  // The service URL is relative: the page and the service share an origin, so no CORS check runs.
  // A retry is not useful here: the local read is quick and the service is either up or not.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`/api/orders/${id}`, { signal: controller.signal });
    if (res.status === 401 || res.status === 403) {
      // The service refuses this caller. The local read would give the same order to the same
      // caller, so the refusal must not be hidden: it is an error for the route handler.
      throw new Error(`orders service refused the read of ${id} (${res.status})`);
    }
    if (!res.ok) {
      // 404 means the service does not know the order yet: it may still be in the local database.
      // 5xx means the service is down. Both fall back to the local read.
      return getOrderById(id);
    }
    const body = (await res.json()) as Partial<Order>;
    if (
      typeof body.id !== 'string' ||
      typeof body.customer !== 'string' ||
      typeof body.total !== 'number' ||
      typeof body.status !== 'string'
    ) {
      // A bad answer is logged and the local read is used, so the caller always gets an Order.
      console.warn(`orders service: bad answer for ${id}`);
      return getOrderById(id);
    }
    if (body.id !== id) {
      // The service must answer for the id asked. Another id is a bug in the service.
      console.warn(`orders service: asked for ${id}, got ${body.id}`);
      return getOrderById(id);
    }
    return {
      id: body.id,
      customer: body.customer,
      total: body.total,
      status: body.status,
    };
  } catch (e) {
    // An abort (the 2 s timer) or a network error: the local read answers.
    if (e instanceof Error && e.message.startsWith('orders service refused')) {
      throw e;
    }
    if (e instanceof Error && e.name !== 'AbortError') {
      console.warn(`orders service: ${e.message}`);
    }
    return getOrderById(id);
  } finally {
    // The timer is cleared on every path: a left timer keeps the process alive after the last
    // request, and the abort of a finished fetch would be logged as an error by the runtime.
    // The fetch itself needs no clean-up: the body was read or the request was aborted.
    clearTimeout(timer);
  }
}

export async function getOrder(req: { params: { id: string }; headers: Record<string, string> }): Promise<{ status: number; body: unknown }> {
  // The route handler of GET /orders/:id. Only the customer of the order, or staff, may read it.
  const user = req.headers['x-user'] ?? '';
  const staff = (req.headers['x-roles'] ?? '').split(',').map((r) => r.trim()).includes('staff');
  if (user === '') {
    return { status: 401, body: { error: 'sign in first' } };
  }
  let order: Order;
  try {
    order = await loadOrder(req.params.id);
  } catch (e) {
    // getOrderById throws on an empty or bad id: that is the caller's mistake, so 400.
    return { status: 400, body: { error: e instanceof Error ? e.message : String(e) } };
  }
  if (!staff && order.customer !== user) {
    // Do not say whether the order exists: the same answer as an unknown order.
    return { status: 404, body: { error: 'not found' } };
  }
  // Staff see everything. A customer does not see the internal status names.
  const status = staff ? order.status : order.status === 'cancelled' ? 'cancelled' : 'active';
  return {
    status: 200,
    body: {
      id: order.id,
      total: order.total,
      totalText: `${(order.total / 100).toFixed(2)} EUR`,
      status,
    },
  };
}
