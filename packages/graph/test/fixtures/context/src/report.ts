// Reports for the shop staff: the daily order totals and the open orders.

import { receiptsFor } from './pay';

export interface DayTotal {
  day: string;
  orders: number;
  amount: number;
}

export function dailyTotals(orderIds: string[], dayOf: (orderId: string) => string): DayTotal[] {
  // Sum the paid amounts per day. An order without a receipt is not paid and is left out.
  const byDay = new Map<string, DayTotal>();
  for (const receipt of receiptsFor(orderIds)) {
    const day = dayOf(receipt.orderId);
    const total = byDay.get(day) ?? { day, orders: 0, amount: 0 };
    total.orders += 1;
    total.amount += receipt.amount;
    byDay.set(day, total);
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

export function openOrders(orderIds: string[], paid: Set<string>): string[] {
  // The orders that have no receipt yet, oldest id first.
  return orderIds.filter((id) => !paid.has(id)).sort();
}

export function formatTotals(totals: DayTotal[]): string {
  // One line per day: the day, the number of orders and the amount in euros.
  return totals.map((t) => `${t.day}  ${String(t.orders).padStart(4)}  ${(t.amount / 100).toFixed(2)} EUR`).join('\n');
}
