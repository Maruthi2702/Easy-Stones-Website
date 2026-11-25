import { describe, it, expect } from 'vitest';
import { statementKindFor, statementKindLabel, statementRowWords, isStatementKind } from './statementRows.ts';
import { isPaymentLine } from './amexStatement.ts';

const line = (kind: 'charge' | 'credit' | 'fee', cents: number, description = 'MERCHANT') => ({ kind, cents, description });

describe('which statement lines become rows', () => {
  it('a credit that is not a card payment is a refund, saved negative', () => {
    expect(statementKindFor(line('credit', -5400, 'EXPEDIATSPUS BELLEVUE WA'), false)).toBe('refund');
    expect(statementKindFor(line('credit', -1000, 'AMEX Wireless Credit'), false)).toBe('refund');
  });
  it('a card payment is no row', () => {
    expect(statementKindFor(line('credit', -8005018, 'AUTO PAYMENT DEDUCTION'), false)).toBeNull();
    expect(statementKindFor(line('credit', -50000, 'ONLINE PAYMENT - THANK YOU'), false)).toBeNull();
    expect(isPaymentLine('AUTO PAYMENT DEDUCTION')).toBe(true);
    expect(isPaymentLine('AMAZON MKTPLACE PMTS')).toBe(false);
  });
  it('a zero or positive "credit" is no row', () => {
    expect(statementKindFor(line('credit', 0), false)).toBeNull();
  });
  it('interest and bank fees are fee rows', () => {
    expect(statementKindFor(line('fee', 2500, '*EXPEDITED CARD DELIVERY FEE'), false)).toBe('fee');
    expect(statementKindFor(line('fee', 1375, 'FOREIGN TRANSACTION FEE'), false)).toBe('fee');
  });
  it('a charge is a row of its own kind only once a refund returned it', () => {
    expect(statementKindFor(line('charge', 34984, 'GRAINGER'), false)).toBeNull();
    expect(statementKindFor(line('charge', 34984, 'GRAINGER'), true)).toBe('refunded_charge');
  });
});

describe('words', () => {
  it('names each kind and says no receipt is needed', () => {
    expect(statementKindLabel('refund')).toBe('Refund');
    expect(statementKindLabel('fee')).toBe('Fee');
    expect(statementKindLabel('refunded_charge')).toBe('Refunded charge');
    expect(statementKindLabel('')).toBe('');
    expect(isStatementKind('fee')).toBe(true);
    expect(isStatementKind('')).toBe(false);
    for (const k of ['refund', 'fee', 'refunded_charge'] as const) expect(statementRowWords(k, 'Amex', 'R1')).toMatch(/No receipt is needed|no receipt is needed/);
  });
});
