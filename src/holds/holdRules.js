/**
 * Cart & Holds — the rules (2026-10-10). Pure: no database, no DOM, shared by
 * the server and the screens, and pinned down by holdRules.test.js.
 *
 * A hold reserves whole slabs for a customer:
 *
 *   active ──(expiry date passes)──▶ expired ──(7 more days)──▶ released
 *     │                                 │
 *     └──────── released by hand ───────┘        (converted: Sales Orders, later)
 *
 * "Expires Oct 16" means the end of Oct 16 on the hold's branch clock. An
 * expired hold still keeps its slabs for GRACE_DAYS more (owner's call,
 * 2026-10-10) and can be extended in that time; after that the release job
 * frees them.
 *
 * A slab is identified by its serial number (normalised): checked unique
 * across all 9,687 live slabs on 2026-10-10. Only whole slabs (type SLAB)
 * can be carted or held — samples and A-frames repeat serials across shops.
 */
import { toCents, formatCents } from '../accounting/money.js';
import { branchZone, isBranch } from '../config/branches.js';
import { HOLDS, can } from './permissions.js';

export const DEFAULT_HOLD_DAYS = 7;
export const GRACE_DAYS = 7;
export const MAX_HOLD_DAYS = 365;
export const MAX_CART_SLABS = 200;
export const MAX_HOLD_SLABS = 200;

export const HOLD_STATUSES = Object.freeze(['active', 'released', 'converted']);
export const STATE_LABELS = Object.freeze({ active: 'Active', expired: 'Expired', released: 'Released', converted: 'Converted' });

// ── Slabs ────────────────────────────────────────────────────────────────

/** "  14744-29 " → "14744-29". The key every cart line, hold line and lock uses. */
export const slabKeyOf = (serial) => String(serial ?? '').trim().toUpperCase();

/** Only whole slabs still in stock can be carted or held. */
export const isHoldableSlab = (item) => Boolean(item) && item.type === 'SLAB' && Number(item.instockQty) > 0 && Boolean(slabKeyOf(item.serialNumber));

/** Square feet as whole hundredths (55.1 SF → 5510), so money math stays in integers. */
export const sfHundredthsOf = (qty) => {
  const n = Number(qty);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};

export const formatSf = (hundredths) => `${(Number(hundredths || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} SF`;

/** What a hold line keeps of a slab: a snapshot, so a later SPS import never changes a past hold. */
export const slabSnapshot = (item = {}) => ({
  slabKey: slabKeyOf(item.serialNumber),
  serial: String(item.serialNumber || '').trim(),
  barcode: String(item.barcodeId || '').trim(),
  product: String(item.product || '').trim(),
  category: String(item.category || '').trim(),
  bundle: String(item.bundle || '').trim(),
  slabNumber: String(item.slabNumber || '').trim(),
  block: String(item.block || '').trim(),
  bin: String(item.bin || '').trim(),
  location: String(item.location || '').trim(),
  dimensions: String(item.dimensions || '').trim(),
  sfHundredths: sfHundredthsOf(item.instockQty)
});

/** Product → bundle groups, and whether a product mixes lots (colour may vary). */
export function lotGroups(lines = []) {
  const byProduct = new Map();
  for (const line of lines) {
    const product = line.product || 'Unknown product';
    if (!byProduct.has(product)) byProduct.set(product, new Map());
    const bundles = byProduct.get(product);
    const bundle = line.bundle || '—';
    if (!bundles.has(bundle)) bundles.set(bundle, []);
    bundles.get(bundle).push(line);
  }
  return [...byProduct].map(([product, bundles]) => {
    const groups = [...bundles].map(([bundle, list]) => ({ bundle, lines: list }));
    const all = groups.flatMap((g) => g.lines);
    return {
      product,
      bundles: groups,
      lines: all,
      slabs: all.length,
      sfHundredths: all.reduce((s, l) => s + (l.sfHundredths || 0), 0),
      mixedLots: groups.length > 1
    };
  });
}

// ── Money ────────────────────────────────────────────────────────────────

/** A typed price per SF ("$12.50") → whole cents per SF; '' → null; nonsense → undefined. */
export const priceCentsOf = (value) => toCents(value);

/** One line's total: SF (hundredths) × price per SF (cents), rounded to the cent. */
export const lineTotalCents = (sfHundredths, priceCentsPerSf) => (
  Number.isSafeInteger(priceCentsPerSf) ? Math.round((sfHundredths * priceCentsPerSf) / 100) : null
);

/** Slabs, SF and total for a set of lines. Total is null while any line has no price. */
export function holdTotals(lines = []) {
  let sfHundredths = 0;
  let totalCents = 0;
  let missingPrices = 0;
  for (const line of lines) {
    sfHundredths += line.sfHundredths || 0;
    const t = lineTotalCents(line.sfHundredths || 0, line.priceCentsPerSf);
    if (t === null) missingPrices += 1; else totalCents += t;
  }
  return { slabs: lines.length, sfHundredths, pricedCents: totalCents, totalCents: missingPrices ? null : totalCents, missingPrices };
}

export const formatMoney = (cents) => formatCents(cents);

// ── Dates on the branch clock ────────────────────────────────────────────

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" for `now` on that time zone's clock. */
export const todayIn = (timeZone, now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
}).format(now);

/** "2026-10-16" → "Oct 16, 2026": a calendar day, never shifted by the reader's time zone. */
export const formatDay = (isoDay) => new Date(`${isoDay}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function addDays(isoDay, days) {
  const [y, m, d] = isoDay.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Whole days from `fromDay` to `toDay` (both "YYYY-MM-DD"). */
export function daysBetween(fromDay, toDay) {
  const toUtc = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((toUtc(toDay) - toUtc(fromDay)) / 86400000);
}

/** The instant a day starts on a time zone's clock (DST-safe). */
export function zonedMidnight(isoDay, timeZone) {
  const [y, m, d] = isoDay.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 2; i += 1) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    guess -= asUtc - Date.UTC(y, m - 1, d);
  }
  return new Date(guess);
}

/** When a hold expiring on `expiresOn` turns Expired, and when its slabs are released. */
export function expiryMoments(expiresOn, branch) {
  const zone = branchZone(branch);
  return {
    expiresAt: zonedMidnight(addDays(expiresOn, 1), zone),
    releaseAt: zonedMidnight(addDays(expiresOn, 1 + GRACE_DAYS), zone)
  };
}

/** Where a hold actually is right now: active / expired (still holding) / released / converted. */
export function holdState(hold, now = new Date()) {
  if (!hold) return null;
  if (hold.status !== 'active') return hold.status;
  return now >= new Date(hold.expiresAt) ? 'expired' : 'active';
}

/** Days until expiry on the branch clock: 6 = "6 days to go", 0 = today, negative = expired. */
export const daysToExpiry = (hold, now = new Date()) => daysBetween(todayIn(branchZone(hold.branch), now), hold.expiresOn);

/** Days until an expired hold lets go of its slabs (on the branch clock). */
export const daysToRelease = (hold, now = new Date()) => daysToExpiry(hold, now) + GRACE_DAYS + 1;

/** The default expiry for a new hold on a branch: 7 days from today there. */
export const defaultExpiresOn = (branch, now = new Date()) => addDays(todayIn(branchZone(branch), now), DEFAULT_HOLD_DAYS);

/**
 * Can this expiry date be set? null when fine, else why not. Longer than
 * 7 days from today needs the Extend permission; nothing in the past.
 */
export function expiryProblem({ expiresOn, branch, canExtend = false, now = new Date() }) {
  if (!ISO_DAY.test(String(expiresOn || ''))) return 'Pick the date the hold runs until.';
  const today = todayIn(branchZone(branch), now);
  const days = daysBetween(today, expiresOn);
  if (days < 0) return 'The hold date can’t be in the past.';
  if (days > MAX_HOLD_DAYS) return `A hold can run for up to ${MAX_HOLD_DAYS} days.`;
  if (days > DEFAULT_HOLD_DAYS && !canExtend) return `Holds longer than ${DEFAULT_HOLD_DAYS} days need the Extend permission.`;
  return null;
}

// ── Branches and who sees what ───────────────────────────────────────────

/** A hold belongs to one of our Easy Stones branches the person is assigned to. */
export function branchProblem(branch, assignedLocations = []) {
  if (!isBranch(branch)) return 'Pick one of our Easy Stones branches.';
  if (!assignedLocations.includes('*') && !assignedLocations.includes(branch)) return 'You aren’t assigned to that branch.';
  return null;
}

/** Which "whose holds" choices this person gets: mine / branch / all. */
export function holdScopesFor(user) {
  const scopes = [];
  if (can(user, HOLDS.VIEW_OWN) || can(user, HOLDS.VIEW_BRANCH) || can(user, HOLDS.VIEW_ALL)) scopes.push('mine');
  if (can(user, HOLDS.VIEW_BRANCH)) scopes.push('branch');
  if (can(user, HOLDS.VIEW_ALL)) scopes.push('all');
  return scopes;
}

/** Can this person see this hold at all? */
export function canSeeHold(user, hold) {
  if (!user || !hold) return false;
  if (can(user, HOLDS.VIEW_ALL)) return true;
  const assigned = user.assignedLocations || [];
  if (can(user, HOLDS.VIEW_BRANCH) && (assigned.includes('*') || assigned.includes(hold.branch))) return true;
  return can(user, HOLDS.VIEW_OWN) && String(hold.createdBy?.id || '') === String(user.id || '');
}

/** The Mongo filter for a list scope, or null when the person can't use that scope. */
export function scopeClause(user, scope, branch = '') {
  if (!holdScopesFor(user).includes(scope)) return null;
  const assigned = user.assignedLocations || [];
  if (scope === 'mine') return { 'createdBy.id': String(user.id || '') };
  if (scope === 'branch') {
    if (branch) return assigned.includes('*') || assigned.includes(branch) ? { branch } : null;
    return assigned.includes('*') ? {} : { branch: { $in: assigned } };
  }
  return branch ? { branch } : {};
}
