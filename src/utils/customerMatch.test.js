import { describe, it, expect } from 'vitest';
import { withoutSeparated } from './customerMatch.js';

const marks = (pairs) => {
  const m = new Map();
  for (const [a, b] of pairs) {
    if (!m.has(a)) m.set(a, new Set());
    m.get(a).add(b);
  }
  return m;
};

describe('withoutSeparated', () => {
  it('leaves a group nobody has ruled on alone', () => {
    expect(withoutSeparated(['a', 'b', 'c'], new Map())).toEqual(['a', 'b', 'c']);
  });

  it('settles a pair marked as separate accounts', () => {
    expect(withoutSeparated(['a', 'b'], marks([['a', 'b']]))).toEqual([]);
  });

  it('reads the mark from either side', () => {
    expect(withoutSeparated(['a', 'b'], marks([['b', 'a']]))).toEqual([]);
  });

  it('keeps the members still unruled on when one is separate from both others', () => {
    expect(withoutSeparated(['a', 'b', 'c'], marks([['a', 'b'], ['a', 'c']]))).toEqual(['b', 'c']);
  });

  it('settles a group where every pair has been marked separate', () => {
    expect(withoutSeparated(['a', 'b', 'c'], marks([['a', 'b'], ['a', 'c'], ['b', 'c']]))).toEqual([]);
  });

  it('keeps a member that is separate from only some of the others', () => {
    expect(withoutSeparated(['a', 'b', 'c'], marks([['a', 'b']]))).toEqual(['a', 'b', 'c']);
  });
});
