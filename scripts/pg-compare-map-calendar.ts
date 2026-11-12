/** Read registrations for pg-compare.ts; discovers arguments read-only, never writes the source. */
import mongoose from 'mongoose';
import * as customers from '../src/db/customers/index.ts';
import { buildSignalIndex, matchAgainst, STRONG } from '../src/utils/customerMatch.ts';
import { repCountsOf } from '../src/utils/routePlannerScope.ts';
import type { Loose } from '../src/types/records.ts';

export interface MapCalendarComparisonRead {
  name: string;
  read: () => Promise<unknown>;
  prepare?: (value: unknown, mongo: unknown) => unknown;
}
const byId = (value: unknown) => [...value as Loose[]].sort((a, b) => String(a._id).localeCompare(String(b._id)));

export async function mapCalendarReads(): Promise<MapCalendarComparisonRead[]> {
  const db = mongoose.connection.db!;
  const ids = (await db.collection('customers').find({}, { projection: { _id: 1 } }).toArray()).map(c => String(c._id));
  const owners = (await db.collection('schedules').distinct('userId')).map(String);
  const probes = await db.collection('customers').find({ $or: [{ company: { $exists: true } }, { phone: { $exists: true } }] },
    { projection: { _id: 1, company: 1, phone: 1, email: 1 } }).limit(24).toArray();
  const reads: MapCalendarComparisonRead[] = [
    { name: 'map pins: every slim field, newest visit and visit count, exact order', read: () => customers.mapCustomerPins() },
    { name: 'map pins: all rep counts', read: async () => repCountsOf(await customers.mapCustomerPins()) },
    { name: 'duplicate candidates: every signal and separation link', read: () => customers.duplicateSignals(), prepare: byId },
    { name: 'duplicate candidates: every returned customer field', read: () => customers.duplicateCustomers(ids), prepare: byId },
    { name: 'calendar: all entries, local clock order and populated customer names', read: () => customers.calendarEntries({ people: '*' }) },
    { name: 'calendar: empty people scope', read: () => customers.calendarEntries({ people: new Set() }) },
    { name: 'calendar: all entries in the 2026 local clock range', read: () => customers.calendarEntries({ people: '*', start: '2026-01-01T00:00:00.000', end: '2026-12-31T23:59:59.999' }) },
    { name: 'map details: every customer, including customers with no coordinates', read: async () => {
      const out = [];
      for (let start = 0; start < ids.length; start += 16) out.push(...await Promise.all(ids.slice(start, start + 16).map(id => customers.mapCustomerRecord(id))));
      return out;
    } },
    { name: 'duplicate matcher: selected matches in score order for 24 source probes', read: async () => {
      const rows = await customers.duplicateSignals();
      const index = buildSignalIndex(rows);
      return probes.map(probe => {
        const apart = new Set((rows.find(row => String(row._id) === String(probe._id))?.notDuplicateOf ?? []).map(String));
        return matchAgainst(index, probe).filter(hit => hit.id !== String(probe._id) && !apart.has(hit.id) && hit.score >= STRONG).slice(0, 3);
      });
    } }
  ];
  for (const owner of owners) {
    reads.push({ name: `calendar: owner ${owner}, ordered entries`, read: () => customers.calendarEntries({ people: new Set([owner]) }) });
    reads.push({ name: `calendar feed: owner ${owner}, not cancelled and lean customer fields`, read: () => customers.calendarEntries({ people: new Set([owner]), feed: true }), prepare: byId });
  }
  return reads;
}
