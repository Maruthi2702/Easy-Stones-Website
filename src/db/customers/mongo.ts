/**
 * The customer area's reads on MongoDB — the queries server.ts ran inline, moved here
 * unchanged so the Postgres version (postgres.ts) can be checked against them
 * (customers.parity.test.ts). Pick between the two through index.ts, never directly.
 */
import type mongoose from 'mongoose';
import Customer from '../../models/Customer.ts';
import { escapeRegex } from '../../server/http.ts';
import type { Loose } from '../../types/records.ts';
import type { CustomerPage, CustomerPageQuery } from './types.ts';

/** GET /api/customers/dropdown: every customer, the fields a dropdown shows. */
export async function dropdownCustomers(): Promise<Loose[]> {
  return Customer.find({})
    // salesRepName rides along so a screen that picks a customer can fill in
    // the account's owning rep without a second round trip — the delivery
    // modal does exactly that.
    .select('_id company contactName firstName lastName email customerType city address street state zip shippingAddress shippingCity billingAddress billingCity salesRepName')
    .sort({ company: 1, contactName: 1 })
    .lean();
}

/** GET /api/customers/cities: every city on a customer, trimmed, A–Z. */
export async function customerCities(): Promise<string[]> {
  const cities1 = await Customer.distinct('city');
  const cities2 = await Customer.distinct('address.city');
  return Array.from(new Set([...cities1, ...cities2]))
    .filter((city): city is string => typeof city === 'string' && Boolean(city))
    .map(c => c.trim())
    .sort();
}

/** GET /api/customers: newest first, a page at a time, searched by contact / company / email. */
export async function customerPage({ page, limit, search }: CustomerPageQuery): Promise<CustomerPage> {
  const skip = (page - 1) * limit;
  let query: Loose = {};
  if (search) {
    const safeSearch = escapeRegex(search);
    query = {
      $or: [
        { contactName: { $regex: safeSearch, $options: 'i' } },
        { company: { $regex: safeSearch, $options: 'i' } },
        { email: { $regex: safeSearch, $options: 'i' } }
      ]
    };
  }
  const total = await Customer.countDocuments(query);
  const customers = await Customer.aggregate(([
    { $match: query },
    { $addFields: { lastVisitDate: { $max: '$visits.date' } } },
    { $project: { password: 0, contacts: 0, visits: 0, resources: 0 } },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: limit }
  ] as mongoose.PipelineStage[]));
  return { customers, total };
}
