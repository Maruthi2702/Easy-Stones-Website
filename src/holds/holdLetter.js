/**
 * The Hold Information Letter (2026-10-10) — what the customer copy of a hold
 * says, worked out once so the PDF (holdPdf.js) only draws it, and the print
 * preview's "Hide …" boxes all go through one place. Pure; holdLetter.test.js.
 *
 * Laid out after SPS's "Hold Information Letter - Customer". Internal notes,
 * commission notes and chance to close never go on it: it is for the
 * customer. Slab notes do (a chipped corner is the customer's business).
 */
import { lotGroups, holdTotals, lineTotalCents, formatDay, todayIn, STATE_LABELS } from './holdRules.js';
import { formatCents } from '../accounting/money.js';
import { branchZone } from '../config/branches.js';

/** The preview's boxes, in its order. Each one hides something; nothing is hidden by default. */
export const LETTER_HIDE = Object.freeze([
  { key: 'inventory', label: 'Hide slab list' },
  { key: 'unitPrice', label: 'Hide unit price' },
  { key: 'pricing', label: 'Hide pricing' },
  { key: 'totals', label: 'Hide totals' }
]);
const HIDE_KEYS = LETTER_HIDE.map((h) => h.key);

/** "unitPrice,totals" (the PDF route's ?hide=) → { unitPrice: true, totals: true }; unknown keys dropped. */
export function parseHide(value) {
  const out = {};
  for (const k of String(value || '').split(',').map((s) => s.trim())) if (HIDE_KEYS.includes(k)) out[k] = true;
  return out;
}

/** { unitPrice: true } → "unitPrice" (or '' for nothing hidden), in the boxes' order. */
export const hideParam = (hide = {}) => HIDE_KEYS.filter((k) => hide[k]).join(',');

const money = (cents) => (cents === null || cents === undefined ? '—' : formatCents(cents));
const sfText = (hundredths) => `${(Number(hundredths || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SF`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "6012 S 196th St, Kent, WA 98032" → ["6012 S 196th St", "Kent, WA 98032"] */
export function addressLinesOf(addressLine = '') {
  const s = String(addressLine || '').trim();
  const i = s.indexOf(',');
  return i < 0 ? [s].filter(Boolean) : [s.slice(0, i).trim(), s.slice(i + 1).trim()].filter(Boolean);
}

/** One price for every slab, or null when they differ (or any has none). */
function sharedPriceOf(lines) {
  const prices = [...new Set(lines.map((l) => l.priceCentsPerSf ?? null))];
  return prices.length === 1 ? prices[0] : undefined;
}

const instant = (d, timeZone, opts) => new Intl.DateTimeFormat('en-US', { timeZone, ...opts }).format(new Date(d));

/** Where the hold stands, in a sentence for the customer. */
function standing(hold, now) {
  const state = hold.state;
  if (state === 'released') return `This hold was released on ${instant(hold.releasedAt, branchZone(hold.branch), { month: 'short', day: 'numeric', year: 'numeric' })}. These slabs are no longer held.`;
  if (state === 'converted') return 'This hold has been converted to a sales order.';
  if (state === 'expired') return `This hold expired on ${formatDay(hold.expiresOn)}. Contact your sales rep to keep these slabs.`;
  const today = todayIn(branchZone(hold.branch), now);
  return hold.expiresOn >= today
    ? `These slabs are held for you until the end of ${formatDay(hold.expiresOn)}.`
    : `These slabs were held until ${formatDay(hold.expiresOn)}.`;
}

/**
 * Everything the letter shows, as text. `hold` is as the API presents it
 * (state, totals); `letterhead` is letterheadFor(the branch's Location).
 */
export function letterModel(hold, { hide = {}, letterhead = {}, now = new Date() } = {}) {
  const zone = branchZone(hold.branch);
  const showPricing = !hide.pricing;
  const showUnit = showPricing && !hide.unitPrice;
  const c = hold.customer || {};

  const groups = lotGroups(hold.lines).map((g) => {
    const shared = sharedPriceOf(g.lines);
    const varies = shared === undefined;
    const sub = holdTotals(g.lines);
    return {
      title: `${g.product} (${g.slabs})`,
      quantity: sfText(g.sfHundredths),
      unit: showUnit ? (varies ? 'Varies' : money(shared)) : '',
      extended: showPricing ? (sub.totalCents !== null ? money(sub.totalCents) : sub.pricedCents ? `${money(sub.pricedCents)}*` : '—') : '',
      rows: hide.inventory ? [] : g.lines.map((l) => ({
        serial: l.serial || l.slabKey,
        barcode: l.barcode || '',
        bundle: l.bundle || '',
        slabNumber: l.slabNumber || '',
        block: l.block || '',
        bin: l.bin || l.location || '',
        quantity: [l.dimensions, (Number(l.sfHundredths || 0) / 100).toFixed(2)].filter(Boolean).join(' = '),
        // A slab's own price only when its product's slabs differ — otherwise the product line says it once.
        unit: showUnit && varies ? money(l.priceCentsPerSf) : '',
        extended: showPricing && varies ? money(lineTotalCents(l.sfHundredths || 0, l.priceCentsPerSf ?? null)) : '',
        note: l.note || ''
      }))
    };
  });

  const t = hold.totals || holdTotals(hold.lines);
  const totals = !showPricing || hide.totals ? null : {
    count: `${plural(t.slabs, 'slab')} · ${sfText(t.sfHundredths)}`,
    label: t.totalCents !== null ? 'Total' : 'Total so far',
    amount: t.missingPrices === t.slabs ? '—' : money(t.totalCents !== null ? t.totalCents : t.pricedCents),
    missing: t.missingPrices ? `* ${plural(t.missingPrices, 'slab')} ${t.missingPrices === 1 ? 'has' : 'have'} no price yet` : ''
  };

  return {
    title: 'Hold Information Letter - Customer',
    company: `Easy Stones - ${hold.branch}`,
    address: [...addressLinesOf(letterhead.addressLine), letterhead.contactLine].filter(Boolean),
    number: String(hold.number),
    date: instant(hold.createdAt, zone, { month: 'short', day: 'numeric', year: 'numeric' }),
    printed: `printed on ${instant(now, zone, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
    state: STATE_LABELS[hold.state] || hold.status || '',
    billTo: [
      c.name,
      ...String(c.address || '').split('\n'),
      c.contact,
      c.phone ? `P: ${c.phone}` : '',
      c.email ? `E: ${c.email}` : ''
    ].map((s) => String(s || '').trim()).filter(Boolean),
    job: hold.job || '',
    info: [
      { label: 'Sales Rep', value: hold.createdBy?.name || '—' },
      { label: 'Hold Until', value: formatDay(hold.expiresOn) },
      { label: 'Branch', value: hold.branch || '—' }
    ],
    columns: { unit: showUnit, extended: showPricing, inventory: !hide.inventory },
    groups,
    totals,
    standing: standing(hold, now)
  };
}
