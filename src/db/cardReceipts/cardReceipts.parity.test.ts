/**
 * Credit Card Receipts, through the real router: each request run on MongoDB, then on
 * Postgres, must answer the same and leave the same cards, categories and expenses behind
 * (`t.differences()` runs the copy's own check — companyCardRowOf, receiptCategoryRowOf and
 * cardExpenseRowsOf are the spec). Users and Roles, which the router also reads, stay on
 * MongoDB in both runs: that area moves last.
 *
 * Ids a request makes (a new card's, a new category's, the screen's own receipt ids) are
 * handed out in order and start over for each of the two runs, so both databases hold the same ones.
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { randomBytes } from 'node:crypto';

const ids = vi.hoisted(() => ({ made: [] as string[], used: 0 }));
vi.mock('../ids.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../ids.ts')>()),
  newId: () => (ids.made[ids.used] ??= randomBytes(12).toString('hex'), ids.made[ids.used++])
}));

const { openWriteParity } = await import('../customers/writes/writeParity.ts');
const { normalize } = await import('../customers/parity.ts');
const { openDb, migrateDb } = await import('../client.ts');
const { default: createCardReceiptsRouter } = await import('../../routes/cardReceipts.ts');
const { CardExpense } = await import('../../models/CardReceipts.ts');
const { default: Customer } = await import('../../models/Customer.ts');
const { STARTING_CATEGORIES, categoryKey } = await import('../../utils/cardReceipts.ts');
const { seedCategories, listCategories } = await import('./postgres.ts');
type WriteParity = Awaited<ReturnType<typeof openWriteParity>>;
type Loose = Record<string, any>;

const oid = () => new mongoose.Types.ObjectId();
const USE = 'use_card_receipts';
const rep = oid().toString(), manager = oid().toString(), director = oid().toString(), acct = oid().toString();
const acme = oid().toString();
const REP = { id: rep, displayName: 'Maruthi Ponugupati', role: 'sales_rep', location: 'Seattle', permissions: [USE] };
const MANAGER = { id: manager, displayName: 'Dana Whitfield', role: 'manager', location: 'Kent', permissions: [USE, 'approve_card_receipts'] };
const DIRECTOR = { id: director, displayName: 'Dee Rector', role: 'director', location: 'Seattle', permissions: [USE, 'approve_card_receipts'] };
const ACCOUNTING = { id: acct, displayName: 'Ann Count', role: 'accounting', permissions: ['view_all_card_receipts', 'manage_company_cards', 'add_receipt_categories', 'edit_receipt_categories', 'reorder_receipt_categories', 'delete_receipt_categories'] };
const NOCARD = { id: oid().toString(), displayName: 'No Card', role: 'sales_rep', permissions: [USE] };
const NOBODY = { id: oid().toString(), role: 'sales_rep', permissions: [] };

const CATEGORIES = STARTING_CATEGORIES.map((c, i) => ({ _id: oid(), name: categoryKey(c.label), label: c.label, order: i, active: true, fields: { ...c.fields }, updatedBy: '', createdAt: new Date('2026-11-05T17:00:00Z'), updatedAt: new Date('2026-11-05T17:00:00Z') }));
const seeded = { waiting: oid().toString(), approved: oid().toString(), lost: oid().toString() };
const cardOf = { rep: oid().toString(), manager: oid().toString() };

let t: WriteParity;
let app: express.Express;

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertMany(['Seattle', 'Kent'].map(name => ({ _id: oid(), name })));
    await db.collection('roles').insertMany([
      { _id: oid(), name: 'sales_rep', displayName: 'Sales rep', permissions: [] },
      { _id: oid(), name: 'manager', displayName: 'Manager', permissions: [], approvesCardReceiptsOf: ['sales_rep'] },
      { _id: oid(), name: 'director', displayName: 'Director', permissions: [], approvesCardReceiptsOf: ['sales_rep', 'manager', 'director'] },
      { _id: oid(), name: 'accounting', displayName: 'Accounting', permissions: [] }
    ]);
    await db.collection('users').insertMany([
      { _id: new mongoose.Types.ObjectId(rep), username: 'maruthi', displayName: 'Maruthi Ponugupati', password: 'x', role: 'sales_rep', email: 'm@x.com', isActive: true },
      { _id: new mongoose.Types.ObjectId(manager), username: 'dana', displayName: 'Dana Whitfield', password: 'x', role: 'manager', email: 'd@x.com', isActive: true },
      { _id: new mongoose.Types.ObjectId(director), username: 'dee', displayName: 'Dee Rector', password: 'x', role: 'director', email: 'dee@x.com', isActive: true },
      { _id: new mongoose.Types.ObjectId(acct), username: 'ann', displayName: 'Ann Count', password: 'x', role: 'accounting', email: 'a@x.com', isActive: true }
    ]);
    await Customer.insertMany([{ _id: acme, company: 'Acme Stone', contactName: 'Ann', email: 'ann@acme.test' }]);
    await db.collection('receiptcategories').insertMany(CATEGORIES);
    const at = (iso: string) => new Date(iso);
    await db.collection('companycards').insertMany([
      { _id: new mongoose.Types.ObjectId(cardOf.rep), userId: rep, label: 'MARU92069', issuer: 'amex', lastDigits: '92069', active: true, updatedBy: 'Ann', createdAt: at('2026-11-05T17:00:00Z'), updatedAt: at('2026-11-05T17:00:00Z') },
      { _id: new mongoose.Types.ObjectId(cardOf.manager), userId: manager, label: 'DANA41008', issuer: 'amex', lastDigits: '41008', active: true, updatedBy: 'Ann', createdAt: at('2026-11-05T17:00:00Z'), updatedAt: at('2026-11-05T17:00:00Z') }
    ]);
    const base = { holderName: 'Maruthi Ponugupati', cardId: cardOf.rep, cardLabel: 'MARU92069', location: 'Seattle', category: 'travel_lunch', customerId: '', customerName: '', attendees: [], purpose: '', note: '', recurring: false,
      receiptUrl: 'https://res.cloudinary.com/test/CardReceipts/a.webp', lostReason: '', createdBy: 'Maruthi Ponugupati', voidedAt: null, voidedBy: '', voidReason: '' };
    await db.collection('cardexpenses').insertMany([
      { ...base, _id: new mongoose.Types.ObjectId(seeded.waiting), userId: rep, date: '2026-10-03', month: '2026-10', merchant: "McDonald's, Kent", cents: 1432, subtotalCents: 1297, taxCents: 135, tipCents: null, status: 'waiting',
        approval: null, sentBack: null, createdAt: at('2026-10-03T19:00:00Z'), updatedAt: at('2026-10-03T19:00:00Z'), history: [{ at: at('2026-10-03T19:00:00Z'), by: 'Maruthi Ponugupati', action: 'added', changes: 'sent for approval' }] },
      { ...base, _id: new mongoose.Types.ObjectId(seeded.approved), userId: rep, date: '2026-10-05', month: '2026-10', merchant: 'Shell', category: 'fuel', cents: 6120, status: 'approved',
        approval: { by: manager, byName: 'Dana Whitfield', at: at('2026-10-06T16:00:00Z'), comment: 'OK' }, sentBack: null, createdAt: at('2026-10-05T19:00:00Z'), updatedAt: at('2026-10-06T16:00:00Z'),
        history: [{ at: at('2026-10-05T19:00:00Z'), by: 'Maruthi Ponugupati', action: 'added', changes: 'sent for approval' }, { at: at('2026-10-06T16:00:00Z'), by: 'Dana Whitfield', action: 'approved', changes: 'OK' }] },
      { ...base, _id: new mongoose.Types.ObjectId(seeded.lost), userId: manager, holderName: 'Dana Whitfield', cardId: cardOf.manager, cardLabel: 'DANA41008', location: 'Kent', date: '2026-10-04', month: '2026-10', merchant: 'Chevron', category: 'fuel',
        cents: 4000, receiptUrl: '', lostReason: 'No receipt printed', status: 'sent_back', approval: null, sentBack: { by: director, byName: 'Dee Rector', at: at('2026-10-05T10:00:00Z'), comment: 'Which trip?' },
        createdAt: at('2026-10-04T19:00:00Z'), updatedAt: at('2026-10-05T10:00:00Z'),
        history: [{ at: at('2026-10-04T19:00:00Z'), by: 'Dana Whitfield', action: 'added', changes: 'sent for approval' }, { at: at('2026-10-05T10:00:00Z'), by: 'Dee Rector', action: 'sent back', changes: 'Which trip?' }] }
    ]);
  }, 'DB_CARD_RECEIPTS');

  app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/card-receipts', createCardReceiptsRouter({
    authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
    processBase64Image: async () => 'https://res.cloudinary.com/test/CardReceipts/img_1.webp'
  }));
}, 240000);

afterAll(async () => { await t?.close(); });

type Api = ReturnType<typeof apiFor>;
const apiFor = (user: Loose) => {
  const h = (r: request.Test) => r.set('x-test-user', JSON.stringify(user));
  const done = async (r: request.Test) => { const x = await h(r); return { status: x.status, body: x.body }; };
  return {
    get: (url: string) => done(request(app).get(`/api/card-receipts${url}`)),
    post: (url: string, body: Loose = {}) => done(request(app).post(`/api/card-receipts${url}`).send(body)),
    put: (url: string, body: Loose) => done(request(app).put(`/api/card-receipts${url}`).send(body)),
    patch: (url: string, body: Loose) => done(request(app).patch(`/api/card-receipts${url}`).send(body)),
    del: (url: string, body: Loose = {}) => done(request(app).delete(`/api/card-receipts${url}`).send(body))
  };
};
const nextId = () => (ids.made[ids.used] ??= randomBytes(12).toString('hex'), ids.made[ids.used++]);

/** A short script of requests, run on MongoDB then Postgres at the same moment: the same answers, the same rows. */
async function same<T>(user: Loose, script: (api: Api) => Promise<T>): Promise<T> {
  ids.made = [];
  const ask = async () => { ids.used = 0; return script(apiFor(user)); };
  const { mongo, postgres } = await t.both(ask);
  expect(normalize(postgres)).toEqual(normalize(mongo));
  expect(await t.differences()).toEqual([]);
  return mongo;
}

const receipt = (over: Loose = {}) => ({
  id: nextId(), date: '2026-10-03', merchant: "McDonald's, Kent", total: '14.32', tax: '1.35', category: 'fuel',
  receiptUrl: 'https://res.cloudinary.com/test/CardReceipts/img_1.webp', ...over
});

describe('categories', () => {
  it('lists the starting list to anyone who can open the page', async () => {
    const r = await same(REP, a => a.get('/categories'));
    expect(r.body.categories.map((c: Loose) => c.label)).toEqual(['Travel Lunch', 'Customer Lunch', 'Office Supplies', 'Fuel', 'Parking', 'Software & Subscriptions']);
    expect((await same(NOBODY, a => a.get('/categories'))).status).toBe(403);
    await same(REP, a => a.get('/me'));
  });

  it('adds, renames, hides and reorders with the Admin switches only', async () => {
    expect((await same(REP, a => a.post('/categories', { label: 'Travel' }))).status).toBe(403);
    const added = await same(ACCOUNTING, a => a.post('/categories', { label: 'Travel', fields: { purpose: true, recurring: true } }));
    expect(added.body.category).toMatchObject({ name: 'travel', order: 6, fields: { purpose: true, recurring: true } });
    expect((await same(ACCOUNTING, a => a.post('/categories', { label: 'fuel' }))).status).toBe(400);
    const id = added.body.category._id;
    const renamed = await same(ACCOUNTING, a => a.put(`/categories/${id}`, { label: 'Travel & Hotels', active: false }));
    expect(renamed.body.category).toMatchObject({ name: 'travel', label: 'Travel & Hotels', active: false });
    await same(ACCOUNTING, a => a.put(`/categories/${id}`, { label: 'Travel & Hotels', fields: { customer: true, attendees: true } }));
    expect((await same(ACCOUNTING, a => a.put(`/categories/${nextId()}`, { label: 'Nope' }))).status).toBe(404);
    const order = (await same(ACCOUNTING, a => a.get('/categories'))).body.categories.map((c: Loose) => c._id).reverse();
    const reordered = await same(ACCOUNTING, a => a.patch('/categories/reorder', { ids: order }));
    expect(reordered.body.categories[0].label).toBe('Travel & Hotels');
    expect((await same(ACCOUNTING, a => a.patch('/categories/reorder', { ids: order.slice(1) }))).status).toBe(400);
  });

  it('deletes one in use only by moving its expenses to a shown category', async () => {
    const cats = (await same(ACCOUNTING, a => a.get('/categories'))).body.categories;
    const fuel = cats.find((c: Loose) => c.name === 'fuel');
    const travel = cats.find((c: Loose) => c.name === 'travel_lunch');
    expect((await same(ACCOUNTING, a => a.get(`/categories/${travel._id}/uses`))).body.uses).toBe(1);
    expect((await same(ACCOUNTING, a => a.get(`/categories/${nextId()}/uses`))).status).toBe(404);
    expect((await same(ACCOUNTING, a => a.del(`/categories/${travel._id}`))).status).toBe(409);
    const hidden = cats.find((c: Loose) => !c.active);
    expect((await same(ACCOUNTING, a => a.del(`/categories/${travel._id}`, { replaceWith: hidden._id }))).status).toBe(409);
    const moved = await same(ACCOUNTING, a => a.del(`/categories/${travel._id}`, { replaceWith: fuel._id }));
    expect(moved.body).toEqual({ deleted: true, moved: 1 });
    const kept = (await same(REP, a => a.get('/expenses?month=2026-10'))).body.expenses.find((e: Loose) => e.id === seeded.waiting);
    expect(kept.category).toBe('fuel');
    expect(kept.history.at(-1).changes).toMatch(/Travel Lunch → Fuel/);
    // One nothing uses goes on its own.
    const parking = cats.find((c: Loose) => c.name === 'parking');
    expect((await same(ACCOUNTING, a => a.del(`/categories/${parking._id}`))).body).toEqual({ deleted: true, moved: 0 });
  });
});

describe('cards', () => {
  it('keeps one active card per person and per card ID', async () => {
    expect((await same(REP, a => a.post('/cards', { userId: director, label: 'DEER11111', lastDigits: '11111' }))).status).toBe(403);
    expect((await same(ACCOUNTING, a => a.post('/cards', { userId: rep, label: 'MARU55555', lastDigits: '55555' }))).status).toBe(409);
    expect((await same(ACCOUNTING, a => a.post('/cards', { userId: director, label: 'MARU92069', lastDigits: '92069' }))).status).toBe(409);
    expect((await same(ACCOUNTING, a => a.post('/cards', { userId: director, label: 'x' }))).status).toBe(400);
    const added = await same(ACCOUNTING, a => a.post('/cards', { userId: director, label: 'deer11111', lastDigits: '11111' }));
    expect(added.body.card.label).toBe('DEER11111');
    await same(ACCOUNTING, a => a.put(`/cards/${cardOf.rep}`, { active: false }));
    await same(ACCOUNTING, a => a.post('/cards', { userId: rep, label: 'MARU55555', lastDigits: '55555' }));
    await same(ACCOUNTING, a => a.put(`/cards/${added.body.card._id}`, { label: 'DEER22222', lastDigits: '22222' }));
    expect((await same(ACCOUNTING, a => a.put(`/cards/${nextId()}`, { active: false }))).status).toBe(404);
    const list = await same(ACCOUNTING, a => a.get('/cards'));
    expect(list.body.cards).toHaveLength(4);
    expect(list.body.cards[0].active).toBe(true);
    await same(REP, a => a.get('/me'));
    await same(ACCOUNTING, a => a.put(`/cards/${cardOf.rep}`, { active: true }));
  });
});

describe('saving a receipt', () => {
  it('saves under the uploader and their card, at their home location, and sends a complete one for approval', async () => {
    const r = await same(REP, a => a.post('/expenses', receipt({ date: '2026-10-08', total: '21.00' })));
    expect(r.body.expense).toMatchObject({ cents: 2100, cardLabel: 'MARU55555', location: 'Seattle', status: 'waiting', mine: true });
  });

  it('keeps an unfinished one as a draft, and finishing it sends it for approval', async () => {
    const body = receipt({ category: 'customer_lunch', merchant: 'Kashish Cuisine of India', total: '57.29', date: '2026-10-09' });
    const draft = await same(REP, a => a.post('/expenses', body));
    expect(draft.body.expense.status).toBe('draft');
    const done = await same(REP, a => a.put(`/expenses/${body.id}`, { ...body, customerId: acme, customerName: 'Acme Stone', attendees: ['Maruthi Ponugupati', 'J. Alvarez'] }));
    expect(done.body.expense.status).toBe('waiting');
    expect(done.body.expense.history.at(-1).changes).toMatch(/customer, who attended · sent for approval/);
    const unchanged = await same(REP, a => a.put(`/expenses/${body.id}`, { ...body, customerId: acme, customerName: 'Acme Stone', attendees: ['Maruthi Ponugupati', 'J. Alvarez'] }));
    expect(unchanged.body.unchanged).toBe(true);
    await same(REP, a => a.put(`/expenses/${body.id}`, { ...body, customerId: acme, customerName: 'Acme Stone', attendees: ['Maruthi Ponugupati'], total: '60.00', tip: '5.00', note: 'with tip', recurring: true, date: '2026-11-02' }));
  });

  it('answers a repeated save with the one it has', async () => {
    const body = receipt({ date: '2026-10-10', total: '9.99' });
    await same(REP, a => a.post('/expenses', body));
    expect((await same(REP, a => a.post('/expenses', body))).body.alreadySaved).toBe(true);
    expect((await same(MANAGER, a => a.post('/expenses', body))).status).toBe(409);
  });

  it('stops the same receipt twice unless the person says it’s a second purchase', async () => {
    const again = await same(REP, a => a.post('/expenses', receipt({ merchant: 'McDonalds' })));
    expect(again.status).toBe(409);
    expect(again.body.repeat).toMatchObject({ date: '2026-10-03', cents: 1432 });
    expect((await same(REP, a => a.post('/expenses', receipt({ confirmRepeat: true })))).status).toBe(201);
  });

  it('needs a card, a valid body, and a shown category', async () => {
    expect((await same(NOCARD, a => a.post('/expenses', receipt()))).status).toBe(409);
    const bad = await same(REP, a => a.post('/expenses', receipt({ total: 'abc', date: '2027-01-01' })));
    expect(Object.keys(bad.body.problems).sort()).toEqual(['date', 'total']);
    const hidden = (await same(ACCOUNTING, a => a.get('/categories'))).body.categories.find((c: Loose) => !c.active);
    expect((await same(REP, a => a.post('/expenses', receipt({ category: hidden.name, total: '3.00' })))).status).toBe(400);
    expect((await same(REP, a => a.post('/expenses', { ...receipt(), id: 'nope' }))).status).toBe(400);
  });

  it('takes a lost-receipt reason in place of a photo', async () => {
    const r = await same(REP, a => a.post('/expenses', receipt({ receiptUrl: '', lostReason: 'The pump didn’t print one', category: 'fuel', total: '125.00', date: '2026-10-12' })));
    expect(r.body.expense).toMatchObject({ status: 'waiting', lostReason: 'The pump didn’t print one', receiptUrl: '' });
  });
});

describe('who sees what', () => {
  it('shows people their own, view-all everyone’s, and approvers what waits for them', async () => {
    const mine = await same(REP, a => a.get('/expenses?month=2026-10'));
    expect(mine.body.expenses.length).toBeGreaterThan(3);
    const days = mine.body.expenses.map((e: Loose) => e.date);
    expect(days).toEqual([...days].sort().reverse());
    expect((await same(REP, a => a.get('/expenses?scope=all&month=2026-10'))).status).toBe(403);
    expect((await same(ACCOUNTING, a => a.get('/expenses?scope=all&month=2026-10'))).body.expenses.length).toBeGreaterThan(mine.body.expenses.length);
    await same(ACCOUNTING, a => a.get('/expenses?scope=all&month=2026-11'));
    await same(MANAGER, a => a.get('/expenses?scope=waiting'));
    await same(DIRECTOR, a => a.get('/expenses?scope=waiting'));
    await same(REP, a => a.get('/expenses?scope=waiting'));
    expect((await same(REP, a => a.get('/expenses'))).status).toBe(400);
  });
});

describe('approval', () => {
  it('lets someone above approve, from another branch, and never the cardholder themselves', async () => {
    const body = receipt({ date: '2026-10-14', total: '33.00' });
    await same(REP, a => a.post('/expenses', body));
    const mgr = receipt({ merchant: 'Staples', total: '86.42', category: 'office_supplies', date: '2026-10-14' });
    await same(MANAGER, a => a.post('/expenses', mgr));
    expect((await same(MANAGER, a => a.post(`/expenses/${mgr.id}/approve`))).status).toBe(403);
    expect((await same(REP, a => a.post(`/expenses/${body.id}/approve`))).status).toBe(403);
    const ok = await same(MANAGER, a => a.post(`/expenses/${body.id}/approve`));
    expect(ok.body.expense).toMatchObject({ status: 'approved', approval: { byName: 'Dana Whitfield' } });
    expect((await same(DIRECTOR, a => a.post(`/expenses/${body.id}/approve`))).status).toBe(409);
    expect((await same(REP, a => a.put(`/expenses/${body.id}`, { ...body, total: '1.00' }))).status).toBe(409);
    expect((await same(REP, a => a.post(`/expenses/${body.id}/void`, { reason: 'late' }))).status).toBe(409);
    await same(DIRECTOR, a => a.post(`/expenses/${mgr.id}/approve`));
    expect((await same(DIRECTOR, a => a.post(`/expenses/${nextId()}/approve`))).status).toBe(404);
  });

  it('needs the approver’s comment for a lost receipt', async () => {
    const body = receipt({ receiptUrl: '', lostReason: 'Pump didn’t print one', category: 'fuel', date: '2026-10-15', total: '70.00' });
    await same(REP, a => a.post('/expenses', body));
    const refused = await same(MANAGER, a => a.post(`/expenses/${body.id}/approve`, { comment: ' ' }));
    expect(refused.status).toBe(400);
    const ok = await same(MANAGER, a => a.post(`/expenses/${body.id}/approve`, { comment: 'Burlington delivery run. OK.' }));
    expect(ok.body.expense.approval.comment).toBe('Burlington delivery run. OK.');
  });

  it('sends back with a reason; fixing it sends it for approval again, and a sent-back one can be approved after', async () => {
    const body = receipt({ merchant: 'SP PARK', total: '12.85', category: 'office_supplies', date: '2026-10-16' });
    await same(REP, a => a.post('/expenses', body));
    expect((await same(MANAGER, a => a.post(`/expenses/${body.id}/send-back`, { comment: '' }))).status).toBe(400);
    const back = await same(MANAGER, a => a.post(`/expenses/${body.id}/send-back`, { comment: 'Was this the customer visit?' }));
    expect(back.body.expense).toMatchObject({ status: 'sent_back', sentBack: { comment: 'Was this the customer visit?' } });
    const fixed = await same(REP, a => a.put(`/expenses/${body.id}`, { ...body, note: 'Parking for the Bellevue showroom visit' }));
    expect(fixed.body.expense.status).toBe('waiting');
    await same(MANAGER, a => a.post(`/expenses/${body.id}/approve`, { comment: 'fine' }));
    // The one seeded as sent back (Kent, lost receipt) is fixed by its holder and goes round again.
    await same(MANAGER, a => a.put(`/expenses/${seeded.lost}`, { id: seeded.lost, date: '2026-10-04', merchant: 'Chevron', total: '40.00', category: 'fuel', lostReason: 'No receipt printed', note: 'Run to Burlington' }));
    await same(DIRECTOR, a => a.post(`/expenses/${seeded.lost}/approve`, { comment: 'ok' }));
  });
});

describe('voiding', () => {
  it('is the cardholder’s, with a reason, until it’s approved', async () => {
    const body = receipt({ date: '2026-10-17', total: '18.00' });
    await same(REP, a => a.post('/expenses', body));
    expect((await same(REP, a => a.post(`/expenses/${body.id}/void`, { reason: '' }))).status).toBe(400);
    expect((await same(MANAGER, a => a.post(`/expenses/${body.id}/void`, { reason: 'x' }))).status).toBe(404);
    const voided = await same(REP, a => a.post(`/expenses/${body.id}/void`, { reason: 'Uploaded to the wrong card' }));
    expect(voided.body.expense.voided.reason).toBe('Uploaded to the wrong card');
    expect((await same(REP, a => a.post(`/expenses/${body.id}/void`, { reason: 'again' }))).body.alreadyVoided).toBe(true);
    // A voided one is not a repeat: the same receipt can be uploaded again.
    expect((await same(REP, a => a.post('/expenses', receipt({ date: '2026-10-17', total: '18.00' })))).status).toBe(201);
    expect((await same(REP, a => a.put(`/expenses/${body.id}`, { ...body, total: '19.00' }))).status).toBe(409);
    await same(REP, a => a.get('/expenses?month=2026-10'));
  });
});

describe('the starting list, on an empty Postgres', () => {
  it('is seeded once, in order, with each category’s fields', { timeout: 120000 }, async () => {
    const empty = await openDb('pglite:memory');
    await migrateDb(empty.db, 'pglite:memory');
    const docs = STARTING_CATEGORIES.map((c, i) => ({ _id: randomBytes(12).toString('hex'), name: categoryKey(c.label), label: c.label, order: i, fields: { ...c.fields } }));
    await seedCategories(empty.db, docs);
    await seedCategories(empty.db, docs.map(d => ({ ...d, _id: randomBytes(12).toString('hex') })));
    const list = await listCategories(empty.db);
    expect(list.map(c => [c.name, c.label, c.order, c.active, c.fields])).toEqual(docs.map(d => [d.name, d.label, d.order, true, { customer: false, attendees: false, purpose: false, recurring: false, ...d.fields }]));
    await empty.close();
  });
});
