/**
 * King County (unincorporated areas) — read through MyBuildingPermit, where
 * the county's Accela permits are published (office 20). Checked monthly
 * against the county's own "Issued Permits" spreadsheet (Department of Local
 * Services, posted around the 1st), which also fills in each permit's job
 * value, dwelling units and site city once it's out.
 * Reader: src/permits/sources/mbp.js; report: src/permits/kingCountyReport.js.
 */
import { cleanText, dayOf, money, count, monthBounds, tidyContacts } from '../common.js';
import { mbpRule } from './mbp.js';

/** 'Building/Residential Building/Dwelling-Single/NA' → 'Building/Residential Building/Dwelling-Single'. */
export const kingType = (type) => cleanText(type).replace(/(\s*\/\s*NA?)+$/i, '').replace(/\s*\/\s*/g, '/');

const kingCounty = mbpRule({
  id: 'king_county',
  label: 'King County',
  long: 'King County (outside city limits)',
  county: 'king',
  kind: 'county',
  jurisId: 20,
  office: 'KING COUNTY',
  normalize: kingType,
  types: [
    ['Building/Residential Building/Dwelling-Single', 'new_home'],
    ['Building/Residential Building/Dwelling-Modular', 'new_home'],
    ['Building/Residential Building/Dwelling-ADU', 'adu'],
    // The county files additions and remodels as one type.
    ['Building/Residential Building/Addition-Improvement', 'remodel'],
    // A house built to a plan registered with the county — new or not isn't said.
    ['Building/Residential Building/Basic', 'building_other'],
    ['Building/Dwelling Units/Multiple', 'multifamily'],
    ['Building/New Commercial Construction/Mixed', 'commercial_new'],
    ['Building/New Commercial Construction/Partial', 'commercial_new'],
    ['Building/New Commercial Construction/Undeveloped', 'commercial_new'],
    ['Building/School Construction/New', 'commercial_new'],
    ['Building/Addition-Improvement/Tenant', 'commercial_remodel'],
    ['Building/Addition-Improvement/MF-Commercial', 'commercial_remodel'],
    ['Building/Addition-Improvement/Change Use', 'commercial_remodel'],
    ['Building/Addition-Improvement/Change-Use', 'commercial_remodel'],
    ['Building/School Construction/Addition-Modification', 'commercial_remodel'],
    ['Building/School Construction/Interior', 'commercial_remodel']
  ],
  skipped: [
    'Building/Residential Building/Dwelling-Mobile',
    'Building/School Construction/Portable',
    'Building/Residential Site',
    'Building/Established Register Plan',
    'Building/Medical Hardship/Mobile Home',
    'Building/Temporary Use',
    'Building/Commercial Site Development'
  ],
  // Building work, less the families that never are leads (trades, inspections, records, signs…).
  building: /^Building\/(?!Mechanical|Demolition|Electrical|Inspection|Signage|Non-Building|Record|Agricultural|Historical|Building Record)/i,
  checkHow: 'a second read of MyBuildingPermit (the county’s report replaces it once the month is over)',
  // Permits added from the county's report (MyBuildingPermit didn't have them) link nowhere; this finds them.
  lookup: {
    url: 'https://aca-prod.accela.com/kingco/Cap/CapHome.aspx?module=Building&TabName=Building',
    label: 'Look it up on King County’s permit site',
    note: 'Search by this permit number — no account needed.'
  }
});

export default kingCounty;

// ── The county's monthly "Issued Permits" spreadsheet ─────────────────────

export const KING_REPORTS_PAGE = 'https://kingcounty.gov/en/dept/local-services/certificates-permits-licenses/permits/permits-inspections-codes-buildings-land-use/permit-forms-application-materials/reports';

/** The report links on the county's page: 'YYYY-MM' and the link, newest month first (one per month). */
export function parseKingReports(html, pageUrl = KING_REPORTS_PAGE) {
  const out = new Map();
  for (const m of String(html).matchAll(/href="([^"]*issued-permits-(\d{4})-(\d{2})\.xlsx?[^"]*)"/gi)) {
    const month = `${m[2]}-${m[3]}`;
    if (!out.has(month)) out.set(month, { month, title: `King County issued permits, ${month}`, url: new URL(m[1].replace(/&amp;/g, '&'), pageUrl).toString() });
  }
  return [...out.values()].sort((a, b) => b.month.localeCompare(a.month));
}

const HEADERS = {
  number: 'PERMIT NBR',
  type: 'PERMIT TYPE',
  project: 'PROJECT NAME',
  description: 'DETAIL DESCRIPTION',
  applied: 'INTAKE COMPLETE DT',
  status: 'RECORD STATUS',
  applicant: 'APPLICANT NAME & ADDRESS',
  owner: 'OWNER NAME & ADDRESS',
  issued: 'ISSUED DATE',
  value: 'JOB VALUE',
  parcel: 'PARCEL',
  address: 'PRIMARY ADDRESS',
  units: 'DWEL UNITS'
};

/**
 * The report's rows from the spreadsheet as a grid (arrays of cells, as the
 * xlsx reader gives them). The column titles sit a few rows down under the
 * report's heading; they're found by name, so a moved column still reads.
 * Fails when the titles aren't there — the county changed its report.
 */
export function kingReportRows(grid) {
  const at = (grid || []).findIndex((r) => (r || []).some((c) => cleanText(c).toUpperCase() === HEADERS.number));
  if (at < 0) throw new Error('The county’s report has no “PERMIT NBR” column — its layout may have changed');
  const titles = grid[at].map((c) => cleanText(c).toUpperCase());
  const col = Object.fromEntries(Object.entries(HEADERS).map(([k, title]) => [k, titles.indexOf(title)]));
  for (const k of ['number', 'type', 'issued']) {
    if (col[k] < 0) throw new Error(`The county’s report has no “${HEADERS[k]}” column — its layout may have changed`);
  }
  const cell = (r, k) => (col[k] < 0 ? null : r[col[k]]);
  return grid.slice(at + 1)
    .filter((r) => cleanText(cell(r || [], 'number')))
    .map((r) => {
      const address = cleanText(cell(r, 'address'));
      // '10121 420TH AVE SE, NORTH BEND, WA 98045'
      const parts = address.split(',').map(cleanText);
      const zip = (parts[parts.length - 1] || '').match(/\b(\d{5})(?:-\d{4})?$/)?.[1] || '';
      return {
        number: cleanText(cell(r, 'number')),
        type: cleanText(cell(r, 'type')),
        project: cleanText(cell(r, 'project')),
        description: cleanText(cell(r, 'description')),
        status: cleanText(cell(r, 'status')),
        appliedOn: dayOf(cell(r, 'applied')),
        applicant: String(cell(r, 'applicant') ?? '').trim(),
        owner: String(cell(r, 'owner') ?? '').trim(),
        address,
        issuedOn: dayOf(cell(r, 'issued')),
        valuation: money(cell(r, 'value')),
        parcel: cleanText(cell(r, 'parcel')),
        city: parts.length >= 3 ? titleCase(parts[parts.length - 2]) : '',
        zip,
        units: count(cell(r, 'units'))
      };
    });
}

/**
 * 'Faruk Behluli, 10121 420th Ave Se\nNorth Bend, WA 98045' or 'Renee & Brian
 * Sonnichsen 10321 428TH AVE SE NORTH BEND WA 98045' → the name and the
 * address, both as the report wrote them.
 */
export function splitNameAddress(text) {
  const s = String(text ?? '').replace(/\r/g, '').trim();
  if (!s) return { name: '', address: '' };
  const comma = s.search(/[,\n]/);
  if (comma > 0 && !/^\d/.test(s)) return { name: cleanText(s.slice(0, comma)), address: cleanText(s.slice(comma + 1).replace(/\n/g, ', ')) };
  const m = s.match(/^(.*?\D)\s+(\d+\s.*)$/s);
  return m ? { name: cleanText(m[1]), address: cleanText(m[2]) } : { name: cleanText(s), address: '' };
}

/**
 * A permit from a report row, for a lead the report has and the pull didn't
 * (MyBuildingPermit lacks a few of the county's permits — checked 2026-10-14).
 * Everything is the report's own: type, address, value, applicant and owner.
 */
export function kingReportPermit(row) {
  const applicant = splitNameAddress(row.applicant);
  const owner = splitNameAddress(row.owner);
  const street = cleanText(String(row.address || '').split(',')[0]);
  return {
    source: 'king_county',
    permitNumber: row.number,
    externalId: '',
    category: kingCounty.categoryFor(row.type),
    type: kingType(row.type),
    subtype: '',
    status: row.status || '',
    appliedOn: row.appliedOn || null,
    issuedOn: row.issuedOn,
    finaledOn: null,
    expiresOn: null,
    address: street,
    city: row.city || '',
    zip: row.zip || '',
    parcel: row.parcel || '',
    projectName: row.project || '',
    description: row.description || '',
    valuation: row.valuation ?? null,
    sqft: null,
    units: row.units ?? null,
    contacts: tidyContacts([
      { role: 'Owner', name: owner.name, address: owner.address },
      { role: 'Applicant', name: applicant.name, address: applicant.address }
    ]),
    sourceUrl: '',
    finalOnly: false
  };
}

export const titleCase = (s) => cleanText(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * One month of the county's report against the app, permit by permit.
 *
 *   rows        the report's rows (kingReportRows)
 *   appInMonth  county permits the app holds with an issue date in the month
 *   appHas      every report permit number the app holds, whatever its date
 *
 * A report row is a lead when its type is one (the same rules as the pull).
 * Leads the app lacks are `missingFromApp`; leads the app filed under the
 * month that the report doesn't list at all are `notInReport`; a report lead
 * the app holds under another date is `datesMoved` (fine — the county moved it).
 */
export function reconcileKingReport({ month, rows, appInMonth, appHas }) {
  const { from, to } = monthBounds(month);
  const numbers = new Set(rows.map((r) => r.number));
  const has = new Set(appHas);
  const leads = rows.filter((r) => kingCounty.categoryFor(r.type));
  const missingFromApp = [...new Set(leads.filter((r) => !has.has(r.number)).map((r) => r.number))].sort();
  const datesMoved = leads.filter((r) => has.has(r.number) && (!r.issuedOn || r.issuedOn < from || r.issuedOn > to)).map((r) => r.number).sort();
  const notInReport = [...new Set(appInMonth)].filter((n) => !numbers.has(n)).sort();
  const leadCount = new Set(leads.map((r) => r.number)).size;
  return {
    inReport: numbers.size,
    leadsInReport: leadCount,
    matched: leadCount - missingFromApp.length,
    missingFromApp,
    notInReport,
    datesMoved,
    ok: !missingFromApp.length && !notInReport.length
  };
}

/**
 * What the report adds to a permit the app already holds: the job value,
 * dwelling units, project name and the site's city / ZIP — only where the
 * app's copy is empty, so nothing the pull read is overwritten.
 */
export function kingReportFill(row, permit) {
  const fill = {};
  if (row.valuation && !permit.valuation) fill.valuation = row.valuation;
  if (row.units && !permit.units) fill.units = row.units;
  if (row.project && !permit.projectName) fill.projectName = row.project;
  if (row.city && !permit.city) fill.city = row.city;
  if (row.zip && !permit.zip) fill.zip = row.zip;
  if (row.parcel && !permit.parcel) fill.parcel = row.parcel;
  return fill;
}
