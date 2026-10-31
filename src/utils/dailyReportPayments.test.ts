import { describe, it, expect } from 'vitest';
import {
  PAYMENT_METHODS, withAllPaymentMethods, paymentCount, paymentAmount, paymentsSaid, noPayments
} from './dailyReportPayments.ts';

describe('daily report payments', () => {
  it('lists ACH first, then Cash, Credit Card, Check', () => {
    expect(PAYMENT_METHODS.map(m => m.label)).toEqual(['ACH', 'Cash', 'Credit Card (CC)', 'Check']);
  });

  it('gives a report saved before ACH a blank ACH, keeping the rest', () => {
    const old = { cash: { count: 2, amount: 150 }, card: { count: null, amount: null }, check: { count: 0, amount: 0 } };
    expect(withAllPaymentMethods(old)).toEqual({
      ach: { count: null, amount: null },
      cash: { count: 2, amount: 150 },
      card: { count: null, amount: null },
      check: { count: 0, amount: 0 }
    });
    expect(withAllPaymentMethods(undefined).ach).toEqual({ count: null, amount: null });
  });

  it('totals include ACH, and an older report totals the same as before', () => {
    const old = { cash: { count: 2, amount: 150.5 }, card: { count: 1, amount: 99.5 }, check: { count: null, amount: null } };
    expect(paymentCount(old)).toBe(3);
    expect(paymentAmount(old)).toBe(250);
    const withAch = { ...old, ach: { count: 1, amount: 1000 } };
    expect(paymentCount(withAch)).toBe(4);
    expect(paymentAmount(withAch)).toBe(1250);
  });

  it('counts a 0 as said and blanks as unsaid, ACH included', () => {
    expect(paymentsSaid(withAllPaymentMethods({}))).toBe(false);
    expect(paymentsSaid({ ach: { count: '', amount: null } })).toBe(false);
    expect(paymentsSaid({ ach: { count: null, amount: 0 } })).toBe(true);
    expect(paymentsSaid({ check: { count: 1, amount: null } })).toBe(true);
    expect(paymentsSaid(noPayments())).toBe(true);
    expect(paymentAmount(noPayments())).toBe(0);
  });
});
