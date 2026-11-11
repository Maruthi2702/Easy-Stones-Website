/**
 * Customer saves leave MongoDB and Postgres the same (writeParity.ts): each save runs
 * on both, answers the same, and afterwards every table equals the copy of MongoDB.
 * The template for every save group's test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import Customer from '../../../models/Customer.ts';
import * as data from '../index.ts';
import { normalize } from '../parity.ts';
import { newId } from '../../ids.ts';
import { openWriteParity, type WriteParity } from './writeParity.ts';
import { logActivityMongo, insertActivityLog, type ActivityEntry } from './activityLog.ts';

const oid = () => new mongoose.Types.ObjectId();
const seattle = oid(), rep = oid();
const acme = newId(), blank = newId();
let t: WriteParity;

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertOne({ _id: seattle, name: 'Seattle' });
    await db.collection('roles').insertOne({ _id: oid(), name: 'sales_rep', permissions: [] });
    await db.collection('users').insertOne({ _id: rep, username: 'jo', displayName: 'Jo', password: 'x', role: 'sales_rep', location: 'Seattle' });
    // Through the model, as the app saves them.
    await Customer.insertMany([
      { _id: acme, company: 'Acme Stone', contactName: 'Ann', email: 'ann@acme.example', location: 'Seattle', salesRep: rep, quickNote: 'Old note' },
      { _id: blank, contactName: 'Pat', email: 'pat@plain.example', location: 'Seattle' }
    ]);
  });
  expect(await t.differences()).toEqual([]);
}, 60_000);

afterAll(async () => { await t?.close(); });

describe('activity log line', () => {
  it('the same line in both databases, details and local time as written', async () => {
    const entry: ActivityEntry = {
      id: newId(), entityType: 'Customer', entityId: acme, customerId: acme, action: 'UPDATE',
      performedBy: String(rep), performedByName: 'Jo', performedByRole: 'admin',
      details: { changes: { quickNote: { from: 'Old', to: 'New' } }, at: new Date('2026-11-10T09:00:00Z') },
      timestamp: '2026-11-10T09:15:42.123'
    };
    await logActivityMongo(entry);
    await insertActivityLog(t.pg.db, entry);
    expect(await t.differences()).toEqual([]);
  });
});

describe('quick note', () => {
  it.each([
    ['a new note', acme, 'Gate code 4411'],
    ['a note on a customer that had none', blank, 'Call before noon'],
    ['clearing it', acme, ''],
    ['a number, saved as text', acme, 42],
    ['null', blank, null]
  ])('%s: same answer, same data', async (_label, id, note) => {
    const { mongo, postgres } = await t.both(() => data.setQuickNote(id, note));
    expect(normalize(postgres)).toEqual(normalize(mongo));
    expect(await t.differences()).toEqual([]);
  });

  it('no such customer: null from both, nothing changed', async () => {
    const { mongo, postgres } = await t.both(() => data.setQuickNote(newId(), 'x'));
    expect(mongo).toBeNull();
    expect(postgres).toBeNull();
    expect(await t.differences()).toEqual([]);
  });

  it('a list or an object is refused by both', async () => {
    await expect(t.on('mongo', () => data.setQuickNote(acme, { a: 1 }))).rejects.toThrow();
    await expect(t.on('postgres', () => data.setQuickNote(acme, { a: 1 }))).rejects.toThrow();
    expect(await t.differences()).toEqual([]);
  });
});
