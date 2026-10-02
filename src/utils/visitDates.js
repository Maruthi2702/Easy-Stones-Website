/**
 * Visit dates are stored as plain 'YYYY-MM-DD' strings, and the server builds
 * queries from them — including the calendar link's `startTime` prefix match.
 * server.js's ensureDateString used to pass any string containing a "T", or
 * any string it couldn't parse, through unchanged, so arbitrary text could be
 * stored as a date and land inside a MongoDB $regex. These accept only a real
 * calendar date and return null for anything else, for the caller to reject.
 * Shared by server.js and tested in visitDates.test.js.
 */
export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const isRealDay = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/**
 * 'YYYY-MM-DD' for a visit date, or null if it isn't one. An ISO timestamp is
 * read as the calendar date written in it (how the app's own parseAsLocal
 * reads them); a Date object as its server-local day, as ensureDateString did.
 */
export const normalizeVisitDate = (value) => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  if (typeof value !== 'string') return null;
  const head = value.trim().slice(0, 10);
  const rest = value.trim().slice(10);
  if (!YMD_RE.test(head) || !isRealDay(head)) return null;
  if (rest && !/^T[0-9:.]+(Z|[+-]\d{2}:?\d{2})?$/.test(rest)) return null;
  return head;
};

/** Like normalizeVisitDate for an optional field: '' when empty, null when invalid. */
export const normalizeOptionalDate = (value) => {
  if (value === undefined || value === null || value === '') return '';
  return normalizeVisitDate(value);
};
