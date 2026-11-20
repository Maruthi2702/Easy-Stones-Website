/**
 * "Locate now" (2026-11-20, owner's ask): outside the 7 AM – 6 PM window the phone
 * reports nothing on its own, but an admin may ask one person's phone for ONE position,
 * for a reason, and every ask is kept. Rules shared by the server and the screens:
 *
 *   Who asks   a role with `locate_on_request`, about a tracked person on their team
 *              (teamScope.ts) who agreed to the current consent wording.
 *   Reason     required (5–200 characters) and saved with the request.
 *   Answer     the person's phone sends one position within 15 minutes, or the request
 *              expires. The position lives with the request, never in location_points,
 *              so the window rule for ordinary points is untouched.
 *   Kept       90 days, like points. The person is told by a push when it is asked.
 * Pure: no database, no DOM. Tested in locationRequests.test.ts.
 */
export const LOCATE = Object.freeze({ ASK: 'locate_on_request' });

export const REASON_MIN = 5;
export const REASON_MAX = 200;
/** A request not answered within this long expires (the phone was off, or the app force-quit). */
export const REQUEST_TTL_MS = 15 * 60 * 1000;
/** Worse than this and the position is too vague to count as an answer. */
export const ANSWER_MAX_ACCURACY_M = 1000;
/** Longest an answer may be ahead of the server's clock (a wrong phone clock). */
export const MAX_ANSWER_AGE_MS = 5 * 60 * 1000;

export const canLocateOnRequest = (user: { permissions?: string[] } | null | undefined) =>
  Boolean(user?.permissions?.includes(LOCATE.ASK));

export type RequestRow = { requestedAt: Date; answeredAt: Date | null };
export type RequestStatus = 'pending' | 'answered' | 'expired';

export const requestStatus = (row: RequestRow, now: Date = new Date()): RequestStatus =>
  row.answeredAt ? 'answered' : now.getTime() - row.requestedAt.getTime() > REQUEST_TTL_MS ? 'expired' : 'pending';

/** The reason trimmed, or an error message in words for the admin. */
export function cleanReason(raw: unknown): { reason: string; problem: string } {
  const reason = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (reason.length < REASON_MIN) return { reason, problem: `Say why you need it (at least ${REASON_MIN} characters).` };
  if (reason.length > REASON_MAX) return { reason, problem: `Keep the reason under ${REASON_MAX} characters.` };
  return { reason, problem: '' };
}

/** A position from the phone, or null when it is not one a map can use. */
export function cleanAnswer(raw: unknown): { lat: number; lng: number; accuracyM: number | null } | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { lat?: unknown; lng?: unknown; accuracy?: unknown };
  if (o.lat === null || o.lng === null || o.lat === undefined || o.lng === undefined) return null;
  const lat = Number(o.lat), lng = Number(o.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  const accuracy = o.accuracy === undefined || o.accuracy === null ? null : Number(o.accuracy);
  if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > ANSWER_MAX_ACCURACY_M)) return null;
  return { lat, lng, accuracyM: accuracy };
}

/** What the person's phone is told when it is asked. */
export const askedNotice = (askerName: string) => ({
  title: 'Location requested',
  body: `${askerName || 'Your manager'} asked for your phone’s location. Open Easy Surfaces to send it.`,
  path: '/sales'
});

/** "Kevin’s phone hasn’t answered yet" and the like — the admin's status line. */
export function requestLine(name: string, status: RequestStatus, answeredAt?: Date | null): string {
  if (status === 'pending') return `Asked ${name}’s phone. Waiting for an answer…`;
  if (status === 'expired') return `${name}’s phone didn’t answer in 15 minutes. It answers when the app is next opened.`;
  return `Located ${name}${answeredAt ? ` at ${answeredAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}.`;
}
