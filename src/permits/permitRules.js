/**
 * Permits (2026-10-11): building permits issued in Whatcom County, pulled each
 * morning from the two offices that issue them, for sales leads.
 *
 *   whatcom     Whatcom County (unincorporated areas) — Tyler EnerGov
 *               self-service, the same search the county's own site runs.
 *               Contacts (GC, owner, applicant) come with phone and email.
 *   bellingham  City of Bellingham — the city's published permit layer on its
 *               ArcGIS server (eTRAKiT needs a login). Contractor, owner and
 *               applicant names only.
 *
 * Accuracy rules: every figure is the source's own value, copied, never
 * guessed. Which permits count is decided here by the source's exact type
 * names, never by the source's search filters (the county's are silently
 * ignored). A building type nobody has sorted yet is reported, not dropped
 * without a word — see `isUnsortedBuildingType`.
 *
 * Pure: shared by the server (src/permits/) and the Permits screen.
 */

export const SOURCES = Object.freeze({
  whatcom: {
    id: 'whatcom',
    label: 'Whatcom County',
    long: 'Whatcom County (outside city limits)',
    contactsNote: 'GC, owner and applicant with phone and email',
    issuer: 'Whatcom County permit'
  },
  bellingham: {
    id: 'bellingham',
    label: 'Bellingham',
    long: 'City of Bellingham',
    contactsNote: 'Contractor, owner and applicant names (the city doesn’t publish phone or email)',
    issuer: 'City of Bellingham permit'
  }
});
export const SOURCE_IDS = Object.freeze(Object.keys(SOURCES));

export const CATEGORIES = Object.freeze([
  { id: 'new_home', label: 'New home' },
  { id: 'adu', label: 'ADU / detached' },
  { id: 'addition', label: 'Addition' },
  { id: 'remodel', label: 'Remodel' },
  { id: 'multifamily', label: 'Multifamily' },
  { id: 'commercial_new', label: 'Commercial new' },
  { id: 'commercial_remodel', label: 'Commercial remodel' }
]);
export const CATEGORY_IDS = Object.freeze(CATEGORIES.map((c) => c.id));
export const categoryLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || '';

// ── Which permits count ───────────────────────────────────────────────────

const key = (...parts) => parts.map((p) => String(p ?? '').trim().replace(/\s+/g, ' ').toUpperCase()).join(' | ');

/** County: EnerGov's CaseType, which already includes the work class. */
const WHATCOM_TYPES = new Map([
  ['Building (Residential) - SFR - New Construction', 'new_home'],
  ['Building (Residential) - SFR - Modular Home/Foundation Only', 'new_home'],
  ['Building (Residential) - Detached - New Construction', 'adu'],
  ['Building (Residential) - SFR - Addition', 'addition'],
  ['Building (Residential) - Detached - Addition', 'addition'],
  ['Building (Residential) - SFR - Alteration, Remodel, Repair', 'remodel'],
  ['Building (Residential) - Detached - Alteration/Remodel/Repair', 'remodel'],
  ['Building (Commercial) - Multi-Family - New', 'multifamily'],
  ['Building (Commercial) - New', 'commercial_new'],
  ['Building (Commercial) - Alteration/Tenant Improvement', 'commercial_remodel'],
  ['Building (Commercial) - Addition', 'commercial_remodel']
].map(([type, category]) => [key(type), category]));

/** County building types that are deliberately not leads. */
const WHATCOM_SKIPPED = new Set([
  'Building - Land Clearing Permit',
  'Building (Residential) - Demolition',
  'Building (Residential) - Window Replacement',
  'Building (Residential) - Re-Roof',
  'Building (Residential) - Re-Side',
  'Building (Residential) - Foundation',
  'Building (Residential) - Relocation',
  'Building (Residential) - Detached - Relocation',
  'Building (Residential) - Detached - Agricultural Building',
  'Building (Commercial) - Eligible Facility Request',
  'Building (Commercial) - Certificate of Occupancy',
  'Building (Commercial) - Complex',
  'Mobile/Manufactured Home Structure - Manufactured Home'
].map((t) => key(t)));

/** Bellingham: PermitType | PermitSubType. */
const BELLINGHAM_TYPES = new Map([
  [['NEW CONSTRUCTION SINGLE FAMILY OR DUPLEX', 'NEW STRUCTURE'], 'new_home'],
  [['NEW CONSTRUCTION TOWNHOME', 'NEW STRUCTURE'], 'new_home'],
  [['NEW CONSTRUCTION SINGLE FAMILY OR DUPLEX', 'ADU'], 'adu'],
  [['EXISTING SINGLE FAMILY OR DUPLEX', 'ADU'], 'adu'],
  [['EXISTING SINGLE FAMILY OR DUPLEX', 'ADDITION'], 'addition'],
  [['BUILDING MULTIFAMILY RESIDENTIAL', 'ADDITION'], 'addition'],
  [['EXISTING SINGLE FAMILY OR DUPLEX', 'INTERIOR REMODEL'], 'remodel'],
  [['BUILDING MULTIFAMILY RESIDENTIAL', 'INTERIOR REMODEL'], 'remodel'],
  [['BUILDING MULTIFAMILY RESIDENTIAL', 'NEW CONSTRUCTION'], 'multifamily'],
  [['BUILDING MIXED USE', 'NEW CONSTRUCTION'], 'multifamily'],
  [['BUILDING NONRESIDENTIAL', 'NEW CONSTRUCTION'], 'commercial_new'],
  [['BUILDING NONRESIDENTIAL', 'TENANT IMPROVEMENT'], 'commercial_remodel'],
  [['BUILDING MIXED USE', 'TENANT IMPROVEMENT'], 'commercial_remodel'],
  [['BUILDING NONRESIDENTIAL', 'ADDITION'], 'commercial_remodel'],
  [['BUILDING MIXED USE', 'ADDITION'], 'commercial_remodel']
].map(([[type, sub], category]) => [key(type, sub), category]));

/** Bellingham building types that are deliberately not leads (repairs are windows, roofs, siding). */
const BELLINGHAM_SKIPPED = new Set([
  ['EXISTING SINGLE FAMILY OR DUPLEX', 'REPAIR'],
  ['EXISTING SINGLE FAMILY OR DUPLEX', 'FOUNDATION ONLY'],
  ['BUILDING MULTIFAMILY RESIDENTIAL', 'REPAIR'],
  ['BUILDING MULTIFAMILY RESIDENTIAL', 'UNDERGROUND STORMWATER FACILITY'],
  ['BUILDING NONRESIDENTIAL', 'REPAIR'],
  ['BUILDING NONRESIDENTIAL', 'UNDERGROUND STORMWATER FACILITY'],
  ['BUILDING MIXED USE', 'REPAIR'],
  ['BUILDING MIXED USE', 'UNDERGROUND STORMWATER FACILITY']
].map(([type, sub]) => key(type, sub)));

/** The Bellingham permit types worth asking the city's server for. */
export const BELLINGHAM_PERMIT_TYPES = Object.freeze([
  'NEW CONSTRUCTION SINGLE FAMILY OR DUPLEX',
  'NEW CONSTRUCTION TOWNHOME',
  'EXISTING SINGLE FAMILY OR DUPLEX',
  'BUILDING MULTIFAMILY RESIDENTIAL',
  'BUILDING MIXED USE',
  'BUILDING NONRESIDENTIAL'
]);

/** The lead category for a permit's type, or null when it isn't a lead. */
export function categoryFor(source, type, subtype = '') {
  if (source === 'whatcom') return WHATCOM_TYPES.get(key(type)) || null;
  if (source === 'bellingham') return BELLINGHAM_TYPES.get(key(type, subtype)) || null;
  return null;
}

/**
 * A building permit type that is neither a lead nor on the skip list — a type
 * the source added since these lists were written. The morning run counts
 * them so an admin hears about it instead of the permits quietly vanishing.
 */
export function isUnsortedBuildingType(source, type, subtype = '') {
  if (categoryFor(source, type, subtype)) return false;
  if (source === 'whatcom') {
    return /^(Building|Mobile\/Manufactured)/i.test(String(type || '').trim()) && !WHATCOM_SKIPPED.has(key(type));
  }
  if (source === 'bellingham') {
    return BELLINGHAM_PERMIT_TYPES.includes(key(type)) && !BELLINGHAM_SKIPPED.has(key(type, subtype));
  }
  return false;
}

export const typeLabel = (source, type, subtype = '') =>
  source === 'bellingham' && subtype ? `${type} · ${subtype}` : String(type || '');

// ── Days ──────────────────────────────────────────────────────────────────

export const PERMIT_ZONE = 'America/Los_Angeles';
/** The first pull goes back six months. */
export const BACKFILL_DAYS = 183;
/** Each morning re-reads the last 30 days, so late status changes and added contractors land. */
export const DAILY_LOOKBACK_DAYS = 30;
/** The morning run starts at 5:00 AM Pacific; a server asleep then runs as soon as it wakes. */
export const RUN_AT_MINUTES = 5 * 60;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (s) => typeof s === 'string' && DAY_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/**
 * 'YYYY-MM-DD' from a source's date. EnerGov sends local wall-clock strings
 * ('2026-10-09T00:00:00'); ArcGIS sends epoch milliseconds at UTC midnight of
 * the day. Either way the calendar day is the source's own, with no time-zone
 * shift.
 */
export function dayOf(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return new Date(value).toISOString().slice(0, 10);
  }
  const s = String(value).trim().slice(0, 10);
  return isDay(s) ? s : null;
}

export function shiftDay(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today's date and minutes past midnight on the Pacific clock. */
export function pacificNow(at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: PERMIT_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(at).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}

/**
 * Whether the morning run is due: it's 5:00 AM Pacific or later and today
 * hasn't had a successful run yet (a failed one tries again on the next tick
 * — see the scheduler's retry gap).
 */
export function isDailyRunDue(lastSuccessDay, at = new Date()) {
  const { day, minutes } = pacificNow(at);
  return minutes >= RUN_AT_MINUTES && lastSuccessDay !== day;
}

/** How far back a run reads: six months on the first run, else the last 30 days. */
export function runSince(hasFullBackfill, at = new Date()) {
  const { day } = pacificNow(at);
  return shiftDay(day, -(hasFullBackfill ? DAILY_LOOKBACK_DAYS : BACKFILL_DAYS));
}

// ── Text, phones, contacts ────────────────────────────────────────────────

export const cleanText = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** The last ten digits — how two spellings of one US number are compared. */
export function phoneKey(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

export function formatPhone(phone) {
  const k = phoneKey(phone);
  return k ? `(${k.slice(0, 3)}) ${k.slice(3, 6)}-${k.slice(6)}` : cleanText(phone);
}

export const emailKey = (email) => {
  const e = cleanText(email).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
};

/** Company names compared without case, punctuation or a trailing LLC / Inc. */
export function nameKey(name) {
  return cleanText(name).toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\b(LLC|L L C|INC|INCORPORATED|CO|CORP|CORPORATION|LTD|COMPANY|THE)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Contractor first, then owner, applicant, everyone else. */
export const CONTACT_ORDER = ['contractor', 'owner', 'applicant', 'other'];

export function contactKind(role) {
  const r = String(role || '').toLowerCase();
  if (r.includes('contractor')) return 'contractor';
  if (r.includes('owner')) return 'owner';
  if (r.includes('applicant')) return 'applicant';
  return 'other';
}

/** "TBD" and owner-builder exemptions are what the source says, but nobody to call. */
export function isPlaceholderName(name) {
  const n = cleanText(name).toUpperCase();
  return !n || n === 'TBD' || n === 'N/A' || n === 'NONE' || /OWNER AS CONTR/.test(n);
}

/** Drops exact repeats (the county lists some GCs twice) and sorts by kind. */
export function tidyContacts(contacts) {
  const seen = new Set();
  const out = [];
  for (const c of contacts || []) {
    const contact = {
      role: cleanText(c.role),
      kind: contactKind(c.role),
      company: cleanText(c.company),
      name: cleanText(c.name),
      phone: cleanText(c.phone),
      email: cleanText(c.email).toLowerCase(),
      address: cleanText(c.address)
    };
    if (!contact.company && !contact.name) continue;
    const k = [contact.kind, nameKey(contact.company), nameKey(contact.name), phoneKey(contact.phone), contact.email].join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(contact);
  }
  return out.sort((a, b) => CONTACT_ORDER.indexOf(a.kind) - CONTACT_ORDER.indexOf(b.kind));
}

/** Bellingham re-issues some old permits only to sign them off; there's no new work in them. */
export const isFinalOnly = (description) => /^\s*FINAL[\s-]*ONLY\b/i.test(String(description || ''));

const money = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null);

// ── Source records → permits ──────────────────────────────────────────────

export const WHATCOM_PORTAL = 'https://whatcomcountywa-energovweb.tylerhost.net/apps/selfservice';
export const whatcomPermitUrl = (caseId) => `${WHATCOM_PORTAL}#/permit/${encodeURIComponent(caseId)}`;

/**
 * A county permit from its search row and (when fetched) its detail record.
 * The detail adds valuation, square feet, the full description and contacts.
 */
export function whatcomPermit(row, detail = null) {
  const a = row.Address || {};
  const contacts = detail ? (detail.Contacts || []).map((c) => ({
    role: c.ContactTypeName,
    company: c.GlobalEntityName,
    name: [c.FirstName, c.LastName].map(cleanText).filter(Boolean).join(' '),
    phone: c.Phone,
    email: c.EmailTo,
    address: c.MainAddress
  })) : null;
  return {
    source: 'whatcom',
    permitNumber: cleanText(row.CaseNumber),
    externalId: cleanText(row.CaseId),
    category: categoryFor('whatcom', row.CaseType),
    type: cleanText(row.CaseType),
    subtype: cleanText(row.CaseWorkclass),
    status: cleanText(row.CaseStatus),
    appliedOn: dayOf(row.ApplyDate),
    issuedOn: dayOf(row.IssueDate),
    finaledOn: dayOf(row.FinalDate),
    expiresOn: dayOf(row.ExpireDate),
    address: cleanText([a.AddressLine1, a.PreDirection, a.AddressLine2, a.StreetTypeName, a.PostDirection, a.UnitOrSuite && `#${a.UnitOrSuite}`].filter(Boolean).join(' ')) || cleanText(row.AddressDisplay),
    city: cleanText(a.City),
    zip: cleanText(a.PostalCode),
    parcel: cleanText(row.MainParcel),
    projectName: cleanText(row.ProjectName),
    description: cleanText(detail?.Description || row.Description),
    valuation: detail ? money(detail.ValuationValue) : undefined,
    sqft: detail ? count(detail.SquareFeet) : undefined,
    units: undefined,
    contacts: contacts ? tidyContacts(contacts) : undefined,
    sourceUrl: row.CaseId ? whatcomPermitUrl(row.CaseId) : '',
    finalOnly: false
  };
}

/**
 * The city's own permit search (eTRAKiT). It needs a free city login
 * (anyone can register), and the login doesn't carry a permit number
 * through, so this opens the search, not the permit itself.
 */
export const BELLINGHAM_PERMIT_SEARCH = 'https://permits.cob.org/etrakit/Search/permit.aspx';

export const BELLINGHAM_LAYER = 'https://maps.cob.org/arcgis3/rest/services/Maps/Permits/MapServer/0';
export const BELLINGHAM_FIELDS = Object.freeze([
  'OBJECTID', 'PERMIT_NO', 'PermitType', 'PermitSubType', 'STATUS', 'APPLIED', 'ISSUED', 'FINALED', 'EXPIRED',
  'SITE_ADDR', 'SITE_APN', 'DESCRIPTION', 'JOBVALUE', 'OWNER_NAME', 'APPLICANT_NAME', 'CONTRACTOR_NAME',
  'TOTAL_FLOOR_AREA', 'NEW_FLOOR_AREA', 'NUM_NEW_UNITS', 'NEW_DWELL_UNITS', 'PARENT_PROJECT_NO'
]);

/** A Bellingham permit from one feature's attributes. */
export function bellinghamPermit(attrs) {
  const contacts = [
    { role: 'Contractor', company: attrs.CONTRACTOR_NAME },
    { role: 'Owner', company: attrs.OWNER_NAME },
    { role: 'Applicant', company: attrs.APPLICANT_NAME }
  ];
  const description = cleanText(attrs.DESCRIPTION);
  return {
    source: 'bellingham',
    permitNumber: cleanText(attrs.PERMIT_NO),
    externalId: attrs.OBJECTID === null || attrs.OBJECTID === undefined ? '' : String(attrs.OBJECTID),
    category: categoryFor('bellingham', attrs.PermitType, attrs.PermitSubType),
    type: cleanText(attrs.PermitType),
    subtype: cleanText(attrs.PermitSubType),
    status: cleanText(attrs.STATUS),
    appliedOn: dayOf(attrs.APPLIED),
    issuedOn: dayOf(attrs.ISSUED),
    finaledOn: dayOf(attrs.FINALED),
    expiresOn: dayOf(attrs.EXPIRED),
    address: cleanText(attrs.SITE_ADDR),
    city: 'Bellingham',
    zip: '',
    parcel: cleanText(attrs.SITE_APN),
    projectName: cleanText(attrs.PARENT_PROJECT_NO),
    description,
    valuation: money(attrs.JOBVALUE),
    sqft: count(attrs.NEW_FLOOR_AREA) || count(attrs.TOTAL_FLOOR_AREA),
    units: count(attrs.NUM_NEW_UNITS) || count(attrs.NEW_DWELL_UNITS),
    contacts: tidyContacts(contacts),
    sourceUrl: '',
    finalOnly: isFinalOnly(description)
  };
}

// ── The county's monthly "Permits Issued" report ──────────────────────────

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
 * gate permits — which counts as missing only if its code is a lead code
 * (`notInCountySearch`), else it's listed in `notPublic`. And every lead the
 * app filed under the month that the report doesn't list is `notInReport`.
 */
export function reconcileReport({ month, reportNumbers, searchRows, appInMonth, appHas, leadPrefixes }) {
  const { from, to } = monthBounds(month);
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
      const day = dayOf(row.IssueDate);
      if (!day || day < from || day > to) out.datesMoved.push(n);
      if (!has.has(n)) out.missingFromApp.push(n);
    } else if (has.has(n)) {
      out.leadsInReport += 1;
    } else if (codes.has(permitPrefix(n))) {
      out.leadsInReport += 1;
      out.missingFromApp.push(n);
      out.notInCountySearch.push(n);
    } else {
      out.notPublic.push(n);
    }
  }
  const notInReport = [...new Set(appInMonth)].filter((n) => !report.has(n)).sort();
  const matched = out.leadsInReport - out.missingFromApp.length;
  return { inReport: report.size, matched, ...out, notInReport, ok: !out.missingFromApp.length && !notInReport.length };
}

/** Every whole month ('YYYY-MM') that starts on or after `sinceDay` and ends before `beforeMonth`. */
export function fullMonthsBetween(sinceDay, beforeMonth) {
  const out = [];
  let [y, m] = sinceDay.slice(0, 7).split('-').map(Number);
  if (sinceDay.slice(8) !== '01') m += 1;
  for (;;) {
    if (m > 12) { y += 1; m = 1; }
    const month = `${y}-${String(m).padStart(2, '0')}`;
    if (month >= beforeMonth) return out;
    out.push(month);
    m += 1;
  }
}

export const monthBounds = (month) => {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
};
