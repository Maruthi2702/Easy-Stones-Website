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
export const checkInExportFileName = (location, today = new Date()) =>
  `checkin-log-${location ? `${String(location).replace(/\s+/g, '_')}-` : ''}${today.toISOString().slice(0, 10)}.xlsx`;
