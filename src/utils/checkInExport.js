/**
 * The Check-In Log export's rules, shared by the Check-In Log tab (SalesPage)
 * and the standalone /checkin-log page so the two files can't drift apart.
 * Pure — the network call is passed in — so it can be tested.
 */
import { checkInMoment } from './checkInClock.js';

// The server caps a page at 1000 rows; 50 pages is a generous ceiling.
export const EXPORT_PAGE_SIZE = 1000;
export const EXPORT_MAX_PAGES = 50;

/**
 * One spreadsheet row per check-in. Location is included so an all-branch
 * export says where each visitor came. Date and Time are on the branch's own
 * clock (checkInMoment), the day the log and the Daily Report put it on, with
 * the zone ('EDT') when it isn't the exporter's.
 */
export const checkInExportRows = (list = [], { viewerZone } = {}) => list.map((c) => {
  const m = checkInMoment(c.createdAt, c.location, { viewerZone });
  return {
    Date: m.date,
    Time: m.zone ? `${m.time} ${m.zone}` : m.time,
    Location: c.location || '',
    Name: c.name || '',
    Phone: c.phone || '',
    'Company/Contact Name': c.fabricatorCompany || '',
    'Fabricator Phone': c.fabricatorPhone || '',
    'Sales Rep': c.salesRep || ''
  };
});

/**
 * Every page of check-ins matching the table's filters.
 * `fetchPage(page)` resolves { list, totalPages, total } or throws — and a
 * failed page now stops the export instead of quietly writing a partial file.
 * `truncated` is true when there were more pages than EXPORT_MAX_PAGES.
 */
export async function collectAllCheckIns(fetchPage, { maxPages = EXPORT_MAX_PAGES } = {}) {
  const rows = [];
  let page = 1;
  let totalPages = 1;
  let total = 0;
  do {
    const { list = [], totalPages: tp = 1, total: t } = await fetchPage(page);
    rows.push(...list);
    totalPages = tp || 1;
    if (typeof t === 'number') total = t;
    page += 1;
  } while (page <= totalPages && page <= maxPages);
  return { rows, total: total || rows.length, truncated: totalPages > maxPages };
}

/** The file name: the day it was made, and the branch when it's one branch. */
export const checkInExportFileName = (location, today = new Date(), ext = 'xlsx') =>
  `checkin-log-${location ? `${String(location).replace(/\s+/g, '_')}-` : ''}${today.toISOString().slice(0, 10)}.${ext}`;

// ── PDF (More menu → View as PDF / Download as PDF, 2026-10-08) ──────────

/**
 * A PDF stops here: 5,000 rows is ~130 pages, already more than anyone
 * reads, and it keeps the server's answer quick. The Excel file has no such
 * cap beyond the export's own (EXPORT_PAGE_SIZE × EXPORT_MAX_PAGES).
 */
export const CHECKIN_PDF_MAX_ROWS = 5000;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The PDF heading's filter line: "Seattle · October 2026 · matching “smith”". */
export const checkInExportScope = ({ location, month, year, search } = {}) => {
  const m = Number(month);
  const y = Number(year);
  const when = m >= 1 && m <= 12 && y > 2000 ? `${MONTHS[m - 1]} ${y}` : 'All dates';
  const q = String(search || '').trim();
  return [location || 'All branches', when, q ? `matching “${q}”` : ''].filter(Boolean).join(' · ');
};

/**
 * The PDF's address for the log's current filters. A plain link (the login
 * cookie signs it in), so "View" can open it in a new tab straight from the
 * tap — an iPad blocks a tab opened after waiting on a fetch. `download`
 * asks for a file instead of showing it; `tz` puts times on the reader's clock.
 */
export const checkInPdfUrl = (apiUrl, { search, month, year, location } = {}, { download = false, tz } = {}) => {
  const params = new URLSearchParams();
  const q = String(search || '').trim();
  if (q) params.set('search', q);
  if (month) params.set('month', String(month));
  if (year) params.set('year', String(year));
  if (location) params.set('location', location);
  if (tz) params.set('tz', tz);
  if (download) params.set('download', '1');
  const qs = params.toString();
  return `${apiUrl || ''}/api/checkin/export.pdf${qs ? `?${qs}` : ''}`;
};
