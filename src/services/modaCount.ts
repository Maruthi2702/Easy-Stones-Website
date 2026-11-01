import type { ClientSession } from 'mongoose';
import Customer from '../models/Customer.ts';
import ResourceType from '../models/ResourceType.ts';
import { familyLookup, earlierCount, modaFields, modaKindOf } from '../utils/modaTotals.ts';
import type { FamilyOf, ModaResource } from '../utils/modaTotals.ts';
import type { Loose } from '../types/records.ts';

/*
 * Keeps a customer's Display / Binders in step with its resources (the rule is
 * src/utils/modaTotals.ts). Every write that changes a customer's resources
 * takes `resourcesOf(customer)` before the change and calls `recountModa`
 * after it, before the save, so the counts commit with the resources.
 */

/** Type name → family, read inside the caller's transaction. */
export const loadFamilies = async (session?: ClientSession | null): Promise<FamilyOf> =>
  familyLookup(await ResourceType.find({}).select('name family').session(session ?? null).lean() as Loose[]);

/** The customer's resources as they are now (what the earlier count is worked out against). */
export const resourcesOf = (customer: Loose): ModaResource[] =>
  Array.from(customer?.resources || [], (r: Loose) => ({ resourceType: r.resourceType, title: r.title, qty: r.qty, status: r.status }));

/** Sets Display, Binders and the earlier count on a customer document whose resources just changed. */
export const recountModa = (customer: Loose, before: ModaResource[], familyOf: FamilyOf) => {
  const fields = modaFields(earlierCount(customer, before, familyOf), resourcesOf(customer), familyOf);
  customer.set(fields);
  return fields;
};

/**
 * Admin → Resource Types: a type moved into or out of Display towers / Sample
 * binders changes the counts of every customer holding it. Runs inside the
 * edit's transaction, before the type is saved. Returns how many customers
 * were recounted.
 */
export async function recountForFamilyChange(typeName: string, from: string | undefined, to: string | undefined, session: ClientSession): Promise<number> {
  if (modaKindOf(from) === modaKindOf(to)) return 0;
  const before = await loadFamilies(session);
  const after: FamilyOf = (name) => (name === typeName ? to : before(name));
  const customers = await Customer.find({ $or: [{ 'resources.resourceType': typeName }, { 'resources.title': typeName }] }).session(session);
  for (const customer of customers) {
    const resources = resourcesOf(customer);
    customer.set(modaFields(earlierCount(customer, resources, before), resources, after));
    // Old customers can hold fields today's schema would refuse; only what changed is checked.
    await customer.save({ session, validateModifiedOnly: true });
  }
  return customers.length;
}
