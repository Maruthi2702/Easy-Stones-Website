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
const ids = { rep: new mongoose.Types.ObjectId().toString(), manager: new mongoose.Types.ObjectId().toString(), director: new mongoose.Types.ObjectId().toString(), acct: new mongoose.Types.ObjectId().toString() };
const REP = { id: ids.rep, displayName: 'Maruthi Ponugupati', role: 'sales_rep', location: 'Seattle', permissions: [USE] };
const MANAGER = { id: ids.manager, displayName: 'Dana Whitfield', role: 'manager', location: 'Kent', permissions: [USE, 'approve_card_receipts'] };
const DIRECTOR = { id: ids.director, displayName: 'Dee Rector', role: 'director', location: 'Seattle', permissions: [USE, 'approve_card_receipts'] };
const ACCOUNTING = { id: ids.acct, displayName: 'Ann Count', role: 'accounting', permissions: ['view_all_card_receipts', 'manage_company_cards', 'add_receipt_categories', 'edit_receipt_categories', 'reorder_receipt_categories', 'delete_receipt_categories'] };
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
    { _id: new mongoose.Types.ObjectId(ids.manager), username: 'dana', displayName: 'Dana Whitfield', password: 'x'.repeat(10), role: 'manager' },
    { _id: new mongoose.Types.ObjectId(ids.director), username: 'dee', displayName: 'Dee Rector', password: 'x'.repeat(10), role: 'director' },
    { _id: new mongoose.Types.ObjectId(ids.acct), username: 'ann', displayName: 'Ann Count', password: 'x'.repeat(10), role: 'accounting' }
  ]);
  await Role.collection.insertMany([
    { name: 'manager', displayName: 'Manager', permissions: [], approvesCardReceiptsOf: ['sales_rep'] },
    { name: 'director', displayName: 'Director', permissions: [], approvesCardReceiptsOf: ['sales_rep', 'manager', 'director'] }
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
    expect(res.body.categories[1].fields).toMatchObject({ customer: true, attendees: true });
    await as(REP).get('/categories').expect(200);
    expect(await ReceiptCategory.countDocuments()).toBe(6);
    await as(NOBODY).get('/categories').expect(403);
  });

  it('adds, renames, hides and reorders with the Admin switches only', async () => {
    await as(REP).post('/categories', { label: 'Travel' }).expect(403);
    const added = await as(ACCOUNTING).post('/categories', { label: 'Travel', fields: { purpose: true } }).expect(201);
    expect(added.body.category).toMatchObject({ name: 'travel', order: 6, fields: { purpose: true } });
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
    const forManager = (await as(MANAGER).get('/expenses?scope=waiting').expect(200)).body.expenses;
    expect(forManager.map((e: Loose) => [e.merchant, e.canDecide])).toEqual([["McDonald's, Kent", true]]);
    const forDirector = (await as(DIRECTOR).get('/expenses?scope=waiting').expect(200)).body.expenses;
    expect(forDirector).toHaveLength(2);
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
  it('lets someone above approve, from another branch, and never the cardholder themselves', async () => {
    const body = receipt();
    await as(REP).post('/expenses', body).expect(201);
    const mgr = receipt({ merchant: 'Staples', total: '86.42' });
    await as(MANAGER).post('/expenses', mgr).expect(201);
    await as(MANAGER).post(`/expenses/${mgr.id}/approve`).expect(403);
    await as(REP).post(`/expenses/${body.id}/approve`).expect(403);
    const ok = await as(MANAGER).post(`/expenses/${body.id}/approve`).expect(200);
    expect(ok.body.expense).toMatchObject({ status: 'approved', approval: { byName: 'Dana Whitfield' } });
    await as(DIRECTOR).post(`/expenses/${body.id}/approve`).expect(409);
    await as(REP).put(`/expenses/${body.id}`, { ...body, total: '1.00' }).expect(409);
    await as(DIRECTOR).post(`/expenses/${mgr.id}/approve`).expect(200);
  });

  it('needs the approver’s comment for a lost receipt', async () => {
    const body = receipt({ receiptUrl: '', lostReason: 'Pump didn’t print one', category: 'fuel' });
    await as(REP).post('/expenses', body).expect(201);
    const refused = await as(MANAGER).post(`/expenses/${body.id}/approve`, { comment: ' ' }).expect(400);
    expect(refused.body.problems.comment).toMatch(/comment/);
    const ok = await as(MANAGER).post(`/expenses/${body.id}/approve`, { comment: 'Burlington delivery run. OK.' }).expect(200);
    expect(ok.body.expense.approval.comment).toBe('Burlington delivery run. OK.');
  });

  it('sends back with a reason; fixing it sends it for approval again', async () => {
    const body = receipt({ merchant: 'SP PARK', total: '12.85', category: 'parking' });
    await as(REP).post('/expenses', body).expect(201);
    await as(MANAGER).post(`/expenses/${body.id}/send-back`, { comment: '' }).expect(400);
    const back = await as(MANAGER).post(`/expenses/${body.id}/send-back`, { comment: 'Was this the customer visit?' }).expect(200);
    expect(back.body.expense).toMatchObject({ status: 'sent_back', sentBack: { comment: 'Was this the customer visit?' } });
    const fixed = await as(REP).put(`/expenses/${body.id}`, { ...body, note: 'Parking for the Bellevue showroom visit' }).expect(200);
    expect(fixed.body.expense.status).toBe('waiting');
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
    const res = await as(MANAGER).post(`/expenses/${saved.id}/approve`, { comment: '', expectedUpdatedAt: stale }).expect(409);
    expect(res.body.changed).toBe(true);
    await as(MANAGER).post(`/expenses/${saved.id}/approve`, { comment: '', expectedUpdatedAt: saved.updatedAt }).expect(200);
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
    await as(MANAGER).get(`/files/${PRIV}`).expect(200);       // approves reps' receipts
    await as(DIRECTOR).get(`/files/${PRIV}`).expect(200);
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
    const lunch = await as(REP).post('/expenses', receipt({ category: 'food', subcategory: 'customer_lunch', total: '44.00', attendees: ['Someone'] })).expect(201);
    expect(lunch.body.expense).toMatchObject({ status: 'draft', attendees: [] });
    const team = await as(REP).post('/expenses', receipt({ category: 'food', subcategory: 'office_team_lunch', total: '45.00' })).expect(201);
    expect(team.body.expense.status).toBe('waiting');
    await as(ACCOUNTING).del(`/categories/${food.body.category._id}`, { replaceWith: gas.body.category._id }).expect(200);
    const moved = await CardExpense.findById(team.body.expense.id).lean();
    expect(moved).toMatchObject({ category: 'gas', subcategory: '' });
  });
});
