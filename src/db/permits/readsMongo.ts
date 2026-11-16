/** Permits' reads on MongoDB: the router's own Mongoose calls, moved here unchanged (src/permits/router.ts held them). */
import { Permit, PermitRun, PermitCheck } from '../../permits/models.ts';
import { escapeRegex } from '../../server/http.ts';
import type { Loose } from '../../types/records.ts';
import type { PermitSpec, SortKey, PermitPageOptions, PermitPage, PermitMeta, ContractorPermitData } from './readTypes.ts';

/**
 * The list's orders. A permit with no value always sorts after the ones with
 * one, whichever way value is sorted, so "lowest first" starts at $1, not at
 * the blanks.
 */
export const SORTS = Object.freeze({
  issued_desc: { issuedOn: -1, permitNumber: -1 },
  issued_asc: { issuedOn: 1, permitNumber: 1 },
  value_desc: { _hasValue: -1, valuation: -1, issuedOn: -1, permitNumber: -1 },
  value_asc: { _hasValue: -1, valuation: 1, issuedOn: -1, permitNumber: -1 }
});

/** The spec as the Mongo filter it always was; `except` leaves one out (for the per-category counts). */
export function mongoFilter(spec: PermitSpec, { except = null }: { except?: 'category' | null } = {}): Loose {
  const f: Loose = { issuedOn: { $ne: null } };
  if (spec.sources) f.source = spec.sources.length === 1 ? spec.sources[0] : { $in: spec.sources };
  if (spec.category && except !== 'category') f.category = spec.category;
  if (spec.from || spec.to) f.issuedOn = { ...(spec.from && { $gte: spec.from }), ...(spec.to && { $lte: spec.to }) };
  if (spec.city) f.city = spec.city;
  if (spec.minValue !== undefined) f.valuation = { $gte: spec.minValue };
  const text = spec.text;
  if (text) {
    const re = { $regex: escapeRegex(text), $options: 'i' };
    f.$or = [
      { permitNumber: re }, { address: re }, { description: re }, { parcel: re },
      { 'contacts.company': re }, { 'contacts.name': re }, { 'contacts.email': re }, { 'contacts.license': text.toUpperCase() }
    ];
  }
  if (!spec.license) return f;
  const { license: lic, names } = spec.license;
  const or: Loose[] = [{ contacts: { $elemMatch: { kind: 'contractor', license: lic } } }];
  if (names.length) {
    or.push({ contacts: { $elemMatch: { kind: 'contractor', license: { $exists: false }, company: { $in: names.map((n) => new RegExp(`^${escapeRegex(n)}$`, 'i')) } } } });
  }
  return { $and: [f, { $or: or }] };
}

function sortedPermits(filter: Loose, sortKey: SortKey, { skip = 0, limit = null }: { skip?: number; limit?: number | null } = {}) {
  return Permit.aggregate([
    { $match: filter },
    { $addFields: { _hasValue: { $cond: [{ $gt: ['$valuation', 0] }, 1, 0] } } },
    { $sort: SORTS[sortKey] as Record<string, 1 | -1> },
    ...(skip ? [{ $skip: skip }] : []),
    ...(limit ? [{ $limit: limit }] : []),
    { $project: { _hasValue: 0 } }
  ]);
}

const countByCategory = (filter: Loose) => Permit.aggregate([{ $match: filter }, { $group: { _id: '$category', n: { $sum: 1 } } }]);

export async function permitPage(spec: PermitSpec, sort: SortKey, { skip = 0, limit = null, withTotal = false, withCategoryCounts = false }: PermitPageOptions = {}): Promise<PermitPage> {
  const filter = mongoFilter(spec);
  const [items, total, byCategory] = await Promise.all([
    sortedPermits(filter, sort, { skip, limit }),
    withTotal ? Permit.countDocuments(filter) : 0,
    withCategoryCounts ? countByCategory(mongoFilter(spec, { except: 'category' })) : []
  ]);
  return { items, total, byCategory };
}

export const countPermits = (spec: PermitSpec): Promise<number> => Permit.countDocuments(mongoFilter(spec));

export async function permitMeta(sourceIds: string[], checkLimit: number): Promise<PermitMeta> {
  const runs: PermitMeta['runs'] = {};
  for (const id of sourceIds) {
    const [last, lastOk, first] = await Promise.all([
      PermitRun.findOne({ source: id }).sort({ startedAt: -1 }).lean(),
      PermitRun.findOne({ source: id, ok: true }).sort({ startedAt: -1 }).lean(),
      PermitRun.findOne({ source: id, ok: true, kind: 'backfill' }).sort({ startedAt: 1 }).lean()
    ]);
    runs[id] = { last, lastOk, first };
  }
  const checks = await PermitCheck.find({}).sort({ month: -1, source: -1 }).limit(checkLimit).lean();
  const cities = await Permit.distinct('city');
  const rows = await Permit.aggregate([{ $match: { city: { $nin: ['', null] } } }, { $group: { _id: { city: '$city', source: '$source' } } }]);
  return { runs, checks, cities, bySource: rows.map(({ _id }) => ({ city: _id.city, source: _id.source })) };
}

export async function contractorPermitData(spec: PermitSpec): Promise<ContractorPermitData> {
  const clause = mongoFilter(spec);
  const [total, byCategory, recent, emailRows] = await Promise.all([
    Permit.countDocuments(clause),
    countByCategory(clause),
    Permit.find(clause, 'source permitNumber category issuedOn address city valuation description').sort({ issuedOn: -1, permitNumber: -1 }).limit(8).lean(),
    Permit.aggregate([{ $match: clause }, { $unwind: '$contacts' }, { $match: { 'contacts.kind': 'contractor', 'contacts.email': { $nin: ['', null] } } },
      { $group: { _id: { $toLower: '$contacts.email' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 5 }])
  ]);
  return { total, byCategory, recent, emailRows };
}
