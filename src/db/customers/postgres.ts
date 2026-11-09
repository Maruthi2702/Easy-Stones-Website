/**
 * The customer area's reads on Postgres. Each answers exactly what its MongoDB twin in
 * mongo.ts answers (customers.parity.test.ts loads the same records into both and
 * compares). Pick between the two through index.ts, never directly.
 */
import { sql, eq, or, ilike, desc, count, inArray, asc, type SQL } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { customers, customerLinks, customerLogins } from '../schema/customers.ts';
import { locations, users } from '../schema/reference.ts';
import type { Loose } from '../../types/records.ts';
import { customerDoc, repNameOf, type CustomerLinks } from './customerDoc.ts';
import type { CustomerPage, CustomerPageQuery } from './types.ts';

/** `%text%` for ILIKE, with the user's own % _ \ taken literally (MongoDB's escaped regex). */
export const containsPattern = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

/**
 * MongoDB compares strings byte by byte; Postgres by the database's language rules
 * unless told otherwise. `COLLATE "C"` keeps the order MongoDB gave.
 */
const bytewise = (column: unknown) => sql`${column} collate "C"`;

/** GET /api/customers/dropdown. */
export async function dropdownCustomers(db: Db): Promise<Loose[]> {
  const rows = await db.select({
    id: customers.id, company: customers.company, contactName: customers.contactName, email: customers.email,
    customerType: customers.customerType, street: customers.street, city: customers.city, state: customers.state,
    zipCode: customers.zipCode, repUsername: users.username, repDisplayName: users.displayName
  })
    .from(customers)
    .leftJoin(users, eq(users.id, customers.salesRepId))
    .orderBy(bytewise(customers.company), bytewise(customers.contactName), asc(customers.id));
  return rows.map(r => {
    const doc: Loose = {
      _id: r.id, company: r.company, contactName: r.contactName, email: r.email,
      address: { street: r.street, city: r.city, state: r.state, zipCode: r.zipCode },
      salesRepName: repNameOf(r)
    };
    if (r.customerType != null) doc.customerType = r.customerType;
    return doc;
  });
}

/** GET /api/customers/cities. */
export async function customerCities(db: Db): Promise<string[]> {
  const rows = await db.selectDistinct({ city: customers.city }).from(customers);
  return rows.map(r => r.city).filter(Boolean).map(c => c.trim()).sort();
}

/** The two customer↔customer lists, in their saved order, for the given customers. */
async function linksOf(db: Db, ids: string[]): Promise<Map<string, CustomerLinks>> {
  const out = new Map<string, CustomerLinks>(ids.map(id => [id, { associated: [], notDuplicate: [] }]));
  if (!ids.length) return out;
  const rows = await db.select().from(customerLinks)
    .where(inArray(customerLinks.customerId, ids))
    .orderBy(customerLinks.customerId, customerLinks.kind, customerLinks.position);
  for (const r of rows) {
    const l = out.get(r.customerId)!;
    (r.kind === 'associated' ? l.associated : l.notDuplicate).push(r.otherCustomerId);
  }
  return out;
}

/** GET /api/customers. */
export async function customerPage(db: Db, { page, limit, search }: CustomerPageQuery): Promise<CustomerPage> {
  let where: SQL | undefined;
  if (search) {
    const p = containsPattern(search);
    where = or(ilike(customers.contactName, p), ilike(customers.company, p), ilike(customers.email, p));
  }
  const [{ total }] = await db.select({ total: count() }).from(customers).where(where);
  const rows = await db.select({
    c: customers,
    login: customerLogins,
    locationName: locations.name,
    repUsername: users.username,
    repDisplayName: users.displayName,
    lastVisitDate: sql<string | null>`(select max(v.visit_date)::text from visits v where v.customer_id = ${customers.id})`
  })
    .from(customers)
    .leftJoin(locations, eq(locations.id, customers.locationId))
    .leftJoin(users, eq(users.id, customers.salesRepId))
    .leftJoin(customerLogins, eq(customerLogins.customerId, customers.id))
    .where(where)
    .orderBy(desc(customers.createdAt), desc(customers.id))
    .limit(Math.max(limit, 0))
    .offset(Math.max((page - 1) * limit, 0));
  const links = await linksOf(db, rows.map(r => r.c.id));
  return {
    total,
    customers: rows.map(r => {
      const doc = customerDoc(r.c, r, links.get(r.c.id)!, r.login);
      if (r.lastVisitDate != null) doc.lastVisitDate = r.lastVisitDate;
      return doc;
    })
  };
}
