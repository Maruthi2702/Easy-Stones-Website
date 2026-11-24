import { describe, it, expect } from 'vitest';
import {
  amexDay, amexCents, amexDigits, periodOf, readAmexActivity, kindOf, lineStatus, cardForDigits, suggestHolder,
  unknownCards, planMatches, merchantOf, statusCounts, isNearMatch, nearMatches, pairRefunds, type MatchLine, type MatchExpense
} from './amexStatement.ts';

const HEADER = ['Date', 'Receipt', 'Description', 'Card Member', 'Account #', 'Amount', 'Extended Details', 'Appears On Your Statement As', 'Address', 'City/State', 'Zip Code', 'Country', 'Reference', 'Category'];
const sheet = (...data: unknown[][]) => [
  ['Transaction Details', 'Business Platinum Card® / Sep 29, 2026 to Oct 29, 2026'],
  ['Prepared for'], ['TEST HOLDER'], ['Account Number'], ['XXXX-XXXXXX-97001'], [],
  HEADER,
  ...data
];
const row = (date: string, desc: string, amount: unknown, ref: string, account = '-92069', member = 'MARUTHI PONUGUPATI', category = 'Restaurant-Restaurant') =>
  [date, '', desc, member, account, amount, 'details', desc, '1 Main St', 'SEATTLE WA', '98101', 'UNITED STATES', ref, category];

describe('reading cells', () => {
  it('reads Amex days, Excel day numbers and refuses impossible ones', () => {
    expect(amexDay('10/29/2026')).toBe('2026-10-29');
    expect(amexDay('1/2/2026')).toBe('2026-01-02');
    expect(amexDay(46324)).toBe('2026-10-29');
    expect(amexDay('02/30/2026')).toBe('');
    expect(amexDay('2026-10-29')).toBe('');
  });
  it('reads amounts as cents, credits negative', () => {
    expect(amexCents(4.99)).toBe(499);
    expect(amexCents('-40521.63')).toBe(-4052163);
    expect(amexCents('$1,234.5')).toBe(123450);
    expect(amexCents('(12.00)')).toBe(-1200);
    expect(amexCents('abc')).toBeNull();
    expect(amexCents(0.1 + 0.2)).toBe(30);
  });
  it('keeps the last 5 digits of the account', () => {
    expect(amexDigits('-92069')).toBe('92069');
    expect(amexDigits('XXXX-XXXXXX-97001')).toBe('97001');
    expect(amexDigits('-12')).toBe('');
  });
  it('reads the period from the title', () => {
    expect(periodOf('Business Platinum Card® / Sep 29, 2026 to Oct 29, 2026')).toEqual({ from: '2026-09-29', to: '2026-10-29' });
    expect(periodOf('nothing')).toBeNull();
  });
});

describe('readAmexActivity', () => {
  it('finds the header by name and reads every line', () => {
    const read = readAmexActivity(sheet(
      row('10/29/2026', 'AMAZON PRIME*UC99N4EAMZN.COM/BILL       WA', 4.99, '320263020855963537', '-92135', 'ABHINAV C MEDURI'),
      [],
      row('10/26/2026', 'ONLINE PAYMENT - THANK YOU', -40521.63, '161030060000336400', '-97001', 'SREEKANTH MANAM', '')
    ));
    expect(read.problems).toEqual([]);
    expect(read.period).toEqual({ from: '2026-09-29', to: '2026-10-29' });
    expect(read.skippedRows).toBe(1);
    expect(read.lines).toHaveLength(2);
    expect(read.lines[0]).toMatchObject({
      reference: '320263020855963537', date: '2026-10-29', cents: 499, digits: '92135', cardMember: 'ABHINAV C MEDURI',
      description: 'AMAZON PRIME*UC99N4EAMZN.COM/BILL WA', cityState: 'SEATTLE WA', amexCategory: 'Restaurant-Restaurant'
    });
    expect(read.lines[1]!.cents).toBe(-4052163);
  });
  it('refuses a file that isn’t the export', () => {
    expect(readAmexActivity([['Name', 'Total'], ['x', 1]]).problems[0]).toMatch(/isn’t Amex’s activity export/);
  });
  it('stops on a row it can’t read and on a Reference twice', () => {
    const read = readAmexActivity(sheet(
      row('13/45/2026', 'X', 1, 'r1'),
      row('10/01/2026', 'Y', 'lots', 'r2'),
      row('10/01/2026', 'Z', 1, 'r3'),
      row('10/02/2026', 'Z again', 1, 'r3')
    ));
    expect(read.problems).toEqual([
      'Row 8: can’t read its date.',
      'Row 9: can’t read its amount.',
      'Row 11: Reference r3 is also on row 10.'
    ]);
  });
  it('falls back to the first and last day when the title has no period', () => {
    const read = readAmexActivity([HEADER, row('10/05/2026', 'A', 1, 'a'), row('10/01/2026', 'B', 1, 'b')]);
    expect(read.period).toEqual({ from: '2026-10-01', to: '2026-10-05' });
  });
});

describe('kindOf and lineStatus', () => {
  it('sorts credits, interest and fees from charges', () => {
    expect(kindOf({ cents: -100, description: 'THE HOME DEPOT', amexCategory: '' })).toBe('credit');
    expect(kindOf({ cents: 344876, description: 'Interest Charge on Pay Over Time Purchases', amexCategory: 'Fees & Adjustments-Fees & Adjustments' })).toBe('fee');
    expect(kindOf({ cents: 3320, description: 'JPMC FEE            REDMOND             WA', amexCategory: 'Other-Utilities' })).toBe('fee');
    expect(kindOf({ cents: 200, description: 'TEXAS.GOV*SERVICEFEEAUSTIN              TX', amexCategory: 'Other-Government Services' })).toBe('fee');
    expect(kindOf({ cents: 11207, description: 'TN SERV FEE ST FRANCJEFFERSONVILL       IN', amexCategory: 'Other-Education' })).toBe('fee');
    expect(kindOf({ cents: 25000, description: 'CITY OF SEATTLE PERMIT FEE SEATTLE             WA', amexCategory: 'Other-Government Services' })).toBe('charge');
    expect(kindOf({ cents: 7500, description: 'KING CO RECORDING FEE', amexCategory: 'Other-Government Services' })).toBe('charge');
    expect(kindOf({ cents: 650, description: "JANNA'S COFFEE", amexCategory: 'Restaurant-Bar & Café' })).toBe('charge');
    expect(kindOf({ cents: 35000, description: 'MYFREIGHTWORLDCARRIEOVERLAND PARK       KS', amexCategory: 'Business Services-Other Services' })).toBe('charge');
    expect(kindOf({ cents: 1800, description: 'EZPASS', amexCategory: 'Transportation-Tolls & Fees' })).toBe('charge');
  });
  it('says where a line stands', () => {
    const base = { kind: 'charge' as const, date: '2026-11-03', cardId: 'c1', expenseStatus: null };
    expect(lineStatus({ ...base, kind: 'credit' })).toBe('no_receipt');
    expect(lineStatus({ ...base, expenseStatus: 'waiting' })).toBe('matched');
    expect(lineStatus({ ...base, expenseStatus: 'missing' })).toBe('missing');
    expect(lineStatus({ ...base, cardId: null })).toBe('no_card');
    expect(lineStatus({ ...base, unassigned: true })).toBe('unassigned');
    expect(lineStatus({ ...base, unassigned: true, expenseStatus: 'waiting' })).toBe('matched');
    expect(lineStatus({ ...base, unassigned: true, date: '2026-10-20' })).toBe('before_start');
    expect(lineStatus({ ...base, date: '2026-10-20', cardId: null })).toBe('before_start');
    expect(lineStatus({ ...base, date: '2026-10-20', expenseStatus: 'approved' })).toBe('matched');
    expect(lineStatus({ ...base, expenseStatus: 'draft', expenseVoided: true })).toBe('missing');
    // An Admin's charge with no upload waits for Accounting; once it has a receipt or a lost reason it is matched.
    expect(lineStatus({ ...base, expenseStatus: 'waiting', hasReceipt: false })).toBe('awaiting');
    expect(lineStatus({ ...base, expenseStatus: 'waiting', hasReceipt: true })).toBe('matched');
    expect(lineStatus({ ...base, expenseStatus: 'approved', hasReceipt: false })).toBe('matched');
  });
  it('counts per status', () => {
    const c = statusCounts([{ status: 'missing', cents: 100 }, { status: 'missing', cents: 50 }, { status: 'matched', cents: 7 }]);
    expect(c.missing).toEqual({ count: 2, cents: 150 });
    expect(c.no_card).toEqual({ count: 0, cents: 0 });
  });
});

describe('cards', () => {
  const cards = [
    { id: 'a', lastDigits: '92069', active: true },
    { id: 'b', lastDigits: '2135', active: true },
    { id: 'old', lastDigits: '41008', active: false },
    { id: 'x1', lastDigits: '7777', active: true },
    { id: 'x2', lastDigits: '7777', active: true }
  ];
  it('finds a card by its digits, never by name', () => {
    expect(cardForDigits(cards, '92069')?.id).toBe('a');
    expect(cardForDigits(cards, '92135')?.id).toBe('b');
    expect(cardForDigits(cards, '41008')?.id).toBe('old');
    expect(cardForDigits(cards, '17777')).toBeNull(); // two fit equally
    expect(cardForDigits(cards, '55555')).toBeNull();
    expect(cardForDigits([...cards, { id: 'new', lastDigits: '41008', active: true }], '41008')?.id).toBe('new');
  });
  it('suggests the one staff person with the Card Member’s first and last name', () => {
    const people = [
      { id: '1', name: 'Maruthi Ponugupati', active: true },
      { id: '2', name: 'Srini Manam', active: true },
      { id: '3', name: 'Sreekanth Manam', active: true },
      { id: '4', name: 'Thivikram Valluru', active: false }
    ];
    expect(suggestHolder(people, 'MARUTHI PONUGUPATI')?.id).toBe('1');
    expect(suggestHolder(people, 'SREEKANTH MANAM')?.id).toBe('3');
    expect(suggestHolder(people, 'THIVIKRAM  VALLURU')).toBeNull();
    expect(suggestHolder(people, 'NOBODY HERE')).toBeNull();
  });
  it('lists each unknown card once with its charges', () => {
    const lines = [
      { digits: '93018', cardMember: 'THIVIKRAM  VALLURU', cents: 1000, kind: 'charge' as const, date: '2026-10-05', cardId: null },
      { digits: '93018', cardMember: 'THIVIKRAM  VALLURU', cents: -200, kind: 'credit' as const, date: '2026-10-01', cardId: null },
      { digits: '92069', cardMember: 'MARUTHI', cents: 500, kind: 'charge' as const, date: '2026-10-02', cardId: 'a' },
      { digits: '97001', cardMember: 'SREEKANTH MANAM', cents: -50000, kind: 'credit' as const, date: '2026-10-02', cardId: null }
    ];
    expect(unknownCards(lines)).toEqual([{ issuer: 'amex', digits: '93018', cardMember: 'THIVIKRAM  VALLURU', charges: 1, cents: 1000, first: '2026-10-01', last: '2026-10-05' }]);
  });
});

describe('planMatches', () => {
  const line = (reference: string, date: string, cents: number, over: Partial<MatchLine> = {}): MatchLine =>
    ({ reference, date, cents, kind: 'charge', cardId: 'card1', expenseId: null, ...over });
  const exp = (id: string, date: string, cents: number, over: Partial<MatchExpense> = {}): MatchExpense =>
    ({ id, date, cents, cardId: 'card1', status: 'waiting', voided: false, ...over });

  it('matches the exact amount on the same card within 2 days, nearest first', () => {
    const plan = planMatches({
      lines: [line('r1', '2026-11-10', 5040)],
      expenses: [exp('far', '2026-11-12', 5040), exp('near', '2026-11-09', 5040), exp('tipless', '2026-11-10', 4200), exp('other', '2026-11-10', 5040, { cardId: 'card2' })]
    });
    expect(plan).toEqual({ link: [{ reference: 'r1', expenseId: 'near' }], create: [], retire: [] });
  });
  it('never matches 3 days apart, a voided upload or a different amount; makes a Missing receipt row instead', () => {
    const plan = planMatches({
      lines: [line('r1', '2026-11-10', 5040)],
      expenses: [exp('a', '2026-11-13', 5040), exp('b', '2026-11-10', 5040, { voided: true }), exp('c', '2026-11-10', 5041)]
    });
    expect(plan).toEqual({ link: [], create: ['r1'], retire: [] });
  });
  it('gives an upload to one charge only: two identical coffees need two uploads', () => {
    const plan = planMatches({
      lines: [line('r1', '2026-11-10', 650), line('r2', '2026-11-10', 650)],
      expenses: [exp('only', '2026-11-10', 650)]
    });
    expect(plan.link).toEqual([{ reference: 'r1', expenseId: 'only' }]);
    expect(plan.create).toEqual(['r2']);
  });
  it('keeps a charge’s upload and leaves credits, fees and unknown cards alone', () => {
    const plan = planMatches({
      lines: [
        line('kept', '2026-11-10', 100, { expenseId: 'mine' }),
        line('credit', '2026-11-10', -100, { kind: 'credit' }),
        line('fee', '2026-11-10', 100, { kind: 'fee' }),
        line('nocard', '2026-11-10', 100, { cardId: null })
      ],
      expenses: [exp('mine', '2026-11-10', 100, { status: 'approved' }), exp('spare', '2026-11-10', 100)]
    });
    expect(plan).toEqual({ link: [], create: [], retire: [] });
  });
  it('swaps a Missing receipt row for an upload that turns up, and keeps it while none does', () => {
    const plan = planMatches({
      lines: [line('r1', '2026-11-10', 999, { expenseId: 'ph1' }), line('r2', '2026-11-11', 777, { expenseId: 'ph2' })],
      expenses: [exp('ph1', '2026-11-10', 999, { status: 'missing' }), exp('ph2', '2026-11-11', 777, { status: 'missing' }), exp('real', '2026-11-11', 999)]
    });
    expect(plan).toEqual({ link: [{ reference: 'r1', expenseId: 'real' }], create: [], retire: [{ expenseId: 'ph1', reference: 'r1', by: 'real' }] });
  });
  it('never makes a Missing receipt row before the start day, but still matches', () => {
    const plan = planMatches({
      lines: [line('old', '2026-10-20', 100), line('oldmatch', '2026-10-21', 200), line('new', '2026-11-01', 300)],
      expenses: [exp('x', '2026-10-22', 200)],
      missingFrom: '2026-11-01'
    });
    expect(plan).toEqual({ link: [{ reference: 'oldmatch', expenseId: 'x' }], create: ['new'], retire: [] });
  });
  it('lets go of a voided upload and asks for the receipt again', () => {
    const plan = planMatches({ lines: [line('r1', '2026-11-10', 100, { expenseId: 'gone' })], expenses: [exp('gone', '2026-11-10', 100, { voided: true })] });
    expect(plan).toEqual({ link: [{ reference: 'r1', expenseId: null }], create: ['r1'], retire: [] });
  });
});

it('merchantOf keeps one space and 80 characters', () => {
  expect(merchantOf('AMAZON PRIME*UC99N4EAMZN.COM/BILL       WA')).toBe('AMAZON PRIME*UC99N4EAMZN.COM/BILL WA');
  expect(merchantOf('   ')).toBe('Amex charge');
  expect(merchantOf('x'.repeat(100))).toHaveLength(80);
});

describe('near matches (offered, never automatic)', () => {
  const charge = { date: '2026-11-10', cents: 4518 };
  it('is close when within a week and within $5 or 10%, whichever is wider', () => {
    expect(isNearMatch(charge, { date: '2026-11-09', cents: 4500 })).toBe(true);
    expect(isNearMatch(charge, { date: '2026-11-17', cents: 4518 })).toBe(true);
    expect(isNearMatch(charge, { date: '2026-11-18', cents: 4518 })).toBe(false);
    expect(isNearMatch(charge, { date: '2026-11-10', cents: 4018 })).toBe(true);
    expect(isNearMatch(charge, { date: '2026-11-10', cents: 4017 })).toBe(false);
    // A $480 hotel: 10% ($48) is wider than $5.
    expect(isNearMatch({ date: '2026-11-10', cents: 48000 }, { date: '2026-11-06', cents: 43200 })).toBe(true);
    expect(isNearMatch({ date: '2026-11-10', cents: 48000 }, { date: '2026-11-06', cents: 43199 })).toBe(false);
  });
  it('lists the closest amount first, then the closest day', () => {
    const list = nearMatches(charge, [
      { id: 'a', date: '2026-11-10', cents: 4300 },
      { id: 'b', date: '2026-11-14', cents: 4500 },
      { id: 'c', date: '2026-11-10', cents: 4500 },
      { id: 'd', date: '2026-11-01', cents: 4518 }
    ]);
    expect(list.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('refunds pair with their charges (review B9)', () => {
  const l = (reference: string, date: string, cents: number, digits = '92069', description = 'HOME DEPOT') => ({ reference, issuer: 'amex', digits, date, cents, description });
  it('pairs the same card, the exact amount back, within 30 days after, one credit for one charge', () => {
    const charges = [l('c1', '2026-11-03', 20000), l('c2', '2026-11-05', 20000), l('c3', '2026-11-04', 20000, '11111')];
    const pairs = pairRefunds(charges, [l('r1', '2026-11-06', -20000), l('r2', '2026-12-30', -20000)]);
    // The newest earlier charge on that card; the credit 55 days later returns nothing; another card is untouched.
    expect([...pairs]).toEqual([['c2', 'r1']]);
  });
  it('never pairs a charge with a credit before it, a different amount, or a card payment', () => {
    expect(pairRefunds([l('c1', '2026-11-10', 5000)], [l('r1', '2026-11-09', -5000)]).size).toBe(0);
    expect(pairRefunds([l('c1', '2026-11-10', 5000)], [l('r1', '2026-11-11', -4999)]).size).toBe(0);
    expect(pairRefunds([l('c1', '2026-11-10', 5000)], [l('r1', '2026-11-11', -5000, '92069', 'ONLINE PAYMENT - THANK YOU')]).size).toBe(0);
  });
  it('a refunded charge reads as Refunded unless a receipt is already on it', () => {
    const base = { kind: 'charge' as const, date: '2026-11-06', cardId: 'k' };
    expect(lineStatus({ ...base, expenseStatus: null, refunded: true })).toBe('refunded');
    expect(lineStatus({ ...base, expenseStatus: 'missing', refunded: true })).toBe('refunded');
    expect(lineStatus({ ...base, expenseStatus: 'waiting', hasReceipt: true, refunded: true })).toBe('matched');
    expect(lineStatus({ ...base, expenseStatus: null })).toBe('missing');
  });
});
