// The driver screen's small text rules (DriverView, DriverStop).

/**
 * "09:00 AM" → 540. Used only for ordering, so anything unparseable sorts last
 * rather than throwing a stop off the run.
 */
export function timeToMinutes(value: unknown) {
  const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return Number.MAX_SAFE_INTEGER;
  let hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const meridiem = (m[3] || '').toUpperCase();
  if (meridiem === 'PM' && hours !== 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

/**
 * A driver's phone is the one place these links have to open the native app
 * rather than a web map. Apple's universal link does that on iOS and falls back
 * to the browser everywhere else, which is exactly the behaviour wanted.
 */
export function mapsHrefFor(address: string) {
  const query = encodeURIComponent(String(address || '').trim());
  if (!query) return null;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isApple = /iPhone|iPad|iPod|Macintosh/.test(ua);
  return isApple
    ? `https://maps.apple.com/?q=${query}`
    : `https://www.google.com/maps/search/?api=1&query=${query}`;
}

/** Blank, whitespace and the string "undefined" all mean "not set" here. */
export function cleanField(value: unknown) {
  const text = String(value ?? '').trim();
  return !text || text === 'undefined' || text === 'null' ? '' : text;
}

export const CONNECTION_LABELS: Record<string, string | null> = {
  online: null,
  reconnecting: 'Reconnecting — showing the last synced stops',
  offline: 'Offline — showing the last synced stops'
};
