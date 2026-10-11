/**
 * The Permits screen's rules (src/components/sales/permits/): date ranges,
 * how each source's freshness and the county report check read, which
 * contact a row leads with, and the Excel rows. Pure, with tests beside it.
 */
import { SOURCES, categoryLabel, formatPhone, isPlaceholderName, shiftDay, pacificNow } from '../permits/permitRules';

export const DATE_RANGES = Object.freeze([
  { id: '7', label: 'Last 7 days', days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
  { id: '183', label: 'Last 6 months', days: 183 }
]);
export const DEFAULT_RANGE = '30';

/** The list's orders (the server's SORTS in src/permits/router.js). */
export const SORT_OPTIONS = Object.freeze([
  { id: 'issued_desc', label: 'Newest first' },
  { id: 'issued_asc', label: 'Oldest first' },
  { id: 'value_desc', label: 'Highest value' },
  { id: 'value_asc', label: 'Lowest value' }
]);
export const DEFAULT_SORT = 'issued_desc';

/** Clicking a column: highest / newest first, then the other way on the next click. */
export function nextSort(current, column) {
  return current === `${column}_desc` ? `${column}_asc` : `${column}_desc`;
}

/** 'descending' / 'ascending' / 'none' for a column header's aria-sort. */
export function ariaSort(current, column) {
  if (current === `${column}_desc`) return 'descending';
  if (current === `${column}_asc`) return 'ascending';
  return 'none';
}

/** The first issue date a range includes, on the Pacific calendar. */
export function rangeFrom(rangeId, at = new Date()) {
  const r = DATE_RANGES.find((d) => d.id === rangeId) || DATE_RANGES.find((d) => d.id === DEFAULT_RANGE);
  return shiftDay(pacificNow(at).day, -(r.days - 1));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 'Oct 9, 2026' from 'YYYY-MM-DD'. */
export function formatDay(day) {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** 'August 2026' from 'YYYY-MM'. */
export function formatMonth(month) {
  const [y, m] = String(month || '').split('-').map(Number);
  return m ? `${LONG_MONTHS[m - 1]} ${y}` : '';
}

export function formatMoney(value) {
  if (value === null || value === undefined) return '';
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

export const formatCount = (n) => (n ? n.toLocaleString('en-US') : '');

/** '2,808 sq ft · 3 units' — whichever the source gave. */
export function sizeLine(p) {
  return [p.sqft ? `${formatCount(p.sqft)} sq ft` : '', p.units ? `${formatCount(p.units)} unit${p.units === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
}

/** When something happened, in Pacific time: 'today 5:04 AM', 'yesterday 5:02 AM', 'Oct 8, 5:03 AM'. */
export function whenLine(at, now = new Date()) {
  if (!at) return '';
  const date = new Date(at);
  const time = date.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
  const day = pacificNow(date).day;
  const today = pacificNow(now).day;
  if (day === today) return `today ${time}`;
  if (day === shiftDay(today, -1)) return `yesterday ${time}`;
  const [, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${time}`;
}

const STALE_HOURS = 30;

/**
 * One source's status line and tone. `ok`: pulled within the last day and a
 * bit; `warn`: the last pull failed or is old, so what's shown may be behind;
 * `none`: never pulled.
 */
export function sourceStatus(source, now = new Date()) {
  const { lastRun, lastOk } = source;
  if (!lastRun) return { tone: 'none', text: `${source.label}: first pull hasn’t run yet` };
  if (!lastRun.finishedAt) return { tone: 'busy', text: `${source.label}: pulling now…` };
  const through = lastOk?.latestIssuedOn ? ` · its data runs to ${formatDay(lastOk.latestIssuedOn)}` : '';
  if (!lastRun.ok) {
    const kept = lastOk ? ` Showing what was saved ${whenLine(lastOk.finishedAt, now)}.` : ' Nothing has been saved from it yet.';
    return { tone: 'warn', text: `${source.label}: the last pull failed ${whenLine(lastRun.finishedAt, now)} — ${lastRun.error || 'no reason given'}.${kept}`, through };
  }
  const hours = (now - new Date(lastRun.finishedAt)) / 3600000;
  if (hours > STALE_HOURS) return { tone: 'warn', text: `${source.label}: last updated ${whenLine(lastRun.finishedAt, now)} — the morning pull hasn’t run since`, through };
  const partial = lastRun.detailErrors ? ` (${lastRun.detailErrors} permit${lastRun.detailErrors === 1 ? '' : 's'} without contacts this time)` : '';
  return { tone: lastRun.detailErrors ? 'warn' : 'ok', text: `${source.label}: updated ${whenLine(lastRun.finishedAt, now)}${partial}`, through };
}

/**
 * The checks shown on top: each source's month so far, then the newest
 * county report check. Everything else goes under Details.
 */
export function splitChecks(checks, at = new Date()) {
  const month = pacificNow(at).day.slice(0, 7);
  const current = checks.filter((c) => c.method === 'search' && c.month === month)
    .sort((a, b) => Object.keys(SOURCES).indexOf(a.source) - Object.keys(SOURCES).indexOf(b.source));
  const report = checks.filter((c) => c.method !== 'search').sort((a, b) => b.month.localeCompare(a.month))[0];
  const top = report ? [...current, report] : current;
  return { top, rest: checks.filter((c) => !top.includes(c)) };
}

/** A month's accuracy check, as one line and a tone. */
export function checkStatus(check) {
  if (check.method === 'search') {
    const who = SOURCES[check.source]?.label || check.source;
    const how = check.source === 'bellingham' ? 'a separate query of the city’s data' : 'a separate county search by permit number';
    const label = `Accuracy check, ${formatMonth(check.month)} so far (${who})`;
    if (check.error) return { tone: 'warn', text: `${label}: couldn’t run — ${check.error}` };
    if (check.ok) return { tone: 'ok', text: `${label}: all ${check.matched} lead permit${check.matched === 1 ? '' : 's'} found again by ${how}` };
    const n = (check.missingFromApp || []).length + (check.notFoundAgain || []).length;
    return { tone: 'warn', text: `${label}: ${n} permit${n === 1 ? '' : 's'} differ from ${how}` };
  }
  const month = `Accuracy check, ${formatMonth(check.month)}`;
  if (check.error) return { tone: 'warn', text: `${month}: couldn’t check against the county’s report — ${check.error}` };
  if (check.ok) return { tone: 'ok', text: `${month}: matches the county’s report — all ${check.matched} lead permit${check.matched === 1 ? '' : 's'} accounted for` };
  const n = check.missingFromApp.length + check.notInReport.length + (check.notInCountySearch || []).length;
  return { tone: 'warn', text: `${month}: ${n} permit${n === 1 ? '' : 's'} differ from the county’s report` };
}

/** The contact a row leads with: the contractor, unless it's TBD or the owner building it themselves. */
export function leadContact(permit) {
  const contacts = permit.contacts || [];
  const gc = contacts.find((c) => c.kind === 'contractor' && !isPlaceholderName(c.company || c.name));
  if (gc) return { contact: gc, note: '' };
  const placeholder = contacts.find((c) => c.kind === 'contractor');
  const owner = contacts.find((c) => c.kind === 'owner');
  const note = placeholder && /OWNER/i.test(placeholder.company) ? 'Owner-builder' : placeholder ? 'Contractor not named yet' : 'No contractor listed';
  return { contact: owner || null, note };
}

export const contactTitle = (c) => c?.company || c?.name || '';
/** The person, when it isn't just the company repeated. */
export const contactPerson = (c) => (c?.name && c.name.toUpperCase() !== String(c.company || '').toUpperCase() ? c.name : '');

/** The first existing customer any of the permit's contacts already is. */
export const customerOf = (permit) => (permit.contacts || []).find((c) => c.customer)?.customer || null;

/** Rows for the Excel export: one per permit, contractor / owner / applicant side by side. */
export function permitExportRows(items) {
  return items.map((p) => {
    const by = (kind) => (p.contacts || []).find((c) => c.kind === kind) || {};
    const gc = by('contractor');
    const owner = by('owner');
    const applicant = by('applicant');
    return {
      Source: SOURCES[p.source]?.long || p.source,
      'Permit #': p.permitNumber,
      Category: categoryLabel(p.category),
      Type: [p.type, p.subtype && !p.type.toUpperCase().endsWith(p.subtype.toUpperCase()) ? p.subtype : ''].filter(Boolean).join(' · '),
      Status: p.status,
      Issued: p.issuedOn || '',
      Applied: p.appliedOn || '',
      Address: p.address,
      City: p.city,
      ZIP: p.zip,
      Parcel: p.parcel,
      Description: p.description,
      Valuation: p.valuation ?? '',
      'Sq ft': p.sqft ?? '',
      Units: p.units ?? '',
      Contractor: contactTitle(gc),
      'Contractor contact': contactPerson(gc),
      'Contractor phone': gc.phone ? formatPhone(gc.phone) : '',
      'Contractor email': gc.email || '',
      Owner: contactTitle(owner),
      'Owner phone': owner.phone ? formatPhone(owner.phone) : '',
      'Owner email': owner.email || '',
      Applicant: contactTitle(applicant),
      'Applicant phone': applicant.phone ? formatPhone(applicant.phone) : '',
      'Applicant email': applicant.email || '',
      'Existing customer': customerOf(p)?.name || '',
      Link: p.sourceUrl || ''
    };
  });
}
