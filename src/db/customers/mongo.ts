/**
 * The customer area's reads on MongoDB — the queries server.ts ran inline, moved here
 * unchanged so the Postgres version (postgres.ts) can be checked against them
 * (customers.parity.test.ts). Pick between the two through index.ts, never directly.
 */
import mongoose from 'mongoose';
import { savedViewQuery, letterQuery, SAVED_VIEWS } from '../../utils/customerList.ts';
import { BASIC_CUSTOMER_PROJECTION } from '../../utils/customerAccess.ts';
import Customer from '../../models/Customer.ts';
import User from '../../models/User.ts';
import { displayNameOf } from '../../utils/salesReps.ts';
import { inTeam } from '../../utils/teamScope.ts';
import { shapeCustomerHistory } from './profileShape.ts';
import type { CustomerHistoryScope, CustomerHistoryKind } from './types.ts';
import { escapeRegex } from '../../server/http.ts';
import type { Loose } from '../../types/records.ts';
import type { CustomerPage, CustomerPageQuery, CustomerList, CustomerListQuery, CustomerViewCounts, CustomerViewCountsQuery } from './types.ts';

export { customerVCard, customerModa, customerById, customerContactsForMatching, customerPriceLevel, customerAttribution } from './lookup.mongo.ts';

/** Kept on MongoDB for create/edit replies until customer writes move too. */
export async function customerRecordResponse(record: Loose, scope: CustomerHistoryScope): Promise<Loose> {
  const customer = shapeCustomerHistory(record, scope);
  if (!scope.mayProfile) return customer;
  const resources: Loose[] = customer.resources;
  const ids = [...new Set(resources.map((r) => String(r.uploadedBy || '')).filter((id) => /^[a-f0-9]{24}$/i.test(id)))];
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select('username displayName').lean() as Loose[] : [];
  const nameById = new Map(users.map((u) => [String(u._id), displayNameOf(u)]));
  resources.forEach((r) => { r.uploadedByName = nameById.get(String(r.uploadedBy || '')) || ''; });
  return customer;
}

export async function customerProfile(id: string, scope: CustomerHistoryScope): Promise<Loose | null> {
  const customer = await Customer.findById(id)
    .populate('associatedCustomers', 'contactName company customerType status phone visits')
    .select('-password').lean() as Loose | null;
  return customer ? customerRecordResponse(customer, scope) : null;
}

export async function customerHistoryEntry(customerId: string, kind: CustomerHistoryKind, entryId: string,
  people: CustomerHistoryScope['people']): Promise<Loose | null> {
  const customer = await Customer.findOne(
    { _id: customerId, [`${kind}._id`]: entryId }, { [`${kind}.$`]: 1 }
  ).lean() as Loose | null;
  const entry = customer?.[kind]?.[0];
  const owner = kind === 'visits' ? entry?.createdBy : entry?.uploadedBy || entry?.createdBy;
  return entry && inTeam(people, owner) ? entry : null;
}

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

/** GET /api/customers/list (+ the legacy /api/partners alias). The original pipeline. */
export async function customerList(q: CustomerListQuery): Promise<CustomerList> {
  const { page, limit, search, mayProfile, userId, today, sortBy, sortOrder,
    level: filterLevel = '', type: filterType = '', typeExclude: filterTypeExclude = '',
    city: filterCity = '', status: filterStatus = '', salesRep: filterSalesRep = '',
    location: filterLocation = '', view: filterView = '', letter: filterLetter = '', moda: filterModa = '' } = q;
  const skip = (page - 1) * limit;

  let query: Loose = {};

  // Build filter conditions
  const filterConditions: Loose[] = [];

  if (search) {
    const safeSearch = escapeRegex(search);
    filterConditions.push({
      $or: [
        { company: { $regex: safeSearch, $options: 'i' } },
        { contactName: { $regex: safeSearch, $options: 'i' } },
        { name: { $regex: safeSearch, $options: 'i' } },
        { email: { $regex: safeSearch, $options: 'i' } },
        { phone: { $regex: safeSearch, $options: 'i' } },
        { city: { $regex: safeSearch, $options: 'i' } },
        { 'address.city': { $regex: safeSearch, $options: 'i' } },
        { 'address.street': { $regex: safeSearch, $options: 'i' } },
        { status: { $regex: safeSearch, $options: 'i' } }
      ]
    });
  }

  // Saved views (My accounts, Follow-ups due, …) — one preset filter each,
  // defined with the screen in src/utils/customerList.ts.
  if (filterView) {
    filterConditions.push(savedViewQuery(filterView, {
      userId: userId,
      today: today,
      toId: (id: string) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null)
    })!);
  }

  // A–Z jump strip.
  const letterCondition = letterQuery(filterLetter);
  if (letterCondition) filterConditions.push(letterCondition);

  // Moda Resources: display = 'Yes'/'No', binders = a count stored as a string.
  if (filterModa) {
    const wanted = filterModa.split(',').map(m => m.trim());
    const modaOrs: Loose[] = [];
    if (wanted.includes('display')) modaOrs.push({ modaDisplay: 'Yes' });
    if (wanted.includes('noDisplay')) modaOrs.push({ modaDisplay: { $ne: 'Yes' } });
    if (wanted.includes('binders')) modaOrs.push({ modaBinder: { $nin: [null, '', '0'] } });
    if (wanted.includes('noBinders')) modaOrs.push({ modaBinder: { $in: [null, '', '0'] } });
    if (modaOrs.length) filterConditions.push(modaOrs.length === 1 ? modaOrs[0] : { $or: modaOrs });
  }

  if (filterStatus) {
    const statuses = filterStatus.split(',').map(s => s.trim()).filter(Boolean);
    if (statuses.length > 0) {
      filterConditions.push({ status: { $in: statuses } });
    }
  }

  if (filterLevel) {
    const levels = filterLevel.split(',').map(l => l.trim()).filter(Boolean);
    if (levels.length > 0) {
      filterConditions.push({ level: { $in: levels } });
    }
  }
  if (filterType) {
    const types = filterType.split(',').map(t => t.trim()).filter(Boolean);
    if (types.length > 0) {
      const orConditions: Loose[] = [];
      const nonFabricatorTypes: string[] = [];
      let hasFabricator = false;

      types.forEach(t => {
        if (t.toLowerCase() === 'fabricator') {
          hasFabricator = true;
        } else {
          nonFabricatorTypes.push(t);
        }
      });

      if (hasFabricator) {
        orConditions.push(
          { customerType: { $regex: /^fabricator$/i } },
          { customerType: null },
          { customerType: { $exists: false } },
          { customerType: '' }
        );
      }
      if (nonFabricatorTypes.length > 0) {
        orConditions.push({ customerType: { $in: nonFabricatorTypes } });
      }

      if (orConditions.length > 0) {
        filterConditions.push(orConditions.length === 1 ? orConditions[0] : { $or: orConditions });
      }
    }
  }
  if (filterTypeExclude) {
    const excludeList = filterTypeExclude.split(',').map(t => t.trim()).filter(Boolean);
    if (excludeList.length > 0) {
      // When excluding 'Fabricator', also exclude records where customerType is null/empty/missing
      // because the UI renders those as "Fabricator" by default.
      const isFabricatorExcluded = excludeList.some(t => t.toLowerCase() === 'fabricator');
      if (isFabricatorExcluded) {
        // Must have a non-null, non-empty customerType that is not a Fabricator (case-insensitive)
        filterConditions.push({
          $and: [
            { customerType: { $exists: true } },
            { customerType: { $ne: null } },
            { customerType: { $ne: '' } },
            { customerType: { $not: { $regex: /^fabricator$/i } } }
          ]
        });
      } else {
        filterConditions.push({ customerType: { $nin: excludeList } });
      }
    }
  }
  if (filterCity) {
    const cities = filterCity.split(',').map(c => c.trim()).filter(Boolean);
    if (cities.length > 0) {
      const cityOrs: Loose[] = [];
      cities.forEach(c => {
        cityOrs.push(
          { city: { $regex: c, $options: 'i' } },
          { 'address.city': { $regex: c, $options: 'i' } }
        );
      });
      filterConditions.push({ $or: cityOrs });
    }
  }

  // Owning rep. The literal 'unassigned' is a selectable value, not an id —
  // it is how someone pulls up the accounts still waiting to be claimed, so
  // it has to match records where the field is null, missing or was cleared.
  if (filterSalesRep) {
    const reps = filterSalesRep.split(',').map(r => r.trim()).filter(Boolean);
    const wantsUnassigned = reps.some(r => r.toLowerCase() === 'unassigned');
    const repIds = reps
      .filter(r => mongoose.Types.ObjectId.isValid(r))
      .map(r => new mongoose.Types.ObjectId(r));

    const repOrs: Loose[] = [];
    if (repIds.length > 0) repOrs.push({ salesRep: { $in: repIds } });
    if (wantsUnassigned) repOrs.push({ salesRep: { $in: [null] } });

    if (repOrs.length > 0) {
      filterConditions.push(repOrs.length === 1 ? repOrs[0] : { $or: repOrs });
    }
  }

  // Branch. Records predating the field are Seattle's — the startup migration
  // backfills them, but match a missing value to Seattle regardless so a
  // Seattle filter is right even on a database that has not been migrated yet.
  if (filterLocation) {
    const locations = filterLocation.split(',').map(l => l.trim()).filter(Boolean);
    if (locations.length > 0) {
      const locationOrs: Loose[] = [{ location: { $in: locations } }];
      if (locations.some(l => l.toLowerCase() === 'seattle')) {
        locationOrs.push({ location: { $in: [null, ''] } }, { location: { $exists: false } });
      }
      filterConditions.push(locationOrs.length === 1 ? locationOrs[0] : { $or: locationOrs });
    }
  }

  if (filterConditions.length > 0) {
    query = filterConditions.length === 1 ? filterConditions[0] : { $and: filterConditions };
  }

  // Build the dynamic sort stage. Low-priority statuses always float to the bottom,
  // and we sort by the chosen sortBy field within those groupings.
  const sortStage: Record<string, 1 | -1> = { sortPriority: 1 };
  if (sortBy === 'company') {
    sortStage.normalizedCompany = sortOrder;
  } else if (sortBy === 'level') {
    sortStage.level = sortOrder;
    sortStage.normalizedCompany = 1;
  } else if (sortBy === 'city') {
    sortStage.normalizedCity = sortOrder;
  } else if (sortBy === 'salesRep') {
    // Unassigned accounts hold '' and so group together at one end, which is
    // the useful reading of this sort — the backlog in one block.
    sortStage.salesRepName = sortOrder;
    sortStage.normalizedCompany = 1;
  } else if (sortBy === 'location') {
    sortStage.normalizedLocation = sortOrder;
    sortStage.normalizedCompany = 1;
  } else {
    sortStage.createdAt = -1; // Default fallback to newest first
  }
  // Last, the id: customers with equal sort values come in one fixed order, so no page
  // repeats or skips a customer (Postgres sorts the same way, listSql.ts).
  sortStage._id = 1;

  const totalCount = await Customer.countDocuments(query);

  // The fields the sort reads but the documents do not carry directly. Held in
  // one place because the paginated and export pipelines below must agree on
  // them exactly — when they were written out twice they were one edit away
  // from sorting the export differently from the page it was exported from.
  const sortFields = {
    $addFields: {
      sortPriority: {
        $cond: {
          if: {
            $in: ["$status", ["Different Sales Person", "Not Interested"]]
          },
          then: 1,
          else: 0
        }
      },
      normalizedCity: {
        $cond: {
          if: { $and: [{ $gt: ["$city", null] }, { $ne: ["$city", ""] }] },
          then: "$city",
          else: { $ifNull: ["$address.city", ""] }
        }
      },
      // A record with no branch is a Seattle record that predates the field,
      // so it sorts with Seattle rather than ahead of everything.
      normalizedLocation: {
        $cond: {
          if: { $and: [{ $gt: ["$location", null] }, { $ne: ["$location", ""] }] },
          then: "$location",
          else: "Seattle"
        }
      },
      normalizedCompany: {
        $cond: {
          if: { $and: [{ $gt: ["$company", null] }, { $ne: ["$company", ""] }] },
          then: "$company",
          else: {
            $cond: {
              if: { $and: [{ $gt: ["$name", null] }, { $ne: ["$name", ""] }] },
              then: "$name",
              else: { $ifNull: ["$contactName", ""] }
            }
          }
        }
      }
    }
  };

  // Without Full profile a row is the basic card only (customerAccess.js).
  const hideHeavyFields = mayProfile
    ? { $project: { password: 0, contacts: 0, visits: 0, resources: 0 } }
    : { $project: BASIC_CUSTOMER_PROJECTION };

  // The list shows "+N" for extra contacts without shipping the contacts
  // themselves, so count them before they're projected away.
  const countContacts = { $addFields: { contactsCount: { $size: { $ifNull: ['$contacts', []] } } } };

  const customers = await Customer.aggregate(
    (limit === -1
      ? [{ $match: query }, sortFields, { $sort: sortStage }, countContacts, hideHeavyFields]
      : [{ $match: query }, sortFields, { $sort: sortStage }, { $skip: skip }, { $limit: limit }, countContacts, hideHeavyFields] as mongoose.PipelineStage[])
  );

  return {
    partners: customers,
    totalCount,
    totalPages: Math.ceil(totalCount / (limit === -1 ? totalCount || 1 : limit)),
    currentPage: page
  };
}

// The Fabricators / Partners tab, as a query. Same rule as the type/typeExclude
// handling in GET /api/partners: a record with no type is a Fabricator.
const partnersTabQuery = (tab: string | undefined) => (tab === 'partners'
  ? {
    $and: [
      { customerType: { $exists: true } },
      { customerType: { $ne: null } },
      { customerType: { $ne: '' as const } },
      { customerType: { $not: { $regex: /^fabricator$/i } } }
    ]
  }
  : {
    $or: [
      { customerType: { $regex: /^fabricator$/i } },
      { customerType: null },
      { customerType: { $exists: false } },
      { customerType: '' as const }
    ]
  });

/** GET /api/customers/view-counts: the original tab filter and six MongoDB counts. */
export async function customerViewCounts({ tab, userId, today }: CustomerViewCountsQuery): Promise<CustomerViewCounts> {
  const base = partnersTabQuery(tab);
  const opts = {
    userId: userId,
    today: today,
    toId: (id: string) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null)
  };
  const entries = await Promise.all(SAVED_VIEWS.map(async ({ key }) =>
    [key, await Customer.countDocuments({ $and: [base, savedViewQuery(key, opts)!] })]
  ));
  return Object.fromEntries(entries);
}

export { mapCustomerPins, mapCustomerRecord, duplicateSignals, duplicateCustomers, calendarEntries } from './mapCalendar.mongo.ts';
export { dashboardVisits, dashboardResources, dashboardRollups } from './dashboard.mongo.ts';
