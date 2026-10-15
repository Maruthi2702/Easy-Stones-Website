/**
 * Washington's contractor registry (2026-10-14): the state Department of
 * Labor & Industries' contractor license data on data.wa.gov (Socrata
 * m8qx-ubtq, updated daily) — every registered contractor's business name,
 * phone, address, trade and whether the license is active.
 *
 * Two ways a permit's contractor is found in it, both exact:
 *   by license  MyBuildingPermit gives the contractor's license number.
 *   by name     Seattle, Bellevue, Bellingham and Shoreline give a business
 *               name only. It counts when exactly one *active* license is
 *               registered under that exact name (upper case, spaces tidied)
 *               — "Smith Construction" with three licenses matches nothing.
 *
 * What the registry says is kept beside the permit, never written into the
 * source's own contact: the screen shows it as "WA L&I registry".
 *
 * `refreshFor(contacts)` runs after each morning pull; records are re-read
 * after 30 days (a license can lapse). `lookup(contacts)` is the API's read.
 *
 * Server-only. `fetchImpl` and `now` are injectable for tests.
 */
import { Contractor, ContractorName } from './models.js';
import { cleanText, dayOf, licenseKey, isPlaceholderName, money } from './common.js';
import { fetchJson } from './sources/http.js';

export const LNI_DATASET = 'https://data.wa.gov/resource/m8qx-ubtq.json';
/** The registry's other tables, by license number: insurance, bonds, principals. */
export const LNI_TABLES = Object.freeze({
  insurance: 'https://data.wa.gov/resource/ciwg-agsx.json',
  bonds: 'https://data.wa.gov/resource/bzff-4fmt.json',
  principals: 'https://data.wa.gov/resource/4xk5-x9j6.json'
});
/** The state's own page for a license ("Verify a Contractor"). */
export const lniVerifyUrl = (license) => `https://secure.lni.wa.gov/verify/Detail.aspx?LIC=${encodeURIComponent(license)}`;
const FIELDS = [
  'businessname', 'contractorlicensenumber', 'contractorlicensetypecodedesc', 'address1', 'city', 'state', 'zip', 'phonenumber',
  'licenseexpirationdate', 'specialtycode1desc', 'specialtycode2desc', 'contractorlicensestatus', 'statuscode', 'primaryprincipalname', 'ubi'
];
const STALE_MS = 30 * 24 * 3600 * 1000;
const BATCH = 40;
// Per morning, so a first run over six months of permits spreads over a few days.
const MAX_PER_RUN = 3000;

/** A business name as the registry is searched by it: upper case, spaces tidied. */
export const registryName = (name) => cleanText(name).toUpperCase();

const soql = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** One registry row as a Contractor record. */
export function contractorRecord(row, at) {
  return {
    license: cleanText(row.contractorlicensenumber).toUpperCase(),
    businessName: cleanText(row.businessname),
    phone: cleanText(row.phonenumber),
    address: cleanText(row.address1),
    city: cleanText(row.city),
    state: cleanText(row.state),
    zip: cleanText(row.zip),
    licenseType: cleanText(row.contractorlicensetypecodedesc),
    specialty: cleanText(row.specialtycode1desc),
    specialty2: cleanText(row.specialtycode2desc),
    status: cleanText(row.contractorlicensestatus),
    expiresOn: dayOf(row.licenseexpirationdate),
    principal: cleanText(row.primaryprincipalname),
    ubi: cleanText(row.ubi),
    notFound: false,
    refreshedAt: at
  };
}

const isActive = (row) => cleanText(row.statuscode).toUpperCase() === 'A' || /^ACTIVE$/i.test(cleanText(row.contractorlicensestatus));

/**
 * The license an exact name belongs to, from the registry's rows for it:
 * the one active license among them, or '' (none active, or more than one).
 */
export function licenseForName(rows) {
  const active = [...new Set((rows || []).filter(isActive).map((r) => cleanText(r.contractorlicensenumber).toUpperCase()).filter(Boolean))];
  return { license: active.length === 1 ? active[0] : '', candidates: active.length };
}

/** The contractor contacts worth asking about: licenses, and names of contractors without one. */
export function wantedFrom(contacts) {
  const licenses = new Set();
  const names = new Set();
  for (const c of contacts || []) {
    if (c.kind !== 'contractor') continue;
    const lic = licenseKey(c.license);
    if (lic) { licenses.add(lic); continue; }
    const name = registryName(c.company || c.name);
    if (name && !isPlaceholderName(name) && name.length >= 5) names.add(name);
  }
  return { licenses: [...licenses], names: [...names] };
}

export function createContractorRegistry({ dataset = LNI_DATASET, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pauseMs = 250, now = () => new Date(), log = console } = {}) {
  const query = (where) => fetchJson(`${dataset}?${new URLSearchParams({ $select: FIELDS.join(','), $where: where, $limit: '5000' })}`, {
    fetchImpl, sleep, pauseMs, name: 'The WA contractor registry', errorOf: (d) => (!Array.isArray(d) ? d?.message || 'error' : null)
  });

  async function refreshLicenses(licenses) {
    const at = now();
    let read = 0;
    for (let i = 0; i < licenses.length; i += BATCH) {
      const batch = licenses.slice(i, i + BATCH);
      await sleep(pauseMs);
      const rows = await query(`contractorlicensenumber in (${batch.map(soql).join(',')})`);
      const byLicense = new Map();
      for (const r of rows) {
        const lic = cleanText(r.contractorlicensenumber).toUpperCase();
        if (!byLicense.has(lic)) byLicense.set(lic, r);
      }
      await Contractor.bulkWrite(batch.map((lic) => {
        const row = byLicense.get(lic);
        const set = row ? contractorRecord(row, at) : { license: lic, notFound: true, refreshedAt: at };
        return { updateOne: { filter: { license: lic }, update: { $set: set }, upsert: true } };
      }), { ordered: false });
      read += batch.length;
    }
    return read;
  }

  async function matchNames(names) {
    const at = now();
    const found = [];
    for (let i = 0; i < names.length; i += BATCH) {
      const batch = names.slice(i, i + BATCH);
      await sleep(pauseMs);
      const rows = await query(`upper(businessname) in (${batch.map(soql).join(',')})`);
      const byName = new Map(batch.map((n) => [n, []]));
      for (const r of rows) byName.get(registryName(r.businessname))?.push(r);
      const ops = [];
      for (const [name, list] of byName) {
        const { license, candidates } = licenseForName(list);
        ops.push({ updateOne: { filter: { name }, update: { $set: { name, license, candidates, checkedAt: at } }, upsert: true } });
        if (license) found.push(license);
      }
      await ContractorName.bulkWrite(ops, { ordered: false });
      // The matched licenses' own records, so the screen has their phone.
      const rowsByLicense = new Map();
      for (const r of rows) {
        const lic = cleanText(r.contractorlicensenumber).toUpperCase();
        if (found.includes(lic) && !rowsByLicense.has(lic)) rowsByLicense.set(lic, r);
      }
      if (rowsByLicense.size) {
        await Contractor.bulkWrite([...rowsByLicense].map(([lic, r]) => ({
          updateOne: { filter: { license: lic }, update: { $set: contractorRecord(r, at) }, upsert: true }
        })), { ordered: false });
      }
    }
    return found.length;
  }

  /**
   * Reads what isn't known yet, or was last read over 30 days ago, for these
   * contacts. Returns counts for the run log; throws if the registry can't
   * be reached (the caller logs it — a permit pull never fails for this).
   */
  async function refreshFor(contacts) {
    const { licenses, names } = wantedFrom(contacts);
    const fresh = new Date(now().getTime() - STALE_MS);
    const [knownLicenses, knownNames] = await Promise.all([
      Contractor.distinct('license', { license: { $in: licenses }, refreshedAt: { $gte: fresh } }),
      ContractorName.distinct('name', { name: { $in: names }, checkedAt: { $gte: fresh } })
    ]);
    const kl = new Set(knownLicenses);
    const kn = new Set(knownNames);
    const dueLicenses = licenses.filter((l) => !kl.has(l)).slice(0, MAX_PER_RUN);
    const dueNames = names.filter((n) => !kn.has(n)).slice(0, Math.max(0, MAX_PER_RUN - dueLicenses.length));
    const licensesRead = dueLicenses.length ? await refreshLicenses(dueLicenses) : 0;
    const namesMatched = dueNames.length ? await matchNames(dueNames) : 0;
    log.log?.(`[permits] contractor registry: ${licensesRead} licenses read, ${dueNames.length} names looked up (${namesMatched} matched)`);
    return { licensesRead, namesLookedUp: dueNames.length, namesMatched };
  }

  /**
   * Everything the registry has on one license, read live (Permits search
   * box → the contractor pop-up): the license record, insurance policies,
   * bonds and principals. The license record is saved, so the permit list
   * shows it too. When the registry can't be reached, the last saved record
   * comes back with `stale: true` and no insurance/bond/principal lists.
   */
  async function profile(license) {
    const lic = licenseKey(license);
    if (!lic) return { license: cleanText(license).toUpperCase(), found: false };
    const byLicense = (url) => fetchJson(`${url}?${new URLSearchParams({ contractorlicensenumber: lic, $limit: '200' })}`, {
      fetchImpl, sleep, pauseMs, name: 'The WA contractor registry', errorOf: (d) => (!Array.isArray(d) ? d?.message || 'error' : null)
    });
    let rows;
    try {
      const [general, insurance, bonds, principals] = await Promise.all([
        byLicense(dataset), byLicense(LNI_TABLES.insurance), byLicense(LNI_TABLES.bonds), byLicense(LNI_TABLES.principals)
      ]);
      rows = { general, insurance, bonds, principals };
    } catch (err) {
      const saved = await Contractor.findOne({ license: lic, notFound: { $ne: true } }).lean();
      if (!saved) throw err;
      return { ...contractorView(saved), found: true, stale: true, insurance: [], bonds: [], principals: [], verifyUrl: lniVerifyUrl(lic) };
    }
    const at = now();
    if (!rows.general.length) {
      await Contractor.updateOne({ license: lic }, { $set: { license: lic, notFound: true, refreshedAt: at } }, { upsert: true });
      return { license: lic, found: false, verifyUrl: lniVerifyUrl(lic) };
    }
    const record = contractorRecord(rows.general[0], at);
    await Contractor.updateOne({ license: lic }, { $set: record }, { upsert: true });
    return {
      ...contractorView(record),
      found: true,
      stale: false,
      insurance: rows.insurance.map((r) => ({
        company: cleanText(r.insurancecompany), policy: cleanText(r.insurancepolicyno), amount: money(r.insuranceamt),
        effectiveOn: dayOf(r.effectivedate), expiresOn: dayOf(r.expirationdate), agency: cleanText(r.insuranceagencyname)
      })).sort((a, b) => String(b.expiresOn).localeCompare(String(a.expiresOn))),
      bonds: rows.bonds.map((r) => {
        const until = cleanText(r.bondexpirationdate);
        return {
          company: cleanText(r.bondfirmname), account: cleanText(r.bondaccountid), amount: money(r.bondamt),
          effectiveOn: dayOf(r.bondeffectivedate), expiresOn: dayOf(until), untilCanceled: /until\s+cancel/i.test(until)
        };
      }).sort((a, b) => Number(b.untilCanceled) - Number(a.untilCanceled) || String(b.expiresOn).localeCompare(String(a.expiresOn))),
      principals: rows.principals.map((r) => ({ name: cleanText(r.principalname), since: dayOf(r.startdate), until: dayOf(r.enddate) }))
        .sort((a, b) => Number(Boolean(a.until)) - Number(Boolean(b.until)) || String(b.since).localeCompare(String(a.since))),
      verifyUrl: lniVerifyUrl(lic)
    };
  }

  return { refreshFor, profile };
}

/** A saved Contractor record as the pop-up shows it. */
export function contractorView(r) {
  return {
    license: r.license,
    businessName: r.businessName,
    phone: r.phone,
    address: r.address,
    city: r.city,
    state: r.state,
    zip: r.zip,
    licenseType: r.licenseType,
    specialty: r.specialty,
    specialty2: r.specialty2,
    status: r.status,
    expiresOn: r.expiresOn,
    principal: r.principal,
    ubi: r.ubi,
    refreshedAt: r.refreshedAt
  };
}

/**
 * The names a license goes by on permits that don't print license numbers:
 * every exact business name the registry matched to it (ContractorName).
 */
export async function namesForLicense(license) {
  const lic = licenseKey(license);
  if (!lic) return [];
  return ContractorName.distinct('name', { license: lic });
}

/**
 * The registry's record for each contractor contact, for the API: license
 * → Contractor, and exact name → its one license → Contractor. Returns a
 * function that gives a contact its `registry` (or nothing).
 */
export async function registryLookup(contacts) {
  const { licenses, names } = wantedFrom(contacts);
  if (!licenses.length && !names.length) return () => null;
  const named = names.length ? await ContractorName.find({ name: { $in: names }, license: { $ne: '' } }, 'name license').lean() : [];
  const byName = new Map(named.map((n) => [n.name, n.license]));
  const all = [...new Set([...licenses, ...byName.values()])];
  const records = all.length ? await Contractor.find({ license: { $in: all }, notFound: { $ne: true } }).lean() : [];
  const byLicense = new Map(records.map((r) => [r.license, r]));
  return (c) => {
    if (c.kind !== 'contractor') return null;
    const lic = licenseKey(c.license);
    const via = lic ? 'license' : 'name';
    const record = byLicense.get(lic || byName.get(registryName(c.company || c.name)));
    if (!record) return null;
    return {
      matchedBy: via,
      license: record.license,
      businessName: record.businessName,
      phone: record.phone,
      address: [record.address, record.city, [record.state, record.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      specialty: [record.specialty, record.specialty2].filter(Boolean).join(', '),
      status: record.status,
      expiresOn: record.expiresOn
    };
  };
}
