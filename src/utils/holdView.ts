/**
 * Holds screens (HoldsTab, HoldPage, HoldForms) — what they show and offer,
 * kept out of the components so holdView.test.js can pin it down. The hold
 * rules themselves (expiry, totals, who sees what) are src/holds/holdRules.ts;
 * the server checks every permission again.
 */
import { HOLDS, can } from '../holds/permissions.ts';
import {
  addDays, todayIn, daysToExpiry, holdState, priceCentsOf, lineTotalCents, formatDay, GRACE_DAYS, STATE_LABELS
} from '../holds/holdRules.ts';
import { centsToPlain, formatCents } from '../accounting/money.ts';
import { branchZone } from '../config/branches.ts';
import type { Loose } from '../types/records';

/** A hold, a hold line and a cart line as /api/holds sends them (src/holds/models.ts). */
export type Hold = Loose;
export type HoldLine = Loose;
export type Tone = 'ok' | 'soon' | 'expired' | 'closed';

// ── List ─────────────────────────────────────────────────────────────────

/** "Converted" waits for Sales Orders. Expiring = ends within 3 days (router.js statusClause). */
export const HOLD_TABS = Object.freeze([
  { id: 'active', label: 'Active' },
  { id: 'expiring', label: 'Expiring soon' },
  { id: 'expired', label: 'Expired' },
  { id: 'released', label: 'Released' },
  { id: 'all', label: 'All' }
]);

export const SCOPE_LABELS: Readonly<Record<string, string>> = Object.freeze({ mine: 'Mine', branch: 'My branches', all: 'All locations' });

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "Taj Mahal 3CM ×12 · Black Pearl ×2 · 1 more" */
export function productSummary(products: { product?: string; slabs: number }[] = [], max = 2): string {
  const shown = products.slice(0, max).map((p) => `${p.product || 'Unknown'} ×${p.slabs}`);
  const rest = products.length - max;
  return [...shown, ...(rest > 0 ? [`${rest} more`] : [])].join(' · ');
}

// ── Dates ────────────────────────────────────────────────────────────────

const fromIsoDay = (iso: string): Date => new Date(`${iso}T12:00:00Z`);

/** "2026-10-16" → "Oct 16, 2026" (a calendar day, never shifted by the viewer's zone). */
export const longDate = (iso: string | null | undefined): string => (iso ? formatDay(iso) : '—');

/** "2026-10-16" → "Oct 16" */
export const dayMonth = (iso: string | null | undefined): string => (iso ? fromIsoDay(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');

/** An instant → "Oct 9, 2026" */
export const dateOf = (at: string | number | Date | null | undefined): string => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Date accepts what the API sends
  const d = new Date(at as any);
  return at && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
};

/** An instant → "Oct 9, 9:37 PM" */
export const dateTimeOf = (at: string | number | Date | null | undefined): string => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above
  const d = new Date(at as any);
  return at && !Number.isNaN(d.getTime()) ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
};

/** The day an expired hold lets go of its slabs (releaseAt is the start of it). */
export const releaseDayOf = (hold: Hold): string => addDays(hold.expiresOn, GRACE_DAYS + 1);

/**
 * Where a hold stands, in words, and how urgent it is:
 * tone 'ok' | 'soon' (3 days or less) | 'expired' | 'closed'.
 */
export function expiryLine(hold: Hold, now = new Date()): { text: string; tone: Tone } {
  const state = holdState(hold, now);
  if (state === 'released') return { text: `Released ${dateOf(hold.releasedAt)}`, tone: 'closed' };
  if (state === 'converted') return { text: 'Converted to an order', tone: 'closed' };
  if (state === 'expired') return { text: `Expired · slabs free ${dayMonth(releaseDayOf(hold))}`, tone: 'expired' };
  const d = daysToExpiry(hold, now);
  if (d <= 0) return { text: 'Ends today', tone: 'soon' };
  if (d === 1) return { text: 'Ends tomorrow', tone: 'soon' };
  return { text: `${d} days to go`, tone: d <= 3 ? 'soon' : 'ok' };
}

/** How much of the hold's time has gone, 0–1, for the bar under the expiry. */
export function elapsedShare(hold: Hold, now = new Date()): number {
  const start = new Date(hold.createdAt).getTime();
  const end = new Date(hold.expiresAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}

export const stateLabel = (state: string | null | undefined): string => (STATE_LABELS as Record<string, string>)[state || ''] || state || '';

// ── What a person may do ─────────────────────────────────────────────────

/**
 * The buttons a hold page shows. Released and converted holds are final;
 * an expired one still holds its slabs and can be changed or extended.
 */
export function holdActions(user: import('../types/permissions.ts').PermissionUser, hold: Hold | null | undefined) {
  const open = hold?.status === 'active';
  return {
    edit: open && can(user, HOLDS.EDIT),
    slabs: open && can(user, HOLDS.SLABS),
    prices: open && can(user, HOLDS.PRICES),
    extend: open && can(user, HOLDS.EXTEND),
    release: open && can(user, HOLDS.RELEASE),
    print: Boolean(hold) && can(user, HOLDS.PRINT)
  };
}

// ── Prices ───────────────────────────────────────────────────────────────

/** The price editor's starting values: { [slabKey]: "22.00" | "" }. */
export const priceDraftOf = (lines: HoldLine[] = []): Record<string, string> => Object.fromEntries(lines.map((l) => [l.slabKey, centsToPlain(l.priceCentsPerSf)]));

/** One price shared by every slab of a product, or '' when they differ. */
export function sharedPrice(lines: HoldLine[] = [], draft: Record<string, string> = {}): string {
  const values = [...new Set(lines.map((l) => (draft[l.slabKey] ?? '').trim()))];
  return values.length === 1 ? values[0] : '';
}

/**
 * The price editor's result: the lines whose price changed, ready for
 * PATCH /prices, and any slab whose typed price can't be read.
 */
export function priceChanges(lines: HoldLine[] = [], draft: Record<string, string> = {}): { changed: { slabKey: string; price: string | null }[]; errors: Record<string, string> } {
  const changed: { slabKey: string; price: string | null }[] = [];
  const errors: Record<string, string> = {};
  for (const l of lines) {
    const typed = draft[l.slabKey] ?? '';
    const cents = priceCentsOf(typed);
    if (cents === undefined || (cents !== null && cents <= 0)) { errors[l.slabKey] = 'Enter the price like 12.50'; continue; }
    if (cents !== (l.priceCentsPerSf ?? null)) changed.push({ slabKey: l.slabKey, price: cents === null ? null : centsToPlain(cents) });
  }
  return { changed, errors };
}

/** A line's extended amount for the slab table, from the draft while editing. */
export function lineAmount(line: HoldLine, draft: Record<string, string> | null = null): number | null {
  const cents = draft ? priceCentsOf(draft[line.slabKey] ?? '') : line.priceCentsPerSf;
  const total = lineTotalCents(line.sfHundredths || 0, cents ?? null);
  return total === null ? null : total;
}

// ── Expiry ───────────────────────────────────────────────────────────────

/**
 * Quick picks for Extend: 7, 14 and 30 days on from the later of today
 * (on the branch clock) and the current expiry.
 */
export function extendChoices(hold: Hold, now = new Date()): { days: number; expiresOn: string }[] {
  const today = todayIn(branchZone(hold.branch), now);
  const base = hold.expiresOn > today ? hold.expiresOn : today;
  return [7, 14, 30].map((days) => ({ days, expiresOn: addDays(base, days) }));
}

// ── Slabs from the cart ──────────────────────────────────────────────────

/**
 * Cart slabs that can go on this hold — in stock, not held, not on it
 * already — each with a suggested price: the one price its product already
 * has on the hold, if every slab of it shares one.
 */
export function cartSlabsFor(hold: Hold | null | undefined, cartLines: Loose[] = []): Loose[] {
  const onHold = new Set((hold?.lines || []).map((l: HoldLine) => l.slabKey));
  const priceByProduct = new Map<string, number | null>();
  for (const l of hold?.lines || []) {
    const seen = priceByProduct.get(l.product);
    const p = l.priceCentsPerSf ?? null;
    if (seen === undefined) priceByProduct.set(l.product, p);
    else if (seen !== p) priceByProduct.set(l.product, null);
  }
  return cartLines
    .filter((l) => l.inStock && !l.lock && !onHold.has(l.slabKey))
    .map((l) => ({ ...l, suggestedPrice: centsToPlain(priceByProduct.get(l.slab?.product) ?? null) }));
}

// ── History ──────────────────────────────────────────────────────────────

const ACTION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  created: 'Hold created',
  edited: 'Details changed',
  slabs_added: 'Slabs added',
  slabs_removed: 'Slabs removed',
  slab_swapped: 'Slab swapped',
  prices_changed: 'Prices changed',
  extended: 'Hold date changed',
  expired: 'Expired',
  released: 'Released'
});

export const historyLabel = (action: string): string => ACTION_LABELS[action] || action;

const FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  customer: 'Customer', job: 'Job', notes: 'Notes', commissionNotes: 'Commission notes',
  chanceToClose: 'Chance to close', expiresOn: 'Hold until', status: 'Status'
});

const blank = (v: unknown): v is null | undefined | '' => v === null || v === undefined || v === '';
const show = (v: unknown): string => (blank(v) ? '—' : String(v));
const perSf = (cents: unknown): string => (blank(cents) ? 'no price' : `${formatCents(cents as number)}/SF`);

/** One change in a history entry, in words. */
export function changeText(c: { field?: string; from?: unknown; to?: unknown } | null | undefined): string {
  const field = String(c?.field || '');
  const { from, to } = c || {};
  if (field.startsWith('price ')) return `${field.slice(6)}: ${perSf(from)} → ${perSf(to)}`;
  if (field.startsWith('note ')) return `${field.slice(5)} note: ${show(from)} → ${show(to)}`;
  if (field === 'slab') return `${show(from)} → ${show(to)}`;
  if (field === 'expiresOn') return `Hold until: ${longDate(from as string)} → ${longDate(to as string)}`;
  if (field === 'chanceToClose') return `Chance to close: ${blank(from) ? '—' : `${from}%`} → ${blank(to) ? '—' : `${to}%`}`;
  return `${FIELD_LABELS[field] || field}: ${show(from)} → ${show(to)}`;
}

/** The change lines worth showing under an entry (status flips are in its label already). */
export const visibleChanges = (entry: Loose | null | undefined): Loose[] => (entry?.changes || []).filter((c: Loose) => c.field !== 'status');

// ── Edit details ─────────────────────────────────────────────────────────

export const CHANCE_OPTIONS = Object.freeze([10, 25, 50, 75, 90]);
export const chanceText = (n: unknown): string => (blank(n) ? '—' : `${n}%`);

/** Hold → the Edit details form's values. */
export type HoldDetails = { customerId: string; job: string; chanceToClose: number | null; notes: string; commissionNotes: string };

export const detailsOf = (hold: Hold = {}): HoldDetails => ({
  customerId: hold.customer?.id || '',
  job: hold.job || '',
  chanceToClose: hold.chanceToClose ?? null,
  notes: hold.notes || '',
  commissionNotes: hold.commissionNotes || ''
});

/** Only what changed, for PATCH /details; an empty object means nothing to save. */
export function detailsPatch(hold: Hold, values: Loose): Partial<HoldDetails> {
  const before = detailsOf(hold);
  const out: Loose = {};
  for (const key of Object.keys(before) as (keyof HoldDetails)[]) {
    const next = typeof values[key] === 'string' ? values[key].trim() : values[key];
    if ((next ?? null) !== (before[key] ?? null) && !(blank(next) && blank(before[key]))) out[key] = next;
  }
  if (out.customerId === '') delete out.customerId;
  return out;
}

export const slabCount = (n: number): string => plural(n, 'slab');
