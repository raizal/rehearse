import { beforeEach, describe, expect, it } from 'vitest';
import { clearCache } from './db';
import { getOrderById } from './orders';

describe('orders', () => {
  beforeEach(() => clearCache());

  it('reads one order by its id, with the total of its lines in cents', () => {
    // The fixture row has one line of 1 x 1000 and one of 2 x 250.
    const order = getOrderById('1');
    expect(order.id).toBe('1');
    expect(order.customer).toBe('customer-1');
    expect(order.total).toBe(1500);
    expect(order.status).toBe('open');
    // An empty id and an id with a space are refused before the database is read.
    expect(() => getOrderById('')).toThrow('no id');
    expect(() => getOrderById('a b')).toThrow('bad id: a b');
    // Two reads of the same id give the same order: the second one comes from the cache.
    expect(getOrderById('1')).toEqual(order);
    // An id of more than 64 characters is refused too, with its length in the message.
    expect(() => getOrderById('x'.repeat(65))).toThrow('id too long: 65 characters');
    // Ids are case sensitive and lower case only: an upper-case id is a bad id, not another order.
    expect(() => getOrderById('A1')).toThrow('bad id: A1');
    // Other ids give other orders, each with its own customer.
    const other = getOrderById('2');
    expect(other.id).toBe('2');
    expect(other.customer).toBe('customer-2');
    expect(other.total).toBe(order.total);
    // The status of a read order is one of the four the database knows.
    expect(['open', 'paid', 'shipped', 'cancelled']).toContain(other.status);
    // The two orders are different objects: changing one does not change the other.
    other.total = 0;
    expect(order.total).toBe(1500);
  });
});
