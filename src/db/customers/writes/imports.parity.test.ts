/**
 * The customer imports' saves leave MongoDB and Postgres the same (writeParity.ts):
 * SPS connect (exact names and the by-person answers, a name taken in the meantime, a
 * repeat), the Excel import's creates and updates (a row refused for its email doesn't
 * stop the rest), its remembered answers, and the plan's customer read.
 * Not covered here: reading the spreadsheet itself (the route's own tests).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import Customer from '../../../models/Customer.ts';
import * as data from '../index.ts';
import { normalize } from '../parity.ts';
import { newId } from '../../ids.ts';
import { openWriteParity, type WriteParity } from './writeParity.ts';

vi.setConfig({ testTimeout: 60_000 });

const oid = () => new mongoose.Types.ObjectId();
const seattle = oid(), kent = oid(), repRole = oid(), rep = oid(), rep2 = oid();
const c = Object.fromEntries(['a', 'b', 'c', 'held', 'u1', 'u2', 'u3', 'mail'].map(k => [k, oid()])) as Record<string, mongoose.Types.ObjectId>;
const id = (k: string) => String(c[k]);
let t: WriteParity;

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertMany([{ _id: seattle, name: 'Seattle' }, { _id: kent, name: 'Kent' }]);
    await db.collection('roles').insertOne({ _id: repRole, name: 'sales_rep', permissions: [] });
    await db.collection('users').insertMany([
      { _id: rep, username: 'jo', displayName: 'Jo', password: 'x', role: 'sales_rep', location: 'Seattle' },
      { _id: rep2, username: 'sam', displayName: 'Sam', password: 'x', role: 'sales_rep', location: 'Kent' }
    ]);
    // MongoDB refuses a held email / SPS name through the model's unique indexes.
    await Customer.syncIndexes();
    const base = { location: 'Seattle', contactName: 'X' };
    await Customer.insertMany([
      { ...base, _id: c.a, company: 'Alpha Stone', email: 'a@x.example' },
      { ...base, _id: c.b, company: 'Beta Stone', email: 'b@x.example' },
      { ...base, _id: c.c, company: 'Gamma Stone', email: 'c@x.example' },
      { ...base, _id: c.held, company: 'Held Co', email: 'held@x.example', sps: { key: 'taken name', name: 'Taken Name' } },
      { ...base, _id: c.u1, company: '', email: 'u1@x.example', phone: '' },
      { ...base, _id: c.u2, company: 'Two', email: 'u2@x.example', address: { street: '', city: '', state: '', zipCode: '' } },
      { ...base, _id: c.u3, company: 'Three', email: 'u3@x.example', salesRep: rep },
      { ...base, _id: c.mail, company: 'Mail', email: 'taken@x.example' }
    ]);
  });
  expect(await t.differences()).toEqual([]);
}, 90_000);

afterAll(async () => { await t?.close(); });

const now = new Date('2026-11-10T18:00:00.000Z');

describe('SPS connect', () => {
  it('exact names, a name taken meanwhile, the not-in-SPS answer and a customer that already holds one', async () => {
    const input = {
      connect: [
        { customerId: id('a'), key: 'alpha stone' },
        { customerId: id('b'), key: 'taken name' },       // held by another customer: refused
        { customerId: id('held'), key: 'held again' },    // already holds a name: not touched
        { customerId: id('c'), key: 'gamma stone' }
      ],
      notInSps: [id('mail'), id('held')],
      nameByKey: { 'alpha stone': 'Alpha Stone', 'taken name': 'Taken Name', 'held again': 'Held', 'gamma stone': 'Gamma Stone' },
      by: 'boss', now
    };
    const { mongo, postgres } = await t.both(() => data.connectSps(input));
    expect(postgres).toMatchObject({ connected: 2, notInSps: 1 });
    expect((postgres as { failed: unknown[] }).failed).toHaveLength(1);
    expect(normalize(postgres)).toEqual(normalize(mongo));
    expect(await t.differences()).toEqual([]);
  });

  it('a repeat changes nothing', async () => {
    const input = { connect: [{ customerId: id('a'), key: 'alpha stone' }], notInSps: [], nameByKey: { 'alpha stone': 'Alpha Stone' }, by: 'boss', now };
    const { mongo, postgres } = await t.both(() => data.connectSps(input));
    expect(postgres).toMatchObject({ connected: 0 });
    expect(normalize(postgres)).toEqual(normalize(mongo));
    expect(await t.differences()).toEqual([]);
  });
});

describe('Excel import', () => {
  it('the plan reads the same customers', async () => {
    const select = 'company contactName email phone address quickNote salesRep salesRepName location isActive createdAt notDuplicateOf sps.key';
    const { mongo, postgres } = await t.both(() => data.customersForPlan(select));
    const pick = (rows: Record<string, unknown>[]) => rows.map(r => ({ id: String(r._id), company: r.company || "", email: r.email, phone: r.phone || "", location: r.location, rep: r.salesRep ? String(r.salesRep) : '', key: (r.sps as { key?: string } | undefined)?.key ?? '' })).sort((x, y) => x.id.localeCompare(y.id));
    expect(pick(postgres as never)).toEqual(pick(mongo as never));
  });

  it('adds customers; a row with a held email is refused alone', async () => {
    const [n1, n2, n3] = [oid(), oid(), oid()];
    const make = () => [
      new Customer({ _id: n1, company: 'New One', contactName: 'Nia', email: 'Nia@new.example', location: 'Kent', salesRep: rep2, createdBy: rep, address: { city: 'Kent' }, quickNote: 'From the sheet' }),
      new Customer({ _id: n2, company: 'Dup', contactName: 'Dan', email: 'taken@x.example', location: 'Seattle' }),
      new Customer({ _id: n3, company: 'New Two', contactName: 'Tom', email: 'tom@new.example', location: 'Seattle', sps: { key: 'new two', name: 'New Two' } })
    ];
    const { mongo, postgres } = await t.both(() => data.insertImportedCustomers(make(), 500));
    expect([...(postgres as Map<number, string>).keys()]).toEqual([1]);
    expect([...(postgres as Map<number, string>).keys()]).toEqual([...(mongo as Map<number, string>).keys()]);
    expect(await t.differences()).toEqual([]);
  });

  it('updates what the plan changed; a row that would take a held email is refused alone', async () => {
    const batch = [
      { targetId: id('u1'), apply: { company: 'Filled', phone: '555-0100', 'address.city': 'Kent', 'address.street': '1 Main', 'geocode.status': 'pending' } },
      { targetId: id('u2'), apply: { email: 'taken@x.example' } },
      { targetId: id('u3'), apply: { salesRep: rep2, salesRepName: 'Sam', location: 'Kent', quickNote: 'Delivery: gate' } }
    ];
    const { mongo, postgres } = await t.both(() => data.updateImportedCustomers(batch));
    expect([...(postgres as Map<number, string>).keys()]).toEqual([1]);
    expect([...(postgres as Map<number, string>).keys()]).toEqual([...(mongo as Map<number, string>).keys()]);
    expect(await t.differences()).toEqual([]);
  });

  it('remembers answers, adds to them, and forgets them', async () => {
    const save = (set: Record<string, string>) => t.both(() => data.saveImportMemory({ set, by: 'boss', id: '6a0000000000000000000001' }));
    await save({ 'repAliases.brian': String(rep), 'branchAliases.pdx': 'Kent' });
    expect(await t.differences()).toEqual([]);
    await save({ 'decisions.acme|kent': id('a'), 'repAliases.zed': '' });
    expect(await t.differences()).toEqual([]);
    const { mongo, postgres } = await t.both(() => data.readImportMemory());
    const plain = (m: Record<string, unknown> | null) => ({ r: Object.fromEntries(m?.repAliases instanceof Map ? m.repAliases : Object.entries((m?.repAliases ?? {}) as object)), d: Object.fromEntries(m?.decisions instanceof Map ? m.decisions : Object.entries((m?.decisions ?? {}) as object)) });
    expect(plain(postgres as never)).toEqual(plain(mongo as never));
    await t.both(() => data.forgetImportMemory());
    expect(await t.differences()).toEqual([]);
  });
});
