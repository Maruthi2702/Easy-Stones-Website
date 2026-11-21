import { describe, expect, it } from 'vitest';
import { read, utils, write } from 'xlsx';
import {
  CARD_RECEIPTS, cleanExpense, parseCents, canApprove, isBigReceipt,
  decisionProblem, exportRows, statusTotals, PRIVATE_RECEIPT_ROUTE,
  privateReceiptNameOf, isMonth
} from '../../src/utils/cardReceipts.ts';
import { amexCents, cardForDigits, planMatches, readAmexActivity } from '../../src/utils/amexStatement.ts';
import { receiptFileProblem, MAX_RECEIPT_BYTES } from '../../src/utils/receiptFile.ts';

const categories = [{ name: 'fuel', label: 'Fuel', active: true }];
const expense = (over: Record<string, unknown> = {}) => ({
  date: '2026-11-05', merchant: 'Fuel station', total: '10.01', category: 'fuel',
  lostReason: 'Printer failed', ...over
});
const clean = (over: Record<string, unknown> = {}) => cleanExpense(expense(over), { today: '2026-11-20', categories });

describe('Money and date acceptance controls', () => {
  it.each([
    ['0.01', 1], ['0.29', 29], ['1.005', NaN], ['150.00', 15000], ['150.01', 15001],
    ['$1,250.50', 125050], ['100000.00', 10000000], ['100000.01', NaN],
    ['-1', NaN], ['1e3', NaN], ['Infinity', NaN], ['NaN', NaN], ['12.345', NaN], ['', null]
  ])('MONEY: parses %s without changing cents', (input, expected) => {
    expect(parseCents(input)).toBe(expected);
  });
  it.each(['0', '-1', '1e3', '12.345', '100000.01', 'NaN'])('MONEY: rejects invalid receipt total %s', (total) => {
    expect(clean({ total }).problems.total).toBeTruthy();
  });
  it.each(['12,34', '1 2.34', '1,23,456.78', '1$2.34'])('CC-01: rejects malformed money %s instead of silently changing its value', (total) => {
    expect(clean({ total }).value).toBeUndefined();
  });
  it.each(['subtotal', 'tax', 'tip'])('MONEY: rejects a negative or malformed %s', (key) => {
    expect(clean({ [key]: '-1' }).problems).toHaveProperty(key);
    expect(clean({ [key]: 'abc' }).problems).toHaveProperty(key);
  });
  it.each(['2026-02-29', '2026-11-31', '2026-13-01', '2026-00-10', '', 'not-a-date'])('DATE: rejects impossible day %s', (date) => {
    expect(clean({ date }).problems.date).toBeTruthy();
  });
  it('DATE: accepts leap day and derives exact cents', () => {
    expect(clean({ date: '2024-02-29' }).value).toMatchObject({ date: '2024-02-29', cents: 1001 });
  });
  it('CC-02: allows the one-day grace (a branch already on tomorrow) but rejects anything later', () => {
    expect(clean({ date: '2026-11-21' }).problems.date).toBeUndefined();
    expect(clean({ date: '2026-11-22' }).problems.date).toBeTruthy();
  });
  it('CC-02: rejects a timestamp rather than truncating it into a valid accounting day', () => {
    expect(clean({ date: '2026-11-05garbage' }).problems.date).toBeTruthy();
  });
  it.each(['2026-00', '2026-13', '2026-1', '26-01', '2026-01 OR 1=1'])('DATE: rejects malformed month %s', (month) => {
    expect(isMonth(month)).toBe(false);
  });
});

describe('Approval, reports, attachment and reconciliation boundaries', () => {
  it.each([[14999, false], [15000, false], [15001, true]])('APPROVAL: boundary %i requires second approval = %s', (cents, expected) => {
    expect(isBigReceipt(cents as number)).toBe(expected);
  });
  const approver = { id: 'manager', role: 'director', permissions: [CARD_RECEIPTS.APPROVE] };
  it('APPROVAL: never approves own expense, including at the second step', () => {
    expect(canApprove({ approver, holder: { id: 'manager', role: 'sales_rep' }, approverRoles: ['sales_rep'], cents: 15001, step1By: 'other' })).toBe(false);
  });
  it('APPROVAL: two different people are needed over $150', () => {
    expect(canApprove({ approver, holder: { id: 'rep', role: 'sales_rep' }, approverRoles: ['sales_rep'], cents: 15001, step1By: 'manager' })).toBe(false);
    expect(canApprove({ approver, holder: { id: 'rep', role: 'sales_rep' }, approverRoles: [], cents: 15001, step1By: 'other' })).toBe(true);
  });
  it.each(['draft', 'missing', 'sent_back', 'approved'])('APPROVAL: cannot decide status %s', (status) => {
    expect(decisionProblem('approve', { status }, 'OK')).toBeTruthy();
  });
  it('APPROVAL: voided expense, blank send-back reason, and blank lost-receipt approval are rejected', () => {
    expect(decisionProblem('approve', { status: 'waiting', voided: true }, 'OK')).toBeTruthy();
    expect(decisionProblem('send_back', { status: 'waiting' }, '  ')).toBeTruthy();
    expect(decisionProblem('approve', { status: 'waiting', lostReason: 'Lost' }, '  ')).toBeTruthy();
  });
  it('EXPORT: exact cent sums exclude voids, and the workbook keeps untrusted strings as text', () => {
    const list = [
      { date: '2026-11-05', location: 'Seattle', holderName: 'Rep', cardLabel: 'REP12345', merchant: '=1+1', cents: 29, category: 'fuel', status: 'approved', note: '@SUM(1,1)' },
      { date: '2026-11-05', location: 'Seattle', holderName: 'Rep', cardLabel: 'REP12345', merchant: 'Shop', cents: 1, category: 'fuel', status: 'draft' },
      { date: '2026-11-05', location: 'Seattle', holderName: 'Rep', cardLabel: 'REP12345', merchant: 'Void', cents: 10000, category: 'fuel', status: 'waiting', voided: true }
    ];
    expect(statusTotals(list)).toMatchObject({ count: 2, cents: 30, open: 1 });
    const rows = exportRows(list, categories);
    expect(rows).toHaveLength(2);
    expect(rows.reduce((n, r) => n + Math.round(r['Spent Amount'] * 100), 0)).toBe(30);
    const book = utils.book_new();
    utils.book_append_sheet(book, utils.json_to_sheet(rows), 'Receipts');
    const sheet = read(write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' }).Sheets.Receipts!;
    expect(sheet.E2).toMatchObject({ t: 's', v: '=1+1' });
    expect(sheet.E2.f).toBeUndefined();
    expect(sheet.L2).toMatchObject({ t: 's', v: '@SUM(1,1)' });
  });
  it.each([
    [{ name: 'empty.pdf', type: 'application/pdf', size: 0 }, false],
    [{ name: 'receipt.pdf', type: 'application/pdf', size: MAX_RECEIPT_BYTES }, true],
    [{ name: 'large.pdf', type: 'application/pdf', size: MAX_RECEIPT_BYTES + 1 }, false],
    [{ name: 'receipt.html', type: 'text/html', size: 10 }, false],
    [{ name: 'receipt.exe', type: 'application/octet-stream', size: 10 }, false],
    [{ name: 'receipt.HEIC', type: '', size: 10 }, true]
  ])('UPLOAD: validates file boundary %j', (file, accepted) => {
    expect(receiptFileProblem(file) === '').toBe(accepted);
  });
  it('SECURITY: private file names cannot contain traversal, queries or HTML', () => {
    for (const suffix of ['../secret.pdf', 'file.svg', '%2e%2e%2fsecret', 'img_1700000000000_0123456789abcdef01234567.webp?x=1']) {
      expect(privateReceiptNameOf(PRIVATE_RECEIPT_ROUTE + suffix)).toBe('');
    }
  });
  it('AMEX: overlapping digits that fit equally never choose an arbitrary card', () => {
    expect(cardForDigits([{ id: 'a', lastDigits: '12345', active: true }, { id: 'b', lastDigits: '12345', active: true }], '12345')).toBeNull();
  });
  it('AMEX: refunds stay negative and do not become expenses', () => {
    expect(amexCents('(12.34)')).toBe(-1234);
    expect(planMatches({ lines: [{ reference: 'refund', date: '2026-11-05', cents: -1234, kind: 'credit', cardId: 'a', expenseId: null }], expenses: [] }).create).toEqual([]);
  });
  it.each([-2, 2, -3, 3])('AMEX: exact two-day matching boundary (%i days)', (offset) => {
    const date = `2026-11-${String(10 + offset).padStart(2, '0')}`;
    const plan = planMatches({ lines: [{ reference: 'r', date: '2026-11-10', cents: 1000, kind: 'charge', cardId: 'c', expenseId: null }], expenses: [{ id: 'e', cardId: 'c', date, cents: 1000, status: 'waiting', voided: false }] });
    expect(plan.link.some(l => l.expenseId === 'e')).toBe(Math.abs(offset) <= 2);
  });
  it('AMEX: duplicate references invalidate the whole input', () => {
    const header = ['Date', 'Description', 'Card Member', 'Account #', 'Amount', 'Reference'];
    const row = ['11/05/2026', 'Shop', 'REP', '-12345', 10, 'R1'];
    expect(readAmexActivity([header, row, row]).problems).not.toEqual([]);
  });
});
