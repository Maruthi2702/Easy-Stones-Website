/**
 * An SPS import run leaves MongoDB and Postgres the same (writeParity.ts): the frozen plan
 * written in batches (adds, connects, updates, a deleted customer brought back, a name held
 * by someone else, a clash on email), the check, a run interrupted mid-batch and resumed
 * without doubling anyone, and Undo.
 *
 * Set apart: customer_delete_backups lines. Undo's backups are made with fresh ids and, on
 * Postgres, hold the rows as they were (`customer.pg`, sps.postgres.ts); they are checked
 * by what they say instead.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import Customer from '../../../models/Customer.ts';
import * as data from '../index.ts';
import { normalize } from '../parity.ts';
import { customerDeleteBackups, customers } from '../../schema/customers.ts';
import { runItems, undoRun, resumeRunningImports, checkRun } from '../../../services/spsImportRunner.ts';
import { openWriteParity, type WriteParity } from './writeParity.ts';

vi.setConfig({ testTimeout: 60_000 });

const oid = () => new mongoose.Types.ObjectId();
const seattle = oid(), kent = oid(), repRole = oid(), rep = oid();
const ids = Object.fromEntries(['a', 'b', 'holder', 'gone', 'kept', 'mailer', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6'].map(k => [k, oid()])) as Record<string, mongoose.Types.ObjectId>;
const id = (k: string) => String(ids[k]);
const [backupGone, backupKept] = [oid(), oid()];
const [run1, run2] = [String(oid()), String(oid())];
let t: WriteParity;

const same = async () => (await t.differences()).filter(d => !d.startsWith('customer_delete_backups'));

const item = (runId: string, seq: number, f: Record<string, unknown>) => ({
  _id: String(oid()), runId, seq, key: '', rowNumber: seq + 2, name: '', action: 'new', customerId: '', connect: false,
  unset: [], changes: [], warnings: [], state: 'pending', result: '', ...f
});
const fresh = (k: string, key: string, email: string) => ({
  _id: String(ids[k]), company: key, contactName: 'SPS', email, location: 'Seattle', address: { city: 'Kent' }
});

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertMany([{ _id: seattle, name: 'Seattle' }, { _id: kent, name: 'Kent' }]);
    await db.collection('roles').insertOne({ _id: repRole, name: 'sales_rep', permissions: [] });
    await db.collection('users').insertOne({ _id: rep, username: 'jo', displayName: 'Jo', password: 'x', role: 'sales_rep', location: 'Seattle' });
    await Customer.syncIndexes();
    const base = { location: 'Seattle', contactName: 'X' };
    await Customer.insertMany([
      { ...base, _id: ids.a, company: 'A Co', email: 'a@x.example' },
      { ...base, _id: ids.b, company: 'B Co', email: 'b@x.example', phone: '' },
      { ...base, _id: ids.holder, company: 'Holder', email: 'holder@x.example', sps: { key: 'taken name', name: 'Taken Name' } },
      { ...base, _id: ids.mailer, company: 'Mailer', email: 'clash@x.example' }
    ]);
    const gone = (k: string, email: string) => ({ _id: ids[k], company: k, contactName: 'Gone', email, location: 'Seattle', createdAt: new Date('2026-05-01T10:00:00Z'), updatedAt: new Date('2026-05-02T10:00:00Z'), isActive: true });
    await db.collection('customerdeletebackups').insertMany([
      { _id: backupGone, batchId: 'b1', customerId: ids.gone, customer: gone('gone', 'gone@x.example'), source: 'bulk', deletedBy: 'boss', createdAt: new Date('2026-06-01T00:00:00Z'), updatedAt: new Date('2026-06-01T00:00:00Z') },
      { _id: backupKept, batchId: 'b2', customerId: ids.kept, customer: gone('kept', 'kept@x.example'), source: 'bulk', deletedBy: 'boss', createdAt: new Date('2026-06-01T00:00:00Z'), updatedAt: new Date('2026-06-01T00:00:00Z') }
    ]);
  });
  expect(await same()).toEqual([]);
}, 90_000);

afterAll(async () => { await t?.close(); });

const startRun = async (runId: string, items: ReturnType<typeof item>[]) => {
  await data.spsCreateRun({ id: runId, fileName: 'sps.xls', fingerprint: 'f', file: Buffer.from('x'), createdBy: 'krish', createdById: String(rep), mapping: { company: 'Name' }, fileCheck: { ok: true }, rowsRead: items.length });
  await data.spsFreezeRun({ _id: runId, createdBy: 'krish' }, items, {
    status: 'running', startedAt: new Date(), total: items.length, done: 0, planCounts: { new: items.length }, results: {}, verify: null, error: '', createdBy: 'krish'
  });
};

describe('a run', () => {
  const items = () => [
    item(run1, 0, { key: 'fresh co', name: 'Fresh Co', action: 'new', create: fresh('n1', 'Fresh Co', 'fresh@x.example') }),
    item(run1, 1, { key: 'taken name', name: 'Taken Name', action: 'new', create: fresh('n2', 'Taken Name', 'tn@x.example') }),
    item(run1, 2, { key: 'clash co', name: 'Clash Co', action: 'new', create: fresh('n3', 'Clash Co', 'clash@x.example') }),
    item(run1, 3, { key: 'a co', name: 'A Co', action: 'update', customerId: id('a'), connect: true, changes: [{ field: 'sps', from: '', to: 'A Co' }],
      apply: { 'sps.key': 'a co', 'sps.name': 'A Co', 'sps.firstImportedAt': new Date('2026-11-10T00:00:00Z'), salesRep: String(rep), salesRepName: 'Jo', location: 'Kent' },
      before: { location: 'Seattle' }, unset: ['sps.key', 'sps.name', 'sps.firstImportedAt', 'salesRep', 'salesRepName'] }),
    item(run1, 4, { key: 'b co', name: 'B Co', action: 'update', customerId: id('b'), apply: { phone: '555-0100', 'address.city': 'Kent', 'geocode.status': 'pending' }, before: { phone: '' }, unset: [] }),
    item(run1, 5, { key: 'gone co', name: 'Gone Co', action: 'restore', customerId: id('gone'), apply: { 'sps.key': 'gone co', 'sps.name': 'Gone Co' }, deleted: { backupId: String(backupGone), customerId: id('gone') } }),
    item(run1, 6, { key: 'kept co', name: 'Kept Co', action: 'keptDeleted', deleted: { backupId: String(backupKept), customerId: id('kept') } }),
    item(run1, 7, { key: 'same co', name: 'Same Co', action: 'unchanged', state: 'done', result: 'unchanged' })
  ];

  it('is written, checked and shown the same', async () => {
    const frozen = items();
    await t.both(() => startRun(run1, frozen));
    expect(await same()).toEqual([]);
    const { mongo, postgres } = await t.both(async () => {
      await runItems(run1);
      return data.spsGetRun(run1);
    });
    const r = postgres as { status: string; results: Record<string, number>; verify: { missingCount: number } };
    expect(r.results).toMatchObject({ added: 1, unchanged: 1, updated: 2, restored: 1, keptDeleted: 1, failed: 1 });
    expect(normalize(postgres)).toEqual(normalize(mongo));
    expect(await same()).toEqual([]);
  });

  it('the check names what is missing, the same on both', async () => {
    const { mongo, postgres } = await t.both(() => checkRun(run1));
    expect(normalize(postgres)).toEqual(normalize(mongo));
    expect((postgres as { missingCount: number }).missingCount).toBe(3);   // the clashed name, and the two with no key
  });

  it('writing an item again (a retry) never doubles it', async () => {
    const { mongo, postgres } = await t.both(async () => {
      const [first] = await data.spsReportItems(run1);
      return data.spsWriteItem(first, run1);
    });
    expect(postgres).toMatchObject({ result: 'added' });
    expect(normalize(postgres)).toEqual(normalize(mongo));
    expect(await same()).toEqual([]);
  });

  it('Undo puts it all back', async () => {
    const { mongo, postgres } = await t.both(() => undoRun(run1, 'boss'));
    expect(postgres).toMatchObject({ removed: 1, reverted: 2, deletedAgain: 1, forgotten: 1 });
    expect(normalize(postgres)).toEqual(normalize(mongo));
    expect(await same()).toEqual([]);
    const saved = await t.pg.db.select().from(customerDeleteBackups);
    const sources = saved.filter(b => b.source === 'sps-undo').map(b => b.customerId).sort();
    expect(sources).toEqual([id('n1'), id('gone')].sort());
  });
});

describe('a run that stopped half way', () => {
  it('picks up where it stopped and adds nobody twice', async () => {
    const items = [1, 2, 3, 4].map((n, i) => item(run2, i, { key: `late ${n}`, name: `Late ${n}`, action: 'new', create: fresh(`n${n + 2 > 6 ? 6 : n + 2}` as 'n3', `Late ${n}`, `late${n}@x.example`) }));
    // ids n3..n6 are free again after the first run (n3 never saved)
    await t.both(() => startRun(run2, items));
    // The server went down after the first two were written and one was recorded.
    await t.both(async () => {
      const batch = await data.spsPendingBatch(run2, 100);
      const a = await data.spsWriteItem(batch[0], run2); await data.spsRecordItem(batch[0], run2, a);
      await data.spsWriteItem(batch[1], run2);              // written, never recorded
    });
    expect(await same()).toEqual([]);
    await t.both(async () => { await resumeRunningImports(); for (let i = 0; i < 100 && (await data.spsFindRunning()); i++) await new Promise(r => setTimeout(r, 30));
      await new Promise(r => setTimeout(r, 200));   // the worker lets go of the run just after it is done
    });
    expect(await same()).toEqual([]);
    const { mongo, postgres } = await t.both(() => data.spsGetRun(run2));
    expect((postgres as { results: Record<string, number> }).results).toEqual({ added: 4 });
    expect(normalize(postgres)).toEqual(normalize(mongo));
    const held = await t.pg.db.select({ k: customers.spsKey }).from(customers);
    expect(held.filter(h => h.k?.startsWith('late')).length).toBe(4);
  });
});
