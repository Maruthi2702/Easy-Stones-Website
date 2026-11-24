import type { Loose } from '../types/records.ts';
// Credit Card Receipts (src/routes/cardReceipts.ts) against a throwaway
// in-memory MongoDB: categories seeded once and managed, one card per person,
// saving a receipt (draft → waiting, a repeat, the same receipt twice),
// who sees what, approval by role (never your own, lost receipt needs a
// comment), send back and fix, and void.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Which expenses answer an Amex charge (the check itself is Postgres only; the rule is the route's).
const matched = new Set<string>();
vi.mock('../db/cardStatements/hooks.ts', async (orig) => ({
  ...(await orig<typeof import('../db/cardStatements/hooks.ts')>()),
  amexChargeOf: async (id: string) => (matched.has(id) ? { reference: 'R1' } : null)
}));

// A customer a receipt names must exist (cardReceipts route): this one does.
const CUSTOMER = '0123456789abcdef01234567';
vi.mock('../db/customers/index.ts', async (orig) => ({
  ...(await orig<typeof import('../db/customers/index.ts')>()),
  customerById: async (id: string) => (id === '0123456789abcdef01234567' ? { _id: id, company: 'Cascade Countertops' } : null)
}));

// A private file store: what was put under private/CardReceipts/ and who uploaded it.
const PRIV = 'img_1700000000000_0123456789abcdef01234567.webp';
const files = new Map<string, { body: Buffer; contentType: string; metadata: Record<string, string> }>();
const fakeStore = { backend: 's3', get: async (key: string) => files.get(key) ?? null } as unknown as import('../services/fileStore.ts').FileStore;

const { default: createCardReceiptsRouter } = await import('./cardReceipts.ts');
const { CompanyCard, ReceiptCategory, CardExpense } = await import('../models/CardReceipts.ts');
const { default: Role } = await import('../models/Role.ts');
const { default: User } = await import('../models/User.ts');

let mongo!: MongoMemoryServer;
let app!: import('express').Express;

const USE = 'use_card_receipts';
const oid = () => new mongoose.Types.ObjectId().toString();
const ids = { rep: oid(), manager: oid(), director: oid(), acct: oid(), admin1: oid(), admin2: oid() };
const REP = { id: ids.rep, displayName: 'Maruthi Ponugupati', role: 'sales_rep', location: 'Seattle', permissions: [USE] };
const MANAGER = { id: ids.manager, displayName: 'Dana Whitfield', role: 'manager', location: 'Kent', permissions: [USE, 'approve_card_receipts'] };
const DIRECTOR = { id: ids.director, displayName: 'Dee Rector', role: 'director', location: 'Seattle', permissions: [USE, 'approve_card_receipts'] };
const ACCOUNTING = { id: ids.acct, displayName: 'Ann Count', role: 'accounting', permissions: [USE, 'approve_card_receipts', 'view_all_card_receipts', 'manage_company_cards', 'add_receipt_categories', 'edit_receipt_categories', 'reorder_receipt_categories', 'delete_receipt_categories'] };
const ADMIN1 = { id: ids.admin1, displayName: 'Ada Min', role: 'admin', permissions: [USE, 'approve_card_receipts'] };
const ADMIN2 = { id: ids.admin2, displayName: 'Abe Root', role: 'admin', permissions: [USE, 'approve_card_receipts'] };
const NOBODY = { id: new mongoose.Types.ObjectId().toString(), role: 'sales_rep', permissions: [] };

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([CompanyCard.init(), CardExpense.init(), ReceiptCategory.init()]);
  app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/card-receipts', createCardReceiptsRouter({
    authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
    processBase64Image: async (_d: string, _f?: string, _m?: number, opts?: { private?: boolean }) =>
      (opts?.private ? `https://cdn.test/private/CardReceipts/${PRIV}` : 'https://res.cloudinary.com/test/CardReceipts/img_1.webp'),
    fileStore: () => fakeStore
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await Promise.all([CompanyCard, ReceiptCategory, CardExpense, Role, User].map((M) => (M as Loose).collection.deleteMany({})));
  await User.collection.insertMany([
    { _id: new mongoose.Types.ObjectId(ids.rep), username: 'maruthi', displayName: 'Maruthi Ponugupati', password: 'x'.repeat(10), role: 'sales_rep' },
    { _id: new mongoose.Types.ObjectId(ids.manager), username: 'dana', displayName: 'Dana Whitfield', password: 'x'.repeat(10), role: 'manager', location: 'Kent' },
    { _id: new mongoose.Types.ObjectId(ids.director), username: 'dee', displayName: 'Dee Rector', password: 'x'.repeat(10), role: 'director', location: 'Seattle' },
    { _id: new mongoose.Types.ObjectId(ids.acct), username: 'ann', displayName: 'Ann Count', password: 'x'.repeat(10), role: 'accounting' },
    { _id: new mongoose.Types.ObjectId(ids.admin1), username: 'ada', displayName: 'Ada Min', password: 'x'.repeat(10), role: 'admin', location: 'Kent' },
    { _id: new mongoose.Types.ObjectId(ids.admin2), username: 'abe', displayName: 'Abe Root', password: 'x'.repeat(10), role: 'admin' }
  ]);
  await Role.collection.insertMany([
    { name: 'sales_rep', displayName: 'Sales rep', permissions: [USE] },
    { name: 'manager', displayName: 'Manager', permissions: [USE, 'approve_card_receipts'] },
    { name: 'director', displayName: 'Director', permissions: [USE, 'approve_card_receipts'] },
    { name: 'accounting', displayName: 'Accounting', permissions: ['approve_card_receipts'] },
    { name: 'admin', displayName: 'Admin', permissions: [USE, 'approve_card_receipts'] }
  ]);
  await CompanyCard.create({ userId: ids.rep, label: 'MARU92069', lastDigits: '92069' });
  await CompanyCard.create({ userId: ids.manager, label: 'DANA41008', lastDigits: '41008' });
});

const as = (user: Loose) => {
  const h = (r: request.Test) => r.set('x-test-user', JSON.stringify(user));
  return {
    get: (url: string) => h(request(app).get(`/api/card-receipts${url}`)),
    post: (url: string, body: Loose = {}) => h(request(app).post(`/api/card-receipts${url}`)).send(body),
    put: (url: string, body: Loose) => h(request(app).put(`/api/card-receipts${url}`)).send(body),
    patch: (url: string, body: Loose) => h(request(app).patch(`/api/card-receipts${url}`)).send(body),
    del: (url: string, body: Loose = {}) => h(request(app).delete(`/api/card-receipts${url}`)).send(body)
  };
};
const newId = () => new mongoose.Types.ObjectId().toString();
const receipt = (over: Loose = {}) => ({
  id: newId(), date: '2026-10-03', merchant: "McDonald's, Kent", total: '14.32', tax: '1.35', category: 'travel_lunch',
  receiptUrl: 'https://res.cloudinary.com/test/CardReceipts/img_1.webp', ...over
});

describe('categories', () => {
  it('seeds the starting list once and lists it to anyone who can open the page', async () => {
    const res = await as(REP).get('/categories').expect(200);
    expect(res.body.categories.map((c: Loose) => c.label)).toEqual(['Travel Lunch', 'Customer Lunch', 'Office Supplies', 'Fuel', 'Parking', 'Software & Subscriptions']);
    expect(res.body.categories[1].fields).toEqual({ customer: true, note: false, recurring: false });
    await as(REP).get('/categories').expect(200);
    expect(await ReceiptCategory.countDocuments()).toBe(6);
    await as(NOBODY).get('/categories').expect(403);
  });

  it('adds, renames, hides and reorders with the Admin switches only', async () => {
    await as(REP).post('/categories', { label: 'Travel' }).expect(403);
    const added = await as(ACCOUNTING).post('/categories', { label: 'Travel', fields: { note: true } }).expect(201);
    expect(added.body.category).toMatchObject({ name: 'travel', order: 6, fields: { customer: false, note: true, recurring: false } });
    await as(ACCOUNTING).post('/categories', { label: 'fuel' }).expect(400);
    const renamed = await as(ACCOUNTING).put(`/categories/${added.body.category._id}`, { label: 'Travel & Hotels', active: false }).expect(200);
    expect(renamed.body.category).toMatchObject({ name: 'travel', label: 'Travel & Hotels', active: false });
    const list = (await as(ACCOUNTING).get('/categories')).body.categories.map((c: Loose) => c._id).reverse();
    const reordered = await as(ACCOUNTING).patch('/categories/reorder', { ids: list }).expect(200);
    expect(reordered.body.categories[0].label).toBe('Travel & Hotels');
    await as(ACCOUNTING).patch('/categories/reorder', { ids: list.slice(1) }).expect(400);
  });

  it('deletes one in use only by moving its expenses to a shown category', async () => {
    await as(REP).post('/expenses', receipt()).expect(201);
    const cats = (await as(ACCOUNTING).get('/categories')).body.categories;
    const travel = cats.find((c: Loose) => c.name === 'travel_lunch');
    const fuel = cats.find((c: Loose) => c.name === 'fuel');
    expect((await as(ACCOUNTING).get(`/categories/${travel._id}/uses`)).body.uses).toBe(1);
    await as(ACCOUNTING).del(`/categories/${travel._id}`).expect(409);
    await as(ACCOUNTING).del(`/categories/${travel._id}`, { replaceWith: fuel._id }).expect(200);
    const [moved] = await CardExpense.find().lean();
    expect(moved!.category).toBe('fuel');
    expect(moved!.history.at(-1)!.changes).toMatch(/Travel Lunch → Fuel/);
  });
});

describe('cards', () => {
  it('keeps one active card per person and per card ID', async () => {
    await as(REP).post('/cards', { userId: ids.director, label: 'DEER11111', lastDigits: '11111' }).expect(403);
    await as(ACCOUNTING).post('/cards', { userId: ids.rep, label: 'MARU55555', lastDigits: '55555' }).expect(409);
    await as(ACCOUNTING).post('/cards', { userId: ids.director, label: 'MARU92069', lastDigits: '92069' }).expect(409);
    const added = await as(ACCOUNTING).post('/cards', { userId: ids.director, label: 'deer11111', lastDigits: '11111' }).expect(201);
    expect(added.body.card.label).toBe('DEER11111');
    const old = await CompanyCard.findOne({ userId: ids.rep }).lean();
    await as(ACCOUNTING).put(`/cards/${old!._id}`, { active: false }).expect(200);
    // A deactivated card still owns its ID: a new card with it is refused (reactivate the old one instead).
    const again = await as(ACCOUNTING).post('/cards', { userId: ids.rep, label: old!.label, lastDigits: old!.lastDigits }).expect(409);
    expect(again.body.problems.label).toMatch(/deactivated/);
    await as(ACCOUNTING).post('/cards', { userId: ids.rep, label: 'MARU55555', lastDigits: '55555' }).expect(201);
    const list = await as(ACCOUNTING).get('/cards').expect(200);
    expect(list.body.cards).toHaveLength(4);
    expect(list.body.people.map((p: Loose) => p.name)).toContain('Maruthi Ponugupati');
  });
});

describe('saving a receipt', () => {
  it('saves under the uploader and their card, at their home location, and sends a complete one for approval', async () => {
    const res = await as(REP).post('/expenses', receipt()).expect(201);
    expect(res.body.expense).toMatchObject({ cents: 1432, taxCents: 135, cardLabel: 'MARU92069', location: 'Seattle', holderName: 'Maruthi Ponugupati', status: 'waiting', mine: true });
    const me = await as(REP).get('/me').expect(200);
    expect(me.body.card.label).toBe('MARU92069');
  });

  it('keeps an unfinished one as a draft, and finishing it sends it for approval', async () => {
    const body = receipt({ category: 'customer_lunch', merchant: 'Kashish Cuisine of India', total: '57.29' });
    const draft = await as(REP).post('/expenses', body).expect(201);
    expect(draft.body.expense.status).toBe('draft');
    const done = await as(REP).put(`/expenses/${body.id}`, { ...body, customerId: CUSTOMER, customerName: 'Cascade Countertops', attendees: ['Maruthi Ponugupati', 'J. Alvarez'] }).expect(200);
    expect(done.body.expense.status).toBe('waiting');
    expect(done.body.expense.history.at(-1).changes).toMatch(/customer, who attended · sent for approval/);
  });

  it('answers a repeated save with the one it has', async () => {
    const body = receipt();
    await as(REP).post('/expenses', body).expect(201);
    expect((await as(REP).post('/expenses', body).expect(200)).body.alreadySaved).toBe(true);
    expect(await CardExpense.countDocuments()).toBe(1);
  });

  it('stops the same receipt twice unless the person says it’s a second purchase', async () => {
    await as(REP).post('/expenses', receipt()).expect(201);
    const again = await as(REP).post('/expenses', receipt({ merchant: 'McDonalds' })).expect(409);
    expect(again.body.repeat).toMatchObject({ date: '2026-10-03', cents: 1432 });
    await as(REP).post('/expenses', receipt({ confirmRepeat: true })).expect(201);
  });

  it('needs a card, a valid body, and a shown category', async () => {
    await as(DIRECTOR).post('/expenses', receipt()).expect(409);
    const bad = await as(REP).post('/expenses', receipt({ total: 'abc', date: '2027-01-01' })).expect(400);
    expect(Object.keys(bad.body.problems).sort()).toEqual(['date', 'total']);
    await ReceiptCategory.updateOne({ name: 'parking' }, { $set: { active: false } });
    await as(REP).get('/categories');
    await as(REP).post('/expenses', receipt({ category: 'parking' })).expect(400);
  });

  it('takes a lost-receipt reason in place of a photo', async () => {
    const res = await as(REP).post('/expenses', receipt({ receiptUrl: '', lostReason: 'The pump didn’t print one', category: 'fuel', total: '125.00' })).expect(201);
    expect(res.body.expense).toMatchObject({ status: 'waiting', lostReason: 'The pump didn’t print one', receiptUrl: '' });
  });

  it('stores a photo and hands back its address', async () => {
    const res = await as(REP).post('/attachments', { data: 'data:image/jpeg;base64,AAAA' }).expect(200);
    // Kept privately: the saved address is the app's own, never the CDN's.
    expect(res.body.url).toBe(`/api/card-receipts/files/${PRIV}`);
    await as(REP).post('/attachments', { data: 'hello' }).expect(400);
    await as(NOBODY).post('/attachments', { data: 'data:image/jpeg;base64,AAAA' }).expect(403);
  });
});

describe('who sees what', () => {
  it('shows people their own, view-all everyone’s, and approvers what waits for them', async () => {
    await as(REP).post('/expenses', receipt()).expect(201);
    await as(MANAGER).post('/expenses', receipt({ merchant: 'Staples', total: '86.42', category: 'office_supplies' })).expect(201);
    const mine = (await as(REP).get('/expenses?month=2026-10').expect(200)).body.expenses;
    expect(mine.map((e: Loose) => e.merchant)).toEqual(["McDonald's, Kent"]);
    await as(REP).get('/expenses?scope=all&month=2026-10').expect(403);
    expect((await as(ACCOUNTING).get('/expenses?scope=all&month=2026-10').expect(200)).body.expenses).toHaveLength(2);
    // Waiting for me: an Accounting approval is Accounting's (or an Admin's); a branch manager has none of these to give.
    expect((await as(ACCOUNTING).get('/expenses?scope=waiting').expect(200)).body.expenses.map((e: Loose) => [e.merchant, e.canDecide]).sort()).toEqual([["McDonald's, Kent", true], ['Staples', true]]);
    expect((await as(MANAGER).get('/expenses?scope=waiting').expect(200)).body.expenses).toEqual([]);
    expect((await as(DIRECTOR).get('/expenses?scope=waiting').expect(200)).body.expenses).toEqual([]);
    await as(REP).get('/expenses').expect(400);
  });
});

describe('export all', () => {
  const EXPORTER = { id: ids.acct, role: 'accounting', permissions: ['view_all_card_receipts', 'export_all_card_receipts'] };
  it('says which bank each expense is on, and lets the list be read by bank', async () => {
    const encore = await CompanyCard.create({ userId: ids.director, label: 'DEER3992', lastDigits: '3992', issuer: 'encore' });
    await as(REP).post('/expenses', receipt()).expect(201);
    await as(DIRECTOR).post('/expenses', receipt({ merchant: 'Shell' })).expect(201);
    const list = (await as(ACCOUNTING).get('/expenses?scope=all&month=2026-10').expect(200)).body.expenses;
    expect(Object.fromEntries(list.map((e: Loose) => [e.merchant, e.issuer]))).toEqual({ "McDonald's, Kent": 'amex', Shell: 'encore' });
    expect(String(encore._id)).toBe(list.find((e: Loose) => e.merchant === 'Shell').cardId);
  });

  it('needs its own switch, not Export or View all', async () => {
    await as(ACCOUNTING).get('/expenses/export').expect(403);
    await as({ ...ACCOUNTING, permissions: ['view_all_card_receipts', 'export_card_receipts'] }).get('/expenses/export').expect(403);
    await as(EXPORTER).get('/expenses/export').expect(200);
  });

  it('gives every month, or one bank, and refuses a bank it does not know', async () => {
    await CompanyCard.create({ userId: ids.director, label: 'DEER3992', lastDigits: '3992', issuer: 'encore' });
    await as(REP).post('/expenses', receipt()).expect(201);
    await as(REP).post('/expenses', receipt({ merchant: 'Chevron', date: '2026-09-14' })).expect(201);
    await as(DIRECTOR).post('/expenses', receipt({ merchant: 'Shell', date: '2026-08-02' })).expect(201);
    const all = (await as(EXPORTER).get('/expenses/export').expect(200)).body.expenses;
    expect(all.map((e: Loose) => e.merchant)).toEqual(["McDonald's, Kent", 'Chevron', 'Shell']);
    const encoreOnly = (await as(EXPORTER).get('/expenses/export?bank=encore').expect(200)).body.expenses;
    expect(encoreOnly.map((e: Loose) => e.merchant)).toEqual(['Shell']);
    const amexOnly = (await as(EXPORTER).get('/expenses/export?bank=amex').expect(200)).body.expenses;
    expect(amexOnly.map((e: Loose) => e.merchant)).toEqual(["McDonald's, Kent", 'Chevron']);
    await as(EXPORTER).get('/expenses/export?bank=visa').expect(400);
  });

  it('only holds what the caller may see: View all everyone, else their own', async () => {
    await as(REP).post('/expenses', receipt()).expect(201);
    await as(MANAGER).post('/expenses', receipt({ merchant: 'Staples' })).expect(201);
    expect((await as(EXPORTER).get('/expenses/export').expect(200)).body.expenses).toHaveLength(2);
    const ownOnly = { ...REP, permissions: [USE, 'export_all_card_receipts'] };
    expect((await as(ownOnly).get('/expenses/export').expect(200)).body.expenses.map((e: Loose) => e.merchant)).toEqual(["McDonald's, Kent"]);
  });
});

describe('cardholders for the filter', () => {
  it('lists everyone with a card to View all, none to a plain cardholder, and no one twice', async () => {
    await as(REP).get('/cardholders').expect(403);
    const all = (await as(ACCOUNTING).get('/cardholders').expect(200)).body.holders;
    const rows = await CompanyCard.find({}).lean();
    const withHolder = new Set(rows.map((c: Loose) => String(c.userId || '')).filter(Boolean));
    expect(all).toHaveLength(withHolder.size);
    expect(new Set(all.map((h: Loose) => h.id)).size).toBe(all.length);
    expect(all.map((h: Loose) => h.name)).toContain('Maruthi Ponugupati');
  });
});

describe('approval', () => {
  // Cards for every kind of cardholder: staff (REP, Seattle), manager (Kent), accounting, admin.
  beforeEach(async () => {
    await CompanyCard.create({ userId: ids.acct, label: 'ANNC10001', lastDigits: '10001' });
    await CompanyCard.create({ userId: ids.admin1, label: 'ADAM10002', lastDigits: '10002' });
  });
  const big = (over: Loose = {}) => receipt({ total: '240.00', merchant: 'Shell', category: 'fuel', ...over });
  const approve = (who: Loose, id: string, comment = '') => as(who).post(`/expenses/${id}/approve`, { comment });

  it('a staff receipt under $150 needs only the Accounting approval, never the cardholder’s own', async () => {
    const body = receipt();
    await as(REP).post('/expenses', body).expect(201);
    await approve(REP, body.id).expect(403);
    await approve(DIRECTOR, body.id).expect(403); // a branch manager gives only the second approval
    const ok = await approve(ACCOUNTING, body.id).expect(200);
    expect(ok.body.expense).toMatchObject({ status: 'approved', needsSecond: false, approval: { byName: 'Ann Count', as: 'accounting' }, secondApproval: null });
    expect(ok.body.expense.chips).toEqual([{ key: 'accounting', label: 'Accounting', by: 'Ann Count', done: true }]);
    expect(ok.body.expense.history.at(-1)).toMatchObject({ action: 'approved', changes: 'Accounting approval · approved' });
    await approve(ADMIN1, body.id).expect(409);
    await as(REP).put(`/expenses/${body.id}`, { ...body, total: '1.00' }).expect(409);
  });

  it('a staff receipt of $150+ needs Accounting and the branch manager (or an Admin), in either order', async () => {
    const body = big();
    await as(REP).post('/expenses', body).expect(201);
    const first = await approve(ACCOUNTING, body.id).expect(200);
    expect(first.body.expense).toMatchObject({ status: 'waiting', needsSecond: true });
    expect(first.body.expense.history.at(-1).changes).toBe('Accounting approval · waiting for the second approval');
    await approve(MANAGER, body.id).expect(403); // Kent: not the cardholder's branch
    await approve(ACCOUNTING, body.id).expect(403);
    const done = await approve(DIRECTOR, body.id).expect(200);
    expect(done.body.expense).toMatchObject({ status: 'approved', secondApproval: { byName: 'Dee Rector', as: 'manager' } });
    expect(done.body.expense.history.at(-1).changes).toBe('Second approval (manager) · approved');
    // The other order: the manager first, then Accounting.
    const other = big({ total: '151.00' });
    await as(REP).post('/expenses', other).expect(201);
    expect((await approve(DIRECTOR, other.id).expect(200)).body.expense.history.at(-1).changes).toBe('Second approval (manager) · waiting for Accounting');
    expect((await approve(ACCOUNTING, other.id).expect(200)).body.expense.status).toBe('approved');
  });

  it('$150.00 exactly needs the second approval', async () => {
    const body = big({ total: '150.00' });
    await as(REP).post('/expenses', body).expect(201);
    expect((await approve(ACCOUNTING, body.id).expect(200)).body.expense.status).toBe('waiting');
  });

  it('a manager’s receipt of $150+ needs Accounting and an Admin; under $150 Accounting alone', async () => {
    const body = big();
    await as(MANAGER).post('/expenses', body).expect(201);
    await approve(DIRECTOR, body.id).expect(403);
    await approve(ACCOUNTING, body.id).expect(200);
    const done = await approve(ADMIN1, body.id).expect(200);
    expect(done.body.expense).toMatchObject({ status: 'approved', secondApproval: { as: 'admin' } });
    expect(done.body.expense.chips.map((c: Loose) => c.label)).toEqual(['Accounting', 'Admin']);
    const small = receipt({ merchant: 'Staples', total: '86.42' });
    await as(MANAGER).post('/expenses', small).expect(201);
    expect((await approve(ACCOUNTING, small.id).expect(200)).body.expense.status).toBe('approved');
  });

  it('an accounting member’s receipt goes to Admins: two Admins cover a $150+ one, never the same one twice', async () => {
    const body = big();
    await as(ACCOUNTING).post('/expenses', body).expect(201);
    await approve(ACCOUNTING, body.id).expect(403);
    const one = await approve(ADMIN1, body.id).expect(200);
    expect(one.body.expense).toMatchObject({ status: 'waiting', secondApproval: { by: ids.admin1, as: 'admin' }, approval: null });
    const again = await approve(ADMIN1, body.id).expect(403);
    expect(again.body.message).toMatch(/already gave one approval/);
    const two = await approve(ADMIN2, body.id).expect(200);
    expect(two.body.expense).toMatchObject({ status: 'approved', approval: { by: ids.admin2, as: 'admin' } });
    expect(two.body.expense.history.at(-1).changes).toBe('Accounting approval (Admin) · approved');
  });

  it('an Admin’s own receipt needs only Accounting (or another Admin), whatever its total', async () => {
    const body = big({ total: '900.00' });
    await as(ADMIN1).post('/expenses', body).expect(201);
    await approve(ADMIN1, body.id).expect(403);
    const ok = await approve(ADMIN2, body.id).expect(200);
    expect(ok.body.expense).toMatchObject({ status: 'approved', needsSecond: false, holderRole: 'admin', approval: { as: 'admin' } });
  });

  it('needs the approver’s comment for a lost receipt', async () => {
    const body = receipt({ receiptUrl: '', lostReason: 'Pump didn’t print one', category: 'fuel' });
    await as(REP).post('/expenses', body).expect(201);
    const refused = await approve(ACCOUNTING, body.id, ' ').expect(400);
    expect(refused.body.problems.comment).toMatch(/comment/);
    const ok = await approve(ACCOUNTING, body.id, 'Burlington delivery run. OK.').expect(200);
    expect(ok.body.expense.approval.comment).toBe('Burlington delivery run. OK.');
  });

  it('lists in Waiting for me only what is the viewer’s to give', async () => {
    await as(REP).post('/expenses', receipt()).expect(201);
    await as(REP).post('/expenses', big()).expect(201);
    await as(MANAGER).post('/expenses', big({ merchant: 'Staples' })).expect(201);
    const waiting = async (who: Loose) => (await as(who).get('/expenses?scope=waiting').expect(200)).body.expenses
      .map((e: Loose) => [e.holderName, e.cents, e.waitingReason]).sort();
    expect(await waiting(ACCOUNTING)).toEqual([['Dana Whitfield', 24000, 'accounting'], ['Maruthi Ponugupati', 1432, 'accounting'], ['Maruthi Ponugupati', 24000, 'accounting']]);
    expect(await waiting(DIRECTOR)).toEqual([['Maruthi Ponugupati', 24000, 'second']]);
    expect(await waiting(MANAGER)).toEqual([]); // Kent: no receipt of theirs to give
    expect(await waiting(ADMIN1)).toEqual([['Dana Whitfield', 24000, 'second'], ['Maruthi Ponugupati', 1432, 'accounting'], ['Maruthi Ponugupati', 24000, 'second']]);
    expect(await waiting(REP)).toEqual([]);
    const row = (await as(ACCOUNTING).get('/expenses?scope=waiting')).body.expenses.find((e: Loose) => e.cents === 1432);
    expect(row).toMatchObject({ canDecide: true, actions: { approve: 'accounting', sendBack: true, ask: true, withdrawAsk: false, answer: false, reopen: false, fillDetails: false } });
    expect(row.step).toBeUndefined();
  });

  it('sends back only from Accounting or an Admin, with a reason, clearing both approvals and the question', async () => {
    const body = big({ merchant: 'SP PARK', category: 'parking' });
    await as(REP).post('/expenses', body).expect(201);
    await approve(DIRECTOR, body.id).expect(200);
    await as(DIRECTOR).post(`/expenses/${body.id}/send-back`, { comment: 'No' }).expect(403);
    await as(ACCOUNTING).post(`/expenses/${body.id}/send-back`, { comment: '' }).expect(400);
    await as(ACCOUNTING).post(`/expenses/${body.id}/ask`, { to: ids.admin1, question: 'Which customer was this for?' }).expect(200);
    const back = await as(ADMIN2).post(`/expenses/${body.id}/send-back`, { comment: 'Was this the customer visit?' }).expect(200);
    expect(back.body.expense).toMatchObject({ status: 'sent_back', approval: null, secondApproval: null, ask: null, sentBack: { comment: 'Was this the customer visit?' } });
    const fixed = await as(REP).put(`/expenses/${body.id}`, { ...body, note: 'Parking for the Bellevue showroom visit' }).expect(200);
    expect(fixed.body.expense.status).toBe('waiting');
  });

  it('a holder’s edit takes back both approvals; an open question stays', async () => {
    const body = big();
    await as(REP).post('/expenses', body).expect(201);
    await approve(DIRECTOR, body.id).expect(200);
    await as(ACCOUNTING).post(`/expenses/${body.id}/ask`, { to: ids.admin1, question: 'Which job site was this?' }).expect(200);
    const edited = await as(REP).put(`/expenses/${body.id}`, { ...body, note: 'Fuel for the Kent run' }).expect(200);
    expect(edited.body.expense).toMatchObject({ status: 'waiting', approval: null, secondApproval: null, ask: { to: ids.admin1, answeredAt: null } });
    expect(edited.body.expense.history.at(-1).changes).toMatch(/approvals cleared/);
  });

  it('reopens an approved receipt with a reason, clearing its approvals', async () => {
    const body = receipt();
    await as(REP).post('/expenses', body).expect(201);
    await as(ACCOUNTING).post(`/expenses/${body.id}/reopen`, { reason: 'Wrong category' }).expect(409);
    await approve(ACCOUNTING, body.id).expect(200);
    await as(DIRECTOR).post(`/expenses/${body.id}/reopen`, { reason: 'Wrong category' }).expect(403);
    await as(ACCOUNTING).post(`/expenses/${body.id}/reopen`, { reason: 'no' }).expect(400);
    const open = await as(ADMIN1).post(`/expenses/${body.id}/reopen`, { reason: 'Wrong category' }).expect(200);
    expect(open.body.expense).toMatchObject({ status: 'waiting', approval: null, secondApproval: null });
    expect(open.body.expense.history.at(-1)).toMatchObject({ action: 'reopened', changes: 'Wrong category' });
  });

  it('refuses a decision on a receipt that changed after it was opened', async () => {
    const saved = (await as(REP).post('/expenses', receipt()).expect(201)).body.expense;
    const stale = new Date(new Date(saved.updatedAt).getTime() - 5000).toISOString();
    for (const [path, body] of [['send-back', { comment: 'why?' }], ['ask', { to: ids.director, question: 'Which job?' }], ['reopen', { reason: 'Wrong one' }]] as const) {
      expect((await as(ACCOUNTING).post(`/expenses/${saved.id}/${path}`, { ...body, expectedUpdatedAt: stale }).expect(409)).body.changed).toBe(true);
    }
  });
});

describe('asking about a receipt', () => {
  const big = (over: Loose = {}) => receipt({ total: '240.00', merchant: 'Shell', category: 'fuel', ...over });
  const notices: { kind: string; to: string }[] = [];
  let quiet!: import('express').Express;
  beforeAll(() => {
    quiet = express();
    quiet.use(express.json());
    quiet.use('/api/card-receipts', createCardReceiptsRouter({
      authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
      processBase64Image: async () => 'https://res.cloudinary.com/test/CardReceipts/img_1.webp',
      fileStore: () => fakeStore,
      notify: { asked: (_e, a) => { notices.push({ kind: 'asked', to: String(a.to) }); }, answered: (_e, a) => { notices.push({ kind: 'answered', to: String(a.by) }); } }
    }));
  });
  beforeEach(() => { notices.length = 0; });
  const q = (user: Loose) => ({
    get: (url: string) => request(quiet).get(`/api/card-receipts${url}`).set('x-test-user', JSON.stringify(user)),
    post: (url: string, body: Loose = {}) => request(quiet).post(`/api/card-receipts${url}`).set('x-test-user', JSON.stringify(user)).send(body)
  });

  it('asks the branch manager: an Accounting approval is taken back, nobody else approves until the answer, which fills the second', async () => {
    const body = big();
    await as(REP).post('/expenses', body).expect(201);
    await q(ACCOUNTING).post(`/expenses/${body.id}/approve`).expect(200);
    const targets = (await q(ACCOUNTING).get(`/expenses/${body.id}/ask-targets`).expect(200)).body.people;
    // Branch managers first (Seattle's, never Kent's), then Admins; never the cardholder or the asker.
    expect(targets.map((p: Loose) => p.name)).toEqual(['Dee Rector', 'Abe Root', 'Ada Min']);
    await q(DIRECTOR).get(`/expenses/${body.id}/ask-targets`).expect(403);
    await q(ACCOUNTING).post(`/expenses/${body.id}/ask`, { to: ids.manager, question: 'Which job was this?' }).expect(400);
    await q(ACCOUNTING).post(`/expenses/${body.id}/ask`, { to: ids.director, question: 'Hm' }).expect(400);
    const asked = await q(ACCOUNTING).post(`/expenses/${body.id}/ask`, { to: ids.director, question: 'Which job was this?' }).expect(200);
    expect(asked.body.expense).toMatchObject({ approval: null, ask: { to: ids.director, toName: 'Dee Rector', byName: 'Ann Count', question: 'Which job was this?', answer: '', answeredAt: null } });
    expect(asked.body.expense.history.at(-1)).toMatchObject({ action: 'asked', changes: 'to Dee Rector: Which job was this? · Accounting approval taken back' });
    expect(notices).toEqual([{ kind: 'asked', to: ids.director }]);
    await q(ACCOUNTING).post(`/expenses/${body.id}/ask`, { to: ids.admin1, question: 'And another?' }).expect(409);
    // While it's open nobody else approves, and the person asked answers rather than approves.
    await q(ADMIN1).post(`/expenses/${body.id}/approve`).expect(403);
    await q(DIRECTOR).post(`/expenses/${body.id}/approve`).expect(403);
    // An answer approves, so it needs the Approve switch: without it the question is not theirs to answer.
    const withoutApprove = { ...DIRECTOR, permissions: [USE] };
    expect((await q(withoutApprove).get('/expenses?scope=waiting').expect(200)).body.expenses).toEqual([]);
    await q(withoutApprove).post(`/expenses/${body.id}/answer`, { answer: 'The Bellevue showroom job' }).expect(403);
    // With it, the receipt is in their Waiting for me, and they answer.
    const askedOnly = { ...DIRECTOR, permissions: ['approve_card_receipts'] };
    const theirs = (await q(askedOnly).get('/expenses?scope=waiting').expect(200)).body.expenses;
    expect(theirs.map((e: Loose) => [e.id, e.waitingReason, e.actions.answer])).toEqual([[body.id, 'asked', true]]);
    expect((await q(ACCOUNTING).get('/expenses?scope=waiting')).body.expenses.find((e: Loose) => e.id === body.id)).toBeUndefined();
    await q(ADMIN1).post(`/expenses/${body.id}/answer`, { answer: 'The Kent job' }).expect(403);
    await q(askedOnly).post(`/expenses/${body.id}/answer`, { answer: 'x' }).expect(400);
    const answered = await q(askedOnly).post(`/expenses/${body.id}/answer`, { answer: 'The Bellevue showroom job' }).expect(200);
    expect(answered.body.expense).toMatchObject({ status: 'waiting', secondApproval: { by: ids.director, as: 'manager', comment: 'The Bellevue showroom job' }, ask: { answer: 'The Bellevue showroom job' } });
    expect(answered.body.expense.ask.answeredAt).toBeTruthy();
    expect(notices.at(-1)).toEqual({ kind: 'answered', to: ids.acct });
    // Accounting gives the final approval after the answer.
    expect((await q(ACCOUNTING).post(`/expenses/${body.id}/approve`).expect(200)).body.expense.status).toBe('approved');
  });

  it('lets the person asked open the receipt file, and Accounting with Approve too', async () => {
    const ref = `/api/card-receipts/files/${PRIV}`;
    files.set(`private/CardReceipts/${PRIV}`, { body: Buffer.from('IMG'), contentType: 'image/webp', metadata: { uploader: ids.manager } });
    const body = big({ receiptUrl: ref });
    await as(MANAGER).post('/expenses', body).expect(201);
    const acctOnly = { id: ids.acct, role: 'accounting', permissions: ['approve_card_receipts'] };
    await q(acctOnly).get(`/files/${PRIV}`).expect(200);
    await q(ADMIN1).get(`/files/${PRIV}`).expect(200);
    const outsider = { ...ADMIN2, role: 'sales_rep', permissions: [USE] };
    await q(outsider).get(`/files/${PRIV}`).expect(404);
    files.clear();
  });

  it('asks an Admin about a manager’s receipt, and the question can be withdrawn', async () => {
    const body = big();
    await as(MANAGER).post('/expenses', body).expect(201);
    const targets = (await q(ACCOUNTING).get(`/expenses/${body.id}/ask-targets`).expect(200)).body.people;
    expect(targets.map((p: Loose) => p.role)).toEqual(['admin', 'admin']);
    await q(ACCOUNTING).post(`/expenses/${body.id}/ask`, { to: ids.director, question: 'Which store?' }).expect(400);
    await q(ACCOUNTING).post(`/expenses/${body.id}/ask`, { to: ids.admin1, question: 'Which store?' }).expect(200);
    await q(DIRECTOR).post(`/expenses/${body.id}/ask/withdraw`).expect(403);
    const back = await q(ADMIN2).post(`/expenses/${body.id}/ask/withdraw`).expect(200);
    expect(back.body.expense.ask).toBeNull();
    expect(back.body.expense.history.at(-1)).toMatchObject({ action: 'question withdrawn', changes: 'Ada Min: Which store?' });
    await q(ADMIN2).post(`/expenses/${body.id}/ask/withdraw`).expect(409);
    await q(ACCOUNTING).post(`/expenses/${body.id}/approve`).expect(200);
  });

  it('an Admin’s own statement charge waits for Accounting, who fills in the category and approves it', async () => {
    const card = await CompanyCard.findOne({ userId: ids.manager }).lean();
    const charge = await CardExpense.create({ userId: ids.admin1, holderName: 'Ada Min', cardId: String(card!._id), cardLabel: 'ADAM', location: 'Kent', date: '2026-11-03', month: '2026-11',
      merchant: 'UNITED AIRLINES', cents: 48000, status: 'waiting', history: [{ at: new Date(), by: 'Ann Count', action: 'added', changes: 'An Admin’s charge: waiting for Accounting' }] });
    const id = String(charge._id);
    const waiting = (await q(ACCOUNTING).get('/expenses?scope=waiting').expect(200)).body.expenses.find((e: Loose) => e.id === id);
    expect(waiting).toMatchObject({ holderRole: 'admin', needsSecond: false, waitingReason: 'accounting', actions: { fillDetails: true, approve: 'accounting' } });
    const noCategory = await q(ACCOUNTING).post(`/expenses/${id}/approve`).expect(400);
    expect(noCategory.body.problems.category).toMatch(/category/);
    await q(REP).post(`/expenses/${id}/approve`).expect(403);
    await request(quiet).put(`/api/card-receipts/expenses/${id}/details`).set('x-test-user', JSON.stringify(ADMIN1)).send({ category: 'fuel' }).expect(403);
    await request(quiet).put(`/api/card-receipts/expenses/${id}/details`).set('x-test-user', JSON.stringify(ACCOUNTING)).send({ category: 'nope' }).expect(400);
    const filled = await request(quiet).put(`/api/card-receipts/expenses/${id}/details`).set('x-test-user', JSON.stringify(ACCOUNTING)).send({ category: 'customer_lunch', customerId: CUSTOMER, note: 'Flight to the Denver show' }).expect(200);
    expect(filled.body.expense).toMatchObject({ category: 'customer_lunch', customerId: CUSTOMER, customerName: 'Cascade Countertops', note: 'Flight to the Denver show', merchant: 'UNITED AIRLINES', cents: 48000, receiptUrl: '' });
    expect(filled.body.expense.history.at(-1).changes).toMatch(/filled in by Ann Count/);
    expect((await q(ACCOUNTING).post(`/expenses/${id}/approve`).expect(200)).body.expense.status).toBe('approved');
    // Someone else's receipt isn't filled in this way.
    const rep = receipt();
    await as(REP).post('/expenses', rep).expect(201);
    await request(quiet).put(`/api/card-receipts/expenses/${rep.id}/details`).set('x-test-user', JSON.stringify(ACCOUNTING)).send({ category: 'fuel' }).expect(403);
  });
});

describe('what a receipt link, a decision and a matched charge may do', () => {
  it('takes only a file this app stored for a receipt', async () => {
    for (const receiptUrl of ['https://evil.example/receipt.png', 'https://res.cloudinary.com/test/Visits/img_1.webp', 'javascript:alert(1)']) {
      const res = await as(REP).post('/expenses', receipt({ receiptUrl })).expect(400);
      expect(res.body.problems.receipt).toBeTruthy();
    }
    await as(REP).post('/expenses', receipt()).expect(201);
  });

  it('refuses an approval of a receipt that changed after the approver opened it', async () => {
    const saved = (await as(REP).post('/expenses', receipt()).expect(201)).body.expense;
    const stale = new Date(new Date(saved.updatedAt).getTime() - 5000).toISOString();
    const res = await as(ACCOUNTING).post(`/expenses/${saved.id}/approve`, { comment: '', expectedUpdatedAt: stale }).expect(409);
    expect(res.body.changed).toBe(true);
    await as(ACCOUNTING).post(`/expenses/${saved.id}/approve`, { comment: '', expectedUpdatedAt: saved.updatedAt }).expect(200);
  });

  it('keeps Amex’s day and amount on an expense that answers a charge, and lets the rest change', async () => {
    const saved = (await as(REP).post('/expenses', receipt()).expect(201)).body.expense;
    matched.add(saved.id);
    try {
      const body = (over: Loose) => ({ date: saved.date, merchant: saved.merchant, total: '14.32', category: 'travel_lunch', receiptUrl: saved.receiptUrl, ...over });
      await as(REP).put(`/expenses/${saved.id}`, body({ total: '20.00' })).expect(409);
      await as(REP).put(`/expenses/${saved.id}`, body({ date: '2026-10-04' })).expect(409);
      await as(REP).put(`/expenses/${saved.id}`, body({ note: 'client visit' })).expect(200);
    } finally { matched.delete(saved.id); }
  });
});

describe('private receipt files', () => {
  const ref = `/api/card-receipts/files/${PRIV}`;
  const put = (uploader: string) => files.set(`private/CardReceipts/${PRIV}`, { body: Buffer.from('IMG'), contentType: 'image/webp', metadata: { uploader } });
  beforeEach(() => files.clear());

  it('opens for the uploader before it is saved, and for nobody else', async () => {
    put(ids.rep);
    const res = await as(REP).get(`/files/${PRIV}`).expect(200);
    expect(res.headers['content-type']).toMatch(/image\/webp/);
    expect(res.headers['cache-control']).toMatch(/private/);
    await as(MANAGER).get(`/files/${PRIV}`).expect(404);
    await as(NOBODY).get(`/files/${PRIV}`).expect(403);
    await as(REP).get('/files/../secret.webp').expect(404);
    await as(REP).get('/files/img_1_zz.webp').expect(404);
  });

  it('saves only a file the person uploaded, and then opens it for who may see the expense', async () => {
    put(ids.manager); // someone else's upload
    await as(REP).post('/expenses', receipt({ receiptUrl: ref })).expect(400);
    put(ids.rep);
    const saved = (await as(REP).post('/expenses', receipt({ receiptUrl: ref })).expect(201)).body.expense;
    expect(saved.receiptUrl).toBe(ref);
    await as(REP).get(`/files/${PRIV}`).expect(200);
    await as(MANAGER).get(`/files/${PRIV}`).expect(404);       // a manager of another branch
    await as(DIRECTOR).get(`/files/${PRIV}`).expect(200);      // the cardholder's branch manager, with Approve
    await as({ ...DIRECTOR, permissions: [USE] }).get(`/files/${PRIV}`).expect(404);
    await as(ACCOUNTING).get(`/files/${PRIV}`).expect(200);    // view all
    await as({ id: new mongoose.Types.ObjectId().toString(), role: 'sales_rep', permissions: [USE] }).get(`/files/${PRIV}`).expect(404);
  });
});

describe('view branch', () => {
  it('shows the people who work at the caller’s branches, not everyone', async () => {
    await User.collection.updateOne({ _id: new mongoose.Types.ObjectId(ids.rep) }, { $set: { location: 'Seattle', assignedLocations: ['Seattle'] } });
    await User.collection.updateOne({ _id: new mongoose.Types.ObjectId(ids.director) }, { $set: { location: 'Seattle', assignedLocations: ['Seattle'] } });
    await User.collection.updateOne({ _id: new mongoose.Types.ObjectId(ids.manager) }, { $set: { location: 'Kent', assignedLocations: ['Kent'] } });
    await as(REP).post('/expenses', receipt()).expect(201);
    await as(MANAGER).post('/expenses', receipt({ merchant: 'Shell' })).expect(201);
    const branch = { id: ids.director, role: 'director', permissions: ['view_branch_card_receipts'], assignedLocations: ['Seattle'] };
    const res = await as(branch).get('/expenses?scope=all&month=2026-10').expect(200);
    expect(res.body.expenses.map((e: Loose) => e.holderName)).toEqual(['Maruthi Ponugupati']);
    await as({ ...branch, permissions: [] }).get('/expenses?scope=all&month=2026-10').expect(403);
    const all = await as({ ...branch, permissions: ['view_all_card_receipts'] }).get('/expenses?scope=all&month=2026-10').expect(200);
    expect(all.body.expenses).toHaveLength(2);
  });
});

describe('voiding', () => {
  it('is the cardholder’s, with a reason, until it’s approved', async () => {
    const body = receipt();
    await as(REP).post('/expenses', body).expect(201);
    await as(REP).post(`/expenses/${body.id}/void`, { reason: '' }).expect(400);
    await as(MANAGER).post(`/expenses/${body.id}/void`, { reason: 'x' }).expect(404);
    const voided = await as(REP).post(`/expenses/${body.id}/void`, { reason: 'Uploaded to the wrong card' }).expect(200);
    expect(voided.body.expense.voided.reason).toBe('Uploaded to the wrong card');
    await as(REP).post('/expenses', receipt()).expect(201);
  });
});


describe('sub-categories', () => {
  const types = (c: Loose) => (c.subcategories as Loose[]).map((s) => [s.name, s.label, s.active, s.isDefault]);
  const makeGas = () => as(ACCOUNTING).post('/categories', { label: 'Gas', subcategories: [{ label: 'Car' }, { label: 'Truck' }, { label: 'Van' }, { label: 'Forklift' }] }).expect(201);

  it('adds a category with types, and leaves them when it is only hidden or shown', async () => {
    const added = await makeGas();
    expect(types(added.body.category)).toEqual([['car', 'Car', true, true], ['truck', 'Truck', true, false], ['van', 'Van', true, false], ['forklift', 'Forklift', true, false]]);
    await as(REP).put(`/categories/${added.body.category._id}`, { label: 'Gas' }).expect(403);
    // Hiding the whole category sends no types: they stay.
    const hidden = await as(ACCOUNTING).put(`/categories/${added.body.category._id}`, { label: 'Gas', active: false }).expect(200);
    expect(types(hidden.body.category)).toHaveLength(4);
    await as(ACCOUNTING).put(`/categories/${added.body.category._id}`, { label: 'Gas', active: true }).expect(200);
    // Rename one, hide one, add one: the stored names stay, the new one gets its own.
    const edited = await as(ACCOUNTING).put(`/categories/${added.body.category._id}`, {
      label: 'Gas', subcategories: [{ name: 'car', label: 'Car', isDefault: true }, { name: 'truck', label: 'Box truck' }, { name: 'van', label: 'Van', active: false }, { name: 'forklift', label: 'Forklift' }, { label: 'Rental truck' }]
    }).expect(200);
    expect(types(edited.body.category)).toEqual([['car', 'Car', true, true], ['truck', 'Box truck', true, false], ['van', 'Van', false, false], ['forklift', 'Forklift', true, false], ['rental_truck', 'Rental truck', true, false]]);
    await as(ACCOUNTING).put(`/categories/${added.body.category._id}`, { label: 'Gas', subcategories: [{ label: 'Car' }, { label: 'car' }] }).expect(400);
  });

  it('saves the type with the receipt, asks for it before approval, and refuses one the category does not have', async () => {
    const gas = await makeGas();
    await as(ACCOUNTING).put(`/categories/${gas.body.category._id}`, {
      label: 'Gas', subcategories: [{ name: 'car', label: 'Car', isDefault: true }, { name: 'truck', label: 'Truck' }, { name: 'van', label: 'Van', active: false }]
    }).expect(200);
    const draft = await as(REP).post('/expenses', receipt({ category: 'gas', total: '40.00' })).expect(201);
    expect(draft.body.expense).toMatchObject({ status: 'draft', subcategory: '' });
    const sent = await as(REP).post('/expenses', receipt({ category: 'gas', subcategory: 'truck', total: '41.00' })).expect(201);
    expect(sent.body.expense).toMatchObject({ status: 'waiting', category: 'gas', subcategory: 'truck' });
    await as(REP).post('/expenses', receipt({ category: 'gas', subcategory: 'boat', total: '42.00' })).expect(400);
    // The draft is finished by picking the type.
    const done = await as(REP).put(`/expenses/${draft.body.expense.id}`, receipt({ category: 'gas', subcategory: 'car', total: '40.00' })).expect(200);
    expect(done.body.expense).toMatchObject({ status: 'waiting', subcategory: 'car' });
    expect(done.body.expense.history.at(-1).changes).toMatch(/type/);
    // A hidden type can't start a new receipt.
    await as(REP).post('/expenses', receipt({ category: 'gas', subcategory: 'van', total: '43.00' })).expect(400);
  });

  it('Customer Lunch asks for the customer only, and a moved category clears the type', async () => {
    const gas = await makeGas();
    const food = await as(ACCOUNTING).post('/categories', { label: 'Food', subcategories: [{ label: 'Travel Lunch' }, { label: 'Customer Lunch', fields: { customer: true } }, { label: 'Office Team Lunch' }] }).expect(201);
    const lunch = await as(REP).post('/expenses', receipt({ category: 'food', subcategory: 'customer_lunch', total: '44.00' })).expect(201);
    expect(lunch.body.expense).toMatchObject({ status: 'draft' });
    const team = await as(REP).post('/expenses', receipt({ category: 'food', subcategory: 'office_team_lunch', total: '45.00' })).expect(201);
    expect(team.body.expense.status).toBe('waiting');
    await as(ACCOUNTING).del(`/categories/${food.body.category._id}`, { replaceWith: gas.body.category._id }).expect(200);
    const moved = await CardExpense.findById(team.body.expense.id).lean();
    expect(moved).toMatchObject({ category: 'gas', subcategory: '' });
  });
});
