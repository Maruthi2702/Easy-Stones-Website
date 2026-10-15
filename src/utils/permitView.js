/**
 * The Permits screen's rules (src/components/sales/permits/): date ranges,
 * how each source's freshness and the county report check read, which
 * contact a row leads with, and the Excel rows. Pure, with tests beside it.
 */
import { SOURCES, SOURCE_IDS, COVERED_COUNTY_IDS, categoryLabel, formatPhone, isPlaceholderName, shiftDay, pacificNow } from '../permits/permitRules.js';
import { STATES, countyName, countyLabel } from '../permits/places.js';

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

// ── Counties (2026-10-14) ─────────────────────────────────────────────────

/**
 * The county filter's tree: each state with every one of its counties, which
 * ones the app has permits for (`covered`) and which are ticked. No county
 * ticked means every county. A state's box is 'all' when every covered county
 * is ticked, 'some' when part of them are, else 'none'.
 */
export function countyTree(selected = [], coveredIds = COVERED_COUNTY_IDS) {
  const picked = new Set(selected);
  return STATES.map((state) => {
    const counties = state.counties.map((c) => ({ ...c, covered: coveredIds.includes(c.id), checked: picked.has(c.id) }));
    const covered = counties.filter((c) => c.covered);
    const ticked = covered.filter((c) => c.checked).length;
    return { id: state.id, name: state.name, counties, state: ticked && ticked === covered.length ? 'all' : ticked ? 'some' : 'none' };
  });
}

/** Ticking or unticking one county; the list stays in the states' A–Z order. */
export function toggleCounty(selected = [], id) {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  return STATES.flatMap((s) => s.counties.map((c) => c.id)).filter((c) => next.has(c));
}

/** A state's box: every covered county ticked, or (when they all were) none. */
export function toggleState(selected = [], stateId, coveredIds = COVERED_COUNTY_IDS) {
  const state = STATES.find((s) => s.id === stateId);
  if (!state) return selected;
  const ids = state.counties.map((c) => c.id).filter((id) => coveredIds.includes(id));
  const all = ids.every((id) => selected.includes(id));
  const others = selected.filter((id) => !state.counties.some((c) => c.id === id));
  return all ? others : [...others, ...ids];
}

/** 'All counties', 'King County', 'King and Whatcom counties', 'King, Pierce and Whatcom counties'. */
export function countySummary(selected = []) {
  const names = selected.map(countyName).filter(Boolean);
  if (!names.length) return 'All counties';
  if (names.length === 1) return countyLabel(selected[0]);
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} counties`;
}

/** A remembered pick, kept to counties that are still real ids. */
export const cleanCounties = (value) => (Array.isArray(value) ? value : [])
  .filter((id) => STATES.some((s) => s.counties.some((c) => c.id === id)));

/**
 * The one "where" filter under the counties: who issued the permit or the
 * permit's city, as a single select value — '' (everything), 'source:<id>' or
 * 'city:<name>'. Only the issuers and cities in the ticked counties
 * (`cityCounties`: each city's counties, from the API) are offered;
 * `sourceIds` are the sources the server pulls.
 */
export function placeGroups(cities = [], { counties = [], cityCounties = {}, sourceIds = SOURCE_IDS } = {}) {
  const inCounties = (county) => !counties.length || counties.includes(county);
  return [
    { label: 'Issued by', options: sourceIds.filter((id) => SOURCES[id] && inCounties(SOURCES[id].county)).map((id) => ({ value: `source:${id}`, label: SOURCES[id].long })) },
    {
      label: 'City',
      options: cities
        .filter((c) => !counties.length || !cityCounties[c] || cityCounties[c].some(inCounties))
        .map((c) => ({ value: `city:${c}`, label: c }))
    }
  ].filter((g) => g.options.length);
}

/** Whether a place pick is still offered once the counties change ('' always is). */
export const placeOffered = (value, groups) => !value || groups.some((g) => g.options.some((o) => o.value === value));

/** A place value as the list's { source, city } query. */
export function placeQuery(value = '') {
  const [kind, ...rest] = String(value).split(':');
  const id = rest.join(':');
  if (kind === 'source' && SOURCES[id]) return { source: id, city: '' };
  if (kind === 'city' && id) return { source: '', city: id };
  return { source: '', city: '' };
}

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
  const order = (c) => Object.keys(SOURCES).indexOf(c.source);
  const current = checks.filter((c) => c.method === 'search' && c.month === month).sort((a, b) => order(a) - order(b));
  // The newest report check of each source that has them (Whatcom County, King County).
  const reports = [];
  for (const c of checks.filter((x) => x.method !== 'search').sort((a, b) => b.month.localeCompare(a.month))) {
    if (!reports.some((r) => r.source === c.source)) reports.push(c);
  }
  const top = [...current, ...reports.sort((a, b) => order(a) - order(b))];
  return { top, rest: checks.filter((c) => !top.includes(c)) };
}

/** A month's accuracy check, as one line and a tone. */
export function checkStatus(check) {
  if (check.method === 'search') {
    const who = SOURCES[check.source]?.label || check.source;
    const how = SOURCES[check.source]?.checkHow || 'a second search of the source';
    const label = `Accuracy check, ${formatMonth(check.month)} so far (${who})`;
    if (check.error) return { tone: 'warn', text: `${label}: couldn’t run — ${check.error}` };
    if (check.ok) return { tone: 'ok', text: `${label}: all ${check.matched} lead permit${check.matched === 1 ? '' : 's'} found again by ${how}` };
    const n = (check.missingFromApp || []).length + (check.notFoundAgain || []).length;
    return { tone: 'warn', text: `${label}: ${n} permit${n === 1 ? '' : 's'} differ from ${how}` };
  }
  const who = SOURCES[check.source]?.label;
  const month = `Accuracy check, ${formatMonth(check.month)}${who ? ` (${who})` : ''}`;
  const filled = check.filled ? `; value and city filled in for ${check.filled}` : '';
  if (check.error) return { tone: 'warn', text: `${month}: couldn’t check against the county’s report — ${check.error}` };
  if (check.ok) return { tone: 'ok', text: `${month}: matches the county’s report — all ${check.matched} lead permit${check.matched === 1 ? '' : 's'} accounted for${filled}` };
  const n = check.missingFromApp.length + check.notInReport.length + (check.notInCountySearch || []).length;
  return { tone: 'warn', text: `${month}: ${n} permit${n === 1 ? '' : 's'} differ from the county’s report` };
}

/**
 * What the page still shows above the list now that the checks live under
 * More → Detailed Checks: anything that isn't plainly fine — a source that
 * failed, went stale, is pulling or hasn't run, new building types not
 * sorted yet, or a check on top that didn't come out clean. Empty when all
 * is well, so the page stays quiet.
 */
export function checksAttention(sources = [], checks = [], now = new Date()) {
  const lines = [];
  // Sources whose first pull hasn't run share one line, so a new county doesn't fill the page.
  const waiting = sources.filter((s) => sourceStatus(s, now).tone === 'none');
  if (waiting.length > 1) lines.push({ id: 'first-pull', tone: 'none', text: `First pull hasn’t run yet: ${waiting.map((s) => s.label).join(', ')}` });
  for (const source of sources) {
    const s = sourceStatus(source, now);
    if (s.tone === 'none' && waiting.length > 1) continue;
    if (s.tone !== 'ok') lines.push({ id: source.id, tone: s.tone, text: s.text });
    const unsorted = source.lastRun?.unsortedTypes || [];
    if (unsorted.length) {
      lines.push({ id: `${source.id}-unsorted`, tone: 'warn', text: `${source.label}: new building types not sorted yet — ${unsorted.map((u) => `${u.type} (${u.count})`).join(', ')}` });
    }
  }
  for (const c of splitChecks(checks, now).top) {
    const s = checkStatus(c);
    if (s.tone !== 'ok') lines.push({ id: `${c.source}-${c.month}-${c.method}`, tone: s.tone, text: s.text });
  }
  return lines;
}

/** The contact a row leads with: the contractor, unless it's TBD or the owner building it themselves. */
export function leadContact(permit) {
  const contacts = permit.contacts || [];
  const gc = contacts.find((c) => c.kind === 'contractor' && !isPlaceholderName(c.company || c.name || c.registry?.businessName || c.license));
  if (gc) return { contact: gc, note: '' };
  const placeholder = contacts.find((c) => c.kind === 'contractor');
  const owner = contacts.find((c) => c.kind === 'owner');
  const note = placeholder && /OWNER/i.test(placeholder.company) ? 'Owner-builder' : placeholder ? 'Contractor not named yet' : 'No contractor listed';
  return { contact: owner || null, note };
}

/** Who a contact is: the source's name for them, else the registry's (a contractor known only by license). */
export const contactTitle = (c) => c?.company || c?.name || c?.registry?.businessName || (c?.license ? `License ${c.license}` : '');

/**
 * The number to call: the source's own, else the one the WA contractor
 * registry has for that license (`fromRegistry` says which, for the label).
 */
export function contactPhone(c) {
  if (c?.phone) return { phone: c.phone, fromRegistry: false };
  if (c?.registry?.phone) return { phone: c.registry.phone, fromRegistry: true };
  return { phone: '', fromRegistry: false };
}

/** 'Active · General · license BROCKSC921MJ' — the registry's line for a contractor. */
export function registryLine(r) {
  if (!r) return '';
  const status = r.status ? r.status.charAt(0) + r.status.slice(1).toLowerCase() : '';
  return [status, r.specialty ? r.specialty.charAt(0) + r.specialty.slice(1).toLowerCase() : '', r.license ? `license ${r.license}` : ''].filter(Boolean).join(' · ');
}
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
    const gcPhone = contactPhone(gc).phone;
    return {
      County: SOURCES[p.source]?.countyLabel || '',
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
      'Contractor phone': gcPhone ? formatPhone(gcPhone) : '',
      'Contractor email': gc.email || '',
      'Contractor license': gc.license || gc.registry?.license || '',
      'Contractor (WA registry)': gc.registry?.businessName || '',
      'License status': gc.registry?.status || '',
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

// ── PDF (More menu → View as PDF / Download as PDF, 2026-10-11) ──────────

/** A PDF stops here (~50 pages); past it the heading says so and Excel has the rest. */
export const PERMIT_PDF_MAX_ROWS = 1000;

/** One PDF row per permit: two lines a column — the main value and a quieter one under it. */
export function permitPdfRows(items) {
  return items.map((p) => {
    const { contact, note } = leadContact(p);
    const raw = contactPhone(contact).phone;
    const phone = raw ? formatPhone(raw) : '';
    return {
      issued: formatDay(p.issuedOn),
      issuer: SOURCES[p.source]?.label || '',
      number: p.permitNumber || '',
      kind: categoryLabel(p.category),
      address: p.address || '',
      city: p.city || '',
      work: p.description || p.type || '',
      value: formatMoney(p.valuation),
      lead: contactTitle(contact) || note,
      leadSub: [contact && note ? note : '', contact?.company ? contactPerson(contact) : '', phone].filter(Boolean).join(' · ')
    };
  });
}

const countyList = (counties) => (Array.isArray(counties) ? counties : String(counties || '').split(',')).map((c) => String(c).trim()).filter(Boolean);

/** The PDF heading's filter line: "Whatcom County · New home · Sep 12 – Oct 11, 2026 · matching “kvf”". */
export function permitPdfScope({ source, city, counties, category, from, to, q } = {}) {
  const where = SOURCES[source]?.long || city || countySummary(countyList(counties));
  const kind = categoryLabel(category) || 'All kinds of work';
  const when = from && to ? `${formatDay(from)} – ${formatDay(to)}` : from ? `Since ${formatDay(from)}` : to ? `Through ${formatDay(to)}` : 'All dates';
  const text = String(q || '').trim();
  return [where, kind, when, text ? `matching “${text}”` : ''].filter(Boolean).join(' · ');
}

/**
 * The PDF's address for the list's current filters. A plain link (the login
 * cookie signs it in), so View opens a tab straight from the tap — an iPad
 * blocks a tab opened after waiting on a fetch. `download` saves a file.
 */
export function permitPdfUrl(apiUrl, query = {}, { download = false } = {}) {
  const params = new URLSearchParams();
  for (const key of ['counties', 'source', 'city', 'category', 'from', 'to', 'q', 'sort']) {
    const v = String((Array.isArray(query[key]) ? query[key].join(',') : query[key]) ?? '').trim();
    if (v) params.set(key, v);
  }
  if (download) params.set('download', '1');
  const qs = params.toString();
  return `${apiUrl || ''}/api/permits/export.pdf${qs ? `?${qs}` : ''}`;
}

/** "permits-whatcom-2026-09-12-to-2026-10-11.pdf" — the Excel file's name, as a PDF. */
export function permitFileName({ source, city, counties, from, to } = {}, ext = 'xlsx') {
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const where = slug(source) || slug(city) || countyList(counties).map(slug).join('-') || 'all-counties';
  return `permits-${where}-${from || 'start'}-to-${to || 'today'}.${ext}`;
}
