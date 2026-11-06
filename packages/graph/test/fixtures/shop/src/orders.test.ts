import { describe, expect, it } from 'vitest';
import { getOrderById } from './orders';

describe('orders', () => {
  it('reads one order by its id', () => {
    expect(getOrderById('1').id).toBe('1');
  });
});
