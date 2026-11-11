import type { Loose } from '../../types/records.ts';
import type { CustomerHistoryScope } from './types.ts';
import { basicCustomer } from '../../utils/customerAccess.ts';
import { inTeam } from '../../utils/teamScope.ts';

export const lastVisit = (visits: Loose[] = []) => visits.reduce<string | null>((last, visit) =>
  visit.date && (!last || visit.date > last) ? visit.date : last, null);

/** Also accepts mutation documents: never changes their stored history or password. */
export function shapeCustomerHistory(record: Loose, { mayProfile, people }: CustomerHistoryScope): Loose {
  const customer: Loose = record.toObject ? record.toObject() : { ...record };
  delete customer.password;
  if (!mayProfile) return basicCustomer(customer);
  customer.visits = (customer.visits || []).filter((visit: Loose) => inTeam(people, visit.createdBy));
  customer.resources = (customer.resources || []).filter((resource: Loose) => inTeam(people, resource.uploadedBy || resource.createdBy));
  customer.lastVisitDate = lastVisit(customer.visits);
  customer.associatedCustomers = (customer.associatedCustomers || []).map((partner: Loose) => {
    if (!partner || typeof partner !== 'object' || !('visits' in partner)) return partner;
    const { visits = [], ...publicPartner } = partner;
    return { ...publicPartner, lastVisitDate: lastVisit(visits.filter((v: Loose) => inTeam(people, v.createdBy))) };
  });
  return customer;
}
