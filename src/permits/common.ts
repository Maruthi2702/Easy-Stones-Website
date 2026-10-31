import type { Loose } from '../types/records.ts';
/**
 * What every permit source shares (2026-10-14): the lead categories, days on
 * the Pacific clock, and how text, phones and contacts are tidied. Each
 * source's own rules live in src/permits/rules/<source>.js and build on these;
 * src/permits/permitRules.ts puts the sources together.
 *
 * Pure: shared by the server (src/permits/) and the Permits screen.
 */

export const CATEGORIES = Object.freeze([
  { id: 'new_home', label: 'New home' },
  { id: 'adu', label: 'ADU / detached' },
  { id: 'addition', label: 'Addition' },
  { id: 'remodel', label: 'Remodel' },
  { id: 'multifamily', label: 'Multifamily' },
  { id: 'commercial_new', label: 'Commercial new' },
  { id: 'commercial_remodel', label: 'Commercial remodel' },
  // A building permit whose office publishes only a broad type ("BUILDING",
  // "Building - Residential") — new homes, remodels and solar panels alike.
  // Filed here rather than guessed into a category from its description.
  { id: 'building_other', label: 'Other building' }
]);
export const CATEGORY_IDS = Object.freeze(CATEGORIES.map((c) => c.id));
export const categoryLabel = (id: string) => CATEGORIES.find((c) => c.id === id)?.label || '';

/** A type name compared without case or extra spaces; several parts joined with " | ". */
export const key = (...parts: unknown[]) => parts.map((p) => String(p ?? '').trim().replace(/\s+/g, ' ').toUpperCase()).join(' | ');

/** A `[[type…], category]` list as a lookup by key. */
export const typeMap = (entries: readonly (readonly unknown[])[]): Map<string, string> => new Map(entries.map(([parts, category]) => [key(...([] as unknown[]).concat(parts)), category as string]));
export const typeSet = (entries: readonly unknown[]): Set<string> => new Set(entries.map((parts) => key(...([] as unknown[]).concat(parts))));

// ── Days ──────────────────────────────────────────────────────────────────

export const PERMIT_ZONE = 'America/Los_Angeles';
/** The first pull goes back six months. */
export const BACKFILL_DAYS = 183;
/** Each morning re-reads the last 30 days, so late status changes and added contractors land. */
export const DAILY_LOOKBACK_DAYS = 30;
/** The morning run starts at 5:00 AM Pacific; a server asleep then runs as soon as it wakes. */
export const RUN_AT_MINUTES = 5 * 60;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (s: unknown) => typeof s === 'string' && DAY_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/**
 * 'YYYY-MM-DD' from a source's date. EnerGov and Socrata send local
 * wall-clock strings ('2026-10-09T00:00:00'); ArcGIS sends epoch milliseconds
 * at UTC midnight of the day. Either way the calendar day is the source's own,
 * with no time-zone shift. US 'MM/DD/YYYY' (eTRAKiT, MyBuildingPermit pages)
 * reads the same way.
 */
export function dayOf(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return new Date(value).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (us) {
    const s = `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
    return isDay(s) ? s : null;
  }
  const s = text.slice(0, 10);
  return isDay(s) ? s : null;
}

export function shiftDay(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today's date and minutes past midnight on the Pacific clock. */
export function pacificNow(at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: PERMIT_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(at).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}

/**
 * Whether the morning run is due: it's 5:00 AM Pacific or later and today
 * hasn't had a successful run yet (a failed one tries again on the next tick
 * — see the scheduler's retry gap).
 */
export function isDailyRunDue(lastSuccessDay: unknown, at = new Date()) {
  const { day, minutes } = pacificNow(at);
  return minutes >= RUN_AT_MINUTES && lastSuccessDay !== day;
}

/** How far back a run reads: six months on the first run, else the last 30 days. */
export function runSince(hasFullBackfill: boolean, at = new Date()) {
  const { day } = pacificNow(at);
  return shiftDay(day, -(hasFullBackfill ? DAILY_LOOKBACK_DAYS : BACKFILL_DAYS));
}

/** Every whole month ('YYYY-MM') that starts on or after `sinceDay` and ends before `beforeMonth`. */
export function fullMonthsBetween(sinceDay: string, beforeMonth: string) {
  const out = [];
  let [y, m] = sinceDay.slice(0, 7).split('-').map(Number);
  if (sinceDay.slice(8) !== '01') m += 1;
  for (;;) {
    if (m > 12) { y += 1; m = 1; }
    const month = `${y}-${String(m).padStart(2, '0')}`;
    if (month >= beforeMonth) return out;
    out.push(month);
    m += 1;
  }
}

export const monthBounds = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
};

// ── Text, phones, contacts ────────────────────────────────────────────────

export const cleanText = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** HTML text as plain text: <BR> as a line break, tags dropped, the common entities decoded. */
export function htmlText(s: unknown) {
  return cleanText(String(s ?? '')
    .replace(/<br\s*\/?>/gi, ' · ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;?|&apos;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>'))
    .replace(/^·\s*|\s*·$/g, '')
    .replace(/(\s*·\s*)+/g, ' · ');
}

/** The last ten digits — how two spellings of one US number are compared. */
export function phoneKey(phone: unknown) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

export function formatPhone(phone: unknown) {
  const k = phoneKey(phone);
  return k ? `(${k.slice(0, 3)}) ${k.slice(3, 6)}-${k.slice(6)}` : cleanText(phone);
}

export const emailKey = (email: unknown) => {
  const e = cleanText(email).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
};

/** Company names compared without case, punctuation or a trailing LLC / Inc. */
export function nameKey(name: unknown) {
  return cleanText(name).toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\b(LLC|L L C|INC|INCORPORATED|CO|CORP|CORPORATION|LTD|COMPANY|THE)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A Washington L&I contractor license number as the state's registry writes
 * it — six letters/digits-ish codes like 'BROCKSC921MJ', upper case, no
 * spaces. Anything else is not a license number.
 */
export function licenseKey(value: unknown) {
  const s = cleanText(value).toUpperCase().replace(/\s+/g, '');
  return /^[A-Z0-9*]{6,15}$/.test(s) && /[A-Z]/.test(s) && /\d/.test(s) ? s : '';
}

/** Contractor first, then owner, applicant, everyone else. */
export const CONTACT_ORDER = ['contractor', 'owner', 'applicant', 'other'];

export function contactKind(role: unknown) {
  const r = String(role || '').toLowerCase();
  if (r.includes('contractor')) return 'contractor';
  if (r.includes('owner')) return 'owner';
  if (r.includes('applicant')) return 'applicant';
  return 'other';
}

/** "TBD" and owner-builder exemptions are what the source says, but nobody to call. */
export function isPlaceholderName(name: unknown) {
  const n = cleanText(name).toUpperCase();
  return !n || n === 'TBD' || n === 'N/A' || n === 'NONE' || /OWNER AS CONTR/.test(n);
}

/** Drops exact repeats (the county lists some GCs twice) and sorts by kind. */
export function tidyContacts(contacts: Loose[]) {
  const seen = new Set();
  const out = [];
  for (const c of contacts || []) {
    const contact = {
      role: cleanText(c.role),
      kind: contactKind(c.role),
      company: cleanText(c.company),
      name: cleanText(c.name),
      // An all-zero number is a form's placeholder (Skagit shows "(000) 000-0000"), not a phone.
      phone: /^[0\D]*$/.test(String(c.phone ?? '')) ? '' : cleanText(c.phone),
      email: cleanText(c.email).toLowerCase(),
      address: cleanText(c.address),
      ...(licenseKey(c.license) && { license: licenseKey(c.license) })
    };
    if (!contact.company && !contact.name && !contact.license) continue;
    const k = [contact.kind, nameKey(contact.company), nameKey(contact.name), phoneKey(contact.phone), contact.email, contact.license || ''].join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(contact);
  }
  return out.sort((a, b) => CONTACT_ORDER.indexOf(a.kind) - CONTACT_ORDER.indexOf(b.kind));
}

/** Bellingham re-issues some old permits only to sign them off; there's no new work in them. */
export const isFinalOnly = (description: unknown) => /^\s*FINAL[\s-]*ONLY\b/i.test(String(description || ''));

export const money = (v: string) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};
export const count = (v: string) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
