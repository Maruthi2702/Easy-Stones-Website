/** Relational twins of mapCalendar.mongo.ts; routes retain all permission and scope decisions. */
import { and, asc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { customers, customerLinks, schedules, visits } from '../schema/customers.ts';
import { locations, users } from '../schema/reference.ts';
import { customerDoc, nonNull, repNameOf } from './customerDoc.ts';
import { appLocalTime } from './writes/schedule.postgres.ts';
import type { CalendarReadQuery } from './types.ts';
import type { Loose } from '../../types/records.ts';

const bytewise = (column: unknown) => sql`${column} collate "C"`;
const castId = (id: string) => {
  if (!/^[a-f0-9]{24}$/i.test(id)) throw new Error('Invalid customer id');
  return id.toLowerCase();
};

export async function mapCustomerPins(db: Db): Promise<Loose[]> {
  const rows = await db.select({ c: customers, locationName: locations.name,
    repUsername: users.username, repDisplayName: users.displayName,
    lastVisitAt: sql<string | null>`(select max(${visits.visitDate})::text from ${visits} where ${visits.customerId} = ${customers.id})`,
    visitCount: sql<number>`(select count(*)::integer from ${visits} where ${visits.customerId} = ${customers.id})`
  }).from(customers).innerJoin(locations, eq(locations.id, customers.locationId))
    .leftJoin(users, eq(users.id, customers.salesRepId)).where(isNotNull(customers.lat))
    .orderBy(bytewise(customers.company), bytewise(customers.contactName), asc(customers.id));
  return rows.map(r => ({ ...nonNull({ _id: r.c.id, company: r.c.company, contactName: r.c.contactName,
    city: r.c.city, precision: r.c.geocodePrecision, salesRep: r.c.salesRepId,
    salesRepName: repNameOf(r), customerType: r.c.customerType, status: r.c.status, location: r.locationName }),
    coordinates: nonNull({ lat: r.c.lat, lng: r.c.lng }), lastVisitAt: r.lastVisitAt, visitCount: r.visitCount }));
}

export async function mapCustomerRecord(db: Db, id: string): Promise<Loose | null> {
  const [row] = await db.select({ c: customers, locationName: locations.name,
    repUsername: users.username, repDisplayName: users.displayName }).from(customers)
    .innerJoin(locations, eq(locations.id, customers.locationId)).leftJoin(users, eq(users.id, customers.salesRepId))
    .where(eq(customers.id, castId(id)));
  if (!row) return null;
  const doc = customerDoc(row.c, row, { associated: [], notDuplicate: [] }, null);
  return Object.fromEntries(['_id', 'phone', 'email', 'marketingEmail', 'address', 'level', 'modaDisplay', 'modaBinder', 'quickNote', 'salesRep', 'location']
    .filter(key => doc[key] !== undefined).map(key => [key, doc[key]]));
}

export async function duplicateSignals(db: Db): Promise<Loose[]> {
  const [rows, links] = await Promise.all([
    db.select({ _id: customers.id, company: customers.company, phone: customers.phone, email: customers.email })
      .from(customers).orderBy(customers.id),
    db.select().from(customerLinks).where(eq(customerLinks.kind, 'not_duplicate'))
      .orderBy(customerLinks.customerId, customerLinks.position, customerLinks.otherCustomerId)
  ]);
  const separated = new Map<string, string[]>();
  for (const link of links) {
    const list = separated.get(link.customerId) ?? [];
    list.push(link.otherCustomerId); separated.set(link.customerId, list);
  }
  return rows.map(row => ({ ...row, notDuplicateOf: separated.get(row._id) ?? [] }));
}

export async function duplicateCustomers(db: Db, ids: string[]): Promise<Loose[]> {
  if (!ids.length) return [];
  const rows = await db.select({ c: customers, locationName: locations.name,
    repUsername: users.username, repDisplayName: users.displayName }).from(customers)
    .innerJoin(locations, eq(locations.id, customers.locationId)).leftJoin(users, eq(users.id, customers.salesRepId))
    .where(inArray(customers.id, ids.map(castId))).orderBy(customers.id);
  return rows.map(row => {
    const doc = customerDoc(row.c, row, { associated: [], notDuplicate: [] }, null);
    return Object.fromEntries(['_id', 'company', 'contactName', 'phone', 'email', 'status', 'location', 'salesRepName', 'address'].map(key => [key, doc[key]]));
  });
}

export async function calendarEntries(db: Db, { people, start, end, feed = false }: CalendarReadQuery): Promise<Loose[]> {
  const owner = people === '*' ? undefined : people.size ? inArray(schedules.userId, [...people].map(castId)) : sql`false`;
  // MongoDB compares the app's local clock strings lexically, including malformed query bounds.
  const clock = sql`to_char(${schedules.startsAt}, 'YYYY-MM-DD"T"HH24:MI:SS.MS') collate "C"`;
  const rows = await db.select({ s: schedules, company: customers.company, contactName: customers.contactName })
    .from(schedules).leftJoin(customers, eq(customers.id, schedules.customerId))
    .where(and(owner, start && end ? sql`${clock} >= ${start} and ${clock} <= ${end}` : undefined,
      feed ? ne(schedules.status, 'Cancelled') : undefined))
    .orderBy(...(feed ? [asc(schedules.id)] : [asc(schedules.startsAt), asc(schedules.id)]));
  return rows.map(({ s, company, contactName }) => ({
    _id: s.id, userId: s.userId,
    customerId: contactName == null || !s.customerId ? null : {
      _id: s.customerId, company, contactName, ...(feed ? {} : { id: s.customerId })
    },
    startTime: appLocalTime(s.startsAt), endTime: appLocalTime(s.endsAt), activityType: s.activityType,
    notes: s.notes, status: s.status, linkedVisitId: s.visitId ?? undefined, source: s.source,
    createdAt: s.createdAt, updatedAt: s.updatedAt
  }));
}
