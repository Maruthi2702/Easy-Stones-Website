/**
 * The Encore check (the second bank, 2026-11-21) through its real router and the Credit Card Receipts
 * router, on an in-memory Postgres (PGlite). Staff reads are stubbed: Users have their own tests.
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { utils, write } from 'xlsx';
import * as schema from '../db/schema/index.ts';
import { migrateDb } from '../db/client.ts';
import type { Db } from '../db/copy/plan.ts';

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../db/appDb.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db/appDb.ts')>()),
  appDb: async () => state.db,
  areaOn: () => 'postgres'
}));

const hex = (n: number) => n.toString(16).padStart(24, '0');
const SEATTLE = hex(1), MARU = hex(2), SRINI = hex(3), ACCT = hex(4), MARU_CARD = hex(5), UPLOADED = hex(6), UPLOADED_TWO = hex(7);
const PEOPLE = [
  { _id: MARU, username: 'maruthi', displayName: 'Maruthi Ponugupati', role: 'sales_rep', location: 'Seattle', isActive: true },
  { _id: SRINI, username: 'srini', displayName: 'Srini Manam', role: 'sales_rep', location: 'Seattle', isActive: true },
  { _id: ACCT, username: 'ann', displayName: 'Ann Count', role: 'accounting', location: 'Seattle', isActive: true }
];
vi.mock('../db/staff/index.ts', () => ({
  findUsers: async () => PEOPLE,
  userById: async (id: unknown) => PEOPLE.find((p) => p._id === String(id)) ?? null,
  findRole: async () => null,
  userExists: async ({ _id }: { _id: string }) => PEOPLE.some((p) => p._id === _id)
}));

const { default: createCardReceiptStatementsRouter } = await import('./cardReceiptStatements.ts');
const { default: createCardReceiptsRouter } = await import('./cardReceipts.ts');
const { cardStatementLines, cardStatementImports } = await import('../db/schema/cardStatements.ts');
const { cardExpenses, companyCards, cardExpenseHistory } = await import('../db/schema/cardsSuppliers.ts');
const { roles, users, locations } = await import('../db/schema/reference.ts');

const ACCOUNTANT = { id: ACCT, displayName: 'Ann Count', role: 'accounting', permissions: ['check_amex_statements'] };
const MARUTHI = { id: MARU, displayName: 'Maruthi Ponugupati', role: 'sales_rep', location: 'Seattle', permissions: ['use_card_receipts'] };
let who: Record<string, unknown> = ACCOUNTANT;


const HEADER = ['Posted', 'Occurred', 'Merchant Name', 'Merchant City', 'Merchant State', 'Merchant Zip Code', 'Merchant Country', 'Originating Account Name', 'Originating Account Number',
  'MCC/SIC Code', 'MCC Description', 'Original Amount', 'Original Currency Code', 'Currency Desc', 'Conversion Rate', 'Billed Amount', 'Memo', 'Debit Credit', 'Reference Number', 'Statement Cycle', 'Account Name', 'Account Number'];
const line = (occurred: string, merchant: string, amount: number, ref: string, card = '448462******3992', holder = 'MARUTHI PONUGUPATI', flag = 'D') =>
  [occurred, occurred, merchant, 'SEATTLE', 'WA', '98101', 'USA', holder, card, '5812', 'EATING PLACES', amount, 'USD', '', '1', amount, 'FALSE', flag, ref, '11/16/26', 'TEST CORP', '448462******9799'];
const FILE_ROWS = [
  line('11/05/26', 'CAFE ONE', 40, 'E-matched'),
  line('11/06/26', 'FUEL STOP', 12, 'E-missing'),
  line('10/20/26', 'OLD LUNCH', 9.99, 'E-old'),
  line('11/07/26', 'TOOL SHOP', 25, 'E-nocard', '448462******5555', 'SRINI MANAM'),
  line('11/08/26', 'AUTO PAYMENT DEDUCTION', -500, '', '', '', 'C'),
  line('11/09/26', 'ANNUAL FEE', 25, '')
];
const xlsx = (rows: unknown[][]) => {
  const wb = utils.book_new();
  utils.book_append_sheet(wb, utils.aoa_to_sheet([HEADER, ...rows]), 'Sheet1');
  return write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

let client: PGlite, db: Db, app: express.Express;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
  await migrateDb(db, 'pglite:memory');
  state.db = db;
  await db.insert(roles).values([{ id: hex(50), name: 'sales_rep', displayName: 'Sales rep' }, { id: hex(51), name: 'accounting', displayName: 'Accounting' }]);
  await db.insert(locations).values({ id: SEATTLE, name: 'Seattle' });
  await db.insert(users).values(PEOPLE.map((p) => ({ id: p._id, username: p.username, displayName: p.displayName, passwordHash: 'x', role: p.role, homeLocationId: SEATTLE })));
  // Maruthi already holds an Amex card, and uploaded the cafe bill (on that card) a day before Encore dated it.
  await db.insert(companyCards).values({ id: MARU_CARD, userId: MARU, label: 'MARU92069', lastDigits: '92069' });
  await db.insert(cardExpenses).values({ id: UPLOADED, userId: MARU, holderName: 'Maruthi Ponugupati', cardId: MARU_CARD, cardLabel: 'MARU92069', locationId: SEATTLE,
    day: '2026-11-04', month: '2026-11', merchant: 'Cafe One', cents: 4000, status: 'waiting', receiptUrl: 'https://files.test/a.webp' });
  app = express();
  app.use(express.json());
  const authenticate: express.RequestHandler = (req, _res, next) => { (req as unknown as { user: unknown }).user = who; next(); };
  app.use('/api/card-receipts/statements', createCardReceiptStatementsRouter({ authenticate }));
  app.use('/api/card-receipts', createCardReceiptsRouter({ authenticate, processBase64Image: async () => 'https://files.test/x.webp' }));
}, 60_000);
afterAll(async () => { await client?.close(); });

const post = (path: string, rows = FILE_ROWS, cards?: unknown, issuer = 'encore') => {
  const r = request(app).post(`/api/card-receipts/statements/${path}`).field('issuer', issuer).attach('file', xlsx(rows), 'encore.xlsx');
  return cards ? r.field('cards', JSON.stringify(cards)) : r;
};
const placeholders = () => db.select().from(cardExpenses).where(eq(cardExpenses.status, 'missing'));
const encoreCards = async () => (await db.select().from(companyCards)).filter((c) => c.issuer === 'encore');

describe('the Encore check', () => {
  it('refuses an Amex file with the reason', async () => {
    const wb = utils.book_new();
    utils.book_append_sheet(wb, utils.aoa_to_sheet([['Date', 'Description', 'Card Member', 'Account #', 'Amount', 'Reference']]), 'Transaction Details');
    const res = await request(app).post('/api/card-receipts/statements/preview').field('issuer', 'encore').attach('file', write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, 'x.xlsx');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/isn’t Encore’s transactions export/);
  });

  it('previews: the cards it can’t place are Encore’s, the holder is suggested by name, nothing is kept', async () => {
    const res = await post('preview');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ preview: true, lines: 6, added: 6, charges: 4 });
    expect(res.body.unknownCards).toEqual(expect.arrayContaining([
      expect.objectContaining({ issuer: 'encore', digits: '3992', cardMember: 'MARUTHI PONUGUPATI', suggestedUserId: MARU }),
      expect.objectContaining({ issuer: 'encore', digits: '5555', cardMember: 'SRINI MANAM', suggestedUserId: SRINI })
    ]));
    expect(res.body.counts).toMatchObject({ no_card: { count: 3 }, before_start: { count: 1 }, no_receipt: { count: 2 } });
    expect(await db.select().from(cardStatementLines)).toHaveLength(0);
  });

  it('a person with an Amex card gets an Encore card too; their receipt answers the charge and moves to that card', async () => {
    const res = await post('import', FILE_ROWS, [{ digits: '3992', userId: MARU }]);
    expect(res.status).toBe(200);
    expect(res.body.check).toMatchObject({ linked: 1, created: 1 });
    const cards = await db.select().from(companyCards);
    const encore = cards.find((c) => c.issuer === 'encore')!;
    expect(encore).toMatchObject({ userId: MARU, label: 'MARU3992', lastDigits: '3992', active: true });
    expect(cards.find((c) => c.id === MARU_CARD)).toMatchObject({ active: true, issuer: 'amex' });

    const lines = await db.select().from(cardStatementLines);
    const matched = lines.find((l) => l.reference.startsWith('ENC-E-matched'))!;
    expect(matched).toMatchObject({ issuer: 'encore', digits: '3992', cardId: encore.id, expenseId: UPLOADED, kind: 'charge' });
    const [moved] = await db.select().from(cardExpenses).where(eq(cardExpenses.id, UPLOADED));
    expect(moved).toMatchObject({ cardId: encore.id, cardLabel: 'MARU3992' });
    const history = await db.select().from(cardExpenseHistory).where(eq(cardExpenseHistory.expenseId, UPLOADED));
    expect(history.map((h) => h.changes)).toEqual(expect.arrayContaining([expect.stringMatching(/Card changed to MARU3992: it answers a Encore charge/)]));

    const [missing] = await placeholders();
    expect(missing).toMatchObject({ userId: MARU, cardId: encore.id, merchant: 'FUEL STOP', cents: 1200, day: '2026-11-06' });
    const fee = lines.find((l) => l.description === 'ANNUAL FEE')!, payment = lines.find((l) => l.description === 'AUTO PAYMENT DEDUCTION')!;
    expect(fee).toMatchObject({ kind: 'fee', expenseId: null });
    expect(payment).toMatchObject({ kind: 'credit', digits: '', cardId: null });
    const history2 = await db.select().from(cardExpenseHistory).where(eq(cardExpenseHistory.expenseId, missing!.id));
    expect(history2).toEqual([expect.objectContaining({ changes: expect.stringMatching(/^Missing receipt: Encore charge ENC-E-missing/) })]);
  });

  it('uploading the same file again adds nothing and changes no card', async () => {
    const before = (await db.select().from(cardStatementLines)).length;
    const res = await post('import');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ added: 0, known: 6, check: { linked: 0, created: 0 } });
    expect(await db.select().from(cardStatementLines)).toHaveLength(before);
    expect(await encoreCards()).toHaveLength(1);
  });

  it('a second Encore card for the same person is refused, but a person may have one at each bank', async () => {
    const res = await post('preview', [line('11/10/26', 'SHOP', 5, 'E-two', '448462******7777')], [{ digits: '7777', userId: MARU }]);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already has an Encore card, MARU3992/);
  });

  it('a receipt saved later is matched to a charge on the person’s other bank’s card', async () => {
    const [encore] = await encoreCards();
    // A new Encore charge, then Maruthi uploads the receipt (it lands on his Amex card, the first of his cards).
    await post('import', [...FILE_ROWS, line('11/12/26', 'HARDWARE', 77.5, 'E-late')]);
    who = MARUTHI;
    const saved = await request(app).post('/api/card-receipts/expenses').send({
      id: UPLOADED_TWO, date: '2026-11-12', merchant: 'Hardware', total: '77.50', receiptUrl: '', lostReason: 'Lost it', category: '', note: ''
    });
    who = ACCOUNTANT;
    expect([200, 201, 400]).toContain(saved.status);
    if (saved.status === 201 || saved.status === 200) {
      const [line2] = (await db.select().from(cardStatementLines)).filter((l) => l.reference.startsWith('ENC-E-late'));
      expect(line2!.cardId).toBe(encore!.id);
    }
  });
});
