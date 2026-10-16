/**
 * Who gets a location's Daily Work Report PDF by email every day, the moment
 * the day is submitted (by a person or the 11:59 PM auto-submit). Set per
 * location in Users & Roles → Locations → Edit → "Daily Report email", stored
 * on the Location as `dailyReportEmail: { userIds, extraEmails }`:
 *
 *  - userIds: people with a login — their email on file is used, so a changed
 *    address follows them, and a deactivated user stops getting it.
 *  - extraEmails: addresses typed in, for people without a login.
 *
 * A location with nobody on its list gets no email. Until 2026-10-15 only
 * Seattle got one, to the list below typed into the code; the server copies
 * it onto Seattle's location once (seedSeattleRecipients in server.js).
 *
 * Pure functions only — the form, the server's save and the sender share them.
 */

export const SEATTLE_RECIPIENTS_BEFORE_2026_10_15 = [
  'sree@easystones.com',
  'jeremy@easystones.com',
  'vish@easystones.com',
  'krish@easystones.com'
];

// Enough for a branch's managers and the owners; the email route caps a
// one-off send at 20 too.
export const MAX_REPORT_RECIPIENTS = 25;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_RE = /^[a-f\d]{24}$/i;

export const isEmail = (v) => EMAIL_RE.test(String(v || '').trim());

/** "a@x.com, b@y.com; c@z.com" (commas, semicolons, spaces or new lines) → parts. */
export const splitEmails = (text) =>
  String(text || '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

/** Typed addresses → { emails (lower-case, no repeats), bad (what isn't an email) }. */
export const parseEmailList = (text) => {
  const emails = [];
  const bad = [];
  for (const part of splitEmails(text)) {
    if (!isEmail(part)) bad.push(part);
    else if (!emails.includes(part.toLowerCase())) emails.push(part.toLowerCase());
  }
  return { emails, bad };
};

/** User ids as stored: strings, real ids only, no repeats. */
export const cleanUserIds = (ids) =>
  [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter((id) => ID_RE.test(id)))];

/**
 * The addresses a report actually goes to: each listed user who is active
 * and has an email, then the typed addresses — lower-case, no repeats.
 * `users` are the listed users as loaded ({ _id, email, isActive }); ids
 * with no user (deleted) are skipped.
 */
export const recipientEmails = (setting, users = []) => {
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const out = [];
  const add = (e) => {
    const email = String(e || '').trim().toLowerCase();
    if (isEmail(email) && !out.includes(email)) out.push(email);
  };
  for (const id of cleanUserIds(setting?.userIds)) {
    const u = byId.get(id);
    if (u && u.isActive !== false) add(u.email);
  }
  for (const e of setting?.extraEmails || []) add(e);
  return out;
};

/**
 * Why a listed user won't get the email, or '' if they will — shown beside
 * their name on the form.
 */
export const userRecipientProblem = (user) => {
  if (!user) return 'no longer a user';
  if (user.isActive === false) return 'deactivated — not sent';
  if (!isEmail(user.email)) return 'no email on file';
  return '';
};

/**
 * Seattle's one-time copy: the old addresses that belong to a user become
 * that user (so their email can change later), the rest stay typed.
 */
export const seedFromAddresses = (addresses, users = []) => {
  const userIds = [];
  const extraEmails = [];
  for (const a of addresses) {
    const email = a.toLowerCase();
    const u = users.find((x) => String(x.email || '').toLowerCase() === email && x.isActive !== false);
    if (u) userIds.push(String(u._id));
    else extraEmails.push(email);
  }
  return { userIds: cleanUserIds(userIds), extraEmails };
};
