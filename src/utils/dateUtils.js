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

// Returns a date object adjusted to local time but in ISO format (for datetime-local inputs)
export const toLocalISOString = (date) => {
  if (!date) return '';
  const d = parseAsLocal(date);
  if (!d || isNaN(d.getTime())) return '';
  
  const pad = (num) => String(num).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

export const getLocalISOString = (date) => {
    if (!date) return '';
    const d = parseAsLocal(date);
    if (!d) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

export const formatForDateTimeInput = (date) => {
  return toLocalISOString(date);
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
  } catch (e) {
    return '-';
  }
};
