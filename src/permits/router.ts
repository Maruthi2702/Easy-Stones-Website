import type { Loose } from '../types/records.ts';
/**
 * Permits API (2026-10-11) — mounted at /api/permits.
 *
 *   app.use('/api/permits', createPermitsRouter({ authenticate, sync }));
 *
 *   GET  /meta     sources with their last run, the report checks, cities (with their county)
 *   GET  /         one page of permits (filters below), newest issued first
 *   GET  /export   every permit the filters match, for Excel (up to 5,000)
 *   GET  /export.pdf  the same as a PDF (first 1,000), for View / Download as PDF
 *   POST /refresh  run the morning pull now
 *   GET  /contractor/:license  one WA contractor: the registry's record
 *                  (license, insurance, bonds, principals), their permits here
 *                  and whether they're already a customer — the search box's
 *                  pop-up (2026-10-14)
 *
 * Filters: license (a WA contractor license: the permits naming it, or a
 * business name the registry matched to it), counties (comma-separated county ids, src/permits/places.ts),
 * source, category, from / to (issue date, YYYY-MM-DD), city, minValue, q
 * (permit #, address, description, contact names). Order:
 * sort = issued_desc (default) | issued_asc | value_desc | value_asc. Every route
 * checks its own Users & Roles permission.
 *
 * Each contractor contact the WA L&I registry knows comes back with a
 * `registry` record beside it (src/permits/contractors.ts) — the source's own
 * contact is never changed.
 */
import express from 'express';
import Customer from '../models/Customer.ts';
import { HttpError, handle, requireAll, actorOf, escapeRegex } from '../server/http.ts';
import { companyOf, realEmailsOf } from '../utils/customerList.ts';
import { PERMITS, can } from './permissions.ts';
import { buildPermitsPdf } from './permitsPdf.ts';
import { permitPdfScope, permitFileName, PERMIT_PDF_MAX_ROWS } from '../utils/permitView.ts';
import { Permit, PermitRun, PermitCheck } from './models.ts';
import {
  SOURCES, SOURCE_IDS, CATEGORIES, CATEGORY_IDS, isDay, phoneKey, emailKey, nameKey, isPlaceholderName, sourcesInCounties
} from './permitRules.ts';
import { COUNTY_IDS } from './places.ts';
import { registryLookup, namesForLicense, lniVerifyUrl } from './contractors.ts';
import { licenseKey, categoryLabel } from './common.ts';

const LABEL = 'permits';
const MAX_LIMIT = 100;
const MAX_EXPORT = 5000;
const CUSTOMER_INDEX_MS = 10 * 60 * 1000;
// A company name this short ("ABC") matches too much to be called the same business.
const MIN_NAME_KEY = 5;

/** 'king,whatcom' (or an array) as county ids; an unknown one is a 400. */
export function countiesOf(value: unknown) {
  const list = (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map((c) => String(c).trim().toLowerCase()).filter(Boolean);
  for (const c of list) if (!COUNTY_IDS.includes(c)) throw new HttpError(400, 'Unknown county.');
  return [...new Set(list)];
}

/** The Mongo filter for the list's filters; `except` leaves one out (for the per-category counts). */
export function permitFilter(query: Loose = {}, { except = null }: Loose = {}) {
  // Keep source-withdrawn records in storage without offering them as leads.
  const f = { issuedOn: { $ne: null } };
  const { source, category, from, to, city, minValue, q } = query;
  const counties = countiesOf(query.counties);
  if (source) {
    if (!SOURCE_IDS.includes(source)) throw new HttpError(400, 'Unknown source.');
    if (counties.length && !counties.includes(SOURCES[source].county)) f.source = { $in: [] };
    else f.source = source;
  } else if (counties.length) {
    f.source = { $in: sourcesInCounties(counties) };
  }
  if (category && except !== 'category') {
    if (!CATEGORY_IDS.includes(category)) throw new HttpError(400, 'Unknown permit category.');
    f.category = category;
  }
  if (from || to) {
    if ((from && !isDay(from)) || (to && !isDay(to))) throw new HttpError(400, 'Dates must be YYYY-MM-DD.');
    f.issuedOn = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  }
  if (city) f.city = String(city);
  if (minValue !== undefined && minValue !== '') {
    const n = Number(minValue);
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'Minimum value must be a number.');
    f.valuation = { $gte: n };
  }
  const text = String(q || '').trim().slice(0, 100);
  if (text) {
    const re = { $regex: escapeRegex(text), $options: 'i' };
    f.$or = [
      { permitNumber: re }, { address: re }, { description: re }, { parcel: re },
      { 'contacts.company': re }, { 'contacts.name': re }, { 'contacts.email': re }, { 'contacts.license': text.toUpperCase() }
    ];
  }
  return f;
}

/**
 * The permits naming one contractor: by the license number on the permit, or
 * (for sources that print names only) by a business name the WA registry
 * matched to that license — exactly, case aside.
 */
export async function licenseClause(license: unknown) {
  const lic = licenseKey(license);
  if (!lic) throw new HttpError(400, 'That isn’t a WA contractor license number.');
  const names = await namesForLicense(lic);
  const or = [{ contacts: { $elemMatch: { kind: 'contractor', license: lic } } }];
  if (names.length) {
    or.push({ contacts: { $elemMatch: { kind: 'contractor', license: { $exists: false }, company: { $in: names.map((n) => new RegExp(`^${escapeRegex(n)}$`, 'i')) } } } });
  }
  return { $or: or };
}

/** permitFilter plus the license filter, which needs the registry's names. */
export async function fullFilter(query: Loose = {}, opts: Loose = {}) {
  const f = permitFilter(query, opts);
  if (!query.license) return f;
  return { $and: [f, await licenseClause(query.license)] };
}

/** Existing customers by email, phone and company / contact name — rebuilt every 10 minutes. */
function createCustomerIndex(maxAgeMs = CUSTOMER_INDEX_MS) {
  let built = null;
  let at = 0;
  return async function index(fresh = false) {
    if (!fresh && built && Date.now() - at < maxAgeMs) return built;
    const byEmail = new Map();
    const byPhone = new Map();
    const byName = new Map();
    const customers = await Customer.find({}, 'company name contactName email phone contacts.name contacts.phone contacts.email').lean();
    for (const c of customers) {
      const ref = { id: String(c._id), name: companyOf(c) };
      for (const e of [...realEmailsOf(c), ...(c.contacts || []).map((x) => x.email)]) {
        const k = emailKey(e);
        if (k && !byEmail.has(k)) byEmail.set(k, ref);
      }
      for (const p of [c.phone, ...(c.contacts || []).map((x) => x.phone)]) {
        const k = phoneKey(p);
        if (k && !byPhone.has(k)) byPhone.set(k, ref);
      }
      for (const n of [c.company, c.contactName]) {
        const k = nameKey(n);
        if (k.length >= MIN_NAME_KEY && !byName.has(k)) byName.set(k, ref);
      }
    }
    built = { byEmail, byPhone, byName };
    at = Date.now();
    return built;
  };
}

/** The customer each contact already is, by email first, then phone, then exact company name. */
export function matchContacts(contacts: Loose[], { byEmail, byPhone, byName }: Loose) {
  return (contacts || []).map((c) => {
    const hit = (emailKey(c.email) && byEmail.get(emailKey(c.email)))
      || (phoneKey(c.phone) && byPhone.get(phoneKey(c.phone)))
      || (!isPlaceholderName(c.company) && nameKey(c.company).length >= MIN_NAME_KEY && byName.get(nameKey(c.company)))
      || (!isPlaceholderName(c.name) && nameKey(c.name).length >= MIN_NAME_KEY && byName.get(nameKey(c.name)))
      || null;
    return hit ? { ...c, customer: hit } : c;
  });
}

const present = (p: Loose, index: number, registry: unknown) => ({
  _id: String(p._id),
  source: p.source,
  permitNumber: p.permitNumber,
  category: p.category,
  type: p.type,
  subtype: p.subtype,
  status: p.status,
  appliedOn: p.appliedOn,
  issuedOn: p.issuedOn,
  finaledOn: p.finaledOn,
  address: p.address,
  city: p.city,
  zip: p.zip,
  parcel: p.parcel,
  projectName: p.projectName,
  description: p.description,
  valuation: p.valuation,
  sqft: p.sqft,
  units: p.units,
  contacts: withRegistry(index ? matchContacts(p.contacts, index) : p.contacts, registry),
  detailsAt: p.detailsAt,
  sourceUrl: p.sourceUrl,
  finalOnly: p.finalOnly,
  firstSeenAt: p.firstSeenAt
});

/** Each contractor contact with what the WA registry says about it, when it knows. */
function withRegistry(contacts: Loose[], registry: unknown) {
  if (!registry) return contacts;
  return (contacts || []).map((c) => {
    const r = registry(c);
    return r ? { ...c, registry: r } : c;
  });
}

/** The registry's records for a page of permits, as a per-contact lookup. Missing registry → no records. */
async function registryFor(items: Loose[]) {
  try {
    return await registryLookup(items.flatMap((p) => p.contacts || []));
  } catch (err) {
    console.error(`[${LABEL}] contractor registry`, err);
    return null;
  }
}

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

function sortedPermits(filter: unknown, sortKey: unknown, { skip = 0, limit = null }: Loose = {}) {
  const sort = SORTS[sortKey || 'issued_desc'];
  if (!sort) throw new HttpError(400, 'Unknown sort.');
  return Permit.aggregate([
    { $match: filter },
    { $addFields: { _hasValue: { $cond: [{ $gt: ['$valuation', 0] }, 1, 0] } } },
    { $sort: sort },
    ...(skip ? [{ $skip: skip }] : []),
    ...(limit ? [{ $limit: limit }] : []),
    { $project: { _hasValue: 0 } }
  ]);
}

export default function createPermitsRouter({ authenticate, sync = null, contractors = null, customerIndexMs = CUSTOMER_INDEX_MS }: Loose) {
  const router = express.Router();
  const customerIndex = createCustomerIndex(customerIndexMs);

  router.get('/meta', authenticate, requireAll(PERMITS.VIEW), handle(async (req: Loose, res: Loose) => {
    const canRefresh = can(req.user, PERMITS.REFRESH);
    const sources = [];
    // The sources this server pulls (every source when it isn't pulling at all).
    for (const id of sync?.sourceIds?.() || SOURCE_IDS) {
      const [last, lastOk, first] = await Promise.all([
        PermitRun.findOne({ source: id }).sort({ startedAt: -1 }).lean(),
        PermitRun.findOne({ source: id, ok: true }).sort({ startedAt: -1 }).lean(),
        PermitRun.findOne({ source: id, ok: true, kind: 'backfill' }).sort({ startedAt: 1 }).lean()
      ]);
      const run = (r: Loose) => r && {
        kind: r.kind, since: r.since, startedAt: r.startedAt, finishedAt: r.finishedAt, ok: r.ok, error: r.error,
        seen: r.seen, leads: r.leads, added: r.added, updated: r.updated, detailErrors: r.detailErrors,
        latestIssuedOn: r.latestIssuedOn, ...(canRefresh && { unsortedTypes: r.unsortedTypes || [], by: r.by })
      };
      sources.push({ ...SOURCES[id], lastRun: run(last), lastOk: run(lastOk), coverageSince: first?.since || null });
    }
    // About four months of every source's checks: this month's, and the reports behind it.
    const checks = await PermitCheck.find({}).sort({ month: -1, source: -1 }).limit(SOURCE_IDS.length * 4).lean();
    const cities = (await Permit.distinct('city')).filter(Boolean).sort((a, b) => a.localeCompare(b));
    // Each city with the counties its permits come from, so the city list follows the county filter.
    const bySource = await Permit.aggregate([{ $match: { city: { $nin: ['', null] } } }, { $group: { _id: { city: '$city', source: '$source' } } }]);
    const placeCounties = new Map();
    for (const { _id } of bySource) {
      const county = SOURCES[_id.source]?.county;
      if (!county) continue;
      if (!placeCounties.has(_id.city)) placeCounties.set(_id.city, new Set());
      placeCounties.get(_id.city).add(county);
    }
    res.json({
      sources,
      cityCounties: Object.fromEntries([...placeCounties].map(([city, set]) => [city, [...set].sort()])),
      checks: checks.map(({ _id, __v, ...c }) => c),
      categories: CATEGORIES,
      cities,
      running: Boolean(sync?.isRunning()),
      canRefresh,
      canExport: can(req.user, PERMITS.EXPORT)
    });
  }, { label: LABEL }));

  router.get('/', authenticate, requireAll(PERMITS.VIEW), handle(async (req: Loose, res: Loose) => {
    const filter = await fullFilter(req.query);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const [items, total, byCategory, index] = await Promise.all([
      sortedPermits(filter, req.query.sort, { skip: (page - 1) * limit, limit }),
      Permit.countDocuments(filter),
      Permit.aggregate([{ $match: await fullFilter(req.query, { except: 'category' }) }, { $group: { _id: '$category', n: { $sum: 1 } } }]),
      customerIndex()
    ]);
    const counts = Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0]));
    for (const { _id, n } of byCategory) counts[_id] = n;
    counts.all = Object.values(counts).reduce((a, b) => a + b, 0);
    const registry = await registryFor(items);
    res.json({ items: items.map((p) => present(p, index, registry)), total, page, limit, counts });
  }, { label: LABEL }));

  router.get('/export', authenticate, requireAll(PERMITS.VIEW, PERMITS.EXPORT), handle(async (req: Loose, res: Loose) => {
    const filter = await fullFilter(req.query);
    const total = await Permit.countDocuments(filter);
    if (total > MAX_EXPORT) throw new HttpError(400, `That’s ${total.toLocaleString('en-US')} permits — narrow the filters to ${MAX_EXPORT.toLocaleString('en-US')} or fewer.`);
    const [items, index] = await Promise.all([sortedPermits(filter, req.query.sort), customerIndex()]);
    const registry = await registryFor(items);
    res.json({ items: items.map((p) => present(p, index, registry)), total });
  }, { label: LABEL }));

  // The list as a PDF for its current filters (More menu → View as PDF /
  // Download as PDF). Opened by a plain link, so the login cookie signs it in
  // and errors come back as a short readable page, not JSON. ?download=1
  // saves it; otherwise it opens in the browser's PDF viewer.
  router.get('/export.pdf', authenticate, requireAll(PERMITS.VIEW, PERMITS.EXPORT), async (req: Loose, res: Loose) => {
    const fail = (status: unknown, message: unknown) => res.status(status).type('text/plain; charset=utf-8').send(message);
    try {
      const filter = await fullFilter(req.query);
      const [total, items, index] = await Promise.all([
        Permit.countDocuments(filter),
        sortedPermits(filter, req.query.sort, { limit: PERMIT_PDF_MAX_ROWS }),
        customerIndex()
      ]);
      const registry = await registryFor(items);
      const actor = actorOf(req).name;
      const generated = `Generated ${new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
      }).format(new Date())}${actor ? ` by ${actor}` : ''}`;
      const bytes = await buildPermitsPdf({
        items: items.map((p) => present(p, index, registry)), total, generated, scope: permitPdfScope(req.query)
      });
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${permitFileName(req.query, 'pdf')}"`);
      res.set('Cache-Control', 'no-store');
      res.send(Buffer.from(bytes));
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, (err as Error).message);
      console.error(`[${LABEL}] PDF`, err);
      return fail(500, 'Couldn’t make the PDF. Close this tab and try again.');
    }
  });

  router.get('/contractor/:license', authenticate, requireAll(PERMITS.VIEW), handle(async (req: Loose, res: Loose) => {
    const lic = licenseKey(req.params.license);
    if (!lic) throw new HttpError(400, 'That isn’t a WA contractor license number.');
    if (!contractors) throw new HttpError(503, 'The contractor registry isn’t set up on this server.');
    let profile;
    try {
      profile = await contractors.profile(lic);
    } catch (err) {
      console.error(`[${LABEL}] contractor ${lic}`, err);
      throw new HttpError(502, 'Couldn’t reach the state’s contractor registry. Try again in a minute.');
    }
    // Their permits here, whatever the registry said (a license it no longer lists can still be on permits).
    const clause = await fullFilter({ license: lic });
    const [total, byCategory, recent, index, emailRows] = await Promise.all([
      Permit.countDocuments(clause),
      Permit.aggregate([{ $match: clause }, { $group: { _id: '$category', n: { $sum: 1 } } }]),
      Permit.find(clause, 'source permitNumber category issuedOn address city valuation description').sort({ issuedOn: -1, permitNumber: -1 }).limit(8).lean(),
      // Fresh, so a customer created from this pop-up a moment ago is found.
      customerIndex(true),
      // The registry has no email; contractors give one on some permits (EnerGov sources).
      Permit.aggregate([{ $match: clause }, { $unwind: '$contacts' }, { $match: { 'contacts.kind': 'contractor', 'contacts.email': { $nin: ['', null] } } },
        { $group: { _id: { $toLower: '$contacts.email' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 5 }])
    ]);
    const [customerOf] = profile.found
      ? matchContacts([{ kind: 'contractor', company: profile.businessName, phone: profile.phone, email: emailRows[0]?._id || '' }], index)
      : [{}];
    res.json({
      ...profile,
      verifyUrl: profile.verifyUrl || lniVerifyUrl(lic),
      customer: customerOf?.customer || null,
      emails: emailRows.map((e) => e._id).filter((e) => emailKey(e)),
      permits: {
        total,
        byCategory: byCategory.map(({ _id, n }) => ({ category: _id, label: categoryLabel(_id), count: n })).sort((a, b) => b.count - a.count),
        recent: recent.map((p) => ({
          _id: String(p._id), source: p.source, permitNumber: p.permitNumber, category: p.category, issuedOn: p.issuedOn,
          address: p.address, city: p.city, valuation: p.valuation, description: p.description
        }))
      }
    });
  }, { label: LABEL }));

  router.post('/refresh', authenticate, requireAll(PERMITS.VIEW, PERMITS.REFRESH), handle(async (req: Loose, res: Loose) => {
    if (!sync) throw new HttpError(503, 'The permit pull isn’t running on this server.');
    if (sync.isRunning()) return res.status(202).json({ running: true, started: false });
    sync.run({ kind: 'manual', by: actorOf(req).name }).catch(() => {});
    return res.status(202).json({ running: true, started: true });
  }, { label: LABEL }));

  return router;
}
