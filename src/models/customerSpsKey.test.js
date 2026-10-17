// The SPS key's unique index, against a throwaway in-memory MongoDB: two
// customers can never be the same SPS customer, while any number of customers
// with no SPS key coexist.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const { default: Customer } = await import('./Customer.js');
let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Customer.syncIndexes();
}, 180000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(() => Customer.collection.deleteMany({}));

const doc = (n, extra = {}) => ({ company: `Co ${n}`, contactName: `Contact ${n}`, email: `c${n}@x.com`, ...extra });

describe('Customer sps.key', () => {
  it('lets any number of customers have no SPS key', async () => {
    await Customer.collection.insertMany([doc(1), doc(2), doc(3, { sps: {} })]);
    expect(await Customer.collection.countDocuments()).toBe(3);
  });

  it('refuses a second customer with the same SPS key', async () => {
    await Customer.collection.insertOne(doc(1, { sps: { key: 'great floors llc-kent' } }));
    await expect(Customer.collection.insertOne(doc(2, { sps: { key: 'great floors llc-kent' } }))).rejects.toThrow(/duplicate key/);
  });

  it('allows different keys, and a key alongside many keyless customers', async () => {
    await Customer.collection.insertMany([
      doc(1, { sps: { key: 'a' } }), doc(2, { sps: { key: 'b' } }), doc(3), doc(4)
    ]);
    expect(await Customer.collection.countDocuments()).toBe(4);
  });

  it('stores the sps fields through the model, and nothing when unset', async () => {
    const withSps = await Customer.create({ ...doc(5), sps: { key: 'k', name: 'K Name', firstImportedAt: new Date() } });
    expect((await Customer.findById(withSps._id).lean()).sps.key).toBe('k');
    const without = await Customer.create(doc(6));
    expect((await Customer.findById(without._id).lean()).sps?.key).toBeUndefined();
  });
});
