import { describe, it, expect } from 'vitest';
import { newId, newTxnId, newPaymentId, ID_PATTERN } from './ids.js';

describe('transaction and payment ids', () => {
  it('read as PREFIX-date-8 characters, without I, L, O or U', () => {
    const at = new Date('2026-10-09T18:00:00Z');
    expect(newTxnId(at)).toMatch(/^TX-20261009-[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(newPaymentId(at)).toMatch(/^PAY-20261009-[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(ID_PATTERN.test(newPaymentId())).toBe(true);
    expect(ID_PATTERN.test('PAY-20261009-ILOU0000')).toBe(false);
  });

  it('do not repeat', () => {
    const ids = new Set(Array.from({ length: 20000 }, () => newId('TX')));
    expect(ids.size).toBe(20000);
  });
});
