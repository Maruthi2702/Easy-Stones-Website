/** First-match decisions follow MongoDB collection order, including appends and Undo. */
import { beforeAll, afterAll, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { eq, sql } from 'drizzle-orm';
import Customer from '../../models/Customer.ts';
import * as data from './index.ts';
import { customers } from '../schema/customers.ts';
import { normalize } from './parity.ts';
import { indexCustomerContacts, matchContacts } from '../../permits/router.ts';
import { buildSignalIndex, matchAgainst, STRONG } from '../../utils/customerMatch.ts';
import { openWriteParity, type WriteParity } from './writes/writeParity.ts';
import { copyFromMongo, emptySource } from '../copy/plan.ts';
import { readMongo } from '../copy/readMongo.ts';

const ids = ['f00000000000000000000001', '100000000000000000000001', 'd00000000000000000000001', '200000000000000000000001'];
const created = '000000000000000000000001', imported = '000000000000000000000002';
const rep = new mongoose.Types.ObjectId();
const importedContact = new mongoose.Types.ObjectId();
let t: WriteParity;
const fields = (id: string, index: number) => ({ _id: id, company: 'Shared Stone', contactName: 'Shared Person',
  email: `person-${index}@example.test`, phone: '206-555-0100', location: 'Seattle',
  contacts: [{ name: 'Shared Desk', email: 'shared-desk@example.test', phone: '425-555-0199' }] });
// The create route's DTO excludes nested contacts; imports may carry them.
const createFields = (id: string, index: number) => {
  const { contacts: _, ...own } = fields(id, index);
  return own;
};

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertOne({ _id: new mongoose.Types.ObjectId(), name: 'Seattle' });
    await db.collection('roles').insertOne({ _id: new mongoose.Types.ObjectId(), name: 'sales_rep', permissions: [] });
    await db.collection('users').insertOne({ _id: rep, username: 'rep', displayName: 'Rep', password: 'x', role: 'sales_rep', location: 'Seattle' });
    await Customer.insertMany(ids.map(fields));
  });
}, 120_000);
afterAll(async () => { await t?.close(); }, 60_000);

/** Native Undo backups intentionally differ in representation; this is the existing delete-suite boundary. */
const sameData = async () => (await t.differences()).filter(d => !d.startsWith('customer_delete_backups'));
const matching = () => data.customerContactsForMatching();
async function checkOrder(expected?: string[]) {
  const m = await t.on('mongo', matching), p = await t.on('postgres', matching);
  expect(p.map(c => String(c._id))).toEqual(m.map(c => String(c._id)));
  if (expected) expect(p.map(c => String(c._id))).toEqual(expected);
  expect(normalize(p)).toEqual(normalize(m));
  const probes = [{ name: 'Shared Person' }, { email: 'shared-desk@example.test' }, { phone: '206-555-0100' }];
  const selected = (rows: typeof m) => matchContacts(probes, indexCustomerContacts(rows));
  expect(selected(p)).toEqual(selected(m));
  return p;
}

it('copies actual source order, not ObjectId order, and preserves ambiguous Permit and duplicate selections', async () => {
  await checkOrder(ids);
  const query = { company: 'Shared Stone', phone: '206-555-0100', email: '' };
  const top = async () => matchAgainst(buildSignalIndex(await data.duplicateSignals()), query)
    .filter(hit => hit.score >= STRONG).slice(0, 3).map(hit => hit.id);
  expect(await t.on('postgres', top)).toEqual(await t.on('mongo', top));
  expect(await t.on('postgres', top)).toEqual(ids.slice(0, 3));
  expect(await sameData()).toEqual([]);
});

it('an edit retains its position while create and import append even with earlier ids and creation dates', async () => {
  await t.both(() => data.editCustomer(ids[0], { updateData: { quickNote: 'Changed' }, address: null,
    city: undefined, salesRep: undefined, geocode: async () => null }));
  await checkOrder(ids);
  await t.both(() => data.createCustomer({ id: created, fields: createFields(created, 4), rep: { salesRep: null, salesRepName: '' }, geo: {}, createdBy: String(rep) }));
  await t.both(() => data.insertImportedCustomers([new Customer({ ...fields(imported, 5),
    contacts: [{ ...fields(imported, 5).contacts[0], _id: importedContact }] })]));
  await checkOrder([...ids, created, imported]);
  expect(await sameData()).toEqual([]);
  const response = await t.on('postgres', () => data.customerProfile(created, { mayProfile: true, people: '*' }));
  expect(response).not.toHaveProperty('matchOrder');
});

it('bulk Undo appends in MongoDB backup order despite dependency-safe reverse restoration', async () => {
  const originalOrder = (await Customer.collection.find({ _id: { $in: [ids[0], ids[1]].map(id => new mongoose.Types.ObjectId(id)) } }).toArray()).map(c => String(c._id));
  const removed = await t.both(() => data.bulkDeleteCustomers([ids[0], ids[1]], 'test'));
  expect(removed.mongo?.deleted).toBe(2); expect(removed.postgres?.deleted).toBe(2);
  await checkOrder([ids[2], ids[3], created, imported]);
  expect(await sameData()).toEqual([]);
  const m = await t.on('mongo', () => data.undoBulkDelete(removed.mongo!.batchId, 'test'));
  const p = await t.on('postgres', () => data.undoBulkDelete(removed.postgres!.batchId, 'test'));
  expect(p).toEqual(m);
  await checkOrder([ids[2], ids[3], created, imported, ...originalOrder]);
  expect(await sameData()).toEqual([]);
});

it('verification detects reordered customers while accepting identity gaps', async () => {
  const rows = await t.pg.db.select({ id: customers.id, ordinal: customers.matchOrder }).from(customers).orderBy(customers.matchOrder);
  await t.pg.db.update(customers).set({ matchOrder: rows.at(-1)!.ordinal + 100 }).where(eq(customers.id, rows[0].id));
  expect((await t.differences()).some(d => d.startsWith('customers ') && d.includes('matchOrder'))).toBe(true);
  await t.resync();
  expect(await sameData()).toEqual([]);
});

it('verification rejects a stale generator even when customer relative order is unchanged', async () => {
  await t.pg.db.update(customers).set({ matchOrder: sql`${customers.matchOrder} + 1000` });
  expect(await t.differences()).toContain('customers: matchOrder generator does not append after existing customers');
  await t.resync();
  expect(await sameData()).toEqual([]);
});

it('empty copies restart at a valid position and a failed recopy rolls the generator back with its rows', async () => {
  // A failing copy must not reset the live generator below the rows it rolls back.
  const source = await readMongo(t.uri, 'match-order-rollback');
  const before = await t.pg.db.select({ max: sql<number>`max(${customers.matchOrder})` }).from(customers);
  await t.pg.db.execute(sql`create function reject_match_order_copy() returns trigger language plpgsql as $$
    begin raise exception 'forced copy rollback'; end $$`);
  await t.pg.db.execute(sql`create trigger reject_match_order_copy before update on mongo_copy_state
    for each row execute function reject_match_order_copy()`);
  try {
    await expect(copyFromMongo(t.pg.db, { ...source, customers: source.customers.slice(0, 1) }, { write: true })).rejects.toThrow();
  } finally {
    await t.pg.db.execute(sql`drop trigger reject_match_order_copy on mongo_copy_state`);
    await t.pg.db.execute(sql`drop function reject_match_order_copy()`);
  }
  const after = await t.pg.db.select({ max: sql<number>`max(${customers.matchOrder})` }).from(customers);
  expect(after).toEqual(before); expect(await sameData()).toEqual([]);
  const appended = '000000000000000000000003';
  await t.both(() => data.createCustomer({ id: appended, fields: createFields(appended, 6), rep: { salesRep: null, salesRepName: '' }, geo: {}, createdBy: String(rep) }));
  const [row] = await t.pg.db.select({ ordinal: customers.matchOrder }).from(customers).where(eq(customers.id, appended));
  expect(row.ordinal).toBeGreaterThan(before[0].max);
  await checkOrder(); expect(await sameData()).toEqual([]);

  await copyFromMongo(t.pg.db, emptySource(), { write: true });
  const sequence = await t.pg.db.execute(sql`select nextval(pg_get_serial_sequence('customers', 'match_order'))::integer as ordinal`) as unknown as { rows: { ordinal: number }[] };
  expect(sequence.rows[0].ordinal).toBe(1);
  await t.resync();
});
