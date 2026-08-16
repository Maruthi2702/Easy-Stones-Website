/**
 * Centralized date formatting utilities to handle local timezone offsets
 * for date and time inputs.
 *
 * Two kinds of value pass through here and they are NOT interchangeable:
 *
 *   Calendar dates  — a visit date, a delivery's day. These mean the same
 *                     calendar square everywhere and must never shift by zone,
 *                     so a 'YYYY-MM-DD' string (or a UTC-midnight Date) is read
 *                     by its date parts. That is what parseAsLocal does.
 *   Instants        — createdAt, signedAt: a real moment. These must be
 *                     converted, not reinterpreted, so they read as the viewer's
 *                     own local time. Use formatInstant/formatInstantTime.
 *
 * Passing an instant to the calendar-date helpers prints the UTC clock face as
 * if it were local, which shows the wrong time and, after ~4pm Pacific, the
 * wrong day.
 */

// The viewer's own IANA zone, e.g. 'America/Los_Angeles' or 'Asia/Kolkata'.
// Sent to the API so server-computed day/month boundaries agree with the
// timestamps rendered beside them.
export const viewerTimeZone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
})();

/**
 * A Schedule entry's startTime/endTime is a naive wall-clock string (no
 * zone) meaning whatever time the rep who created it actually meant, in
 * their own zone — fine to display (new Date(str) in that same rep's own
 * browser resolves it right back), but ambiguous the moment something
 * OTHER than that rep's browser has to interpret it. That's exactly what
 * the calendar sync functions do (server.js's syncGoogleCalendar,
 * src/services/icloudSyncService.js): they run on the server, whose own
 * runtime zone (UTC in production) is not the rep's — reading the naive
 * string as if the server's zone applied silently shifts every synced
 * event by however many hours separate the two, which is why a rep in
 * Seattle picking 9:00 AM was seeing 2:00 AM on their phone's calendar.
 *
 * Turns the naive string into the true UTC instant it actually means in
 * `timeZone`, via a double round-trip through Intl's own timezone database
 * (so DST is handled correctly) rather than a hardcoded offset.
 */
export const zonedTimeToUtc = (naiveLocalString, timeZone) => {
  if (!naiveLocalString) return null;
  const zone = timeZone || 'America/Los_Angeles';
  const iso = naiveLocalString.endsWith('Z') ? naiveLocalString : `${naiveLocalString}Z`;
  const asIfUtc = new Date(iso);
  if (Number.isNaN(asIfUtc.getTime())) return null;

  // What clock face does that same instant show in `zone`? Re-reading
  // those parts as UTC again gives the offset between the two zones at
  // this particular date (so DST is accounted for automatically).
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(asIfUtc);
  const get = (type) => Number(parts.find(p => p.type === type)?.value);
  // Some engines format midnight's hour as "24" under hour12:false —
  // normalize back to 0 so Date.UTC doesn't roll into the next day.
  const hour = get('hour') % 24;
  const inZoneAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));

  const offsetMs = asIfUtc.getTime() - inZoneAsUtc;
  return new Date(asIfUtc.getTime() + offsetMs);
};

// Helper to treat UTC strings as Local (stripping Z)
const parseAsLocal = (date) => {
    if (!date) return null;
    if (date instanceof Date) return date;
    if (typeof date === 'string') {
        if (date.endsWith('Z')) {
            return new Date(date.slice(0, -1));
        }
        // If it's a plain YYYY-MM-DD date string, parse it using local timezone components
        // to avoid UTC midnight shifting the day backwards in western timezones
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            const [year, month, day] = date.split('-').map(Number);
            return new Date(year, month - 1, day);
        }
    }
    return new Date(date);
};

export const getLocalISOString = (date) => {
    if (!date) return '';
    const d = parseAsLocal(date);
    if (!d) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

export const formatForDateInput = (date) => {
  if (!date) return '';
  
  if (typeof date === 'string') {
      if (date.includes('T')) {
          // If it ends in Z, strip it to ensure we don't shift days
          if (date.endsWith('Z')) {
              return formatForDateInput(date.slice(0, -1));
          }
          return date.split('T')[0];
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return date;
      }
  }
  
  const d = parseAsLocal(date);
  if (!d || isNaN(d.getTime())) return '';
  
  // Use local methods
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
};

/**
 * Format a true instant (createdAt, signedAt, …) in the viewer's local zone.
 * Unlike formatDate this converts the moment rather than reinterpreting its
 * clock face, so a check-in logged at 22:42 UTC reads 3:42 PM in Seattle and
 * 4:12 AM in Kolkata — the same moment, each in the reader's own terms.
 */
export const formatInstant = (value, options = { month: 'short', day: 'numeric', year: 'numeric' }) => {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('en-US', options).format(d);
};

/** Time-of-day of an instant, in the viewer's local zone. */
export const formatInstantTime = (value, options = { hour: '2-digit', minute: '2-digit' }) =>
  formatInstant(value, options);

export const formatDate = (dateString, options = { month: 'short', day: 'numeric', year: 'numeric' }) => {
  if (!dateString) return '-';
  try {
    const dateObj = parseAsLocal(dateString);
    if (!dateObj || isNaN(dateObj.getTime())) return '-';

    // Format using local time
    return new Intl.DateTimeFormat('en-US', { ...options }).format(dateObj);
  } catch {
    return '-';
  }
};
