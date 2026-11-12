/** Dashboard reads over normalized tables. Every query receives the caller's already-narrowed people scope. */
import { and, eq, gte, lte, desc, sql, count, isNull, type SQL } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { customers, visits, resources, visitFollowUpEvents } from '../schema/customers.ts';
import { locations, users } from '../schema/reference.ts';
import { historyScope } from './profileSql.ts';
import { followUpEventDoc, nonNull, repNameOf } from './customerDoc.ts';
import type { DashboardReadQuery, DashboardRollupQuery, DashboardRollups } from './types.ts';
import type { Loose } from '../../types/records.ts';

const visitOwner = sql`coalesce(${visits.createdById}, ${visits.createdByCustomerId})`;
const bytewise = (column: unknown) => sql`${column} collate "C"`;
const clock = (value: string | null): string | null => {
  if (value == null) return null;
  const [time, fraction = ''] = value.replace(' ', 'T').split('.');
  return `${time}.${fraction.padEnd(3, '0')}`;
};
const day = (value: Date | null) => value?.toISOString().slice(0, 10);
const resourceDay = sql<string>`coalesce(${resources.resourceDate}::text, to_char(${resources.createdAt}, 'YYYY-MM-DD'), '')`;
function dateWhere(column: SQL | typeof visits.visitDate, q: DashboardReadQuery): SQL | undefined {
  const start = day(q.startDate), end = day(q.endDate);
  return and(start ? gte(column, start) : undefined, end ? lte(column, end) : undefined);
}

export async function dashboardVisits(db: Db, q: DashboardReadQuery): Promise<Loose[]> {
  // The original follow-up pipeline includes visits with missing nextAction (the
  // field isn't in the model). Except its Today special case it has no restrictive
  // day boundary; followUpList.ts makes the actual due/status decision afterwards.
  const start = day(q.startDate), end = day(q.endDate);
  const range = q.filterType === 'followup'
    ? start && start === end ? gte(visits.followUpDate, start) : undefined
    : dateWhere(visits.visitDate, q);
  const rows = await db.select({ v: visits, company: customers.company, contactName: customers.contactName,
    location: locations.name, phone: customers.phone, city: customers.city }).from(visits)
    .innerJoin(customers, eq(customers.id, visits.customerId))
    .innerJoin(locations, eq(locations.id, customers.locationId))
    .where(and(historyScope(visitOwner, q.people), range))
    .orderBy(desc(visits.visitDate), desc(visits.createdAt), desc(bytewise(visits.id)));
  if (!rows.length) return [];
  const history = await db.select().from(visitFollowUpEvents)
    .where(sql`${visitFollowUpEvents.visitId} in (${sql.join(rows.map(({ v }) => sql`${v.id}`), sql`, `)})`)
    .orderBy(visitFollowUpEvents.position);
  const historyOf = new Map<string, Loose[]>();
  for (const item of history) {
    const list = historyOf.get(item.visitId) ?? [];
    list.push(followUpEventDoc(item)); historyOf.set(item.visitId, list);
  }
  return rows.map(({ v, company, contactName, location, phone, city }) => nonNull({
    _id: v.id, date: v.visitDate, purpose: v.visitType, notes: v.notes, outcome: v.outcome,
    managerComment: v.managerComment, headquartersComment: v.headquartersComment,
    followUp: v.followUp, followUpDate: v.followUpDate, followUpDoneAt: clock(v.followUpDoneAt),
    followUpDoneOn: v.followUpDoneOn, followUpDoneByName: v.followUpDoneByName,
    followUpOutcome: v.followUpOutcome, followUpHistory: historyOf.get(v.id) ?? [],
    ...(q.filterType === 'followup' ? { phone, city } : {}),
    createdBy: v.createdById ?? v.createdByCustomerId, createdAt: clock(v.createdAt),
    customerId: v.customerId, customerName: `${company}${company && contactName ? ' - ' : ''}${contactName}`,
    company, contactName, location, createdByName: v.createdByName
  }));
}

export async function dashboardResources(db: Db, q: DashboardReadQuery): Promise<Loose[]> {
  const rows = await db.select({ r: resources, company: customers.company, contactName: customers.contactName,
    customerLocation: locations.name, repUsername: users.username, repDisplayName: users.displayName }).from(resources)
    .innerJoin(customers, eq(customers.id, resources.customerId))
    .innerJoin(locations, eq(locations.id, customers.locationId))
    .leftJoin(users, eq(users.id, resources.uploadedById))
    .where(and(historyScope(resources.uploadedById, q.people), dateWhere(resourceDay, q)))
    .orderBy(desc(resourceDay), sql`${resources.createdAt} desc nulls last`, desc(bytewise(resources.id)));
  return rows.map(({ r, company, contactName, customerLocation, ...uploader }) => nonNull({
    _id: r.id, description: r.description, resourceType: r.resourceType, qty: r.qty,
    notes: r.notes, status: r.status, customerLocation, company, contactName,
    date: r.resourceDate ?? r.createdAt?.slice(0, 10), uploadedBy: r.uploadedById,
    createdAt: clock(r.createdAt), customerId: r.customerId,
    customerName: `${company}${company && contactName ? ' - ' : ''}${contactName}`,
    uploadedByName: repNameOf(uploader)
    // MongoDB's route projects legacy root `city`, not address.city. It is absent
    // from model-written records and isn't invented from a different field here.
  }));
}

export async function dashboardRollups(db: Db, q: DashboardRollupQuery): Promise<DashboardRollups> {
  const scope = historyScope(visitOwner, q.people);
  const [visitCounts, resourceCounts, leadCounts, scheduleCounts] = await Promise.all([
    db.select({ visits: count(),
      keyVisits: sql<number>`count(*) filter (where ${visits.outcome} ~* 'order|sale|sold|deposit' or ${visits.notes} ~* 'order|sale|sold')`.mapWith(Number),
      bids: sql<number>`count(*) filter (where ${visits.outcome} ~* 'bid|quote' or ${visits.notes} ~* 'bid|quote')`.mapWith(Number)
    }).from(visits).where(and(scope, dateWhere(visits.visitDate, q))),
    db.select({ count: count() }).from(resources).where(and(historyScope(resources.uploadedById, q.people), dateWhere(resourceDay, q))),
    db.select({ count: count() }).from(customers).where(q.userId != null ? eq(customers.createdById, q.userId) : isNull(customers.createdById)),
    // This is the legacy tile's pending follow-ups due today, rather than the
    // calendar table. Keep it distinct from the Follow-ups tab's totals.
    db.select({ count: count() }).from(visits).where(and(scope, eq(sql<string>`${visits.followUpDate}::text`, q.today), isNull(visits.followUpDoneAt)))
  ]);
  return { ...visitCounts[0], resources: resourceCounts[0].count, leads: leadCounts[0].count,
    todayScheduleCount: scheduleCounts[0].count };
}
