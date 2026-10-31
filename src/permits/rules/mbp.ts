import type { Loose } from '../../types/records.ts';
/**
 * MyBuildingPermit (permitsearch.mybuildingpermit.com, run by the eCityGov
 * Alliance) — one public permit search over many King County offices, each
 * with its own permit system behind it, so each office names its permit
 * types its own way. `mbpRule` makes one office's rules from its exact type
 * names; rules/kingCounty.js and rules/mbpCities.js use it.
 * Reader: src/permits/sources/mbp.ts.
 *
 * What the search gives: permit number, type, status, address, description
 * and dates. Each lead's people (contractor with their WA license number,
 * applicant) and parcel are read one by one from its detail page.
 */
import { key, typeMap, typeSet, cleanText, htmlText, dayOf, pacificNow, tidyContacts } from '../common.ts';

export const MBP_SITE = 'https://permitsearch.mybuildingpermit.com';

/** The office's name as MyBuildingPermit's detail links spell it: '…/PermitDetails/ADDC25-0739/KING%20COUNTY'. */
export const mbpPermitUrl = (permitNumber: string | number, office: string) =>
  `${MBP_SITE}/PermitDetails/${encodeURIComponent(permitNumber)}/${encodeURIComponent(String(office).toUpperCase())}`;

/**
 * ASP.NET's '/Date(1791874800000)/' as 'YYYY-MM-DD' on the Pacific clock.
 * Most offices stamp midnight, but some (Kirkland) stamp the time of issue —
 * 4:30 PM on Oct 6 is already Oct 7 in UTC, so the day is read in Pacific time.
 */
export function mbpDay(value: unknown) {
  const m = String(value ?? '').match(/\/Date\((-?\d+)/);
  if (m) return pacificNow(new Date(Number(m[1]))).day;
  return dayOf(value);
}

/**
 * One MyBuildingPermit office's rules.
 *
 *   id, label, long, county, jurisId   who it is (jurisId: the search's own number)
 *   office      how its detail links name it ('KING COUNTY', 'BURIEN')
 *   city        the city every permit is in ('' for the county: read from the parcel)
 *   types       [[type, category]] — exact result types that are leads
 *   skipped     [type] — building types deliberately not leads
 *   building    which result types count as building work at all, so a new
 *               one nobody has sorted is reported (see isUnsorted)
 *   normalize   tidies a result type before comparing (the county's '/NA' tails)
 */
export function mbpRule({ id, label, long, county, jurisId, office, city = '', types, skipped = [], building, normalize = (t: unknown) => t, ...rest }: Loose) {
  const TYPES = typeMap(types.map(([t, c]: [string, string]) => [normalize(t), c]));
  const SKIPPED = typeSet(skipped.map(normalize));
  const categoryFor = (type: string) => TYPES.get(key(normalize(type))) || null;
  const rule = {
    id,
    label,
    long,
    contactsNote: 'Contractor (with their WA license number) and applicant names; phone from the state’s contractor registry',
    issuer: `${long} permit`,
    county,
    jurisId,
    office,
    city,
    siteLabel: 'Open on MyBuildingPermit',
    checkHow: 'a second read of MyBuildingPermit, a day at a time',
    detailConcurrency: 2,
    // A lead's people and parcel are read again once they're a week old, not every morning.
    detailsFreshDays: 7,
    typeOf: (row: Loose) => [row.PermitType],
    categoryFor,
    isUnsorted: (type: string) => !categoryFor(type) && building.test(cleanText(type)) && !SKIPPED.has(key(normalize(type))),
    typeLabel: (type: string) => cleanText(type),
    issuedDayOf: (row: Loose) => mbpDay(row.IssuedDate),
    numberOf: (row: Loose) => cleanText(row.PermitNumber),
    detailIdOf: (row: Loose) => cleanText(row.PermitNumber),
    toPermit: (row: Loose, detail: Loose) => mbpPermit(rule, row, detail),
    emptyError: (since: string) => `MyBuildingPermit had no ${long} permits issued since ${since} — its copy of the office’s permits may have stopped updating`,
    detailsError: (n: unknown) => `MyBuildingPermit wouldn’t open any of the ${n} ${label} permits’ details`,
    ...rest
  };
  return rule;
}

/**
 * A permit from one search row and (when read) its detail: { people, parcel,
 * projectName, place }. `place` is the parcel's postal city and ZIP, for the
 * county's permits (a city's permits are all in that city).
 */
export function mbpPermit(rule: Loose, row: Loose, detail: Loose | null = null) {
  const people = detail ? (detail.people || []).map((p: Loose) => ({
    role: cleanText(p.Type),
    company: cleanText(p.Name),
    license: p.ContractorLicNum
  })) : null;
  const description = htmlText(row.PermitDescription);
  return {
    source: rule.id,
    permitNumber: cleanText(row.PermitNumber),
    externalId: '',
    category: rule.categoryFor(row.PermitType),
    type: cleanText(row.PermitType),
    subtype: '',
    status: cleanText(row.PermitStatus),
    appliedOn: mbpDay(row.AppliedDate),
    issuedOn: mbpDay(row.IssuedDate),
    finaledOn: mbpDay(row.FinaledDate),
    expiresOn: null,
    address: cleanText(row.Address),
    city: rule.city || (detail ? cleanText(detail.place?.city) : undefined),
    zip: detail ? cleanText(detail.place?.zip) : undefined,
    parcel: detail ? cleanText(detail.parcel) : undefined,
    projectName: detail ? cleanText(detail.projectName) : undefined,
    description,
    valuation: undefined,
    sqft: undefined,
    units: undefined,
    contacts: people ? tidyContacts(people) : undefined,
    sourceUrl: mbpPermitUrl(row.PermitNumber, rule.office),
    finalOnly: false
  };
}
