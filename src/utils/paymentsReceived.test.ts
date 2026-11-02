import { describe, it, expect } from 'vitest';
import {
  RECEIVED_METHODS, amountCents, formatMoney, cleanReference, paymentTotals, reportGridFrom,
  cleanPayment, changeSummary, matchesPayment, isDay
} from './paymentsReceived.ts';

describe('methods', () => {
  it('are the report\'s four, in its order, then Return', () => {
    expect(RECEIVED_METHODS.map(m => m.key)).toEqual(['ach', 'cash', 'card', 'check', 'return']);
    expect(RECEIVED_METHODS.find(m => m.key === 'card')?.reference).toBe('Card last 4');
  });
});

describe('amountCents', () => {
  it('saves a Return negative whatever sign was typed', () => {
    expect(amountCents('1000', 'return')).toEqual({ cents: -100000 });
    expect(amountCents('-2000', 'return')).toEqual({ cents: -200000 });
    expect(amountCents('−1,250.50', 'return')).toEqual({ cents: -125050 });
  });
  it('reads money as typed for the other methods', () => {
    expect(amountCents('1,250.50', 'card')).toEqual({ cents: 125050 });
    expect(amountCents('$640', 'cash')).toEqual({ cents: 64000 });
    expect(amountCents(' 12.5 ', 'ach')).toEqual({ cents: 1250 });
  });
  it('refuses a minus on anything but Return', () => {
    expect(amountCents('-5', 'cash')).toEqual({ error: 'negative' });
  });
  it('refuses blanks, zero, words and three decimals', () => {
    for (const bad of ['', '0', '0.00', 'abc', '1.234', '1e5', null, undefined]) {
      expect(amountCents(bad, 'check')).toEqual({ error: 'amount' });
    }
  });
});

describe('formatMoney and references', () => {
  it('formats cents with a real minus', () => {
    expect(formatMoney(125050)).toBe('$1,250.50');
    expect(formatMoney(-100000)).toBe('−$1,000.00');
  });
  it('keeps only the last 4 digits of a card', () => {
    expect(cleanReference('card', '4111 1111 1111 4421')).toBe('4421');
    expect(cleanReference('check', ' 10233 ')).toBe('10233');
  });
});

describe('totals', () => {
  const list = [
    { method: 'check', cents: 485000 },
    { method: 'card', cents: 127550 },
    { method: 'card', cents: 125750, voided: { reason: 'typo' } },
    { method: 'return', cents: -200000 },
    { method: 'cash', cents: 64000 }
  ];
  it('leaves voided entries out and nets returns', () => {
    const t = paymentTotals(list);
    expect(t.count).toBe(4);
    expect(t.byMethod.card).toEqual({ count: 1, cents: 127550 });
    expect(t.byMethod.return).toEqual({ count: 1, cents: -200000 });
    expect(t.taken).toBe(676550);
    expect(t.returned).toBe(-200000);
    expect(t.net).toBe(476550);
  });
  it('gives the report grid in dollars per method', () => {
    expect(reportGridFrom(list)).toEqual({
      ach: { count: 0, amount: 0 }, cash: { count: 1, amount: 640 }, card: { count: 1, amount: 1275.5 },
      check: { count: 1, amount: 4850 }, return: { count: 1, amount: -2000 }
    });
  });
});

describe('cleanPayment', () => {
  const ok = { date: '2026-10-30', customerId: 'c1', customerName: 'Cascade Countertops', method: 'return', amount: '1000', invoice: ' INV-1 ', reference: 'R-9', note: ' chipped ' };
  it('accepts a full payment and tidies it', () => {
    expect(cleanPayment(ok, '2026-11-01')).toEqual({
      problems: {},
      value: { date: '2026-10-30', customerId: 'c1', customerName: 'Cascade Countertops', method: 'return', cents: -100000, invoice: 'INV-1', reference: 'R-9', note: 'chipped' }
    });
  });
  it('names every missing required field', () => {
    expect(cleanPayment({}, '2026-11-01').problems).toEqual({
      date: 'Pick a day', customer: 'Choose a company', method: 'Choose a method', amount: 'Enter an amount above 0'
    });
  });
  it('refuses a day after the branch\'s today and an impossible date', () => {
    expect(cleanPayment({ ...ok, date: '2026-11-02' }, '2026-11-01').problems.date).toBe('Can’t be after today');
    expect(cleanPayment({ ...ok, date: '2026-02-30' }, '2026-11-01').problems.date).toBe('Pick a day');
    expect(isDay('2026-02-28')).toBe(true);
  });
  it('refuses an unknown method', () => {
    expect(cleanPayment({ ...ok, method: 'bitcoin' }, '2026-11-01').problems.method).toBe('Choose a method');
  });
  it('says to use Return for a minus on cash', () => {
    expect(cleanPayment({ ...ok, method: 'cash', amount: '-20' }, '2026-11-01').problems.amount).toBe('Use Return for money going back');
  });
});

describe('changeSummary and search', () => {
  it('describes what an edit changed', () => {
    const before = { date: '2026-10-30', customerId: 'c1', customerName: 'A', method: 'card' as const, cents: 125750, invoice: '', reference: '', note: '' };
    expect(changeSummary(before, { ...before, cents: 127550, method: 'check' as const })).toEqual(['method Credit Card → Check', 'amount $1,257.50 → $1,275.50']);
  });
  it('searches company, invoice, reference and note', () => {
    const p = { customerName: 'Harbor Kitchen & Bath', invoice: 'INV-20431', reference: '4421', note: '' };
    expect(matchesPayment(p, 'harbor')).toBe(true);
    expect(matchesPayment(p, '20431')).toBe(true);
    expect(matchesPayment(p, 'cascade')).toBe(false);
  });
});
