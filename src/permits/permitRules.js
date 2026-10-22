/**
 * Permits (2026-10-11; King County 2026-10-14): building permits pulled each
 * morning from the offices that issue them, for sales leads. One file per
 * source in src/permits/rules/ says who it is, which county it's in, which of
 * its exact type names are leads and how its records read; this file puts
 * them together. Adding an office = a rules file + a reader + tests, listed
 * in RULES below — nothing else in the pull, API or screen changes.
 *
 *   King County     King County (outside cities, via MyBuildingPermit),
 *                   Seattle (open data), Bellevue (its own feed), Renton
 *                   (EnerGov), Shoreline (eTRAKiT), and Auburn, Burien,
 *                   Issaquah, Kenmore, Kirkland, Mercer Island, Sammamish and
 *                   Snoqualmie via MyBuildingPermit
 *   Snohomish County  Snohomish County (outside cities, from the county's monthly
 *                   spreadsheets of issued permits), Edmonds via MyBuildingPermit,
 *                   Marysville (eTRAKiT)
 *   Whatcom County  Whatcom County (outside cities, EnerGov), Bellingham
 *
 * Accuracy rules: every figure is the source's own value, copied, never
 * guessed. Which permits count is decided by the source's exact type names,
 * never by the source's search filters (Whatcom's are silently ignored), and
 * an office that only publishes a broad type files it as Other building
 * rather than guessing from the description. A building type nobody has
 * sorted yet is reported, not dropped without a word — see
 * `isUnsortedBuildingType`.
 *
 * Pure: shared by the server (src/permits/) and the Permits screen.
 */
import { cleanText } from './common.js';
import { COUNTIES, countyLabel } from './places.js';
import whatcom, { WHATCOM_PORTAL, whatcomPermitUrl, energovPermit } from './rules/whatcom.js';
import skagitCounty from './rules/skagitCounty.js';
import anacortes from './rules/anacortes.js';
import snohomishCounty from './rules/snohomishCounty.js';
import { edmonds } from './rules/snohomishCities.js';
import marysville from './rules/marysville.js';
import snohomishCity from './rules/snohomishCity.js';
import monroe from './rules/monroe.js';
import bellingham, { BELLINGHAM_PERMIT_SEARCH, BELLINGHAM_LAYER, BELLINGHAM_FIELDS, BELLINGHAM_PERMIT_TYPES, bellinghamPermit } from './rules/bellingham.js';
import seattle from './rules/seattle.js';
import kingCounty from './rules/kingCounty.js';
import bellevue from './rules/bellevue.js';
import renton from './rules/renton.js';
import shoreline from './rules/shoreline.js';
import { auburn, burien, issaquah, kenmore, kirkland, mercerIsland, sammamish, snoqualmie } from './rules/mbpCities.js';

export * from './common.js';
export { WHATCOM_PORTAL, whatcomPermitUrl, BELLINGHAM_PERMIT_SEARCH, BELLINGHAM_LAYER, BELLINGHAM_FIELDS, BELLINGHAM_PERMIT_TYPES, bellinghamPermit };

/**
 * Every source, in the order lists show them: by county, the county's own
 * office first, then its cities A–Z.
 */
export const RULES = Object.freeze(Object.fromEntries([
  kingCounty, auburn, bellevue, burien, issaquah, kenmore, kirkland, mercerIsland, renton, sammamish, seattle, shoreline, snoqualmie,
  skagitCounty, anacortes,
  snohomishCounty, edmonds, marysville, monroe, snohomishCity,
  whatcom, bellingham
].map((r) => [r.id, r])));

/** What the screen and API show about each source (no functions — safe to send as JSON). */
export const SOURCES = Object.freeze(Object.fromEntries(Object.values(RULES).map((r) => [r.id, Object.freeze({
  id: r.id,
  label: r.label,
  long: r.long,
  contactsNote: r.contactsNote,
  issuer: r.issuer,
  county: r.county,
  countyLabel: countyLabel(r.county),
  // The county's own office, or a city's.
  kind: r.kind === 'county' ? 'county' : 'city',
  // Whether each lead's contacts are read one by one (so may not be loaded yet).
  readsDetails: Boolean(r.detailIdOf),
  phones: Boolean(r.phones),
  siteLabel: r.siteLabel || '',
  checkHow: r.checkHow || '',
  ...(r.lookup && { lookup: r.lookup })
})])));
export const SOURCE_IDS = Object.freeze(Object.keys(SOURCES));

/** The counties some source covers, in COUNTIES order. */
export const COVERED_COUNTY_IDS = Object.freeze(COUNTIES.map((c) => c.id).filter((id) => SOURCE_IDS.some((s) => SOURCES[s].county === id)));

/** The sources in the given counties (all of them for none). */
export const sourcesInCounties = (countyIds = []) => (countyIds.length
  ? SOURCE_IDS.filter((id) => countyIds.includes(SOURCES[id].county))
  : [...SOURCE_IDS]);

/** The lead category for a permit's type, or null when it isn't a lead. */
export function categoryFor(source, type, subtype = '') {
  return RULES[source]?.categoryFor(type, subtype) || null;
}

/**
 * A building permit type that is neither a lead nor on the skip list — a type
 * the source added since these lists were written. The morning run counts
 * them so an admin hears about it instead of the permits quietly vanishing.
 */
export function isUnsortedBuildingType(source, type, subtype = '') {
  const rule = RULES[source];
  if (!rule || rule.categoryFor(type, subtype)) return false;
  return Boolean(rule.isUnsorted(type, subtype));
}

export const typeLabel = (source, type, subtype = '') => RULES[source]?.typeLabel(type, subtype) ?? String(type || '');

/** A county permit from its search row and (when fetched) its detail record. */
export const whatcomPermit = (row, detail = null) => energovPermit(whatcom, row, detail);

// ── Whatcom County's monthly "Permits Issued" report ──────────────────────

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * 'YYYY-MM' for an archive title like "Permits Issued August 2026" or
 * "Permits Issued Report Sept 2025". Contractor listings, and reports that
 * cover a range of months ("April-June 2025"), are not single-month reports.
 */
export function reportMonthOf(title) {
  const t = cleanText(title);
  if (!/permits?\s+issued/i.test(t) || /contractor/i.test(t)) return null;
  if (/[a-z]+\s*[-–]\s*[a-z]+\s+\d{4}/i.test(t)) return null;
  const m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})\b/i);
  if (!m) return null;
  return `${m[2]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}`;
}

export const PERMIT_NUMBER_RE = /^[A-Z][A-Za-z-]*\d{4}-\d{4,5}$/;

/**
 * Every permit number printed in the report's first column. `items` are the
 * PDF's text pieces with their x position; the permit # column starts at the
 * left margin.
 */
export function reportPermitNumbers(items, { maxX = 60 } = {}) {
  const out = new Set();
  for (const it of items || []) {
    const s = cleanText(it.str);
    if (it.x < maxX && PERMIT_NUMBER_RE.test(s)) out.add(s);
  }
  return [...out].sort();
}

/**
 * The month so far: the lead permits a second, separate search of the source
 * found against the ones the app saved for the same days.
 *
 *   missingFromApp  the second search found it; the app doesn't have it
 *   notFoundAgain   the app has it; the second search didn't find it
 */
export function compareMonthToDate({ found, app }) {
  const f = new Set(found);
  const a = new Set(app);
  const missingFromApp = [...f].filter((n) => !a.has(n)).sort();
  const notFoundAgain = [...a].filter((n) => !f.has(n)).sort();
  return { inSearch: f.size, matched: [...a].filter((n) => f.has(n)).length, missingFromApp, notFoundAgain, ok: !missingFromApp.length && !notFoundAgain.length };
}

/** 'SFR' from 'SFR2026-00212', 'FIRE-CON' from 'FIRE-CON2026-00064' — the county's permit type code. */
export const permitPrefix = (n) => String(n || '').replace(/\d{4}-\d+$/, '');

/**
 * One month of the county's report against the app, permit by permit.
 *
 *   reportNumbers   every permit number printed in the report
 *   searchRows      the county's public search, every permit issued since the
 *                   month began (so a permit re-issued later is still there)
 *   appInMonth      lead permits the app holds with an issue date in the month
 *   appHas          every report permit the app holds, whatever its date now
 *   leadPrefixes    permit-number codes of the lead types (SFR, DET, COM…)
 *
 * Each report permit is one of: not a lead type (fine); a lead the app has
 * (fine — including one whose issue date the county has since moved, listed
 * in `datesMoved`); a lead the app lacks (`missingFromApp`); or not in the
 * county's public search at all — the county hides some types, e.g. fire
 * gate permits. A hidden one with a lead code is `notInCountySearch`, else
 * it's `notPublic`; either way the app can't read it, so it's the county's
 * difference, not the pull's, and doesn't fail the check (2026-10-15: two
 * DET permits in September's report were hidden like this).
 *
 * Every lead the app filed under the month that the report doesn't list is
 * `notInReport` — unless the county's search says it isn't issued yet (an
 * issue date with a status like "Fees Due"): the report lists only issued
 * permits, so that one is `notIssuedYet` and doesn't fail the check either.
 */
/** Whether a county search status means issued: 'Issued', 'Final' (or none given, so it isn't excused). */
const issuedStatus = (status) => !cleanText(status) || /^(issued|final)/i.test(cleanText(status));

export function reconcileReport({ month, reportNumbers, searchRows, appInMonth, appHas, leadPrefixes }) {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  const report = new Set(reportNumbers);
  const search = new Map(searchRows.map((r) => [cleanText(r.CaseNumber), r]));
  const has = new Set(appHas);
  const codes = new Set(leadPrefixes);
  const out = { missingFromApp: [], notInCountySearch: [], datesMoved: [], notPublic: [], leadsInReport: 0 };
  for (const n of [...report].sort()) {
    const row = search.get(n);
    if (row) {
      if (!categoryFor('whatcom', row.CaseType)) continue;
      out.leadsInReport += 1;
      const day = whatcom.issuedDayOf(row);
      if (!day || day < from || day > to) out.datesMoved.push(n);
      if (!has.has(n)) out.missingFromApp.push(n);
    } else if (has.has(n)) {
      out.leadsInReport += 1;
    } else if (codes.has(permitPrefix(n))) {
      out.leadsInReport += 1;
      out.notInCountySearch.push(n);
    } else {
      out.notPublic.push(n);
    }
  }
  const unlisted = [...new Set(appInMonth)].filter((n) => !report.has(n)).sort();
  const notIssuedYet = unlisted.filter((n) => !issuedStatus(search.get(n)?.CaseStatus));
  const notInReport = unlisted.filter((n) => !notIssuedYet.includes(n));
  const matched = out.leadsInReport - out.missingFromApp.length - out.notInCountySearch.length;
  return { inReport: report.size, matched, ...out, notInReport, notIssuedYet, ok: !out.missingFromApp.length && !notInReport.length };
}
