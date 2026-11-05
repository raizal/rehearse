// Short forms of long strings for the shell (T17).

import { describe, expect, it } from 'vitest';
import { shortKey } from '../src/model/text.js';

describe('shortKey (T17: the signing chip)', () => {
  it('keeps the algorithm, the first three and the last two characters of the hash', () => {
    expect(shortKey('SHA256:9fQabcdefghijklmnopk2')).toBe('SHA256:9fQ…k2');
  });

  it('leaves a short key or a key without an algorithm readable', () => {
    expect(shortKey('SHA256:abcdef')).toBe('SHA256:abcdef');
    expect(shortKey('abcdefghijklmnop')).toBe('abc…op');
  });
});
