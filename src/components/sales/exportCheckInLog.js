import * as XLSX from 'xlsx';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { EXPORT_PAGE_SIZE, collectAllCheckIns, checkInExportRows, checkInExportFileName } from '../../utils/checkInExport';

/**
 * Download every check-in matching the table's filters as an .xlsx file —
 * used by the Check-In Log tab and the /checkin-log page alike.
 *
 * Resolves { count, total, truncated }. Throws an Error whose message can be
 * shown as is (code 'auth' when the session has ended); nothing is written
 * then, rather than a file that silently stops partway.
 */
export async function exportCheckInLog({ search = '', month = null, year = null, location = null, timeZone }) {
  const fetchPage = async (page) => {
    const params = new URLSearchParams({
      page,
      limit: EXPORT_PAGE_SIZE,
      ...(timeZone && { tz: timeZone }),
      ...(search && { search }),
      ...(month && { month }),
      ...(year && { year }),
      ...(location && { location })
    });
    let res;
    try {
      res = await authFetch(`${API_URL}/api/checkin?${params}`);
    } catch {
      throw new Error('Couldn’t reach the server, so nothing was exported. Check your connection and try again.');
    }
    if (res.status === 401) {
      const err = new Error('Your session has ended. Log in again to export.');
      err.code = 'auth';
      throw err;
    }
    if (!res.ok) throw new Error(`Couldn’t load part of the check-ins (error ${res.status}), so nothing was exported. Try again.`);
    const data = await res.json();
    if (Array.isArray(data)) return { list: data, totalPages: 1, total: data.length };
    return { list: data.checkIns || data.data || [], totalPages: data.totalPages || 1, total: data.total || 0 };
  };

  const { rows, total, truncated } = await collectAllCheckIns(fetchPage);
  const ws = XLSX.utils.json_to_sheet(checkInExportRows(rows));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Check-In Log');
  XLSX.writeFile(wb, checkInExportFileName(location));
  return { count: rows.length, total, truncated };
}

/** What to tell the person when the export stopped at the page limit. */
export const truncatedExportNote = ({ count, total }) =>
  `Exported the first ${count.toLocaleString()} of ${total.toLocaleString()} check-ins. Pick a month or a branch to export the rest.`;
