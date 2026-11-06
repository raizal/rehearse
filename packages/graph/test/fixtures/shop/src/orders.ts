// Orders of the shop: the route handler, the loader and the database read.

export interface Order {
  id: string;
  total: number;
}

export function loadRow(id: string): Order {
  return { id, total: 0 };
}

export function getOrderById(id: string): Order {
  if (id === '') {
    throw new Error('no id');
  }
  const row = loadRow(id);
  return {
    ...row,
  };
}

export async function loadOrder(id: string): Promise<Order> {
  const res = await fetch(`/api/orders/${id}`);
  if (!res.ok) return getOrderById(id);
  return (await res.json()) as Order;
}

export async function getOrder(req: { params: { id: string } }): Promise<Order> {
  return loadOrder(req.params.id);
}

export function handle(id: string): Order {
  return getOrderById(id);
}

const handlers: Record<string, (id: string) => Order> = { handle };

export function dispatch(name: string, id: string): Order {
  return handlers[name]!(id);
}
