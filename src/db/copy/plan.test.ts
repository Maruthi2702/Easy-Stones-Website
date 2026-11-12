import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectId } from 'mongodb';
import { sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { openDb, migrateDb, type OpenDb } from '../client.ts';
import * as schema from '../schema/index.ts';
import { copyFromMongo, verifyCopy, lockCopies, CopyLockedError, type CopySource, emptySource } from './plan.ts';
import { contactIdFor } from './customerRows.ts';

const oid = () => new ObjectId();
const seattle = oid(), dallas = oid();
const adminRole = oid(), repRole = oid();
const rep = oid(), boss = oid();
const visitType = oid(), family = oid(), tower = oid();
const acme = oid(), bolt = oid(), web = oid();
const v1 = oid(), v2 = oid(), v3 = oid(), r1 = oid(), contact = oid(), reaction = oid();
const deletedCustomer = oid(), stranger = oid();
const s1 = oid(), s2 = oid(), log1 = oid(), log2 = oid(), del1 = oid(), merge1 = oid();

function source(): CopySource {
  return {
    ...emptySource(),
    locations: [
      { _id: seattle, name: 'Seattle', shortCode: 'SEA', dailyReportEmail: { userIds: [String(boss), String(stranger)], extraEmails: ['ops@example.com'] }, createdAt: new Date('2026-07-21T00:00:00Z'), updatedAt: new Date('2026-08-01T00:00:00Z') },
      { _id: dallas, name: 'Dallas', salesDefaults: { salesRep: 'Jo Rep', priceLevel: 2, salesTaxRate: 8.25 } }
    ],
    roles: [
      { _id: adminRole, name: 'admin', displayName: 'Admin', permissions: ['manage_users'], isSystem: true },
      { _id: repRole, name: 'sales_rep', displayName: 'Sales Rep', permissions: ['view_customers'] }
    ],
    users: [
      { _id: rep, username: 'jo', displayName: 'Jo Rep', password: '$2a$10$x', role: 'sales_rep', location: 'Dallas', assignedLocations: ['Dallas'], email: 'jo@example.com' },
      { _id: boss, username: 'boss', password: '$2a$10$y', role: 'admin', location: 'Nowhere', assignedLocations: ['*', 'Seattle'], email: null }
    ],
    visitTypes: [{ _id: visitType, name: 'Sales Call', label: 'Sales call', order: 1, fields: { followUp: 'always' } }],
    resourceFamilies: [{ _id: family, name: 'tower', label: 'Display towers', system: true }],
    resourceTypes: [{ _id: tower, name: 'Display Tower', label: 'Display tower', family: 'tower' }],
    customers: [
      {
        _id: acme, contactName: 'Ann', company: 'Acme Stone', email: 'Ann@Acme.example', location: 'Dallas', salesRep: rep,
        modaDisplay: 'Yes', modaBinder: '6', password: '$2a$10$z', loginIps: ['1.2.3.4'], isVerified: true,
        address: { street: '1 Main', city: 'Dallas', state: 'TX', zipCode: '75001' }, coordinates: { lat: 32.7, lng: -96.8 },
        sps: { key: 'acme stone', name: 'Acme Stone', firstImportedAt: new Date('2026-10-18T10:00:00Z') },
        associatedCustomers: [bolt, deletedCustomer, acme], notDuplicateOf: [bolt],
        contacts: [{ _id: contact, name: 'Bo', phone: '555', isPrimary: true, createdAt: new Date('2026-07-01T21:30:00Z') }, { name: 'No Id', phone: '777' }],
        visits: [
          {
            _id: v1, date: '2026-10-23', purpose: 'Sales Call', notes: 'Met Ann', followUp: 'Send samples',
            followUpDate: new Date('2026-10-30T00:00:00Z'), followUpDoneAt: '2026-10-31T09:15:00.000', followUpDoneOn: '2026-10-31',
            followUpDoneBy: String(rep), followUpDoneByName: 'Jo Rep',
            followUpHistory: [{ action: 'snooze', at: '2026-10-29T08:00:00.000', on: '2026-10-29', by: String(rep), byName: 'Jo Rep', from: '2026-10-28', to: '2026-10-30' }],
            image: 'https://files.example/a.jpg', createdBy: String(rep), createdByName: 'Jo Rep',
            createdAt: '2026-10-23T14:05:00.000', updatedAt: 'Thu Oct 22 2026 14:05:07 GMT-0700 (Pacific Daylight Time)',
            reactions: [{ _id: reaction, type: 'like', userId: String(boss), userName: 'Boss', createdAt: '2026-10-23T15:00:00.000' }],
            resourceId: r1
          },
          { _id: v2, date: '2026-10-24', purpose: 'Old Purpose', followUpDate: '', image: [], createdBy: String(acme), createdAt: '2026-10-24T10:00:00.000' },
          { _id: v3, date: 'someday', createdAt: '2026-10-25T10:00:00.000' }
        ],
        resources: [{ _id: r1, title: 'Tower', resourceType: 'Display Tower', date: '2026-10-23', qty: 2, image: ['https://files.example/t.jpg'], uploadedBy: String(rep), createdAt: '2026-10-23T14:06:00.000', location: '', customer: 'Acme Stone' }],
        createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-10-23T21:06:00Z')
      },
      { _id: bolt, contactName: 'Bea', email: 'bea@bolt.example', location: 'Seattle', modaDisplay: null, modaBinder: '0', notDuplicateOf: [acme], salesRep: null },
      { _id: web, contactName: 'Same email', email: 'ann@acme.example', location: 'Seattle' }
    ],
    schedules: [
      { _id: s1, userId: rep, customerId: acme, startTime: new Date('2026-11-03T16:00:00Z'), activityType: 'Visit', status: 'Scheduled', source: 'route_planner', linkedVisitId: v1 },
      { _id: s2, userId: rep, customerId: deletedCustomer, startTime: '2026-11-04T09:00:00.000' }
    ],
    activityLogs: [
      { _id: log1, entityType: 'Visit', entityId: v1, customerId: acme, action: 'CREATE', performedBy: String(rep), performedByName: 'Jo Rep', details: { purpose: 'Sales Call', at: new Date('2026-10-23T21:05:00Z'), visitId: v1 }, timestamp: '2026-10-23T14:05:00.000' },
      { _id: log2, entityType: 'Customer', entityId: deletedCustomer, customerId: deletedCustomer, action: 'DELETE', performedBy: String(boss), performedByName: 'Boss', timestamp: new Date('2026-10-28T18:00:00Z') }
    ],
    customerDeleteBackups: [{ _id: del1, batchId: 'b1', customerId: deletedCustomer, customer: { _id: deletedCustomer, company: 'Gone Co', createdAt: new Date('2026-01-02T00:00:00Z') }, deletedBy: 'boss' }],
    customerMergeBackups: [{ _id: merge1, group: { survivorId: String(acme), losers: [] }, action: 'merge', createdBy: 'boss' }]
  };
}

let open: OpenDb;
beforeAll(async () => {
  open = await openDb('pglite:memory');
  await migrateDb(open.db, 'pglite:memory');
}, 60_000);
afterAll(async () => { await open?.close(); });

const count = async (table: PgTable) => (await open.db.select().from(table)).length;

describe('copyFromMongo', () => {
  it('maps without writing on a dry run', async () => {
    const report = await copyFromMongo(open.db, source(), { write: false });
    expect(report.tables).toMatchObject({ customers: 2, visits: 2, resources: 1, schedules: 2 });
    expect(await count(schema.customers)).toBe(0);
  });

  it('copies the customer area into its own tables, linked by id', async () => {
    const report = await copyFromMongo(open.db, source(), { write: true });
    expect(report.tables).toMatchObject({
      locations: 2, roles: 2, users: 2, user_locations: 2, location_report_recipients: 1,
      customers: 2, customer_logins: 1, customer_contacts: 2, customer_links: 3,
      visits: 2, visit_attachments: 1, visit_reactions: 1, visit_follow_up_events: 1,
      resources: 1, resource_attachments: 1, schedules: 2, activity_logs: 2,
      customer_delete_backups: 1, customer_merge_backups: 1
    });

    const [customer] = await open.db.select().from(schema.customers).where(sql`id = ${String(acme)}`);
    expect(customer).toMatchObject({
      email: 'ann@acme.example', locationId: String(dallas), salesRepId: String(rep),
      modaDisplay: true, modaBinders: 6, spsKey: 'acme stone', city: 'Dallas'
    });
    const [login] = await open.db.select().from(schema.customerLogins);
    expect(login).toMatchObject({ customerId: String(acme), passwordHash: '$2a$10$z', loginIps: ['1.2.3.4'] });

    const visits = await open.db.select().from(schema.visits).orderBy(schema.visits.position);
    expect(visits.map(v => v.id)).toEqual([String(v1), String(v2)]);
    expect(visits[0]).toMatchObject({
      customerId: String(acme), visitDate: '2026-10-23', followUpDate: '2026-10-30',
      followUpDoneAt: '2026-10-31 09:15:00', followUpDoneById: String(rep), createdById: String(rep),
      createdAt: '2026-10-23 14:05:00', updatedAt: '2026-10-22 14:05:07'
    });
    expect(visits[1]).toMatchObject({ followUpDate: null, createdById: null, createdByCustomerId: String(acme), visitType: 'Old Purpose' });

    const [resource] = await open.db.select().from(schema.resources);
    expect(resource).toMatchObject({ customerId: String(acme), placementVisitId: String(v1), resourceType: 'Display Tower', qty: 2, uploadedById: String(rep) });

    const [schedule] = await open.db.select().from(schema.schedules).where(sql`id = ${String(s1)}`);
    expect(schedule).toMatchObject({ startsAt: '2026-11-03 10:00:00', visitId: String(v1) }); // 16:00 UTC on Dallas' clock
    const [orphan] = await open.db.select().from(schema.schedules).where(sql`id = ${String(s2)}`);
    expect(orphan).toMatchObject({ customerId: null, startsAt: '2026-11-04 09:00:00' }); // its customer was deleted: kept, blank

    const contacts = await open.db.select().from(schema.customerContacts).orderBy(schema.customerContacts.position);
    expect(contacts.map(c => c.id)).toEqual([String(contact), contactIdFor(String(acme), 1)]);
    expect(contacts[1]).toMatchObject({ customerId: String(acme), name: 'No Id', phone: '777' });

    const [user] = await open.db.select().from(schema.users).where(sql`id = ${String(boss)}`);
    expect(user).toMatchObject({ allLocations: true, homeLocationId: null, email: null });

    const [log] = await open.db.select().from(schema.activityLogs).where(sql`action = 'CREATE'`);
    expect(log.details).toEqual({ purpose: 'Sales Call', at: '2026-10-23T21:05:00.000Z', visitId: String(v1) });
    const [deletedLog] = await open.db.select().from(schema.activityLogs).where(sql`action = 'DELETE'`);
    expect(deletedLog).toMatchObject({ customerId: String(deletedCustomer), loggedAt: '2026-10-28 11:00:00' });

    const [backup] = await open.db.select().from(schema.customerDeleteBackups);
    expect(backup.customer).toMatchObject({ _id: { $oid: String(deletedCustomer) }, company: 'Gone Co', createdAt: { $date: '2026-01-02T00:00:00Z' } });
  });

  it('reports every row and field it could not take, never silently', async () => {
    const { summary } = await copyFromMongo(open.db, source(), { write: false });
    expect(summary).toMatchObject({
      'customers.email · email already used by another customer · skipped': 1,
      'customers.customer_links.associated · linked customer does not exist · skipped': 1,
      'visits.visit_date · not a day: a · blanked': 1,
      'visits.visit_date · no visit day · skipped': 1,
      'visits.visit_type · not on the Visit Types list (legacy name kept) · kept': 1,
      'schedules.customer_id · customer does not exist · blanked': 1,
      [`customer_contacts.id · no id, given a new one (customer ${String(acme)}, contact 2) · kept`]: 1,
      'users.home_location_id · home location is not a location · blanked': 1,
      'location_report_recipients.user_id · recipient is not a user · skipped': 1
    });
  });

  it('gives the same result when run again, and verifies clean', async () => {
    const first = await copyFromMongo(open.db, source(), { write: true });
    const second = await copyFromMongo(open.db, source(), { write: true });
    expect(second.tables).toEqual(first.tables);
    expect(await verifyCopy(open.db, source())).toEqual([]);
  });

  it('finds a row changed in Postgres behind its back', async () => {
    await copyFromMongo(open.db, source(), { write: true });
    await open.db.execute(sql`update visits set notes = 'edited' where id = ${String(v1)}`);
    const diffs = await verifyCopy(open.db, source());
    expect(diffs).toEqual([`visits "${String(v1)}": differs in notes`]);
  });

  it("the customer-area check ignores what keeps moving on MongoDB (other areas, who's online) and still catches a customer change", async () => {
    await copyFromMongo(open.db, source(), { write: true });
    // MongoDB moves on after the copy: someone signs in, a permit run is logged.
    const moved = source();
    moved.users = moved.users.map((u, i) => (i === 0 ? { ...u, lastSeenAt: new Date('2026-11-12T20:00:00Z') } : u));
    moved.permitRuns = [{ _id: oid(), source: 'x', startedAt: new Date() }];
    expect((await verifyCopy(open.db, moved)).length).toBeGreaterThan(0); // the whole-database check sees it
    expect(await verifyCopy(open.db, moved, 20, { scope: 'customers' })).toEqual([]);
    // …but a customer change after the copy is still found.
    const edited = source();
    edited.customers = edited.customers.map((c, i) => (i === 0 ? { ...c, company: 'Changed Co' } : c));
    expect(await verifyCopy(open.db, edited, 20, { scope: 'customers' })).toEqual([expect.stringMatching(/^customers ".*": differs in company$/)]);
  });

  it('enforces the links: a visit for a customer that does not exist is refused', async () => {
    await expect(open.db.insert(schema.visits).values({
      id: String(oid()), customerId: String(oid()), position: 0, visitDate: '2026-11-01', createdAt: '2026-11-01 10:00:00'
    })).rejects.toThrow();
  });

  it('refuses a customer delete while it still has visits', async () => {
    await copyFromMongo(open.db, source(), { write: true });
    await expect(open.db.execute(sql`delete from customers where id = ${String(acme)}`)).rejects.toThrow();
  });

  it('refuses to copy once the database is locked at cutover', async () => {
    await lockCopies(open.db, 'cutover test');
    await expect(copyFromMongo(open.db, source(), { write: true })).rejects.toBeInstanceOf(CopyLockedError);
    expect(await count(schema.customers)).toBe(2);
  });
});
