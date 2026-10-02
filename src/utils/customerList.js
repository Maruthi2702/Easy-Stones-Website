/**
 * Rules for the customer list (PartnersSheet), shared by the screen and by
 * GET /api/partners so the two can't disagree — e.g. the ⚠ a row shows and the
 * "Incomplete" saved view that finds those rows are built from the same checks.
 *
 * Pure functions over plain records and plain query objects. Nothing here
 * touches the database; server.js passes in anything that needs mongoose
 * (an ObjectId converter) rather than this file importing it.
 */
import { emailKeys, PLACEHOLDER_EMAIL_RE, OWN_DOMAIN_RE } from './customerMatch.js';
import { visitViewScope } from './visitAccess.js';

// ── Status ───────────────────────────────────────────────────────────────────

/**
 * The stored status values are unchanged; the list shows a short label beside a
 * coloured dot. Closed-out statuses get a hollow ring and muted text instead of
 * a colour, so dead accounts fade back without relying on colour alone.
 */
export const STATUS_META = Object.freeze({
  'New Lead': { short: 'New lead', tone: 'new', closed: false },
  'Contacted / In Discussion': { short: 'In discussion', tone: 'con', closed: false },
  'Trying to Onboard': { short: 'Onboarding', tone: 'try', closed: false },
  'Onboarded': { short: 'Onboarded', tone: 'on', closed: false },
  'Different Sales Person': { short: 'Other rep', tone: 'closed', closed: true },
  'Not Interested': { short: 'Not interested', tone: 'closed', closed: true },
  'Inactive': { short: 'Inactive', tone: 'closed', closed: true }
});

/** Every stored status, in the order the filter lists them. */
export const STATUSES = Object.freeze(Object.keys(STATUS_META));

export const statusMeta = (status) =>
  STATUS_META[status] || { short: status || 'No status', tone: 'closed', closed: true };

// ── Display helpers ──────────────────────────────────────────────────────────

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

export const companyOf = (c = {}) =>
  clean(c.company) || clean(c.name) || clean(c.contactName) || 'Customer';

/** The person, when it isn't just the company name repeated. */
export const contactOf = (c = {}) => {
  const person = clean(c.contactName) || clean(c.name);
  return person && person !== companyOf(c) && person !== 'Unknown' ? person : '';
};

export const cityOf = (c = {}) => clean(c.address?.city) || clean(c.city);

/** "Mukilteo, WA 98275" — whichever parts exist. */
export const cityLineOf = (c = {}) => {
  const city = cityOf(c);
  const tail = [clean(c.address?.state), clean(c.address?.zipCode)].filter(Boolean).join(' ');
  return [city, tail].filter(Boolean).join(', ');
};

export const streetOf = (c = {}) => clean(c.address?.street);

export const locationOf = (c = {}) => clean(c.location) || 'Seattle';

/** Up to two letters, from the words of a name. */
export const initialsOf = (name = '') =>
  String(name)
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('') || '?';

/** Real addresses in the email field (it sometimes holds a comma-joined list). */
export const realEmailsOf = (c = {}) => emailKeys(c.email || '');

/** The address to show and to email: the first real one, else whatever is stored. */
export const primaryEmailOf = (c = {}) => realEmailsOf(c)[0] || '';

/**
 * How many more people/addresses there are beyond the one the row shows:
 * extra addresses packed into the email field, plus the contacts list (the list
 * endpoint sends contactsCount instead of the contacts themselves).
 */
export const extraContactCount = (c = {}) => {
  const extraEmails = Math.max(0, realEmailsOf(c).length - 1);
  const contacts = Number.isFinite(c.contactsCount)
    ? c.contactsCount
    : (Array.isArray(c.contacts) ? c.contacts.length : 0);
  return extraEmails + contacts;
};

// ── Data quality ─────────────────────────────────────────────────────────────

/**
 * What's missing from a record, in words a person can act on. Mirrors
 * incompleteQuery below — change one, change both.
 */
export const dataIssues = (c = {}) => {
  const issues = [];
  if (!/\d/.test(String(c.phone || ''))) issues.push('No phone');
  if (realEmailsOf(c).length === 0) issues.push('No email');
  if (!streetOf(c)) issues.push('No street address');
  if (c.geocode?.status === 'failed') issues.push('Address not found on map');
  return issues;
};

/** The database half of dataIssues: records the ⚠ would show on. */
export const incompleteQuery = () => ({
  $or: [
    { phone: { $not: /\d/ } },
    { email: { $not: /\S/ } },
    { $and: [{ email: PLACEHOLDER_EMAIL_RE }, { email: { $not: /[,;]/ } }] },
    { $and: [{ email: OWN_DOMAIN_RE }, { email: { $not: /[,;]/ } }] },
    { 'address.street': { $not: /\S/ } },
    { 'geocode.status': 'failed' }
  ]
});

// ── Saved views ──────────────────────────────────────────────────────────────

export const SAVED_VIEWS = Object.freeze([
  { key: 'mine', label: 'My accounts' },
  { key: 'followups', label: 'Follow-ups due' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'noModa', label: 'No Moda display' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'incomplete', label: 'Incomplete', warn: true }
]);

export const isSavedView = (key) => SAVED_VIEWS.some(v => v.key === key);

/** 'YYYY-MM-DD' plus n days, in UTC so it never shifts with the server's zone. */
export const addDays = (dayStr, n) => {
  const d = new Date(`${dayStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Follow-ups are due when a visit's follow-up date falls today through this many days out. */
export const FOLLOW_UP_WINDOW_DAYS = 7;

/**
 * The query for one saved view, or null for an unknown key. `toId` turns the
 * caller's user id into whatever the salesRep field stores (an ObjectId on the
 * server); `today` is 'YYYY-MM-DD'.
 */
export const savedViewQuery = (key, { userId, today, toId = (x) => x } = {}) => {
  switch (key) {
    case 'mine': {
      // A converter that can't read the id returns null — and { salesRep: null }
      // would match every unassigned account, so match nothing instead.
      const id = userId ? toId(userId) : null;
      return id ? { salesRep: id } : { _id: null };
    }
    case 'followups':
      return {
        visits: {
          $elemMatch: { followUpDate: { $gte: today, $lte: addDays(today, FOLLOW_UP_WINDOW_DAYS) } }
        }
      };
    case 'onboarding':
      return { status: 'Trying to Onboard' };
    case 'noModa':
      return { modaDisplay: { $ne: 'Yes' } };
    case 'unassigned':
      return { salesRep: { $in: [null] } };
    case 'incomplete':
      return incompleteQuery();
    default:
      return null;
  }
};

/** A–Z jump: company (or, with no company, the name) starting with the letter; '#' = anything else. */
export const letterQuery = (letter) => {
  const l = String(letter || '').trim().toUpperCase();
  if (!l) return null;
  const pattern = l === '#' ? /^\s*[^A-Za-z]/ : new RegExp(`^\\s*${l.replace(/[^A-Z]/g, '')}`, 'i');
  if (l !== '#' && !/^[A-Z]$/.test(l)) return null;
  return {
    $or: [
      { company: pattern },
      { $and: [{ company: { $not: /\S/ } }, { name: pattern }] }
    ]
  };
};

// ── Filter options by role ───────────────────────────────────────────────────

const locationsOfRep = (rep) => {
  const assigned = Array.isArray(rep?.assignedLocations) ? rep.assignedLocations.filter(Boolean) : [];
  return [...new Set([clean(rep?.location), ...assigned].filter(Boolean))];
};

/**
 * Which reps and locations a person is offered in the list's filters, by the
 * same rule that decides whose visits they see (visitViewScope):
 *   all       → every rep, every location
 *   branches  → reps working in their assigned locations, those locations
 *   own       → just themselves (plus Unassigned), their own location(s)
 * This only limits what the filters offer; it doesn't hide customers.
 */
export const scopedFilterOptions = ({ user, salesReps = [], locations = [] } = {}) => {
  const scope = visitViewScope(user);
  const me = String(user?.id ?? user?._id ?? '');
  const allLocations = locations.map(l => (typeof l === 'string' ? l : l?.name)).filter(Boolean);

  if (scope.kind === 'all') {
    return { scope: scope.kind, reps: salesReps, locations: allLocations };
  }
  if (scope.kind === 'branches') {
    const allowed = new Set(scope.locations);
    return {
      scope: scope.kind,
      reps: salesReps.filter(r => String(r._id) === me || locationsOfRep(r).some(l => allowed.has(l))),
      locations: allLocations.filter(l => allowed.has(l))
    };
  }
  const mine = salesReps.filter(r => String(r._id) === me);
  const myLocations = locationsOfRep(user).filter(l => l !== '*');
  return {
    scope: scope.kind,
    reps: mine,
    locations: allLocations.filter(l => myLocations.includes(l))
  };
};

/** Group reps under their primary location, in the order the list was given. */
export const groupRepsByLocation = (reps = []) => {
  const groups = new Map();
  for (const r of reps) {
    const key = clean(r.location) || 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups].map(([location, members]) => ({ location, reps: members }));
};

// ── Copying ──────────────────────────────────────────────────────────────────

/** "Derek Thompson <derekt@fsgranite.com>, (425) 295-5383" — pastes cleanly into Outlook's To line. */
export const contactCard = ({ name, email, phone } = {}) => {
  const n = clean(name);
  const e = clean(email);
  const who = n && e ? `${n} <${e}>` : (e || n);
  return [who, clean(phone)].filter(Boolean).join(', ');
};

/** Unique real addresses for a set of customers, ready to paste into To/Bcc. */
export const emailListFor = (customers = []) =>
  [...new Set(customers.flatMap(c => realEmailsOf(c)))].join('; ');
