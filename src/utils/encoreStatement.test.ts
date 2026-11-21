import { describe, it, expect } from 'vitest';
import { readEncoreActivity, encoreDay, encoreDigits, encoreKey } from './encoreStatement.ts';
import { cardForDigits, kindOf, unknownCards } from './amexStatement.ts';

const HEADER = ['Posted', 'Occurred', 'Merchant Name', 'Merchant City', 'Merchant State', 'Merchant Zip Code', 'Merchant Country', 'Originating Account Name', 'Originating Account Number',
  'MCC/SIC Code', 'MCC Description', 'Original Amount', 'Original Currency Code', 'Currency Desc', 'Conversion Rate', 'Billed Amount', 'Memo', 'Debit Credit', 'Reference Number', 'Statement Cycle', 'Account Name', 'Account Number'];
const row = (o: { posted?: unknown; occurred?: unknown; merchant: string; holder?: string; card?: string; amount: number; flag?: string; ref?: string }) => [
  o.posted ?? '10/15/26', o.occurred ?? '10/14/26', o.merchant, 'NORCROSS', 'GA', '30071', 'USA', o.holder ?? 'TEST PERSON', o.card ?? '448462******3992',
  '5812', 'EATING PLACES', o.amount, 'USD', 'US Dollar - (840)', '1.000000000', o.amount, 'FALSE', o.flag ?? 'D', o.ref ?? '', '11/16/26', 'TEST CORP', '448462******9799'];

describe('reading an Encore export', () => {
  it('reads the day, amount, last 4 digits and holder; credits are negative', () => {
    const read = readEncoreActivity([HEADER,
      row({ merchant: 'CAFE ONE', amount: 13.26, ref: 'R1' }),
      row({ merchant: 'REFUND SHOP', amount: -5, flag: 'C', ref: 'R2' }),
      row({ merchant: 'REFUND SHOP 2', amount: 7, flag: 'C', ref: 'R3' })]);
    expect(read.problems).toEqual([]);
    expect(read.lines[0]).toMatchObject({ date: '2026-10-14', cents: 1326, digits: '3992', cardMember: 'TEST PERSON', description: 'CAFE ONE', cityState: 'NORCROSS, GA', amexCategory: 'EATING PLACES' });
    expect(read.lines[1]!.cents).toBe(-500);
    expect(read.lines[2]!.cents).toBe(-700);
    expect(read.period).toEqual({ from: '2026-10-14', to: '2026-10-14' });
  });

  it('accepts Excel day numbers and two-digit-year text for the day', () => {
    expect(encoreDay(46309)).toBe('2026-10-14');
    expect(encoreDay('10/14/26')).toBe('2026-10-14');
    expect(encoreDay('10/14/2026')).toBe('2026-10-14');
    expect(encoreDay('13/40/26')).toBe('');
    expect(encoreDigits('448462******3992')).toBe('3992');
    expect(encoreDigits('')).toBe('');
  });

  it('one reference on several rows (a fee beside its charge) is still one line each', () => {
    const read = readEncoreActivity([HEADER,
      row({ merchant: 'STICKERS', amount: 687.52, ref: 'SHARED' }),
      row({ merchant: 'FOREIGN TRANSACTION FEE', amount: 13.75, ref: 'SHARED' }),
      row({ merchant: 'CARD DELIVERY FEE', amount: 25, ref: 'SHARED', card: '448462******0339' }),
      row({ merchant: 'CARD DELIVERY FEE', amount: 25, ref: 'SHARED', card: '448462******2525' })]);
    expect(read.problems).toEqual([]);
    expect(new Set(read.lines.map((l) => l.reference)).size).toBe(4);
    expect(read.lines.map((l) => kindOf(l))).toEqual(['charge', 'fee', 'fee', 'fee']);
  });

  it('a row with no reference gets a stable key; the same file twice gives the same keys', () => {
    const rows = [HEADER, row({ merchant: 'ANNUAL FEE', amount: 25 }), row({ merchant: 'AUTO PAYMENT DEDUCTION', amount: -80050.18, flag: 'C', card: '' })];
    const a = readEncoreActivity(rows), b = readEncoreActivity(rows);
    expect(a.problems).toEqual([]);
    expect(a.lines.map((l) => l.reference)).toEqual(b.lines.map((l) => l.reference));
    expect(a.lines[0]!.reference).toMatch(/^ENC-h-[0-9a-f]{16}$/);
    expect(a.lines[1]).toMatchObject({ digits: '', cents: -8005018 });
    expect(kindOf(a.lines[1]!)).toBe('credit');
    expect(encoreKey({ reference: 'X', digits: '', cents: 5, date: 'd', description: 'e' })).toBe('ENC-X-x-5');
  });

  it('stops with the row number when a row can’t be read, or it is the same transaction twice', () => {
    expect(readEncoreActivity([HEADER, row({ merchant: 'A', amount: 5, occurred: 'soon', posted: '' })]).problems[0]).toMatch(/^Row 2: can’t read its date/);
    expect(readEncoreActivity([HEADER, row({ merchant: 'A', amount: 5, card: '' })]).problems[0]).toMatch(/card number/);
    expect(readEncoreActivity([HEADER, row({ merchant: 'A', amount: 5, flag: 'X' })]).problems[0]).toMatch(/Debit Credit/);
    const twice = readEncoreActivity([HEADER, row({ merchant: 'A', amount: 5, ref: 'Z' }), row({ merchant: 'A', amount: 5, ref: 'Z' })]);
    expect(twice.problems[0]).toMatch(/same transaction as row 2/);
  });

  it('refuses an Amex file with the reason', () => {
    const read = readEncoreActivity([['Date', 'Description', 'Card Member', 'Account #', 'Amount', 'Reference']]);
    expect(read.problems[0]).toMatch(/isn’t Encore’s transactions export/);
  });
});

describe('cards of two banks', () => {
  const cards = [
    { id: 'a', lastDigits: '33992', active: true, issuer: 'amex' },
    { id: 'e', lastDigits: '3992', active: true, issuer: 'encore' }
  ];
  it('an Encore line fits only an Encore card on the same 4 digits, an Amex line only an Amex card', () => {
    expect(cardForDigits(cards, '3992', 'encore')?.id).toBe('e');
    expect(cardForDigits(cards, '33992', 'amex')?.id).toBe('a');
    expect(cardForDigits([cards[0]!], '3992', 'encore')).toBeNull();
    expect(cardForDigits([cards[1]!], '33992', 'amex')).toBeNull();
    expect(cardForDigits(cards, '', 'encore')).toBeNull();
  });
  it('unknown cards are listed per bank', () => {
    const base = { cardMember: 'T', cents: 100, kind: 'charge' as const, date: '2026-11-02', cardId: null };
    const list = unknownCards([{ ...base, digits: '3992', issuer: 'encore' }, { ...base, digits: '3992', issuer: 'amex' }]);
    expect(list.map((c) => c.issuer).sort()).toEqual(['amex', 'encore']);
  });
});
