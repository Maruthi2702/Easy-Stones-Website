import { describe, it, expect } from 'vitest';
import { BSON, ObjectId, Decimal128 } from 'mongodb';
import { openDb, migrateDb } from '../client.ts';
import { copyCustomerArea, verifyCustomerArea, type CustomerAreaSource } from '../copy/customerArea.ts';
import { packSnapshot, unpackSnapshot } from './snapshot.ts';

const oid = () => new ObjectId();
const dallas = oid(), role = oid(), rep = oid(), acme = oid(), visit = oid(), contact = oid(), log = oid(), backup = oid();

function source(): CustomerAreaSource {
  return {
    locations: [{ _id: dallas, name: 'Dallas', salesDefaults: { priceLevel: 2, salesTaxRate: 8.25 }, createdAt: new Date('2026-07-21T00:00:00Z') }],
    roles: [{ _id: role, name: 'sales_rep', displayName: 'Sales Rep', permissions: ['view_customers'] }],
    users: [{ _id: rep, username: 'jo', displayName: 'Jo Rep', role: 'sales_rep', location: 'Dallas', assignedLocations: ['Dallas'] }],
    visitTypes: [], resourceFamilies: [], resourceTypes: [],
    customers: [{
      _id: acme, company: 'Acme Stone', location: 'Dallas', salesRep: rep, modaBinder: '6', isVerified: true,
      coordinates: { lat: 32.7, lng: -96.8 }, balance: Decimal128.fromString('10.50'),
      contacts: [{ _id: contact, name: 'Bo', phone: '555', isPrimary: true }],
      visits: [{ _id: visit, date: '2026-10-23', notes: 'Met Ann — “quotes” 🙂', createdBy: String(rep), createdAt: '2026-10-23T14:05:00.000' }],
      createdAt: new Date('2026-01-01T00:00:00.123Z'), empty: null, tags: []
    }],
    schedules: [],
    activityLogs: [{ _id: log, action: 'update', customerId: acme, at: new Date('2026-10-23T21:06:00Z'), details: { n: 3, ratio: 0.5 } }],
    customerDeleteBackups: [{ _id: backup, customer: { _id: oid(), company: 'Gone Ltd', createdAt: new Date('2025-01-01T00:00:00Z') } }],
    customerMergeBackups: []
  };
}

describe('MongoDB snapshot for the copy Lambda', () => {
  it('comes back exactly as read: ids, dates, decimals, text', () => {
    const src = source();
    const back = unpackSnapshot(packSnapshot(src));
    expect(BSON.EJSON.stringify(back, { relaxed: false })).toBe(BSON.EJSON.stringify(src, { relaxed: false }));
    const customer = back.customers[0];
    // bson's own build of ObjectId, not the driver's: same type and value (the copy reads ids by toHexString).
    expect(customer._id._bsontype).toBe('ObjectId');
    expect(String(customer._id)).toBe(String(acme));
    expect(customer.createdAt).toBeInstanceOf(Date);
    expect(customer.coordinates.lat).toBe(32.7);
  });

  it('copies into Postgres the same as reading MongoDB directly', async () => {
    const { db, close } = await openDb('pglite:memory');
    try {
      await migrateDb(db, 'pglite:memory');
      const viaSnapshot = await copyCustomerArea(db, unpackSnapshot(packSnapshot(source())), { write: true });
      const direct = await copyCustomerArea(db, source(), { write: false });
      expect(viaSnapshot.tables).toEqual(direct.tables);
      expect(viaSnapshot.summary).toEqual(direct.summary);
      expect(await verifyCustomerArea(db, source())).toEqual([]);
    } finally {
      await close();
    }
  }, 60_000);
});
