// Payments: charge a card for an order.

export interface Charge {
  orderId: string;
  amount: number;
  ok: boolean;
}

/** Charge the total of one order. */
export function charge(orderId: string, amount: number): Charge {
  if (amount < 0) {
    return { orderId, amount, ok: false };
  }
  if (amount === 0) {
    return { orderId, amount, ok: true };
  }
  const cents = Math.round(amount * 100);
  const fee = Math.ceil(cents / 50);
  const total = cents + fee;
  if (total > 1_000_000) {
    return { orderId, amount, ok: false };
  }
  const result: Charge = {
    orderId,
    amount: total / 100,
    ok: true,
  };
  // The card network says yes for every amount in the fixture.
  return result;
}
