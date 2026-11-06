import { describe, it, expect } from 'vitest';
import {
  CARD_RECEIPTS, canOpenReceipts, categoryKey, cleanCategory, parseCents, formatMoney, usDate, shiftMonth, monthLabel,
  suggestCardLabel, cleanCard, cleanExpense, missingFor, missingLine, statusAfterSave, holderMayEdit, changeSummary,
  possibleRepeat, canApprove, cleanApproverRoles, decisionProblem, statusTotals, exportRows, type CategoryLike
} from './cardReceipts.ts';

const CATS: CategoryLike[] = [
  { name: 'travel_lunch', label: 'Travel Lunch' },
  { name: 'customer_lunch', label: 'Customer Lunch', fields: { customer: true, attendees: true } },
  { name: 'software_and_subscriptions', label: 'Software & Subscriptions', fields: { recurring: true } },
  { name: 'travel', label: 'Travel', fields: { purpose: true } }
];
const TODAY = '2026-11-05';
const base = { date: '2026-10-03', merchant: "McDonald's, Kent", total: '14.32', category: 'travel_lunch', receiptUrl: 'https://res.cloudinary.com/x/r.webp' };

describe('categories', () => {
  it('stores a key made from the label that never needs to change', () => {
    expect(categoryKey('Software & Subscriptions')).toBe('software_and_subscriptions');
    expect(categoryKey('  Customer Lunch ')).toBe('customer_lunch');
  });
  it('needs a name not already on the list', () => {
    expect(cleanCategory({ label: '' }, []).problems.label).toBeTruthy();
    expect(cleanCategory({ label: 'fuel' }, [{ _id: 'a', label: 'Fuel' }]).problems.label).toMatch(/already/);
    expect(cleanCategory({ label: 'Fuel' }, [{ _id: 'a', label: 'Fuel' }], 'a').value?.label).toBe('Fuel');
    expect(cleanCategory({ label: 'Gifts', fields: { customer: true, attendees: 'yes' } }, []).value?.fields)
      .toEqual({ customer: true, attendees: false, purpose: false, recurring: false });
  });
});

describe('money, dates, cards', () => {
  it('reads typed amounts into cents and refuses anything else', () => {
    expect(parseCents('$1,250.50')).toBe(125050);
    expect(parseCents('14.32')).toBe(1432);
    expect(parseCents('')).toBeNull();
    expect(parseCents('-3')).toBeNaN();
    expect(parseCents('1.234')).toBeNaN();
  });
  it('shows money and the card log’s date format', () => {
    expect(formatMoney(411694)).toBe('$4,116.94');
    expect(usDate('2026-10-03')).toBe('10-03-2026');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthLabel('2026-10')).toBe('October 2026');
  });
  it('suggests the card ID accounting uses and checks a card', () => {
    expect(suggestCardLabel('Maruthi Ponugupati', '92069')).toBe('MARU92069');
    expect(cleanCard({ userId: 'u1', lastDigits: '92069', label: 'maru92069' }).value)
      .toEqual({ userId: 'u1', issuer: 'amex', lastDigits: '92069', label: 'MARU92069' });
    expect(Object.keys(cleanCard({ lastDigits: '12', label: '' }).problems)).toEqual(['userId', 'lastDigits', 'label']);
  });
});

describe('an expense', () => {
  it('saves a complete one in cents', () => {
    const { value, missing } = cleanExpense({ ...base, tax: '1.35' }, { today: TODAY, categories: CATS });
    expect(value).toMatchObject({ cents: 1432, taxCents: 135, subtotalCents: null, category: 'travel_lunch' });
    expect(missing).toEqual({});
  });
  it('needs a date that has happened, a merchant and a total', () => {
    const { problems } = cleanExpense({ date: '2026-12-01', merchant: '', total: '0' }, { today: TODAY, categories: CATS });
    expect(Object.keys(problems).sort()).toEqual(['date', 'merchant', 'total']);
  });
  it('lets a draft leave the receipt and category for later, and says what’s missing', () => {
    const { value, missing } = cleanExpense({ date: '2026-10-11', merchant: 'SP PARK', total: '12.85' }, { today: TODAY, categories: CATS });
    expect(value).toBeTruthy();
    expect(missingLine(missing)).toBe('Upload the receipt and pick a category');
  });
  it('asks a category’s extra fields and drops the ones another category doesn’t use', () => {
    const lunch = cleanExpense({ ...base, category: 'customer_lunch', customerId: '', recurring: true }, { today: TODAY, categories: CATS });
    expect(Object.keys(lunch.missing)).toEqual(['customer', 'attendees']);
    expect(lunch.value?.recurring).toBe(false);
    const travel = cleanExpense({ ...base, category: 'travel_lunch', customerId: 'c1', attendees: ['A'] }, { today: TODAY, categories: CATS });
    expect(travel.value).toMatchObject({ customerId: '', attendees: [] });
    expect(missingFor({ ...travel.value!, category: 'travel', purpose: '' }, CATS[3])).toEqual({ purpose: 'Say what it was for' });
  });
  it('takes a lost-receipt reason instead of a photo, never both', () => {
    const lost = cleanExpense({ ...base, receiptUrl: '', lostReason: 'Pump didn’t print one' }, { today: TODAY, categories: CATS });
    expect(lost.missing).toEqual({});
    const both = cleanExpense({ ...base, lostReason: 'x' }, { today: TODAY, categories: CATS });
    expect(both.value?.lostReason).toBe('');
    expect(cleanExpense({ ...base, receiptUrl: 'javascript:1' }, { today: TODAY, categories: CATS }).problems.receipt).toBeTruthy();
  });
  it('refuses a category that left the list', () => {
    expect(cleanExpense({ ...base, category: 'gone' }, { today: TODAY, categories: CATS }).problems.category).toBeTruthy();
  });
  it('goes to the approver once complete; a sent-back one stays sent back until then', () => {
    expect(statusAfterSave(true)).toBe('waiting');
    expect(statusAfterSave(false)).toBe('draft');
    expect(statusAfterSave(false, 'sent_back')).toBe('sent_back');
    expect(holderMayEdit({ status: 'approved' })).toBe(false);
    expect(holderMayEdit({ status: 'sent_back' })).toBe(true);
    expect(holderMayEdit({ status: 'waiting', voided: new Date() })).toBe(false);
  });
  it('names what changed', () => {
    const { value } = cleanExpense({ ...base, total: '15.00' }, { today: TODAY, categories: CATS });
    expect(changeSummary({ ...value!, cents: 1432 }, value!)).toEqual(['total']);
  });
});

describe('the same receipt twice', () => {
  const saved = [{ id: 'a', userId: 'u1', date: '2026-10-09', cents: 9817 }, { id: 'b', userId: 'u2', date: '2026-10-09', cents: 9817 }];
  it('finds the cardholder’s expense with the same day and total, whatever the merchant says', () => {
    expect(possibleRepeat(saved, { userId: 'u1', date: '2026-10-09', cents: 9817 })?.id).toBe('a');
    expect(possibleRepeat(saved, { userId: 'u1', date: '2026-10-09', cents: 9900 })).toBeNull();
    expect(possibleRepeat(saved, { id: 'a', userId: 'u1', date: '2026-10-09', cents: 9817 })).toBeNull();
    expect(possibleRepeat([{ ...saved[0]!, voided: new Date() }], { userId: 'u1', date: '2026-10-09', cents: 9817 })).toBeNull();
  });
});

describe('approval', () => {
  const director = { id: 'd1', permissions: [CARD_RECEIPTS.APPROVE] };
  it('follows the approver role’s list, from any branch, never their own', () => {
    const roles = cleanApproverRoles(['Sales_Rep', 'manager', 'manager', '']);
    expect(roles).toEqual(['sales_rep', 'manager']);
    expect(canApprove({ approver: director, approverRoles: roles, holder: { id: 'm1', role: 'manager' } })).toBe(true);
    expect(canApprove({ approver: director, approverRoles: roles, holder: { id: 'x', role: 'director' } })).toBe(false);
    expect(canApprove({ approver: director, approverRoles: ['director'], holder: { id: 'd1', role: 'director' } })).toBe(false);
    expect(canApprove({ approver: { id: 'd1', permissions: [] }, approverRoles: roles, holder: { id: 'm1', role: 'manager' } })).toBe(false);
  });
  it('approves only a waiting one, and a lost receipt only with a comment', () => {
    expect(decisionProblem('approve', { status: 'waiting' }, '')).toBe('');
    expect(decisionProblem('approve', { status: 'waiting', lostReason: 'lost' }, '')).toMatch(/comment/);
    expect(decisionProblem('approve', { status: 'waiting', lostReason: 'lost' }, 'OK, delivery run')).toBe('');
    expect(decisionProblem('send_back', { status: 'waiting' }, ' ')).toMatch(/fixing/);
    expect(decisionProblem('approve', { status: 'draft' }, 'x')).toBeTruthy();
    expect(decisionProblem('approve', { status: 'approved' }, 'x')).toMatch(/already/);
  });
});

describe('totals and the export', () => {
  const list = [
    { status: 'approved', cents: 1432, userId: 'u1' },
    { status: 'waiting', cents: 11579, userId: 'u1' },
    { status: 'draft', cents: 5729, userId: 'u2' },
    { status: 'waiting', cents: 100, userId: 'u3', voided: new Date() }
  ];
  it('counts by status, voided ones left out', () => {
    const t = statusTotals(list);
    expect(t.byStatus.waiting).toEqual({ count: 1, cents: 11579 });
    expect([t.count, t.cents, t.holders, t.open]).toEqual([3, 18740, 2, 2]);
  });
  it('starts with the card log’s six columns, in its format', () => {
    const [row] = exportRows([{
      date: '2026-10-07', location: 'Seattle', holderName: 'Maruthi Ponugupati', cardLabel: 'MARU92069', merchant: 'Chevron',
      cents: 12500, category: 'fuel', status: 'waiting', lostReason: 'Pump didn’t print one'
    }], [{ name: 'fuel', label: 'Fuel' }]);
    expect(Object.keys(row!).slice(0, 6)).toEqual(['Transaction Date', 'Location', 'C C Holder Name', 'Credit Card Number', 'Description', 'Spent Amount']);
    expect(row).toMatchObject({ 'Transaction Date': '10-07-2026', Location: 'SEATTLE', 'C C Holder Name': 'MARUTHI PONUGUPATI', Description: 'CHEVRON', 'Spent Amount': 125, Category: 'Fuel', Receipt: 'Lost: Pump didn’t print one' });
  });
  it('opens the page with any of its switches', () => {
    expect(canOpenReceipts({ permissions: [CARD_RECEIPTS.APPROVE] })).toBe(true);
    expect(canOpenReceipts({ permissions: [CARD_RECEIPTS.EXPORT] })).toBe(false);
  });
});
