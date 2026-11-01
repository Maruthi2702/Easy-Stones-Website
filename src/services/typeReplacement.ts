import type { ClientSession } from 'mongoose';
import Customer from '../models/Customer.ts';
import Schedule from '../models/Schedule.ts';
import { placementVisit, PlacementConflict } from './resourcePlacement.ts';
import { loadFamilies, resourcesOf, recountModa, recountForFamilyChange } from './modaCount.ts';
import ResourceType from '../models/ResourceType.ts';
import type { Loose } from '../types/records.ts';

/**
 * What a Visit Types / Resource Types delete counts and, with "Move them to…",
 * rewrites before the type goes (src/routes/typeLists.ts runs both inside the
 * delete's transaction).
 *
 * A visit type is a visit's `purpose`; the calendar entry linked to the visit
 * carries it as its notes. A resource type is a resource's `resourceType`; its
 * title defaults to the type, its placement visit says "Resource Placement:
 * <type>" and that visit's calendar entry carries the same words. Only text
 * that still says the old type is rewritten, so a hand-written title or note
 * stays as it is. A resource and its placement visit get their durable links
 * (`visitId` / `resourceId`) on the way, because an older one was matched by
 * title and the title may be the thing changing.
 */

const text = (value: unknown) => String(value ?? '').trim();
const sameText = (a: unknown, b: unknown) => text(a).toLowerCase() === text(b).toLowerCase();
const PLACEMENT = 'Resource Placement: ';

const countIn = (field: 'visits' | 'resources', key: 'purpose' | 'resourceType') => async (name: string): Promise<number> => {
  const [row] = await Customer.aggregate([
    { $match: { [`${field}.${key}`]: name } },
    { $project: { n: { $size: { $filter: { input: `$${field}`, cond: { $eq: [`$$this.${key}`, name] } } } } } },
    { $group: { _id: null, n: { $sum: '$n' } } }
  ]);
  return Number(row?.n || 0);
};

/** How many visits carry this visit type. */
export const countVisitTypeUses = countIn('visits', 'purpose');

/** How many resources carry this resource type. */
export const countResourceTypeUses = countIn('resources', 'resourceType');

/** Every visit of type `from` becomes `to`. Returns how many moved. */
export async function replaceVisitType(from: string, to: string, session: ClientSession): Promise<number> {
  const customers = await Customer.find({ 'visits.purpose': from }).select('visits._id visits.purpose').session(session).lean();
  const visitIds = customers.flatMap((c: Loose) => (c.visits || []).filter((v: Loose) => v.purpose === from).map((v: Loose) => v._id));
  if (!visitIds.length) return 0;
  await Customer.updateMany(
    { 'visits.purpose': from },
    { $set: { 'visits.$[v].purpose': to } },
    { arrayFilters: [{ 'v.purpose': from }], session }
  );
  await Schedule.updateMany({ linkedVisitId: { $in: visitIds }, notes: from }, { $set: { notes: to } }, { session });
  return visitIds.length;
}

/**
 * Every resource of type `from` becomes `to`, with its title, placement visit
 * and calendar entry kept in step. An older resource whose placement visit
 * can't be told apart from another throws PlacementConflict (409), and the
 * transaction leaves everything as it was.
 */
export async function replaceResourceType(from: string, to: string, session: ClientSession): Promise<number> {
  const customers = await Customer.find({ 'resources.resourceType': from }).session(session);
  // Both types are still on the list here; a move between families recounts Display / Binders.
  const families = await loadFamilies(session);
  let moved = 0;
  for (const customer of customers) {
    const before = resourcesOf(customer);
    const resources = Array.from(customer.resources as Loose[]).filter(r => r.resourceType === from);
    // Match every placement visit before anything changes: a later title change
    // would hide an earlier resource's visit from the legacy match.
    const pairs = resources.map(resource => ({ resource, visit: placementVisit(customer, resource) }));
    const claimed = pairs.map(p => p.visit && String(p.visit._id)).filter(Boolean);
    if (new Set(claimed).size !== claimed.length) throw new PlacementConflict();

    const calendar: { visitId: unknown; before: string; after: string }[] = [];
    for (const { resource, visit } of pairs) {
      const oldTitle = resource.title;
      resource.resourceType = to;
      if (sameText(resource.title, from)) resource.title = to;
      moved += 1;
      if (!visit) continue;
      resource.visitId = visit._id;
      visit.resourceId = resource._id;
      const before = text(visit.purpose);
      if (sameText(before.replace(/^Resource Placement:\s*/i, ''), from)) {
        visit.purpose = `${PLACEMENT}${to}`;
        calendar.push({ visitId: visit._id, before, after: visit.purpose });
      }
      if (text(visit.notes) === `Added resource: ${text(oldTitle)}`) visit.notes = `Added resource: ${resource.title}`;
    }
    recountModa(customer, before, families);
    // Old customers can hold fields today's schema would refuse; only what changed is checked.
    await customer.save({ session, validateModifiedOnly: true });
    for (const entry of calendar) {
      await Schedule.updateMany({ linkedVisitId: entry.visitId, notes: entry.before }, { $set: { notes: entry.after } }, { session });
    }
  }
  return moved;
}

/** How many resource types are in this family. */
export const countFamilyUses = async (name: string): Promise<number> => ResourceType.countDocuments({ family: name });

/**
 * Every resource type in family `from` moves to `to` (deleting a family). A move
 * into or out of Display towers / Sample binders recounts the customers holding
 * the type, one type at a time so each recount reads the families as they are.
 */
export async function replaceFamily(from: string, to: string, session: ClientSession): Promise<number> {
  const types = await ResourceType.find({ family: from }).select('name').session(session).lean();
  for (const type of types as Loose[]) {
    await recountForFamilyChange(type.name, from, to, session);
    await ResourceType.updateOne({ _id: type._id }, { $set: { family: to } }, { session });
  }
  return types.length;
}
