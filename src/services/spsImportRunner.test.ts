import type { Loose } from '../types/records.ts';
// The SPS import writer, against a throwaway in-memory MongoDB: a frozen plan is
// carried out in batches, every write is safe to repeat, the check names what's
// missing, a run resumes after a restart, and Undo puts everything back.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const { default: Customer } = await import('../models/Customer.ts');
const { default: CustomerDeleteBackup } = await import('../models/CustomerDeleteBackup.ts');
const { default: SpsImportRun } = await import('../models/SpsImportRun.ts');
const { default: SpsImportItem } = await import('../models/SpsImportItem.ts');
const { planSpsImport } = await import('../utils/spsImportPlan.ts');
const { freezePlan, runItems, undoRun, checkRun, resumeRunningImports } = await import('./spsImportRunner.ts');

let mongo;
const mapping = { company: 'Name', salesRep: 'Sales Person1', location: 'Parent Location', email: 'Email', phone: 'Phone1' };
const row = (Name: Loose, extra: Loose = {}) => ({ Name, 'Sales Person1': '', 'Parent Location': '', Email: '', Phone1: '', ...extra });
const STEVE = { salesRep: new mongoose.Types.ObjectId().toString(), salesRepName: 'Steve Watson' };
const repByKey = new Map([['stevewatson', STEVE]]);
const branchByKey = new Map([['seattle', 'Seattle'], ['atlanta', 'Atlanta']]);

const A = new mongoose.Types.ObjectId();
const D = new mongoose.Types.ObjectId();

const load = async () => ({
  customers: await Customer.find({}, 'company contactName email phone address quickNote salesRep salesRepName location sps').lean(),
  deleted: (await CustomerDeleteBackup.find().lean()).map((d) => ({ ...d, deletedAt: d.createdAt }))
});
const newRun = () => SpsImportRun.create({ createdBy: 'krish', fileName: 'x.xls' });
const start = async (rows: Loose[], answers: Loose = {}) => {
  const run = await newRun();
  const plan = planSpsImport({ rows, mapping, branchByKey, repByKey, answers, finalize: true, ...(await load()) });
  await freezePlan(run, plan, 'krish');
  await runItems(run._id);
  return { run, plan, fresh: await SpsImportRun.findById(run._id).lean() };
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Customer.syncIndexes();
}, 180000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Promise.all([Customer, CustomerDeleteBackup, SpsImportRun, SpsImportItem].map((m) => m.collection.deleteMany({})));
  await Customer.collection.insertMany([
    { _id: A, company: 'Acme Stone', email: 'a@acme.com', location: 'Seattle', salesRepName: 'Old Rep', sps: { key: 'acme stone' } }
  ]);
});

const keys = async () => (await Customer.find({}, 'sps.key').lean()).map((c) => c.sps?.key).filter(Boolean).sort();

describe('SPS import writer', () => {
  it('adds, updates, and proves every name is there', async () => {
    const { fresh } = await start([row('Acme Stone', { 'Sales Person1': 'Steve Watson', 'Parent Location': 'Atlanta' }), row('Zed Tile', { Email: 'z@zed.com' })]);
    expect(fresh.status).toBe('done');
    expect(fresh.verify).toMatchObject({ ok: true, expected: 2, present: 2, missingCount: 0 });
    expect(fresh.results).toMatchObject({ added: 1, updated: 1 });
    expect(await keys()).toEqual(['acme stone', 'zed tile']);
    const acme = await Customer.findById(A).lean();
    expect(acme).toMatchObject({ salesRepName: 'Steve Watson', location: 'Atlanta' });
    const zed = await Customer.findOne({ 'sps.key': 'zed tile' }).lean();
    expect(zed).toMatchObject({ company: 'Zed Tile', email: 'z@zed.com', isVerified: true });
    expect(zed.sps.runId).toBe(String(fresh._id));
  });

  it('is safe to run twice: the same file adds nothing the second time', async () => {
    const rows = [row('Zed Tile', { Email: 'z@zed.com' }), row('Yan Stone', { Email: 'y@yan.com' })];
    await start(rows);
    const second = await start(rows);
    expect(second.fresh.results.added || 0).toBe(0);
    expect(await Customer.countDocuments({})).toBe(3);
  });

  it('a repeated add (as after a crash) never doubles', async () => {
    const { run } = await start([row('Zed Tile', { Email: 'z@zed.com' })]);
    await SpsImportItem.updateMany({ runId: String(run._id) }, { $set: { state: 'pending', result: '' } });
    await runItems(run._id);
    expect(await Customer.countDocuments({ 'sps.key': 'zed tile' })).toBe(1);
    const items = await SpsImportItem.find({ runId: String(run._id), action: 'new' }).lean();
    expect(items[0].result).toBe('added');
  });

  it('resumes after a restart: only pending items are worked', async () => {
    const run = await newRun();
    const plan = planSpsImport({ rows: [row('One Co', { Email: '1@x.com' }), row('Two Co', { Email: '2@x.com' })], mapping, branchByKey, repByKey, finalize: true, ...(await load()) });
    await freezePlan(run, plan);
    expect(await resumeRunningImports()).toBe(1);
    for (let i = 0; i < 50 && (await SpsImportRun.findById(run._id).lean()).status !== 'done'; i++) await new Promise((r) => setTimeout(r, 50));
    expect(await keys()).toEqual(['acme stone', 'one co', 'two co']);
  });

  it('names what is missing and why, and retries a failure once', async () => {
    // 'Clash' wants an email another customer holds under a different key.
    await Customer.collection.insertOne({ company: 'Other', email: 'clash@x.com' });
    const run = await newRun();
    const plan = planSpsImport({ rows: [row('Clash Co', { Email: 'clash@x.com' })], mapping, branchByKey, repByKey, finalize: true, ...(await load()) });
    // the plan would normally file it without an email; force the collision a race would cause
    plan.outcomes[0].create.email = 'clash@x.com';
    await freezePlan(run, plan);
    await runItems(run._id);
    const fresh = await SpsImportRun.findById(run._id).lean();
    expect(fresh.verify.ok).toBe(false);
    expect(fresh.verify.missing[0]).toMatchObject({ key: 'clash co' });
    expect(fresh.verify.missing[0].reason).toMatch(/email/i);
    expect(await checkRun(run._id)).toMatchObject({ missingCount: 1 });
  });

  it('brings a deleted customer back, same id, and Undo deletes it again', async () => {
    await Customer.collection.insertOne({ _id: D, company: 'Granite Masters', email: 'g@gm.com', visits: [{ notes: 'old visit' }] });
    const raw = await Customer.collection.findOne({ _id: D });
    await Customer.collection.deleteOne({ _id: D });
    await CustomerDeleteBackup.create({ batchId: 'b', customerId: D, customer: raw, source: 'bulk', deletedBy: 'Maria' });

    const { run, fresh } = await start([row('Granite Masters', { 'Sales Person1': 'Steve Watson' })], { 'granite masters': 'restore' });
    expect(fresh.results.restored).toBe(1);
    const back = await Customer.findById(D).lean();
    expect(back).toMatchObject({ company: 'Granite Masters', salesRepName: 'Steve Watson' });
    expect(back.visits).toHaveLength(1);
    expect((await CustomerDeleteBackup.findOne({ batchId: 'b' }).lean()).undoneAt).toBeTruthy();

    await undoRun(run._id, 'krish');
    expect(await Customer.findById(D)).toBeNull();
    expect((await CustomerDeleteBackup.findOne({ batchId: 'b' }).lean()).undoneAt).toBeNull();
  });

  it('remembers Keep deleted; Undo forgets it', async () => {
    await CustomerDeleteBackup.create({ batchId: 'b', customerId: D, customer: { company: 'Gone Co', email: 'g@g.com' }, source: 'single', deletedBy: 'Krish' });
    const { run } = await start([row('Gone Co')], { 'gone co': 'keep' });
    expect(await Customer.countDocuments({ 'sps.key': 'gone co' })).toBe(0);
    expect((await CustomerDeleteBackup.findOne({ batchId: 'b' }).lean()).spsKeepDeleted).toBe(true);
    await undoRun(run._id);
    expect((await CustomerDeleteBackup.findOne({ batchId: 'b' }).lean()).spsKeepDeleted).toBe(false);
  });

  it('Undo removes what was added (saved first) and puts updates back as they were', async () => {
    const { run } = await start([row('Acme Stone', { 'Sales Person1': 'Steve Watson', 'Parent Location': 'Atlanta' }), row('Zed Tile', { Email: 'z@zed.com' })]);
    const out = await undoRun(run._id, 'krish');
    expect(out).toMatchObject({ removed: 1, reverted: 1, failed: [] });
    expect(await keys()).toEqual(['acme stone']);
    expect(await Customer.findById(A).lean()).toMatchObject({ salesRepName: 'Old Rep', location: 'Seattle' });
    const saved = await CustomerDeleteBackup.findOne({ 'customer.company': 'Zed Tile' }).lean();
    expect(saved.source).toBe('sps-undo');
    expect((await SpsImportRun.findById(run._id).lean()).status).toBe('undone');
  });
});
