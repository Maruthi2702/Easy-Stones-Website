/**
 * What a person's records say about a day, for the tracking rules
 * (src/utils/locationTracking.ts `DayFacts`): did they log Personal Time Off,
 * and do they have scheduled work — a calendar entry that isn't cancelled or a
 * delivery on their own driver column ('drv_<username>', not cancelled).
 * Days are YYYY-MM-DD on the person's branch clock, which is how visits, deliveries
 * and the calendar's local times all store them.
 */
import { and, eq, gte, inArray, lt, ne } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { appDb } from '../appDb.ts';
import { visits, schedules } from '../schema/customers.ts';
import { deliveries } from '../schema/operations.ts';
import { NO_FACTS, TIME_OFF_VISIT_TYPE, type DayFacts } from '../../utils/locationTracking.ts';

const nextDay = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** One entry per asked day (an invalid day is skipped). */
export async function dayFactsFor(person: { id: string; username: string }, days: string[], db?: Db): Promise<Map<string, DayFacts>> {
  const asked = [...new Set(days.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  const out = new Map<string, DayFacts>(asked.map(d => [d, { ...NO_FACTS }]));
  if (!asked.length || !person.id) return out;
  const d = db ?? await appDb();

  const off = await d.select({ day: visits.visitDate }).from(visits)
    .where(and(eq(visits.createdById, person.id), eq(visits.visitType, TIME_OFF_VISIT_TYPE), inArray(visits.visitDate, asked)));
  for (const r of off) out.get(r.day)!.timeOff = true;

  // The calendar stores local clock times ('2026-11-21 09:30:00'); a range over the asked days, then by date part.
  const entries = await d.select({ at: schedules.startsAt }).from(schedules)
    .where(and(eq(schedules.userId, person.id), ne(schedules.status, 'Cancelled'),
      gte(schedules.startsAt, `${asked[0]} 00:00:00`), lt(schedules.startsAt, `${nextDay(asked[asked.length - 1]!)} 00:00:00`)));
  for (const r of entries) { const f = out.get(String(r.at).slice(0, 10)); if (f) f.scheduledWork = true; }

  if (person.username) {
    const drops = await d.select({ day: deliveries.day }).from(deliveries)
      .where(and(eq(deliveries.truckKey, `drv_${person.username}`), ne(deliveries.status, 'cancelled'), inArray(deliveries.day, asked)));
    for (const r of drops) if (r.day) out.get(r.day)!.scheduledWork = true;
  }
  return out;
}

/**
 * The same facts for MANY people at once, each for their own day (the manager's list: one person's "today" is their
 * branch's day). Three queries however many people, not three each. Returns id → that person's DayFacts.
 */
export async function dayFactsForPeople(people: { id: string; username: string; day: string }[], db?: Db): Promise<Map<string, DayFacts>> {
  const valid = people.filter(p => p.id && /^\d{4}-\d{2}-\d{2}$/.test(p.day));
  const out = new Map<string, DayFacts>(valid.map(p => [p.id, { ...NO_FACTS }]));
  if (!valid.length) return out;
  const d = db ?? await appDb();
  const days = [...new Set(valid.map(p => p.day))].sort();
  const ids = valid.map(p => p.id);
  const dayOf = new Map(valid.map(p => [p.id, p.day]));

  const off = await d.select({ id: visits.createdById, day: visits.visitDate }).from(visits)
    .where(and(inArray(visits.createdById, ids), eq(visits.visitType, TIME_OFF_VISIT_TYPE), inArray(visits.visitDate, days)));
  for (const r of off) if (r.id && dayOf.get(r.id) === r.day) out.get(r.id)!.timeOff = true;

  const entries = await d.select({ id: schedules.userId, at: schedules.startsAt }).from(schedules)
    .where(and(inArray(schedules.userId, ids), ne(schedules.status, 'Cancelled'),
      gte(schedules.startsAt, `${days[0]} 00:00:00`), lt(schedules.startsAt, `${nextDay(days[days.length - 1]!)} 00:00:00`)));
  for (const r of entries) if (r.id && dayOf.get(r.id) === String(r.at).slice(0, 10)) out.get(r.id)!.scheduledWork = true;

  const trucks = new Map(valid.filter(p => p.username).map(p => [`drv_${p.username}`, p]));
  if (trucks.size) {
    const drops = await d.select({ truck: deliveries.truckKey, day: deliveries.day }).from(deliveries)
      .where(and(inArray(deliveries.truckKey, [...trucks.keys()]), ne(deliveries.status, 'cancelled'), inArray(deliveries.day, days)));
    for (const r of drops) { const p = r.truck ? trucks.get(r.truck) : undefined; if (p && p.day === r.day) out.get(p.id)!.scheduledWork = true; }
  }
  return out;
}
