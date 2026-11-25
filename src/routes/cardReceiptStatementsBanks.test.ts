/**
 * One bank at a time (owner, 2026-11-24): an Amex upload checks only Amex's lines against receipts on Amex cards, an
 * Encore upload only Encore's against Encore cards. A person holding a card at each bank keeps the two apart; an
 * Encore file never reads, matches or makes anything at Amex. Through the real routers on an in-memory Postgres.
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
const SEATTLE = hex(1), MARU = hex(2), ACCT = hex(4), AMEX_CARD = hex(5), ENCORE_CARD = hex(6);
const R_AMEX = hex(10), R_ENCORE = hex(11), R_ELSEWHERE = hex(12);
const PEOPLE = [
  { _id: MARU, username: 'maruthi', displayName: 'Maruthi Ponugupati', role: 'sales_rep', location: 'Seattle', isActive: true },
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
const { cardStatementLines } = await import('../db/schema/cardStatements.ts');
const { cardExpenses, companyCards, cardExpenseHistory } = await import('../db/schema/cardsSuppliers.ts');
const { roles, users, locations } = await import('../db/schema/reference.ts');

const ACCOUNTANT = { id: ACCT, displayName: 'Ann Count', role: 'accounting', permissions: ['check_amex_statements', 'manage_company_cards'] };
const MARUTHI = { id: MARU, displayName: 'Maruthi Ponugupati', role: 'sales_rep', location: 'Seattle', permissions: ['use_card_receipts'] };
let who: Record<string, unknown> = ACCOUNTANT;

const AMEX_HEADER = ['Date', 'Receipt', 'Description', 'Card Member', 'Account #', 'Amount', 'Extended Details', 'Appears On Your Statement As', 'Address', 'City/State', 'Zip Code', 'Country', 'Reference', 'Category'];
const amexLine = (date: string, desc: string, amount: number, ref: string) =>
  [date, '', desc, 'MARUTHI PONUGUPATI', '-92069', amount, '', desc, '', 'SEATTLE WA', '98101', 'UNITED STATES', ref, 'Restaurant-Restaurant'];
const amexFile = (rows: unknown[][]) => {
  const wb = utils.book_new();
  utils.book_append_sheet(wb, utils.aoa_to_sheet([['Transaction Details', 'Business Platinum Card® / Nov 1, 2026 to Nov 10, 2026'], [], AMEX_HEADER, ...rows]), 'Transaction Details');
  return write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
const ENCORE_HEADER = ['Posted', 'Occurred', 'Merchant Name', 'Merchant City', 'Merchant State', 'Merchant Zip Code', 'Merchant Country', 'Originating Account Name', 'Originating Account Number',
  'MCC/SIC Code', 'MCC Description', 'Original Amount', 'Original Currency Code', 'Currency Desc', 'Conversion Rate', 'Billed Amount', 'Memo', 'Debit Credit', 'Reference Number', 'Statement Cycle', 'Account Name', 'Account Number'];
const encoreLine = (occurred: string, merchant: string, amount: number, ref: string) =>
  [occurred, occurred, merchant, 'SEATTLE', 'WA', '98101', 'USA', 'MARUTHI PONUGUPATI', '448462******3992', '5812', 'EATING PLACES', amount, 'USD', '', '1', amount, 'FALSE', 'D', ref, '11/16/26', 'TEST CORP', '448462******9799'];
const encoreFile = (rows: unknown[][]) => {
  const wb = utils.book_new();
  utils.book_append_sheet(wb, utils.aoa_to_sheet([ENCORE_HEADER, ...rows]), 'Sheet1');
  return write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
const uploadAmex = (rows: unknown[][]) => request(app).post('/api/card-receipts/statements/import').attach('file', amexFile(rows), 'amex.xlsx');
const uploadEncore = (rows: unknown[][]) => request(app).post('/api/card-receipts/statements/import').field('issuer', 'encore').attach('file', encoreFile(rows), 'encore.xlsx');
const linesOf = async (issuer: string) => (await db.select().from(cardStatementLines)).filter((l) => l.issuer === issuer);

let client: PGlite, db: Db, app: express.Express;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
  await migrateDb(db, 'pglite:memory');
  state.db = db;
  await db.insert(roles).values([{ id: hex(50), name: 'sales_rep', displayName: 'Sales rep' }, { id: hex(51), name: 'accounting', displayName: 'Accounting' }]);
  await db.insert(locations).values({ id: SEATTLE, name: 'Seattle' });
  await db.insert(users).values(PEOPLE.map((p) => ({ id: p._id, username: p.username, displayName: p.displayName, passwordHash: 'x', role: p.role, homeLocationId: SEATTLE })));
  // Maruthi holds a card at each bank, and has uploaded one receipt on each.
  await db.insert(companyCards).values([
    { id: AMEX_CARD, userId: MARU, label: 'MARU92069', lastDigits: '92069', issuer: 'amex' },
    { id: ENCORE_CARD, userId: MARU, label: 'MARU3992', lastDigits: '3992', issuer: 'encore' }
  ]);
  const receipt = (id: string, cardId: string, cardLabel: string, day: string, merchant: string, cents: number) => ({
    id, userId: MARU, holderName: 'Maruthi Ponugupati', cardId, cardLabel, locationId: SEATTLE, day, month: '2026-11', merchant, cents, status: 'waiting', receiptUrl: 'https://files.test/a.webp'
  });
  await db.insert(cardExpenses).values([
    receipt(R_AMEX, AMEX_CARD, 'MARU92069', '2026-11-05', 'Cafe', 4000),
    receipt(R_ENCORE, ENCORE_CARD, 'MARU3992', '2026-11-06', 'Fuel', 1200),
    // On his Amex card, but the money was spent on the Encore card: only a person's own click moves it.
    receipt(R_ELSEWHERE, AMEX_CARD, 'MARU92069', '2026-11-08', 'Hardware', 7750)
  ]);
  app = express();
  app.use(express.json());
  const authenticate: express.RequestHandler = (req, _res, next) => { (req as unknown as { user: unknown }).user = who; next(); };
  app.use('/api/card-receipts/statements', createCardReceiptStatementsRouter({ authenticate }));
  app.use('/api/card-receipts', createCardReceiptsRouter({ authenticate, processBase64Image: async () => 'https://files.test/x.webp' }));
}, 60_000);
afterAll(async () => { await client?.close(); });

describe('one bank at a time', () => {
  it('an Amex upload matches only receipts on Amex cards — the $12 Encore receipt is not taken for an Amex charge', async () => {
    // An Amex charge with the same day and amount as the receipt he saved on his Encore card.
    const res = await uploadAmex([amexLine('11/05/2026', 'CAFE ONE', 40, 'AM-cafe'), amexLine('11/06/2026', 'FUEL STOP', 12, 'AM-fuel')]);
    expect(res.status).toBe(200);
    expect(res.body.check).toMatchObject({ linked: 1, created: 1 });
    const amex = await linesOf('amex');
    expect(amex.find((l) => l.reference === 'AM-cafe')).toMatchObject({ cardId: AMEX_CARD, expenseId: R_AMEX });
    // The Amex fuel charge got its own Missing receipt row; the Encore receipt stayed where it was, still unmatched.
    const fuel = amex.find((l) => l.reference === 'AM-fuel')!;
    expect(fuel.expenseId).not.toBe(R_ENCORE);
    expect(fuel.expenseId).not.toBeNull();
    const [encoreReceipt] = await db.select().from(cardExpenses).where(eq(cardExpenses.id, R_ENCORE));
    expect(encoreReceipt).toMatchObject({ cardId: ENCORE_CARD, status: 'waiting', voidedAt: null });
  });

  it('an Encore upload checks Encore only: it matches an Encore receipt, makes rows only for Encore charges and leaves Amex lines alone', async () => {
    // An Amex charge that is still open (no receipt, no Missing row): an Encore file must not touch it.
    await db.insert(cardStatementLines).values({
      reference: 'AM-open', issuer: 'amex', day: '2026-11-09', description: 'OPEN AMEX CHARGE', cardMember: 'MARUTHI PONUGUPATI', digits: '92069', cents: 3300,
      kind: 'charge', cardId: AMEX_CARD, firstImportId: 'x', lastImportId: 'x'
    });
    const amexBefore = JSON.stringify(await linesOf('amex'));
    const res = await uploadEncore([
      encoreLine('11/06/26', 'FUEL STOP', 12, 'E-fuel'),
      // The same amount and day as his Amex cafe receipt — which is on an Amex card, so it can't answer this.
      encoreLine('11/05/26', 'CAFE ONE', 40, 'E-cafe')
    ]);
    expect(res.status).toBe(200);
    expect(res.body.check).toMatchObject({ linked: 1, created: 1 });
    const encore = await linesOf('encore');
    expect(encore.find((l) => l.reference.startsWith('ENC-E-fuel'))).toMatchObject({ cardId: ENCORE_CARD, expenseId: R_ENCORE });
    const cafe = encore.find((l) => l.reference.startsWith('ENC-E-cafe'))!;
    expect(cafe.expenseId).not.toBe(R_AMEX);
    expect(cafe.expenseId).not.toBeNull(); // its own Missing receipt row
    // Nothing at Amex moved: same lines, the open charge still open, the Amex receipt still on its Amex card with its Amex charge.
    expect(JSON.stringify(await linesOf('amex'))).toBe(amexBefore);
    expect((await linesOf('amex')).find((l) => l.reference === 'AM-open')!.expenseId).toBeNull();
    const [amexReceipt] = await db.select().from(cardExpenses).where(eq(cardExpenses.id, R_AMEX));
    expect(amexReceipt).toMatchObject({ cardId: AMEX_CARD, cardLabel: 'MARU92069' });
    const history = await db.select().from(cardExpenseHistory).where(eq(cardExpenseHistory.expenseId, R_AMEX));
    expect(history.map((h) => h.changes).join(' ')).not.toMatch(/Card changed/);
  });

  it('the next Amex upload is the one that looks at the open Amex charge', async () => {
    const res = await uploadAmex([amexLine('11/05/2026', 'CAFE ONE', 40, 'AM-cafe'), amexLine('11/06/2026', 'FUEL STOP', 12, 'AM-fuel')]);
    expect(res.status).toBe(200);
    expect(res.body.check.created).toBe(1);
    expect((await linesOf('amex')).find((l) => l.reference === 'AM-open')!.expenseId).not.toBeNull();
  });

  it('a receipt saved later is matched only to a charge at its own bank', async () => {
    // A new Encore charge, then Maruthi's receipt for it is saved on his Amex card (the wrong one): the Amex side has no such charge.
    await uploadEncore([encoreLine('11/06/26', 'FUEL STOP', 12, 'E-fuel'), encoreLine('11/05/26', 'CAFE ONE', 40, 'E-cafe'), encoreLine('11/08/26', 'HARDWARE', 77.5, 'E-hardware')]);
    const hardware = (await linesOf('encore')).find((l) => l.reference.startsWith('ENC-E-hardware'))!;
    // The charge has its own Missing receipt row; the Hardware receipt is on his Amex card, so the check left it unmatched.
    expect(hardware.expenseId).not.toBe(R_ELSEWHERE);
    const [still] = await db.select().from(cardExpenses).where(eq(cardExpenses.id, R_ELSEWHERE));
    expect(still).toMatchObject({ cardId: AMEX_CARD, voidedAt: null });
    expect((await db.select().from(cardStatementLines)).some((l) => l.expenseId === R_ELSEWHERE)).toBe(false);
  });

  it('a person can still move it by hand from the Missing receipt row ("This is my receipt")', async () => {
    const hardware = (await linesOf('encore')).find((l) => l.reference.startsWith('ENC-E-hardware'))!;
    who = MARUTHI;
    const near = await request(app).get(`/api/card-receipts/expenses/${hardware.expenseId}/near-receipts`);
    expect(near.status).toBe(200);
    expect(near.body.receipts.map((r: { id: string }) => r.id)).toContain(R_ELSEWHERE);
    const use = await request(app).post(`/api/card-receipts/expenses/${hardware.expenseId}/use-receipt`).send({ receiptId: R_ELSEWHERE });
    who = ACCOUNTANT;
    expect(use.status).toBe(200);
    expect((await linesOf('encore')).find((l) => l.reference.startsWith('ENC-E-hardware'))!.expenseId).toBe(R_ELSEWHERE);
    const [moved] = await db.select().from(cardExpenses).where(eq(cardExpenses.id, R_ELSEWHERE));
    expect(moved).toMatchObject({ cardId: ENCORE_CARD });
  });
});
