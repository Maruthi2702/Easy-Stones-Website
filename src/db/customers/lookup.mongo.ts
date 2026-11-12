/** The small customer reads, with the original route queries kept on MongoDB. */
import type { ClientSession } from 'mongoose';
import Customer from '../../models/Customer.ts';
import { loadFamilies } from '../../services/modaCount.ts';
import { modaSummary } from '../../utils/modaTotals.ts';
import type { Loose } from '../../types/records.ts';

export async function customerVCard(id: string): Promise<Loose | null> {
  return Customer.findById(id)
    .select('company contactName name phone email address city location salesRepName customerType contacts').lean();
}

export async function customerModa(id: string) {
  const customer = await Customer.findById(id)
    .select('modaDisplay modaBinder modaEarlier resources._id resources.resourceType resources.title resources.qty resources.status resources.date').lean();
  return customer ? modaSummary(customer as Loose, (customer as Loose).resources, await loadFamilies()) : null;
}

/** Holds still commit in MongoDB: keep their session on the MongoDB read. */
export async function customerById(id: string, session: ClientSession | null = null): Promise<Loose | null> {
  const query = Customer.findById(id).lean();
  if (session) query.session(session);
  return query;
}

export async function customerContactsForMatching(): Promise<Loose[]> {
  return Customer.find({}, 'company name contactName email phone contacts.name contacts.phone contacts.email').lean();
}

export async function customerPriceLevel(id: string): Promise<Loose | null> {
  return Customer.findById(id, 'priceLevel isActive').lean();
}

/** Who a customer login is, for "created by" / "updated by" attribution. */
export async function customerAttribution(id: string): Promise<Loose | null> {
  return Customer.findById(id).select('contactName email').lean();
}
