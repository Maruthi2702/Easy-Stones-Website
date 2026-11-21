/** Real Express routes + migrated PGlite DB. Only the staff directory,
 * authentication boundary and binary file store are test doubles.
 * This opt-in suite deliberately fails when an accounting invariant is broken. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq, sql } from 'drizzle-orm';
import { utils, write } from 'xlsx';
import * as schema from '../../src/db/schema/index.ts';
import { migrateDb } from '../../src/db/client.ts';
import type { Db } from '../../src/db/copy/plan.ts';
import type { Loose } from '../../src/types/records.ts';
import { CARD_RECEIPTS as P, ALL_CARD_RECEIPT_PERMISSIONS, PRIVATE_RECEIPT_KEY_PREFIX, PRIVATE_RECEIPT_ROUTE } from '../../src/utils/cardReceipts.ts';
import { companyCards, cardExpenses, cardExpenseHistory, receiptCategories } from '../../src/db/schema/cardsSuppliers.ts';
import { cardStatementLines, cardStatementImports } from '../../src/db/schema/cardStatements.ts';
import { users, roles, locations } from '../../src/db/schema/reference.ts';

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../../src/db/appDb.ts', async (original) => ({
  ...(await original<typeof import('../../src/db/appDb.ts')>()),
  appDb: async () => state.db,
  areaOn: () => 'postgres'
}));
const hex = (n: number) => n.toString(16).padStart(24, '0');
const REP = hex(1), MANAGER = hex(2), DIRECTOR = hex(3), ACCOUNTANT = hex(4), OTHER = hex(5), INACTIVE = hex(6);
const CARD = hex(10), BRANCH = hex(20);
const PEOPLE = [
  { _id: REP, username: 'rep', displayName: 'Receipt Holder', role: 'sales_rep', location: 'Seattle', isActive: true },
  { _id: MANAGER, username: 'manager', displayName: 'First Approver', role: 'manager', isActive: true },
  { _id: DIRECTOR, username: 'director', displayName: 'Second Approver', role: 'director', isActive: true },
  { _id: ACCOUNTANT, username: 'accountant', displayName: 'Accounting', role: 'accounting', isActive: true },
  { _id: OTHER, username: 'other', displayName: 'Other Holder', role: 'sales_rep', isActive: true },
  { _id: INACTIVE, username: 'inactive', displayName: 'Inactive Holder', role: 'sales_rep', isActive: false }
];
vi.mock('../../src/db/staff/index.ts', () => ({
  userById: async (id: unknown) => PEOPLE.find(p => p._id === String(id)) ?? null,
  userExists: async ({ _id }: { _id: string }) => PEOPLE.some(p => p._id === _id),
  findUsers: async (filter: Loose) => PEOPLE.filter(p => !filter?.role?.$in || filter.role.$in.includes(p.role)),
  findRole: async ({ name }: { name: string }) => ({ name, approvesCardReceiptsOf: name === 'manager' || name === 'director' ? ['sales_rep'] : [] })
}));
const { default: receiptsRouter } = await import('../../src/routes/cardReceipts.ts');
const { default: statementsRouter } = await import('../../src/routes/cardReceiptStatements.ts');
const { cardReceiptsWritesPauseGate } = await import('../../src/utils/cardReceiptsWritesPause.ts');
const receiptsDb = await import('../../src/db/cardReceipts/index.ts');
const statementsDb = await import('../../src/db/cardStatements/index.ts');
const privateName = 'img_1700000000000_0123456789abcdef01234567.webp';
const privateUrl = PRIVATE_RECEIPT_ROUTE + privateName;
const stored = new Map<string, { body: Buffer; contentType: string; metadata: Record<string, string> }>();
let client: PGlite, db: Db, app: express.Express, nextId = 100;
const who = (id: string, permissions: string[]) => ({ ...PEOPLE.find(p => p._id === id), id, permissions });
const holder = who(REP, [P.USE]);
const manager = who(MANAGER, [P.APPROVE]);
const director = who(DIRECTOR, [P.APPROVE]);
const admin = who(ACCOUNTANT, [...ALL_CARD_RECEIPT_PERMISSIONS]);
const other = who(OTHER, [P.USE]);
const base = (over: Loose = {}) => ({
  id: hex(nextId++), date: '2026-11-05', merchant: 'Shop', total: '10.00', category: 'fuel',
  receiptUrl: '', lostReason: 'Printer failed', ...over
});
const api = (user: Loose) => ({
  get: (path: string) => request(app).get('/api/card-receipts' + path).set('x-test-user', JSON.stringify(user)),
  post: (path: string, body: Loose = {}) => request(app).post('/api/card-receipts' + path).set('x-test-user', JSON.stringify(user)).send(body),
  put: (path: string, body: Loose) => request(app).put('/api/card-receipts' + path).set('x-test-user', JSON.stringify(user)).send(body),
  del: (path: string, body: Loose = {}) => request(app).delete('/api/card-receipts' + path).set('x-test-user', JSON.stringify(user)).send(body)
});
const add = async (over: Loose = {}) => {
  const body = base(over);
  const result = await api(holder).post('/expenses', body).expect(201);
  return { body, expense: result.body.expense };
};
const approve = (user: Loose, e: Loose) => api(user).post(`/expenses/${e.id}/approve`, { comment: 'Verified', expectedUpdatedAt: e.updatedAt });
const rawExpense = async (id: string) => (await db.select().from(cardExpenses).where(eq(cardExpenses.id, id)))[0]!;
const xlsx = (amount = 10, reference = 'R1', date = '11/05/2026', digits = '-12345') => {
  const book = utils.book_new();
  utils.book_append_sheet(book, utils.aoa_to_sheet([
    ['Date', 'Description', 'Card Member', 'Account #', 'Amount', 'Reference'],
    [date, 'Shop', 'RECEIPT HOLDER', digits, amount, reference]
  ]), 'Transaction Details');
  return write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
const importFile = (file = xlsx(), path = 'import') => request(app).post('/api/card-receipts/statements/' + path)
  .set('x-test-user', JSON.stringify(admin)).attach('file', file, 'amex.xlsx');

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
  await migrateDb(db, 'pglite:memory');
  state.db = db;
  await db.insert(roles).values(['sales_rep', 'manager', 'director', 'accounting'].map((name, i) => ({ id: hex(30 + i), name, displayName: name })));
  await db.insert(locations).values({ id: BRANCH, name: 'Seattle' });
  await db.insert(users).values(PEOPLE.map(p => ({ id: p._id, username: p.username, displayName: p.displayName, role: p.role, passwordHash: 'test', homeLocationId: BRANCH, isActive: p.isActive })));
  app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use(cardReceiptsWritesPauseGate);
  const authenticate: express.RequestHandler = (req, res, next) => {
    if (!req.headers['x-test-user']) return void res.status(401).json({ message: 'Sign in' });
    (req as unknown as { user: unknown }).user = JSON.parse(String(req.headers['x-test-user']));
    next();
  };
  app.use('/api/card-receipts/statements', statementsRouter({ authenticate }));
  app.use('/api/card-receipts', receiptsRouter({ authenticate,
    processBase64Image: async () => privateUrl,
    fileStore: () => ({ backend: 's3', get: async (key: string) => stored.get(key) ?? null }) as unknown as import('../../src/services/fileStore.ts').FileStore
  }));
});
afterAll(async () => { await client?.close(); });
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await db.delete(cardStatementLines);
  await db.delete(cardStatementImports);
  await db.delete(cardExpenseHistory);
  await db.delete(cardExpenses);
  await db.delete(companyCards);
  await db.delete(receiptCategories);
  await db.insert(companyCards).values([{ id: CARD, userId: REP, label: 'RECE12345', lastDigits: '12345' }, { id: hex(11), userId: OTHER, label: 'OTHE54321', lastDigits: '54321' }]);
  await db.insert(receiptCategories).values([
    { id: hex(40), name: 'fuel', label: 'Fuel' },
    { id: hex(41), name: 'customer_lunch', label: 'Customer lunch', needsCustomer: true, needsAttendees: true },
    { id: hex(42), name: 'hidden', label: 'Hidden', active: false }
  ]);
  stored.clear();
  stored.set(PRIVATE_RECEIPT_KEY_PREFIX + privateName, { body: Buffer.from('test receipt'), contentType: 'image/webp', metadata: { uploader: REP } });
});

describe('Real database accounting acceptance controls', () => {
  it.each([
    ['POST', '/expenses'], ['PUT', '/expenses/' + hex(100)], ['POST', '/expenses/' + hex(100) + '/approve'],
    ['POST', '/expenses/' + hex(100) + '/send-back'], ['POST', '/expenses/' + hex(100) + '/void'],
    ['POST', '/cards'], ['PUT', '/cards/' + CARD], ['POST', '/categories'], ['DELETE', '/categories/' + hex(40)],
    ['POST', '/attachments'], ['GET', '/cards'], ['GET', '/me'], ['GET', '/expenses?scope=all&month=2026-11'],
    ['POST', '/statements/import'], ['POST', '/statements/cards']
  ])('AUTHZ: no permission cannot call %s %s', async (method, path) => {
    const r = request(app)[method.toLowerCase() as 'get']('/api/card-receipts' + path);
    await r.set('x-test-user', JSON.stringify(who(REP, []))).expect(403);
  });
  it('AUTHZ: router receives authentication failures without exposing expenses', async () => {
    await request(app).get('/api/card-receipts/expenses?month=2026-11').expect(401);
  });
  it('AUTHZ: spoofed holder, branch, amount in cents, status, approval and history are ignored', async () => {
    const { expense } = await add({ userId: OTHER, location: 'Fake', cents: 1, status: 'approved', approval: { by: OTHER }, history: [{ action: 'approved' }] });
    expect(expense).toMatchObject({ userId: REP, location: 'Seattle', cents: 1000, status: 'waiting', approval: null });
    expect(expense.history).toHaveLength(1);
    expect(expense.history[0].action).toBe('added');
  });
  it('AUTHZ: another holder cannot edit, void, approve or reuse an existing receipt ID', async () => {
    const { body, expense } = await add();
    await api(other).put('/expenses/' + expense.id, body).expect(404);
    await api(other).post('/expenses/' + expense.id + '/void', { reason: 'Other' }).expect(404);
    await api({ ...other, permissions: [P.APPROVE] }).post('/expenses/' + expense.id + '/approve', { comment: 'OK' }).expect(403);
    await api(other).post('/expenses', body).expect(409);
    expect((await rawExpense(expense.id)).status).toBe('waiting');
  });
  it('APPROVAL: $150 needs one approval; $150.01 needs two distinct approvers', async () => {
    const small = await add({ total: '150.00' });
    expect((await approve(manager, small.expense).expect(200)).body.expense.status).toBe('approved');
    const big = await add({ total: '150.01' });
    const first = (await approve(manager, big.expense).expect(200)).body.expense;
    expect(first).toMatchObject({ status: 'waiting', step: 2 });
    await approve({ ...director, id: MANAGER }, first).expect(403);
    expect((await approve(director, first).expect(200)).body.expense.status).toBe('approved');
  });
  it('APPROVAL: sequential stale decisions, later edits and voids cannot alter an approved expense', async () => {
    const { body, expense } = await add();
    await api(holder).put('/expenses/' + expense.id, { ...body, note: 'Changed' }).expect(200);
    await approve(manager, { ...expense, updatedAt: '2020-01-01T00:00:00.000Z' }).expect(409);
    const current = (await api(holder).get('/expenses?month=2026-11')).body.expenses[0];
    await approve(manager, current).expect(200);
    await api(holder).put('/expenses/' + expense.id, body).expect(409);
    await api(holder).post('/expenses/' + expense.id + '/void', { reason: 'Mistake' }).expect(409);
  });
  it('APPROVAL: editing after step one clears the first approval', async () => {
    const { body, expense } = await add({ total: '200.00' });
    await approve(manager, expense).expect(200);
    const edited = await api(holder).put('/expenses/' + expense.id, { ...body, note: 'Correction' }).expect(200);
    expect(edited.body.expense).toMatchObject({ step: 1, approval: null, status: 'waiting' });
  });
  it('IDEMPOTENCY: sequential retry creates one expense and one audit event', async () => {
    const { body, expense } = await add();
    expect((await api(holder).post('/expenses', body).expect(200)).body.alreadySaved).toBe(true);
    expect(await db.select().from(cardExpenses)).toHaveLength(1);
    expect(await db.select().from(cardExpenseHistory).where(eq(cardExpenseHistory.expenseId, expense.id))).toHaveLength(1);
  });
  it('DUPLICATE: identical day and total requires explicit override; void does not block a replacement', async () => {
    const a = await add();
    await api(holder).post('/expenses', base()).expect(409);
    await api(holder).post('/expenses', base({ confirmRepeat: true })).expect(201);
    await api(holder).post('/expenses/' + a.expense.id + '/void', { reason: 'Wrong purchase' }).expect(200);
    expect((await rawExpense(a.expense.id)).voidReason).toBe('Wrong purchase');
  });
  it('DUPLICATE: a voided receipt alone does not prevent uploading its replacement', async () => {
    const a = await add();
    await api(holder).post('/expenses/' + a.expense.id + '/void', { reason: 'Wrong purchase' }).expect(200);
    await api(holder).post('/expenses', base()).expect(201);
    expect((await db.select().from(cardExpenses)).filter(e => !e.voidedAt)).toHaveLength(1);
  });
  it.each(['?month[$ne]=x', '?month=2026-11&month=2026-10', '?month=2026-11&scope=mine&scope=all', '?month=2026-13'])('SECURITY: rejects non-scalar or invalid expense query %s', async (query) => {
    await api(holder).get('/expenses' + query).expect(400);
  });
  it('AUTHZ: a holder cannot request all expenses or configure a card or category', async () => {
    await add();
    await api(holder).get('/expenses?scope=all&month=2026-11').expect(403);
    await api(holder).post('/cards', { userId: OTHER, label: 'OTHER99999', lastDigits: '99999' }).expect(403);
    await api(holder).post('/categories', { label: 'Injected' }).expect(403);
  });
  it('CARDS: a deactivated card cannot create new expenses', async () => {
    await db.update(companyCards).set({ active: false }).where(eq(companyCards.id, CARD));
    await api(holder).post('/expenses', base()).expect(409);
    expect(await db.select().from(cardExpenses)).toHaveLength(0);
  });
  it('CATEGORY: a hidden category cannot start a new expense, but remains valid on one that already used it', async () => {
    await api(holder).post('/expenses', base({ category: 'hidden' })).expect(400);
    const { body, expense } = await add();
    await db.update(receiptCategories).set({ active: false }).where(eq(receiptCategories.name, 'fuel'));
    await api(holder).put('/expenses/' + expense.id, { ...body, note: 'Still valid' }).expect(200);
  });
  it('UPLOAD: malformed or unsupported data is rejected and the per-person burst limit is enforced', async () => {
    const fresh = who(hex(900), [P.USE]);
    await api(fresh).post('/attachments', { data: 'https://example.test/file.pdf' }).expect(400);
    await api(fresh).post('/attachments', { data: 'data:text/html;base64,SGk=' }).expect(400);
    for (let n = 0; n < 38; n++) await api(fresh).post('/attachments', { data: 'data:image/png;base64,SGk=' }).expect(200);
    await api(fresh).post('/attachments', { data: 'data:image/png;base64,SGk=' }).expect(429);
  });
  it('FILES: private attachment access and attachment reuse are limited to the holder and authorized viewers', async () => {
    await api(holder).get('/files/' + privateName).expect(200);
    await api(other).get('/files/' + privateName).expect(404);
    await api(other).post('/expenses', base({ receiptUrl: privateUrl, lostReason: '' })).expect(400);
    const { expense } = await add({ receiptUrl: privateUrl, lostReason: '' });
    const file = await api(admin).get('/files/' + privateName).expect(200);
    expect(file.headers['cache-control']).toContain('private');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect((await rawExpense(expense.id)).receiptUrl).toBe(privateUrl);
  });
  it('AMEX: preview and a failed card mapping leave all tables unchanged', async () => {
    await importFile(xlsx(), 'preview').expect(200);
    expect(await db.select().from(cardStatementLines)).toHaveLength(0);
    expect(await db.select().from(cardStatementImports)).toHaveLength(0);
    expect(await db.select().from(cardExpenses)).toHaveLength(0);
    await importFile().field('cards', JSON.stringify([{ digits: '99999', userId: hex(999) }])).expect(409);
    expect(await db.select().from(cardStatementLines)).toHaveLength(0);
    expect(await db.select().from(cardExpenses)).toHaveLength(0);
  });
  it('AMEX: repeated import keeps one statement line and one live missing expense', async () => {
    await importFile().expect(200);
    await importFile().expect(200);
    expect(await db.select().from(cardStatementLines)).toHaveLength(1);
    expect((await db.select().from(cardExpenses)).filter(e => !e.voidedAt)).toHaveLength(1);
    expect(await db.select().from(cardStatementImports)).toHaveLength(2);
  });
  it('AMEX: matched charges reject date, total and void changes', async () => {
    await importFile().expect(200);
    const e = (await api(holder).get('/expenses?month=2026-11')).body.expenses[0];
    await api(holder).put('/expenses/' + e.id, base({ date: '2026-11-06' })).expect(409);
    await api(holder).put('/expenses/' + e.id, base({ total: '11.00' })).expect(409);
    await api(holder).post('/expenses/' + e.id + '/void', { reason: 'Wrong' }).expect(409);
  });
  it('TRANSACTION: a failed history write rolls back the corresponding expense change', async () => {
    const { body, expense } = await add();
    await db.execute(sql.raw("CREATE FUNCTION qa_reject_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA injected history failure'; END $$"));
    await db.execute(sql.raw('CREATE TRIGGER qa_history_failure BEFORE INSERT ON card_expense_history FOR EACH ROW EXECUTE FUNCTION qa_reject_history()'));
    try {
      await api(holder).put('/expenses/' + expense.id, { ...body, total: '11.00' }).expect(500);
      expect((await rawExpense(expense.id)).cents).toBe(1000);
      expect(await db.select().from(cardExpenseHistory)).toHaveLength(1);
    } finally {
      await db.execute(sql.raw('DROP TRIGGER qa_history_failure ON card_expense_history'));
      await db.execute(sql.raw('DROP FUNCTION qa_reject_history()'));
    }
  });
  it('OPERATIONS: migration pause blocks receipt and statement writes, keeps reads available', async () => {
    vi.stubEnv('CARD_RECEIPTS_WRITES_PAUSED', 'true');
    const stopped = await api(holder).post('/expenses', base()).expect(503);
    expect(stopped.headers['retry-after']).toBe('120');
    await importFile().expect(503);
    await api(holder).get('/expenses?month=2026-11').expect(200);
    expect(await db.select().from(cardExpenses)).toHaveLength(0);
  });
});

describe('Accounting defect reproductions (ordinary assertions; failures remain open)', () => {
  it('CC-03: saving incomplete details on an Amex missing row must not remove it from missing-receipt totals', async () => {
    await importFile().expect(200);
    const e = (await api(holder).get('/expenses?month=2026-11')).body.expenses[0];
    await api(holder).put('/expenses/' + e.id, base({ receiptUrl: '', lostReason: '', category: '' })).expect(200);
    const view = (await api(admin).get('/statements?month=2026-11').expect(200)).body;
    expect.soft(view.missingNow).toEqual({ count: 1, cents: 1000 });
    expect.soft(view.lines[0].status).toBe('missing');
    expect.soft(view.lines[0].expenseStatus).toBe('missing');
  });
  it('CC-04: importing a changed amount for a known Reference must not retain a false receipt match', async () => {
    await add({ receiptUrl: privateUrl, lostReason: '' });
    await importFile().expect(200);
    await importFile(xlsx(11)).expect(200);
    const [line] = await db.select().from(cardStatementLines);
    expect(line!.expenseId).toBeTruthy();
    expect((await rawExpense(line!.expenseId!)).cents).toBe(line!.cents);
  });
  it('CC-04: importing changed digits for a known Reference must not retain the old card match', async () => {
    await add({ receiptUrl: privateUrl, lostReason: '' });
    await importFile().expect(200);
    await importFile(xlsx(10, 'R1', '11/05/2026', '-54321')).expect(200);
    const [line] = await db.select().from(cardStatementLines);
    expect(line!.cardId).toBe(hex(11));
  });
  it('CC-05: a nonexistent customer must not produce a complete receipt awaiting approval', async () => {
    const result = await api(holder).post('/expenses', base({ category: 'customer_lunch', customerId: hex(999), customerName: 'Does not exist', attendees: ['Holder', 'Guest'] }));
    expect.soft(result.status).toBe(400);
    expect.soft(await db.select().from(cardExpenses)).toHaveLength(0);
  });
  it('CC-06: deleting a category cannot leave an approved receipt missing its newly required customer', async () => {
    const { expense } = await add();
    await approve(manager, expense).expect(200);
    await api(admin).del('/categories/' + hex(40), { replaceWith: hex(41) }).expect(200);
    const saved = await rawExpense(expense.id);
    expect(saved.category === 'fuel' || saved.status !== 'approved' || Boolean(saved.customerId)).toBe(true);
  });

  // Gate the real DB adapter immediately before it persists. This reproducibly
  // schedules the competing request after the route read/validated the old row.
  // No DB result or state-transition function is stubbed.
  it('CC-07: an edit validated before approval cannot later overwrite that approval', async () => {
    const { body, expense } = await add();
    const original = receiptsDb.changeExpense;
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(r => { enter = r; });
    const held = new Promise<void>(r => { release = r; });
    vi.spyOn(receiptsDb, 'changeExpense').mockImplementation(async (id, set, entry) => {
      if (entry.action === 'edited') { enter(); await held; }
      return original(id, set, entry);
    });
    const editing = api(holder).put('/expenses/' + expense.id, { ...body, total: '99.00' }).then(r => r);
    await entered;
    const approval = await approve(manager, expense);
    release();
    const edit = await editing;
    expect(approval.status).toBe(200);
    expect.soft(edit.status).toBe(409);
    expect.soft(await rawExpense(expense.id)).toMatchObject({ status: 'approved', cents: 1000 });
  });
  it('CC-07: a decision validated before an edit cannot approve a different amount', async () => {
    const { body, expense } = await add();
    const original = receiptsDb.changeExpense;
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(r => { enter = r; });
    const held = new Promise<void>(r => { release = r; });
    vi.spyOn(receiptsDb, 'changeExpense').mockImplementation(async (id, set, entry) => {
      if (entry.action === 'approved') { enter(); await held; }
      return original(id, set, entry);
    });
    const approving = approve(manager, expense).then(r => r);
    await entered;
    await api(holder).put('/expenses/' + expense.id, { ...body, total: '200.00' }).expect(200);
    release();
    expect.soft((await approving).status).toBe(409);
    expect.soft((await rawExpense(expense.id)).status).toBe('waiting');
  });
  it('CC-07: a void validated before approval cannot later void the approved expense', async () => {
    const { expense } = await add();
    const original = receiptsDb.changeExpense;
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(r => { enter = r; });
    const held = new Promise<void>(r => { release = r; });
    vi.spyOn(receiptsDb, 'changeExpense').mockImplementation(async (id, set, entry) => {
      if (entry.action === 'voided') { enter(); await held; }
      return original(id, set, entry);
    });
    const voiding = api(holder).post('/expenses/' + expense.id + '/void', { reason: 'Mistake' }).then(r => r);
    await entered;
    await approve(manager, expense).expect(200);
    release();
    expect.soft((await voiding).status).toBe(409);
    expect.soft((await rawExpense(expense.id)).voidedAt).toBeNull();
  });
  it('IDEMPOTENCY: simultaneous identical save IDs both succeed without a 500 or duplicate history', async () => {
    const body = base();
    const original = receiptsDb.addExpense;
    let count = 0, release!: () => void;
    const held = new Promise<void>(r => { release = r; });
    vi.spyOn(receiptsDb, 'addExpense').mockImplementation(async (id, value) => {
      if (++count === 2) release();
      await held;
      return original(id, value);
    });
    const results = await Promise.all([api(holder).post('/expenses', body), api(holder).post('/expenses', body)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 201]);
    expect(await db.select().from(cardExpenses)).toHaveLength(1);
    expect(await db.select().from(cardExpenseHistory)).toHaveLength(1);
  });
  it('CC-08: simultaneous different IDs for the same purchase cannot both bypass the duplicate warning', async () => {
    const original = receiptsDb.addExpense;
    let count = 0, release!: () => void;
    const held = new Promise<void>(r => { release = r; });
    vi.spyOn(receiptsDb, 'addExpense').mockImplementation(async (id, value) => {
      if (++count === 2) release();
      await held;
      return original(id, value);
    });
    const results = await Promise.all([api(holder).post('/expenses', base()), api(holder).post('/expenses', base())]);
    expect.soft(results.map(r => r.status).sort()).toEqual([201, 409]);
    expect.soft(await db.select().from(cardExpenses)).toHaveLength(1);
  });
  it('CC-09: receipt-link lookup failure must not let a matched Amex charge be voided', async () => {
    await add();
    await importFile().expect(200);
    const e = (await api(holder).get('/expenses?month=2026-11')).body.expenses[0];
    vi.spyOn(statementsDb, 'linkedLine').mockRejectedValueOnce(new Error('QA database read failure'));
    const result = await api(holder).post('/expenses/' + e.id + '/void', { reason: 'Wrong' });
    expect.soft(result.status).toBeGreaterThanOrEqual(400);
    expect.soft((await rawExpense(e.id)).voidedAt).toBeNull();
  });
  it('CC-11: a 5001-row month cannot silently truncate ledger totals and export source data', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => ({
      id: hex(10000 + i), userId: REP, holderName: 'Receipt Holder', cardId: CARD, cardLabel: 'RECE12345',
      locationId: BRANCH, day: '2026-11-05', month: '2026-11', merchant: `Shop ${i}`, cents: 1000, status: 'waiting'
    }));
    for (let i = 0; i < rows.length; i += 500) await db.insert(cardExpenses).values(rows.slice(i, i + 500));
    const result = await api(admin).get('/expenses?scope=all&month=2026-11').expect(200);
    expect.soft(result.body.expenses.length).toBe(5001);
    expect.soft(result.body.expenses.reduce((sum: number, e: Loose) => sum + e.cents, 0)).toBe(5001000);
  });
  it('CC-12: two holders racing for the same save ID cannot receive each other’s private expense', async () => {
    const body = base();
    const original = receiptsDb.addExpense;
    let count = 0, release!: () => void;
    const held = new Promise<void>(r => { release = r; });
    vi.spyOn(receiptsDb, 'addExpense').mockImplementation(async (id, value) => {
      if (++count === 2) release();
      await held;
      return original(id, value);
    });
    const results = await Promise.all([api(holder).post('/expenses', body), api(other).post('/expenses', body)]);
    expect.soft(results.map(r => r.status).sort()).toEqual([201, 409]);
    for (const [index, response] of results.entries()) {
      if (response.status < 300 && response.body.expense) {
        expect.soft(response.body.expense.userId).toBe(index === 0 ? REP : OTHER);
      }
    }
  });
});
