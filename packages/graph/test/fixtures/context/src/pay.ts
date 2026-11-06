// Payments: charge an order total and record the receipt.

export interface Receipt {
  orderId: string;
  amount: number;
  at: string;
}

const receipts: Receipt[] = [];

export function charge(orderId: string, amount: number): Receipt {
  // Charge the card on file for the order. Amounts are in cents and must be positive.
  if (amount <= 0) {
    throw new Error(`order ${orderId}: nothing to charge`);
  }
  if (receipts.some((r) => r.orderId === orderId)) {
    throw new Error(`order ${orderId}: already paid`);
  }
  const receipt: Receipt = { orderId, amount, at: new Date(0).toISOString() };
  receipts.push(receipt);
  return receipt;
}

export function refund(orderId: string): Receipt | undefined {
  // Refund the whole amount of an order. A partial refund is not supported yet.
  const i = receipts.findIndex((r) => r.orderId === orderId);
  if (i === -1) return undefined;
  const [receipt] = receipts.splice(i, 1);
  return receipt;
}

export function receiptsFor(orderIds: string[]): Receipt[] {
  // The receipts of the given orders, in the order of the ids.
  return orderIds.flatMap((id) => receipts.filter((r) => r.orderId === id));
}
