/**
 * Check In: who may check visitors in, use the Check-In Log, and edit or email
 * Selection Sheets (2026-10-14). Every permission for these screens lives
 * here, in its section, and Users & Roles builds its one "Check In" card from
 * CHECKIN_SECTIONS — a new permission for any of them is added here, under the
 * section it belongs to, and nowhere else (checkInAccess.test.js holds the
 * card to that).
 *
 *   Check In
 *     create_checkins       → the Check-In button, the staff /checkin page,
 *                             saving a check-in and its phone autofill
 *     view_checkin_qr       → the QR / NFC self check-in codes
 *   Check-In Log
 *     view_checkins         → the log, its exports, a sheet read-only
 *     manage_checkins       → edit a check-in's visitor details and branch
 *     delete_checkins       → delete check-ins
 *   Selection Sheet
 *     edit_selection_sheets → edit the sheet: selections, prices, notes, rep
 *     send_checkin_email    → email sheets (and the rep's automatic copy)
 *
 * The keys kept their old names: they're stored on every role. Saving a
 * check-in used to ride on manage_checkins, which also covered the sheet; the
 * server's one-time migration (CHECKIN_MIGRATION) gave both new keys to every
 * role that held it, so nobody lost anything the day they split.
 *
 * The server (src/routes/checkIn.ts) and the screens call the same functions,
 * so what a button offers and what the API accepts can't drift apart.
 */
import type { PermissionUser } from '../types/permissions.ts';

export const CHECKIN_PERMISSIONS = Object.freeze({
  CHECK_IN: 'create_checkins',
  QR: 'view_checkin_qr',
  VIEW_LOG: 'view_checkins',
  EDIT_DETAILS: 'manage_checkins',
  DELETE: 'delete_checkins',
  EDIT_SHEET: 'edit_selection_sheets',
  EMAIL_SHEET: 'send_checkin_email'
});

const P = CHECKIN_PERMISSIONS;

/** The Users & Roles card's sections, in order, with the keys under each. */
export const CHECKIN_SECTIONS = Object.freeze([
  { id: 'check_in', title: 'Check In', keys: [P.CHECK_IN, P.QR] },
  { id: 'log', title: 'Check-In Log', keys: [P.VIEW_LOG, P.EDIT_DETAILS, P.DELETE] },
  { id: 'selection_sheet', title: 'Selection Sheet', keys: [P.EDIT_SHEET, P.EMAIL_SHEET] }
]);

export const ALL_CHECKIN_PERMISSIONS: readonly string[] = Object.freeze(Object.values(P));

/**
 * Roles that held `from` before a split get `grant` once, on the next start
 * (server.ts records it in seededPermissions, so switching one off sticks).
 */
export const CHECKIN_MIGRATION = Object.freeze([
  { from: P.EDIT_DETAILS, grant: [P.CHECK_IN, P.EDIT_SHEET] }
]);

/** What PUT /api/checkin/:id may change under each switch. */
export const DETAIL_FIELDS = Object.freeze(['name', 'phone', 'email', 'fabricatorCompany', 'fabricatorName', 'fabricatorPhone', 'location']);
export const SHEET_FIELDS = Object.freeze(['builderName', 'builderPhone', 'selections', 'specialNotes', 'internalNotes', 'salesRep', 'salesRepEmail']);

const permsOf = (user: PermissionUser): readonly string[] => (Array.isArray(user?.permissions) ? user.permissions : []);
const has = (user: PermissionUser, key: string) => permsOf(user).includes(key);

export const canCheckIn = (user: PermissionUser) => has(user, P.CHECK_IN);
export const canSeeCheckInQr = (user: PermissionUser) => has(user, P.QR);
export const canViewCheckInLog = (user: PermissionUser) => has(user, P.VIEW_LOG);
export const canEditCheckInDetails = (user: PermissionUser) => has(user, P.EDIT_DETAILS);
export const canDeleteCheckIn = (user: PermissionUser) => has(user, P.DELETE);
export const canEditSelectionSheet = (user: PermissionUser) => has(user, P.EDIT_SHEET);
export const canEmailSelectionSheet = (user: PermissionUser) => has(user, P.EMAIL_SHEET);

/**
 * The permission a PUT /api/checkin/:id body needs that `user` lacks, or null
 * when they may save it: visitor details need Edit details, sheet fields need
 * Edit sheets, a body with both needs both, and one with neither needs one.
 */
export const missingEditPermission = (user: PermissionUser, body: Record<string, unknown> | null | undefined) => {
  const sent = (fields: readonly string[]) => fields.some((f) => body?.[f] !== undefined);
  const needed = [
    ...(sent(DETAIL_FIELDS) ? [P.EDIT_DETAILS] : []),
    ...(sent(SHEET_FIELDS) ? [P.EDIT_SHEET] : [])
  ];
  if (needed.length === 0) {
    return canEditCheckInDetails(user) || canEditSelectionSheet(user) ? null : P.EDIT_DETAILS;
  }
  return needed.find((key) => !has(user, key)) || null;
};
