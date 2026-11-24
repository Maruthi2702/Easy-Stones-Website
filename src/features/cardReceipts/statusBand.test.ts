import { describe, it, expect } from 'vitest';
import { statusBandOf } from './cardReceiptsView';
import type { Expense } from './types';

const acct = { key: 'accounting', label: 'Accounting', by: '', done: false } as const;
const second = { key: 'second', label: 'Manager or Admin', by: '', done: false } as const;
const base = {
  id: 'e1', cents: 3538, status: 'waiting', approval: null, secondApproval: null, ask: null, sentBack: null, voided: null,
  chips: [acct], category: '', subcategory: '', attendees: [], lostReason: '', receiptUrl: 'x', merchant: 'Panera',
} as unknown as Expense;
const e = (o: Partial<Expense>) => ({ ...base, ...o }) as Expense;

describe('statusBandOf', () => {
  it('a small waiting receipt waits for Accounting', () => {
    const b = statusBandOf(e({}), [])!;
    expect(b.title).toBe('Waiting for Accounting');
    expect(b.segs).toEqual(['done', 'now', 'off']);
  });
  it('$150 and up: after Accounting it waits for the second approval, naming who gave the first', () => {
    const big = e({ cents: 41260, needsSecond: true, chips: [acct, second] });
    expect(statusBandOf(big, [])!.segs).toEqual(['done', 'now', 'off', 'off']);
    const b = statusBandOf(e({ cents: 41260, needsSecond: true, chips: [{ ...acct, by: 'Maria', done: true }, second] }), [])!;
    expect(b.title).toBe('Waiting for Manager or Admin');
    expect(b.segs).toEqual(['done', 'done', 'now', 'off']);
    expect(b.sub).toBe('Accounting ✓ Maria · Manager or Admin — waiting');
  });
  it('an open question says who it waits on', () => {
    const b = statusBandOf(e({ ask: { to: 'u', toName: 'Jeremy', by: 'm', byName: 'Maria', at: '', question: 'Who attended?', answer: '', answeredAt: null } }), [])!;
    expect(b.title).toBe('Waiting for Jeremy');
    expect(b.sub).toBe('Maria asked a question');
  });
  it('approved fills the bar; sent back carries the comment; voided has no band', () => {
    const ok = statusBandOf(e({ status: 'approved', chips: [{ ...acct, by: 'Maria', done: true }] }), [])!;
    expect(ok.title).toBe('Approved');
    expect(ok.segs).toEqual(['done', 'done', 'done']);
    const back = statusBandOf(e({ status: 'sent_back', sentBack: { by: 'u', byName: 'Jeremy', at: '', comment: 'Add who attended.' } }), [])!;
    expect(back.title).toBe('Jeremy sent this back');
    expect(back.sub).toBe('“Add who attended.”');
    expect(statusBandOf(e({ voided: { at: '', by: 'a', reason: 'x' } }), [])).toBeNull();
  });
});
