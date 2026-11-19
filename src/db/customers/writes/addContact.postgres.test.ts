/**
 * POST /api/customers/:id/contacts on Postgres: the screen's own contact id makes a repeated save
 * (a retry after a dropped answer) add the contact once. PGlite on its own, not the two-database harness.
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '../../schema/index.ts';
import { migrateDb } from '../../client.ts';
import type { Db } from '../../copy/plan.ts';
import { createCustomer } from './core.postgres.ts';
import { addContact } from './accounts.postgres.ts';
import { addContactOnce } from '../../../services/contactAdd.ts';

let client: PGlite, db: Db;
const cust = '0000000000000000000000c1', other = '0000000000000000000000c2';
const person = (name: string) => ({ name, phone: '', email: '', role: '', notes: '', createdAt: '2026-11-19T09:00:00.000' });
const namesOf = async (customerId: string) =>
  (await db.select({ name: schema.customerContacts.name }).from(schema.customerContacts)
    .where(eq(schema.customerContacts.customerId, customerId)).orderBy(schema.customerContacts.position)).map(r => r.name);

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
  await migrateDb(db, 'pglite:memory');
  await db.insert(schema.locations).values({ id: '000000000000000000000001', name: 'Seattle' });
  for (const [id, company] of [[cust, 'Acme Stone'], [other, 'Other Co']]) {
    await createCustomer(db, { id, fields: { company, contactName: 'T', email: `${id}@x.test`, location: 'Seattle' },
      rep: { salesRep: null, salesRepName: '' }, geo: {}, createdBy: null } as never);
  }
}, 60_000);
afterAll(async () => { await client?.close(); });

describe('adding a contact once', () => {
  it('a repeated save with the same id adds one contact and answers alreadySaved', async () => {
    const id = 'aaaaaaaaaaaaaaaaaaaaaaa1';
    const save = (name: string) => addContactOnce(c => addContact(db, cust, c, person(name)), id);
    expect(await save('Sam')).toEqual({ kind: 'added', id });
    expect(await save('Sam again')).toEqual({ kind: 'alreadySaved', id });
    expect(await namesOf(cust)).toEqual(['Sam']);
  });

  it('different ids add different contacts, in order', async () => {
    await addContactOnce(c => addContact(db, cust, c, person('Pat')), 'aaaaaaaaaaaaaaaaaaaaaaa2');
    await addContactOnce(c => addContact(db, cust, c, person('Lee')), undefined);
    expect(await namesOf(cust)).toEqual(['Sam', 'Pat', 'Lee']);
  });

  it('a customer that is not there is refused and nothing is written', async () => {
    const r = await addContactOnce(c => addContact(db, '0000000000000000000000ff', c, person('Ghost')), 'aaaaaaaaaaaaaaaaaaaaaaa3');
    expect(r.kind).toBe('noCustomer');
    expect(await namesOf(other)).toEqual([]);
  });
});
