import { createHash } from 'node:crypto';
import type { Loose } from '../types/records.ts';

/**
 * Importing the old CRM's activity export (Atlanta, YTD, 2026-11-18) as customer
 * visits. Pure rules, no database: the script (scripts/import-activity-visits.ts)
 * reads the sheet, the customers, the staff and the visit types, hands them here
 * for a plan, and writes the plan through `customerData.addVisit`.
 *
 * The owner's calls (2026-11-18): the tag decides the visit type (`TAG_TYPES`); an
 * untagged Phone or Email is an Important Remote Meeting/Call, an untagged Daily
 * Route / Meeting a scheduled in-person meeting; the Description is the visit's
 * Notes; each person in the file is a named staff login (`USER_NAMES`). A row with
 * no customer behind it is skipped and reported, never guessed. Customers match by
 * exact name; a name that only matches once "LLC / Inc / punctuation" are ignored,
 * or only by phone, is listed for a person to confirm, never written.
 */

export const TAG_TYPES: Record<string, string> = {
  'unscheduled visit': 'Unscheduled in Person Sales Call',
  'visit (unscheduled)': 'Unscheduled in Person Sales Call',
  'scheduled visit': 'Scheduled in Person Sales Meeting',
  'tasks (not a tag)': 'Quick Note',
  'price request': 'Quick Note',
  'issue': 'Quick Note',
  'commercial bid': 'Quick Note',
  '#home address': 'Personal Time Off',
  '#vacation': 'Personal Time Off',
  '#vaction': 'Personal Time Off',
  'moda tower update': 'Resource Update',
  'in office administration': 'In Office Administration Day',
  'formal presentation': 'Formal Presentation'
};

/** Rows with no tag: the Type column decides. */
export const UNTAGGED_TYPES: Record<string, string> = {
  'daily route': 'Scheduled in Person Sales Meeting',
  'meeting': 'Scheduled in Person Sales Meeting',
  'phone': 'Important Remote Meeting/Call',
  'email': 'Important Remote Meeting/Call',
  'note': 'Quick Note',
  'task': 'Quick Note'
};

/** The name in the file → the staff member's display name in our system (owner's list). */
export const USER_NAMES: Record<string, string> = {
  'Priscila Helen': 'Priscila',
  'Felicia Turner': 'Felicia Turner',
  'Eric James Smith': 'Eric James Smith',
  'Cristina Cousins': 'Cristina',
  'Kevin Shores': 'Kevin Shores',
  'Doug Urquhart': 'Doug Urquhart'
};

const squash = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const lower = (s: unknown) => squash(s).toLowerCase();

/** The visit type a row becomes. `null` = the file has a tag or type we have no rule for. */
export const visitTypeFor = (row: Loose): string | null => {
  const tag = lower(row.Tag);
  if (tag && tag !== 'activity without tags') return TAG_TYPES[tag] ?? null;
  return UNTAGGED_TYPES[lower(row.Type)] ?? null;
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const realDay = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/** "08/25/2026" or "Nov 6, 2026 | 7:00 PM - 7:45 PM" → "2026-08-25"; null if not a real day. */
export const importDay = (value: unknown): string | null => {
  const s = squash(value);
  let y: number, m: number, d: number;
  const a = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  const b = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})\b/.exec(s);
  if (a) { m = +a[1]; d = +a[2]; y = +a[3]; }
  else if (b && MONTHS.includes(b[1].toLowerCase())) { m = MONTHS.indexOf(b[1].toLowerCase()) + 1; d = +b[2]; y = +b[3]; }
  else return null;
  if (!realDay(y, m, d)) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** What an account name looks like with "LLC / Inc", "&" and punctuation taken out. */
export const looseName = (s: unknown) => lower(s).replace(/&/g, ' and ')
  .replace(/\b(llc|inc|incorporated|corp|corporation|co|company|ltd)\b\.?/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim();

export const lastTenDigits = (s: unknown) => {
  const d = String(s ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
};

/** The visit's own id, the same for the same row on every run, so a second run finds it and adds nothing. */
export const importVisitId = (userName: string, day: string, account: string, description: string, copy = 0) =>
  createHash('sha1').update(['activity-import', lower(userName), day, lower(account), squash(description), copy].join('|')).digest('hex').slice(0, 24);

export interface ImportCustomer { id: string; company?: string | null; contactName?: string | null; phone?: string | null }
export interface ImportStaff { id: string; name: string; active?: boolean }

export interface Matcher {
  find: (account: string, phone?: string) =>
    | { kind: 'exact'; id: string }
    | { kind: 'confirm'; id: string; how: 'name-ignoring-llc' | 'phone'; found: string }
    | { kind: 'none' };
}

/** Exact (case, spacing) company name first; then the looser name or the phone, each only if it names one customer. */
export const customerMatcher = (customers: ImportCustomer[]): Matcher => {
  const group = <K>(key: (c: ImportCustomer) => K) => {
    const m = new Map<K, ImportCustomer[]>();
    for (const c of customers) { const k = key(c); if (k) (m.get(k) ?? m.set(k, []).get(k)!).push(c); }
    return m;
  };
  const exact = group((c) => lower(c.company));
  const loose = group((c) => looseName(c.company));
  const phone = group((c) => lastTenDigits(c.phone));
  const only = (list?: ImportCustomer[]) => (list && list.length === 1 ? list[0] : null);
  const label = (c: ImportCustomer) => squash(c.company || c.contactName);
  return {
    find: (account, phoneNumber = '') => {
      const e = only(exact.get(lower(account)));
      if (e) return { kind: 'exact', id: e.id };
      const l = only(loose.get(looseName(account)));
      if (l) return { kind: 'confirm', id: l.id, how: 'name-ignoring-llc', found: label(l) };
      const p = only(phone.get(lastTenDigits(phoneNumber)));
      if (p) return { kind: 'confirm', id: p.id, how: 'phone', found: label(p) };
      return { kind: 'none' };
    }
  };
};

export interface PlannedVisit {
  row: number;
  customerId: string;
  customerName: string;
  userId: string;
  userName: string;
  visit: { _id: string; date: string; purpose: string; notes: string; createdBy: string; createdByName: string; createdAt: string };
}
export interface Skipped { row: number; account: string; user: string; reason: string }
export interface ToConfirm { row: number; account: string; found: string; how: string; customerId: string }

export interface PlanInput {
  rows: Loose[];
  customers: ImportCustomer[];
  staff: ImportStaff[];
  /** Names of the visit types that exist and are shown. */
  visitTypes: string[];
  userNames?: Record<string, string>;
  /** Customers a person confirmed: account name (lowercase) → customer id. */
  confirmed?: Record<string, string>;
}

export interface Plan {
  planned: PlannedVisit[];
  skipped: Skipped[];
  toConfirm: ToConfirm[];
  /** File names with no staff login, with their row counts. */
  unknownUsers: Record<string, number>;
  byType: Record<string, number>;
  repeats: number;
}

/** Row numbers are the sheet's own (header = row 1). */
export const planActivityImport = ({ rows, customers, staff, visitTypes, userNames = USER_NAMES, confirmed = {} }: PlanInput): Plan => {
  const matcher = customerMatcher(customers);
  const nameOf = new Map(customers.map((c) => [c.id, squash(c.company || c.contactName)]));
  const staffByName = new Map(staff.map((s) => [lower(s.name), s]));
  const types = new Set(visitTypes);
  const plan: Plan = { planned: [], skipped: [], toConfirm: [], unknownUsers: {}, byType: {}, repeats: 0 };
  const seen = new Map<string, number>();
  const confirmedSeen = new Set<string>();

  rows.forEach((r, i) => {
    const row = i + 2;
    const account = squash(r.Account);
    const user = squash(r.User);
    const skip = (reason: string) => plan.skipped.push({ row, account, user, reason });

    const purpose = visitTypeFor(r);
    if (!purpose) return skip(`No rule for tag "${squash(r.Tag)}" / type "${squash(r.Type)}"`);
    if (!types.has(purpose)) return skip(`Visit type "${purpose}" is missing or hidden`);
    const day = importDay(r.Date);
    if (!day) return skip(`Not a real date: "${squash(r.Date)}"`);
    const person = staffByName.get(lower(userNames[user] ?? user));
    if (!person) { plan.unknownUsers[user] = (plan.unknownUsers[user] ?? 0) + 1; return skip(`No staff login for "${user}"`); }
    if (!account) return skip('No account');
    if (/^atlanta office$/i.test(account)) return skip('Not a customer (Atlanta Office)');

    let customerId = confirmed[lower(account)] ?? '';
    if (!customerId) {
      const found = matcher.find(account, squash(r['Main Phone']));
      if (found.kind === 'none') return skip('No matching customer');
      if (found.kind === 'confirm') {
        if (!confirmedSeen.has(lower(account))) {
          confirmedSeen.add(lower(account));
          plan.toConfirm.push({ row, account, found: found.found, how: found.how, customerId: found.id });
        }
        return skip(`Match to "${found.found}" needs confirming`);
      }
      customerId = found.id;
    }

    const notes = String(r.Description ?? '').replace(/\r\n?/g, '\n').replace(/^["\s]+|["\s]+$/g, '').trim();
    const baseKey = [person.id, day, lower(account), notes, purpose].join('|');
    const copy = seen.get(baseKey) ?? 0;
    seen.set(baseKey, copy + 1);
    if (copy > 0) { plan.repeats++; return skip('Same user, day, customer and note as an earlier row'); }

    plan.byType[purpose] = (plan.byType[purpose] ?? 0) + 1;
    plan.planned.push({
      row, customerId, customerName: nameOf.get(customerId) ?? account, userId: person.id, userName: person.name,
      visit: {
        _id: importVisitId(person.name, day, account, notes), date: day, purpose, notes,
        createdBy: person.id, createdByName: person.name, createdAt: `${day}T12:00:00.000`
      }
    });
  });
  return plan;
};
