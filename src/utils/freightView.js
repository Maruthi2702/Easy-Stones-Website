/**
 * The 3rd-Party Freight screen's rules (src/components/sales/freight/): its
 * tabs and their counts, charges grouped by carrier, what a selection of
 * charges allows, and the labels it shows. The money and status rules
 * themselves live in src/accounting/ (freightRules.js) and the server checks
 * every action again — this only decides what to offer.
 *
 * Pure, tested in freightView.test.js.
 */
import { FREIGHT } from '../accounting/permissions.js';
import { PAYMENT_TERMS } from '../accounting/freightRules.js';
import { sumCents } from '../accounting/money.js';

const has = (user, perm) => Array.isArray(user?.permissions) && user.permissions.includes(perm);

/** The tabs (owner, 2026-10-09): flagged charges live under To approve. */
export const FREIGHT_TABS = Object.freeze([
  { id: 'to_approve', label: 'To approve' },
  { id: 'approved', label: 'Approved' },
  { id: 'paid', label: 'Paid' },
  { id: 'all', label: 'All' }
]);

/** A tab's count from the list's summary. */
export function tabCount(tab, summary = {}) {
  const n = (s) => summary?.[s]?.count || 0;
  if (tab === 'to_approve') return summary?.toApprove || 0;
  if (tab === 'approved') return n('approved');
  if (tab === 'paid') return n('paid');
  if (tab === 'all') return n('draft') + n('approved') + n('paid') + n('void');
  return 0;
}

export const STATUS_PILL = Object.freeze({
  draft: { label: 'To approve', tone: 'draft' },
  approved: { label: 'Approved', tone: 'approved' },
  paid: { label: 'Paid', tone: 'paid' },
  void: { label: 'Void', tone: 'void' }
});

export const openFlagsOf = (charge) => (charge?.openFlags || (charge?.flags || []).filter((f) => !f.resolvedAt));

export const isPerInvoice = (carrier) => carrier?.paymentTerms === PAYMENT_TERMS.PER_INVOICE;

/**
 * The charges on screen, grouped by carrier in the order they first appear:
 * [{ key, name, carrier, perInvoice, unmatched, items, cents }]. A charge
 * whose typed carrier matches nobody yet gets a group of its own, named as
 * typed, so it stands out.
 */
export function groupByCarrier(items = []) {
  const groups = new Map();
  for (const c of items) {
    const key = c.carrier?._id ? `c:${c.carrier._id}` : `raw:${(c.carrierNameRaw || '').trim().toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        carrier: c.carrier || null,
        name: c.carrier?.name || (c.carrierNameRaw ? `“${c.carrierNameRaw}”` : 'No carrier'),
        perInvoice: isPerInvoice(c.carrier),
        unmatched: !c.carrier,
        items: []
      });
    }
    groups.get(key).items.push(c);
  }
  return [...groups.values()].map((g) => ({ ...g, cents: sumCents(g.items.map((c) => c.amountCents)) }));
}

/**
 * What the selection bar offers for these charges and this person:
 *   approve   — every one waits for approval, none flagged, none per-invoice
 *   pay       — 'Approve & pay' (some still wait, and they can approve) or
 *               'Mark paid' (all approved), or null; `payBlocked` says why not
 *   sendBack  — every one approved and not on an invoice
 * The server re-checks all of it; this keeps the buttons honest.
 */
export function selectionActions(selected = [], user = null) {
  const count = selected.length;
  const cents = sumCents(selected.map((c) => c.amountCents));
  const canApprove = has(user, FREIGHT.APPROVE);
  const canPay = has(user, FREIGHT.PAY);
  const carriers = new Set(selected.map((c) => String(c.carrier?._id || c.carrierId || '')));
  const status = (s) => selected.every((c) => c.status === s);
  const onInvoice = selected.some((c) => c.invoiceId);
  const perInvoice = selected.some((c) => isPerInvoice(c.carrier));
  const flagged = selected.some((c) => openFlagsOf(c).length);
  const noPrice = selected.some((c) => c.status === 'draft' && !(c.amountCents > 0));
  const noCarrier = selected.some((c) => !c.carrier && !c.carrierId);

  const approve = count > 0 && canApprove && status('draft') && !onInvoice && !perInvoice && !flagged && !noPrice && !noCarrier;

  let pay = null;
  let payBlocked = '';
  if (count > 0 && canPay && selected.every((c) => c.status === 'draft' || c.status === 'approved')) {
    const someDraft = selected.some((c) => c.status === 'draft');
    if (someDraft && !canApprove) payBlocked = 'Approve them first — or ask someone who can approve.';
    else if (onInvoice || perInvoice) payBlocked = 'Paid per invoice — pay it from the invoice.';
    else if (flagged) payBlocked = 'Mark the flagged charge reviewed (or void it) first.';
    else if (noPrice) payBlocked = 'Add the missing price first.';
    else if (noCarrier) payBlocked = 'Pick the carrier first.';
    else if (carriers.size > 1) payBlocked = 'A payment goes to one carrier — pick one carrier’s charges.';
    else pay = someDraft ? 'Approve & pay' : 'Mark paid';
  }

  const sendBack = count > 0 && canApprove && status('approved') && !onInvoice;
  return { count, cents, approve, pay, payBlocked, sendBack };
}

export const PAYMENT_METHOD_LABELS = Object.freeze({ check: 'Check', ach: 'ACH', card: 'Card', cash: 'Cash', other: 'Other' });

/** What the reference field is called for a payment method. */
export const referenceLabel = (method) => ({
  check: 'Check #', ach: 'ACH reference', card: 'Card reference', cash: 'Receipt #'
}[method] || 'Reference');

/** "Check #1042", "ACH ACH-5", "Cash". */
export const paymentMethodText = (payment = {}) => {
  const m = PAYMENT_METHOD_LABELS[payment.method] || 'Paid';
  if (!payment.reference) return m;
  return payment.method === 'check' ? `Check #${payment.reference}` : `${m} · ${payment.reference}`;
};

export const HISTORY_LABELS = Object.freeze({
  created: 'Created',
  approved: 'Approved',
  unapproved: 'Sent back to approval',
  paid: 'Paid',
  voided: 'Voided',
  edited: 'Edited',
  reviewed: 'Marked reviewed',
  flagged: 'Flagged for review',
  updated_from_delivery: 'Updated from the delivery',
  carrier_matched: 'Carrier matched',
  added_to_invoice: 'Added to invoice',
  removed_from_invoice: 'Removed from invoice',
  invoice_voided: 'Invoice voided',
  deactivated: 'Deactivated',
  reactivated: 'Reactivated'
});

export const historyLabel = (action) => HISTORY_LABELS[action] || String(action || '').replace(/_/g, ' ');

/** Today as YYYY-MM-DD on this device's clock (the date a payment goes out). */
export const todayIso = (now = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
};

/** 'YYYY-MM-DD' → 'Oct 9' (or 'Oct 9, 2025' when it isn't this year). */
export const shortDate = (iso, now = new Date()) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return iso || '—';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const sameYear = +m[1] === now.getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' });
};

/** A one-off id for one Mark paid (the server returns the first payment if it's sent twice). */
export const newRequestId = () => {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
};

/** The Excel export's rows. */
export const freightExportRows = (items = []) => items.map((c) => ({
  Date: c.deliveryDate || '',
  'SO#': c.soNumber || '',
  Customer: c.customerName || '',
  Branch: c.location || '',
  Carrier: c.carrier?.name || c.carrierNameRaw || '',
  'BOL #': c.bolNumber || '',
  Amount: c.amountCents === null || c.amountCents === undefined ? '' : c.amountCents / 100,
  Status: STATUS_PILL[c.status]?.label || c.status,
  'Needs review': openFlagsOf(c).length ? openFlagsOf(c).map((f) => f.detail).join('; ') : '',
  'Approved by': c.approvedBy?.name || '',
  'Paid on': c.payment?.paidOn || '',
  Method: c.payment?.method ? PAYMENT_METHOD_LABELS[c.payment.method] : '',
  Reference: c.payment?.reference || '',
  'Payment ID': c.payment?.paymentId || '',
  Description: c.description || ''
}));
