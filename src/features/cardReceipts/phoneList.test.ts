import { describe, expect, it } from 'vitest';
import { approveButton, dayHeading, groupByDay, shortStatus } from './phoneList';
import type { Expense } from './types';

describe('dayHeading', () => {
  it('says Today and Yesterday on the branch clock, else the weekday and day', () => {
    expect(dayHeading('2026-11-25', '2026-11-25')).toBe('Today · Wed, Nov 25');
    expect(dayHeading('2026-11-24', '2026-11-25')).toBe('Yesterday · Tue, Nov 24');
    expect(dayHeading('2026-11-23', '2026-11-25')).toBe('Mon, Nov 23');
    expect(dayHeading('2026-11-23')).toBe('Mon, Nov 23');
  });
  it('crosses a month end for Yesterday', () => {
    expect(dayHeading('2026-10-31', '2026-11-01')).toBe('Yesterday · Sat, Oct 31');
  });
  it('leaves a value that is not a day alone', () => {
    expect(dayHeading('')).toBe('No date');
    expect(dayHeading('soon')).toBe('soon');
  });
});

describe('groupByDay', () => {
  const r = (date: string, cents: number) => ({ date, cents });
  it('keeps the list order, one group per day, with the day total', () => {
    const g = groupByDay([r('2026-11-24', 8642), r('2026-11-24', 6410), r('2026-11-23', 31258)], '2026-11-25');
    expect(g.map((x) => [x.heading, x.cents, x.rows.length])).toEqual([['Yesterday · Tue, Nov 24', 15052, 2], ['Mon, Nov 23', 31258, 1]]);
  });
  it('nets a refund against the day', () => {
    expect(groupByDay([r('2026-11-20', 5000), r('2026-11-20', -1500)])[0]!.cents).toBe(3500);
  });
  it('joins a day seen again to its first group', () => {
    const g = groupByDay([r('2026-11-24', 1), r('2026-11-23', 2), r('2026-11-24', 3)]);
    expect(g.map((x) => x.rows.length)).toEqual([2, 1]);
  });
  it('is empty for nothing', () => { expect(groupByDay([])).toEqual([]); });
});

describe('shortStatus', () => {
  it('is short for the right-hand column', () => {
    expect(shortStatus('waiting')).toBe('Waiting');
    expect(shortStatus('missing')).toBe('Missing receipt');
    expect(shortStatus('other')).toBe('other');
  });
});

const base = {
  id: 'e1', userId: 'u1', holderName: 'Jordan Hale', cardId: 'c', cardLabel: 'JORD40218', location: 'Seattle', holderRole: 'sales_rep', issuer: 'amex',
  date: '2026-11-24', merchant: 'Home Depot', cents: 8642, category: 'shop', subcategory: '', receiptUrl: '/r.jpg', lostReason: '', status: 'waiting',
  approval: null, secondApproval: null, ask: null, voided: null, mine: false, canDecide: true
} as unknown as Expense;
const withActions = (actions: Partial<NonNullable<Expense['actions']>>, over: Partial<Expense> = {}): Expense => ({
  ...base, ...over, actions: { approve: null, sendBack: false, ask: false, withdrawAsk: false, answer: false, reopen: false, fillDetails: false, ...actions }
});

describe('approveButton', () => {
  it('is one tap when nothing more is asked for', () => {
    expect(approveButton(withActions({ approve: 'accounting', sendBack: true }))).toEqual({ label: 'Approve', direct: true });
  });
  it('says how far along a $150+ receipt is', () => {
    const dec = { by: 'u2', byName: 'Chris', at: '2026-11-24', comment: '' };
    expect(approveButton(withActions({ approve: 'accounting' }, { cents: 48630, needsSecond: true }))!.label).toBe('Approve · 1 of 2');
    expect(approveButton(withActions({ approve: 'accounting' }, { cents: 48630, needsSecond: true, secondApproval: dec }))!.label).toBe('Final approval');
    expect(approveButton(withActions({ approve: 'second' }, { cents: 48630, needsSecond: true, approval: dec }))!.label).toBe('Final approval');
  });
  it('opens the receipt for a lost receipt, which needs the approver’s comment', () => {
    const b = approveButton(withActions({ approve: 'accounting' }, { receiptUrl: '', lostReason: 'Left it at the counter' }));
    expect(b).toEqual({ label: 'Approve with comment', direct: false });
  });
  it('opens the receipt to answer a question', () => {
    expect(approveButton(withActions({ answer: true }))).toEqual({ label: 'Answer', direct: false });
  });
  it('has nothing to decide without an approve or answer', () => {
    expect(approveButton(withActions({ sendBack: true }))).toBeNull();
    expect(approveButton(base)).toBeNull();
  });
});
