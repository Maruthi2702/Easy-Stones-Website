/**
 * The Amex check through its real router and the Credit Card Receipts router, on an in-memory
 * Postgres (PGlite). Staff reads are stubbed: Users have their own tests.
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
const SEATTLE = hex(1), MARU = hex(2), SRINI = hex(3), ACCT = hex(4), MARU_CARD = hex(5), UPLOADED = hex(6), ADA = hex(7), ADA_CARD = hex(8);
const PEOPLE = [
  { _id: MARU, username: 'maruthi', displayName: 'Maruthi Ponugupati', role: 'sales_rep', location: 'Seattle', isActive: true },
  { _id: SRINI, username: 'srini', displayName: 'Srini Manam', role: 'sales_rep', location: 'Seattle', isActive: true },
  { _id: ACCT, username: 'ann', displayName: 'Ann Count', role: 'accounting', location: 'Seattle', isActive: true },
  { _id: ADA, username: 'ada', displayName: 'Ada Min', role: 'admin', location: 'Seattle', isActive: true }
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

const HEADER = ['Date', 'Receipt', 'Description', 'Card Member', 'Account #', 'Amount', 'Extended Details', 'Appears On Your Statement As', 'Address', 'City/State', 'Zip Code', 'Country', 'Reference', 'Category'];
const line = (date: string, desc: string, amount: number, ref: string, account = '-92069', member = 'MARUTHI PONUGUPATI', category = 'Restaurant-Restaurant') =>
  [date, '', desc, member, account, amount, '', desc, '', 'SEATTLE WA', '98101', 'UNITED STATES', ref, category];
const FILE_ROWS = [
  line('11/05/2026', 'JINYA RAMEN BAR', 50.4, 'ref-matched'),
  line('11/06/2026', 'CHEVRON 0207730', 12, 'ref-missing'),
  line('10/20/2026', 'SHELL OIL', 9.99, 'ref-old'),
  line('11/07/2026', 'OFFICE DEPOT', 25, 'ref-nocard', '-93018', 'SRINI MANAM'),
  line('11/08/2026', 'ONLINE PAYMENT - THANK YOU', -500, 'ref-credit', '-97001', 'SREEKANTH MANAM', ''),
  line('11/09/2026', 'Interest Charge on Pay Over Time Purchases', 34.48, 'ref-fee', '-97001', 'SREEKANTH MANAM', 'Fees & Adjustments-Fees & Adjustments')
];
const xlsx = (rows: unknown[][]) => {
  const wb = utils.book_new();
  utils.book_append_sheet(wb, utils.aoa_to_sheet([['Transaction Details', 'Business Platinum Card® / Nov 1, 2026 to Nov 10, 2026'], [], HEADER, ...rows]), 'Transaction Details');
  return write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

let client: PGlite, db: Db, app: express.Express;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
  await migrateDb(db, 'pglite:memory');
  state.db = db;
  await db.insert(roles).values([{ id: hex(50), name: 'sales_rep', displayName: 'Sales rep' }, { id: hex(51), name: 'accounting', displayName: 'Accounting' }, { id: hex(52), name: 'admin', displayName: 'Admin' }]);
  await db.insert(locations).values({ id: SEATTLE, name: 'Seattle' });
  await db.insert(users).values(PEOPLE.map((p) => ({ id: p._id, username: p.username, displayName: p.displayName, passwordHash: 'x', role: p.role, homeLocationId: SEATTLE })));
  await db.insert(companyCards).values({ id: MARU_CARD, userId: MARU, label: 'MARU92069', lastDigits: '92069' });
  // Maruthi uploaded the ramen bill a day before Amex dated it, tip included.
  await db.insert(cardExpenses).values({ id: UPLOADED, userId: MARU, holderName: 'Maruthi Ponugupati', cardId: MARU_CARD, cardLabel: 'MARU92069', locationId: SEATTLE,
    day: '2026-11-04', month: '2026-11', merchant: 'Jinya', cents: 5040, status: 'waiting', receiptUrl: 'https://files.test/a.webp' });
  app = express();
  app.use(express.json());
  const authenticate: express.RequestHandler = (req, _res, next) => { (req as unknown as { user: unknown }).user = who; next(); };
  app.use('/api/card-receipts/statements', createCardReceiptStatementsRouter({ authenticate }));
  app.use('/api/card-receipts', createCardReceiptsRouter({ authenticate, processBase64Image: async () => 'https://files.test/x.webp' }));
}, 60_000);
afterAll(async () => { await client?.close(); });

const post = (path: string, rows = FILE_ROWS, cards?: unknown) => {
  const r = request(app).post(`/api/card-receipts/statements/${path}`).attach('file', xlsx(rows), 'amex.xlsx');
  return cards ? r.field('cards', JSON.stringify(cards)) : r;
};
const placeholders = () => db.select().from(cardExpenses).where(eq(cardExpenses.status, 'missing'));

describe('the Amex check', () => {
  it('needs the Amex check switch', async () => {
    who = MARUTHI;
    expect((await request(app).get('/api/card-receipts/statements?month=2026-11')).status).toBe(403);
    who = ACCOUNTANT;
  });

  it('refuses a file that isn’t Amex’s export, with the reason', async () => {
    const res = await request(app).post('/api/card-receipts/statements/preview')
      .attach('file', (() => { const wb = utils.book_new(); utils.book_append_sheet(wb, utils.aoa_to_sheet([['Name', 'Total']]), 'S'); return write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer; })(), 'x.xlsx');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/isn’t Amex’s activity export/);
  });

  it('previews what an upload would do and keeps nothing', async () => {
    const res = await post('preview');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ preview: true, lines: 6, added: 6, known: 0, charges: 4, chargesCents: 5040 + 1200 + 999 + 2500 + 3448 });
    expect(res.body.counts).toMatchObject({ matched: { count: 1 }, missing: { count: 1 }, before_start: { count: 1 }, no_card: { count: 1 }, no_receipt: { count: 2 } });
    expect(res.body.unknownCards).toEqual([expect.objectContaining({ digits: '93018', cardMember: 'SRINI MANAM', charges: 1, suggestedUserId: SRINI })]);
    expect(await db.select().from(cardStatementLines)).toHaveLength(0);
    expect(await db.select().from(cardStatementImports)).toHaveLength(0);
    expect(await placeholders()).toHaveLength(0);
  });

  it('a preview with a card picked shows its effect, still keeping nothing', async () => {
    const res = await post('preview', FILE_ROWS, [{ digits: '93018', userId: SRINI }]);
    expect(res.body.counts).toMatchObject({ missing: { count: 2 }, no_card: { count: 0 } });
    expect(await db.select().from(companyCards)).toHaveLength(1);
  });

  it('imports: matches the upload, makes one Missing receipt row, leaves the rest', async () => {
    const res = await post('import');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ added: 6, check: { linked: 1, created: 1, retired: 0 } });
    const rows = await db.select().from(cardStatementLines);
    const by = Object.fromEntries(rows.map((r) => [r.reference, r]));
    expect(by['ref-matched']).toMatchObject({ expenseId: UPLOADED, cardId: MARU_CARD, kind: 'charge' });
    expect(by['ref-credit']).toMatchObject({ kind: 'credit', expenseId: null });
    expect(by['ref-fee']).toMatchObject({ kind: 'fee', expenseId: null });
    expect(by['ref-old']).toMatchObject({ cardId: MARU_CARD, expenseId: null });
    expect(by['ref-nocard']).toMatchObject({ cardId: null, expenseId: null });
    const [missing] = await placeholders();
    expect(missing).toMatchObject({ userId: MARU, holderName: 'Maruthi Ponugupati', cardId: MARU_CARD, cardLabel: 'MARU92069', locationId: SEATTLE,
      day: '2026-11-06', month: '2026-11', merchant: 'CHEVRON 0207730', cents: 1200, category: null, receiptUrl: '' });
    expect(by['ref-missing']!.expenseId).toBe(missing!.id);
    const history = await db.select().from(cardExpenseHistory).where(eq(cardExpenseHistory.expenseId, missing!.id));
    expect(history).toEqual([expect.objectContaining({ action: 'added', by: 'Ann Count', changes: 'Missing receipt: Amex charge ref-missing' })]);
  });

  it('uploading the same file again adds nothing', async () => {
    const res = await post('import');
    expect(res.body).toMatchObject({ added: 0, known: 6, check: { linked: 0, created: 0, retired: 0 } });
    expect(await db.select().from(cardStatementLines)).toHaveLength(6);
    expect(await placeholders()).toHaveLength(1);
    expect(await db.select().from(cardStatementImports)).toHaveLength(2);
  });

  it('sets up a card from the Statements tab and asks its holder for the receipt', async () => {
    const res = await request(app).post('/api/card-receipts/statements/cards').send({ digits: '93018', userId: SRINI });
    expect(res.status).toBe(200);
    expect(res.body.check).toMatchObject({ cardsFound: 1, created: 1 });
    const [card] = await db.select().from(companyCards).where(eq(companyCards.userId, SRINI));
    expect(card).toMatchObject({ label: 'SRIN93018', lastDigits: '93018', active: true, issuer: 'amex' });
    expect((await placeholders()).map((p) => p.userId).sort()).toEqual([MARU, SRINI].sort());
    // One card per person, and one card per digits.
    expect((await request(app).post('/api/card-receipts/statements/cards').send({ digits: '93018', userId: ACCT })).status).toBe(409);
    expect((await request(app).post('/api/card-receipts/statements/cards').send({ digits: '11111', userId: MARU })).body.message).toMatch(/already has card MARU92069/);
  });

  it('a receipt uploaded the normal way takes the Missing receipt row’s place', async () => {
    who = MARUTHI;
    const [before] = (await placeholders()).filter((p) => p.userId === MARU);
    // A Missing receipt row can't be voided away.
    const voided = await request(app).post(`/api/card-receipts/expenses/${before!.id}/void`).send({ reason: 'not mine' });
    expect(voided.status).toBe(409);
    expect(voided.body.message).toMatch(/charge on the Amex statement/);
    // The same day and total as the Missing receipt row: not a repeat — it answers the charge.
    const id = hex(99);
    const res = await request(app).post('/api/card-receipts/expenses').send({ id, date: '2026-11-06', merchant: 'Chevron', total: '12.00' });
    expect(res.status).toBe(201);
    expect(res.body.replacedMissing).toBe(before!.id);
    const [line] = await db.select().from(cardStatementLines).where(eq(cardStatementLines.reference, 'ref-missing'));
    expect(line!.expenseId).toBe(id);
    const [gone] = await db.select().from(cardExpenses).where(eq(cardExpenses.id, before!.id));
    expect(gone).toMatchObject({ voidReason: 'Receipt uploaded', voidedBy: 'Maruthi Ponugupati' });
    // A second receipt of the same total has no charge left to answer.
    const again = await request(app).post('/api/card-receipts/expenses').send({ id: hex(100), date: '2026-11-06', merchant: 'Chevron', total: '12.00', confirmRepeat: true });
    expect(again.body.replacedMissing).toBeUndefined();
    who = ACCOUNTANT;
  });

  it('shows the month’s lines with their status, the receipts still missing and the uploads', async () => {
    const res = await request(app).get('/api/card-receipts/statements?month=2026-11');
    expect(res.status).toBe(200);
    const status = Object.fromEntries(res.body.lines.map((l: { reference: string; status: string }) => [l.reference, l.status]));
    expect(status).toEqual({ 'ref-matched': 'matched', 'ref-missing': 'matched', 'ref-nocard': 'missing', 'ref-credit': 'no_receipt', 'ref-fee': 'no_receipt' });
    expect(res.body.lines.find((l: { reference: string }) => l.reference === 'ref-nocard')).toMatchObject({ cardLabel: 'SRIN93018', holderName: 'Srini Manam' });
    expect(res.body.missingNow).toEqual({ count: 1, cents: 2500 });
    // 97001 has only the payment and the interest: nothing to set up.
    expect(res.body.unknownCards).toEqual([]);
    expect(res.body.imports).toHaveLength(2);
    const october = await request(app).get('/api/card-receipts/statements?month=2026-10');
    expect(october.body.lines).toEqual([expect.objectContaining({ reference: 'ref-old', status: 'before_start' })]);
  });

  it('a later upload swaps a Missing receipt row for an upload saved since', async () => {
    // Srini's receipt arrives through some path that didn't claim the charge (here: straight into the table).
    const [ph] = (await placeholders()).filter((p) => p.userId === SRINI);
    const [card] = await db.select().from(companyCards).where(eq(companyCards.userId, SRINI));
    await db.insert(cardExpenses).values({ id: hex(200), userId: SRINI, holderName: 'Srini Manam', cardId: card!.id, cardLabel: card!.label, locationId: SEATTLE,
      day: '2026-11-09', month: '2026-11', merchant: 'Office Depot', cents: 2500, status: 'draft' });
    const res = await post('import');
    expect(res.body.check).toMatchObject({ linked: 1, retired: 1, created: 0 });
    const [line] = await db.select().from(cardStatementLines).where(eq(cardStatementLines.reference, 'ref-nocard'));
    expect(line!.expenseId).toBe(hex(200));
    const [old] = await db.select().from(cardExpenses).where(eq(cardExpenses.id, ph!.id));
    expect(old!.voidedAt).not.toBeNull();
  });
});

describe('approving a month from before the check started', () => {
  it('previews, then gives each charge on a set-up card an Approved expense, and runs twice safely', async () => {
    const { approveMonthWithoutReceipts } = await import('../db/cardStatements/index.ts');
    const by = { id: 'amex-month-approve', name: 'Amex backfill' };
    const preview = await approveMonthWithoutReceipts('2026-10', by, { preview: true }, db);
    expect(preview).toEqual({ charges: 1, toAdd: 1, cents: 999, cardNotSetUp: 0, added: 0 });
    expect(await db.select().from(cardExpenses).where(eq(cardExpenses.merchant, 'Shell Oil'))).toHaveLength(0);

    const done = await approveMonthWithoutReceipts('2026-10', by, {}, db);
    expect(done).toMatchObject({ toAdd: 1, added: 1 });
    const [row] = await db.select().from(cardExpenses).where(eq(cardExpenses.day, '2026-10-20'));
    expect(row).toMatchObject({ userId: MARU, cardId: MARU_CARD, cents: 999, status: 'approved', month: '2026-10', approvedByName: 'Amex backfill' });
    const [line] = await db.select().from(cardStatementLines).where(eq(cardStatementLines.reference, 'ref-old'));
    expect(line!.expenseId).toBe(row!.id);

    const october = await request(app).get('/api/card-receipts/statements?month=2026-10');
    expect(october.body.lines).toEqual([expect.objectContaining({ reference: 'ref-old', status: 'matched' })]);
    expect(await approveMonthWithoutReceipts('2026-10', by, {}, db)).toMatchObject({ toAdd: 0, added: 0 });
  });

  it('a card with no holder yet shows its charges as Missing receipt but asks no one, until a login is assigned', async () => {
    const orphan = hex(300);
    await db.insert(companyCards).values({ id: orphan, userId: null, label: 'THIV95555', lastDigits: '95555' });
    const before = (await placeholders()).length;
    const rows = [line('11/12/2026', 'FUEL STOP', 40, 'ref-orphan', '-95555', 'THIVIKRAM VALLURU')];
    const res = await post('import', rows);
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ missing: { count: 1, cents: 4000 }, no_card: { count: 0 } });
    expect(res.body.unknownCards).toEqual([]);
    expect(await placeholders()).toHaveLength(before);
    const [l] = await db.select().from(cardStatementLines).where(eq(cardStatementLines.reference, 'ref-orphan'));
    expect(l).toMatchObject({ cardId: orphan, expenseId: null });
    const view = await request(app).get('/api/card-receipts/statements?month=2026-11');
    expect(view.body.lines.find((x: { reference: string }) => x.reference === 'ref-orphan')).toMatchObject({ status: 'missing', cardLabel: 'THIV95555', holderName: '' });
    expect(view.body.missingNow).toMatchObject({ count: 1, cents: 4000 });

    // Assigning the card to a login (Cards → Edit) asks that person for the receipt.
    who = { ...ACCOUNTANT, permissions: ['check_amex_statements', 'manage_company_cards'] };
    const assign = await request(app).put(`/api/card-receipts/cards/${orphan}`).send({ userId: ACCT });
    expect(assign.status).toBe(200);
    expect(assign.body.card).toMatchObject({ userId: ACCT, label: 'THIV95555' });
    const made = (await placeholders()).filter((p) => p.userId === ACCT);
    expect(made).toEqual([expect.objectContaining({ day: '2026-11-12', cents: 4000, cardLabel: 'THIV95555', merchant: 'FUEL STOP' })]);
    // An unassigned card can be deactivated without a holder.
    const loose = hex(301);
    await db.insert(companyCards).values({ id: loose, userId: null, label: 'LOOS95556', lastDigits: '95556' });
    expect((await request(app).put(`/api/card-receipts/cards/${loose}`).send({ active: false })).body.card).toMatchObject({ userId: '', active: false });
    who = ACCOUNTANT;
  });

  it('a replaced card (new digits, same name) deactivates the old one only when confirmed by someone who manages cards', async () => {
    await post('import', [line('11/12/2026', 'NEW CARD SHOP', 25, 'ref-new', '-77777', 'MARUTHI PONUGUPATI')]);
    const setUp = (body: object) => request(app).post('/api/card-receipts/statements/cards').send(body);
    // Not confirmed: still refused, nothing changes.
    expect((await setUp({ digits: '77777', userId: MARU })).body.message).toMatch(/Confirm the replacement/);
    // Confirmed, but this login can't manage cards.
    expect((await setUp({ digits: '77777', userId: MARU, replace: true })).body.message).toMatch(/needs someone who manages company cards/);
    who = { ...ACCOUNTANT, permissions: ['check_amex_statements', 'manage_company_cards'] };
    // A different name on the new digits is not a replacement.
    await post('import', [line('11/12/2026', 'OTHER', 25, 'ref-other', '-88888', 'SOMEBODY ELSE')]);
    expect((await setUp({ digits: '88888', userId: MARU, replace: true })).body.message).toMatch(/already has card MARU92069/);
    expect((await setUp({ digits: '77777', userId: MARU, replace: true })).status).toBe(200);
    const cards = await db.select().from(companyCards).where(eq(companyCards.userId, MARU));
    expect(cards.filter((c) => c.active).map((c) => c.lastDigits)).toEqual(['77777']);
    expect(cards.find((c) => c.lastDigits === '92069')?.active).toBe(false);
    who = ACCOUNTANT;
  });

  it('the Cards list carries the name Amex prints (from the statements), and a typed name is kept on the card', async () => {
    who = { ...ACCOUNTANT, permissions: ['check_amex_statements', 'manage_company_cards'] };
    const res = await request(app).get('/api/card-receipts/cards');
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.body.cards.map((c: { label: string; statementName: string; amexName: string }) => [c.label, c]));
    expect(by.MARU92069).toMatchObject({ statementName: 'MARUTHI PONUGUPATI', amexName: '' });
    expect(by.SRIN93018.statementName).toBe('SRINI MANAM');
    expect(by.THIV95555.statementName).toBe('THIVIKRAM VALLURU');
    // Typing a name saves it (upper case, single-spaced) and the statement's name is still offered beside it.
    const saved = await request(app).put(`/api/card-receipts/cards/${by.THIV95555._id}`).send({ amexName: '  thivikram   valluru  ' });
    expect(saved.status).toBe(200);
    expect(saved.body.card.amexName).toBe('THIVIKRAM VALLURU');
    const again = await request(app).get('/api/card-receipts/cards');
    expect(again.body.cards.find((c: { label: string }) => c.label === 'THIV95555')).toMatchObject({ amexName: 'THIVIKRAM VALLURU', statementName: 'THIVIKRAM VALLURU' });
    // It can be cleared again.
    expect((await request(app).put(`/api/card-receipts/cards/${by.THIV95555._id}`).send({ amexName: '' })).body.card.amexName).toBe('');
    who = ACCOUNTANT;
  });
});

describe('an Admin’s own charge', () => {
  const ADMIN = { id: ADA, displayName: 'Ada Min', role: 'admin', location: 'Seattle', permissions: ['use_card_receipts'] };
  it('waits for Accounting instead of Missing receipt, and the receipt the Admin uploads later replaces it', async () => {
    await db.insert(companyCards).values({ id: ADA_CARD, userId: ADA, label: 'ADAM66666', lastDigits: '66666' });
    const missingBefore = (await request(app).get('/api/card-receipts/statements?month=2026-11')).body.missingNow;
    const res = await post('import', [line('11/14/2026', 'DELTA AIR LINES', 480, 'ref-admin', '-66666', 'ADA MIN'), line('11/15/2026', 'HERTZ', 90, 'ref-admin-2', '-66666', 'ADA MIN')]);
    expect(res.body.check).toMatchObject({ created: 2 });
    const rows = await db.select().from(cardExpenses).where(eq(cardExpenses.userId, ADA));
    expect(rows.map((r) => [r.merchant, r.status]).sort()).toEqual([['DELTA AIR LINES', 'waiting'], ['HERTZ', 'waiting']]);
    const delta = rows.find((r) => r.merchant === 'DELTA AIR LINES')!;
    const history = await db.select().from(cardExpenseHistory).where(eq(cardExpenseHistory.expenseId, delta.id));
    expect(history[0]!.changes).toBe('An Admin’s charge: waiting for Accounting (Amex charge ref-admin)');
    // Not counted as a missing receipt.
    expect((await request(app).get('/api/card-receipts/statements?month=2026-11')).body.missingNow).toEqual(missingBefore);
    // Accounting sees it waiting; what it needs before approval is its category.
    who = { ...ACCOUNTANT, permissions: ['approve_card_receipts'] };
    const waiting = (await request(app).get('/api/card-receipts/expenses?scope=waiting')).body.expenses.find((e: { id: string }) => e.id === delta.id);
    expect(waiting).toMatchObject({ holderRole: 'admin', waitingReason: 'accounting', actions: { fillDetails: true } });
    // A charge already approved is never replaced.
    const hertz = rows.find((r) => r.merchant === 'HERTZ')!;
    await db.update(cardExpenses).set({ status: 'approved', approvedById: ACCT, approvedByName: 'Ann Count', approvedAt: new Date() }).where(eq(cardExpenses.id, hertz.id));
    // The Admin uploads the receipt the usual way: the same day and total is not a repeat, it takes the waiting row's place.
    who = ADMIN;
    const up = await request(app).post('/api/card-receipts/expenses').send({ id: hex(400), date: '2026-11-14', merchant: 'Delta', total: '480.00' });
    expect(up.status).toBe(201);
    expect(up.body.replacedMissing).toBe(delta.id);
    const [gone] = await db.select().from(cardExpenses).where(eq(cardExpenses.id, delta.id));
    expect(gone).toMatchObject({ voidReason: 'Receipt uploaded' });
    const [l] = await db.select().from(cardStatementLines).where(eq(cardStatementLines.reference, 'ref-admin'));
    expect(l!.expenseId).toBe(hex(400));
    const again = await request(app).post('/api/card-receipts/expenses').send({ id: hex(401), date: '2026-11-15', merchant: 'Hertz', total: '90.00', confirmRepeat: true });
    expect(again.status).toBe(201);
    expect(again.body.replacedMissing).toBeUndefined();
    const [kept] = await db.select().from(cardStatementLines).where(eq(cardStatementLines.reference, 'ref-admin-2'));
    expect(kept!.expenseId).toBe(hertz.id);
    who = ACCOUNTANT;
  });
});
