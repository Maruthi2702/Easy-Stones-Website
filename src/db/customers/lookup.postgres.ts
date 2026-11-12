/** Customer lookups used by the contact card, Moda, Holds, Permits and catalog. */
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { customers, customerLogins, customerLinks, customerContacts as contacts } from '../schema/customers.ts';
import { locations, users, resourceTypes } from '../schema/reference.ts';
import { customerDoc } from './customerDoc.ts';
import { customerContacts, customerResources, customerVisits } from './profileSql.ts';
import { idForQuery } from './writes/coreSupport.postgres.ts';
import { familyLookup, modaSummary } from '../../utils/modaTotals.ts';
import type { Loose } from '../../types/records.ts';

async function customerRow(db: Db, id: string) {
  const [row] = await db.select({ c: customers, login: customerLogins, locationName: locations.name,
    repUsername: users.username, repDisplayName: users.displayName }).from(customers)
    .leftJoin(customerLogins, eq(customerLogins.customerId, customers.id))
    .leftJoin(locations, eq(locations.id, customers.locationId))
    .leftJoin(users, eq(users.id, customers.salesRepId)).where(eq(customers.id, idForQuery(id)));
  return row;
}

export async function customerVCard(db: Db, id: string): Promise<Loose | null> {
  const row = await customerRow(db, id);
  if (!row) return null;
  const doc = customerDoc(row.c, row, { associated: [], notDuplicate: [] }, row.login);
  return { _id: doc._id, company: doc.company, contactName: doc.contactName, phone: doc.phone,
    email: doc.email, address: doc.address, location: doc.location, salesRepName: doc.salesRepName,
    customerType: doc.customerType, contacts: await customerContacts(db, row.c.id) };
}

export async function customerModa(db: Db, id: string) {
  const row = await customerRow(db, id);
  if (!row) return null;
  const [resources, types] = await Promise.all([
    customerResources(db, row.c.id, '*'),
    db.select({ name: resourceTypes.name, family: resourceTypes.family }).from(resourceTypes)
  ]);
  return modaSummary(customerDoc(row.c, row, { associated: [], notDuplicate: [] }, row.login), resources, familyLookup(types));
}

/** An internal record for Holds; unlike a public profile it keeps unpopulated link ids. */
export async function customerById(db: Db, id: string): Promise<Loose | null> {
  const row = await customerRow(db, id);
  if (!row) return null;
  // The existing parent/child loaders keep saved contact and history order.
  const [links, visits, resources, contacts] = await Promise.all([
    db.select().from(customerLinks).where(eq(customerLinks.customerId, row.c.id))
      .orderBy(customerLinks.kind, customerLinks.position, customerLinks.otherCustomerId),
    customerVisits(db, [row.c.id], '*'), customerResources(db, row.c.id, '*'), customerContacts(db, row.c.id)
  ]);
  const doc = customerDoc(row.c, row, {
    associated: links.filter(l => l.kind === 'associated').map(l => l.otherCustomerId),
    notDuplicate: links.filter(l => l.kind === 'not_duplicate').map(l => l.otherCustomerId)
  }, row.login);
  return { ...doc, visits, resources, contacts, ...(row.login?.passwordHash ? { password: row.login.passwordHash } : {}) };
}

export async function customerContactsForMatching(db: Db): Promise<Loose[]> {
  const [rows, contactRows] = await Promise.all([
    db.select({ _id: customers.id, company: customers.company, contactName: customers.contactName,
      email: customers.email, phone: customers.phone }).from(customers).orderBy(customers.matchOrder, customers.id),
    db.select({ customerId: contacts.customerId, name: contacts.name, phone: contacts.phone, email: contacts.email })
      .from(contacts).orderBy(contacts.customerId, contacts.position, sql`${contacts.id} collate "C"`)
  ]);
  const byCustomer = new Map<string, Loose[]>();
  for (const { customerId, ...contact } of contactRows) {
    const list = byCustomer.get(customerId) ?? [];
    list.push(contact); byCustomer.set(customerId, list);
  }
  return rows.map(row => ({ ...row, contacts: byCustomer.get(row._id) ?? [] }));
}

export async function customerPriceLevel(db: Db, id: string): Promise<Loose | null> {
  const [row] = await db.select({ _id: customers.id, priceLevel: customers.priceLevel, isActive: customers.isActive })
    .from(customers).where(eq(customers.id, idForQuery(id)));
  return row ?? null;
}
