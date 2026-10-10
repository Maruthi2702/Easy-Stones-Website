/**
 * 3rd-Party Freight — the rules (2026-10-09). Pure: no database, no DOM, so
 * the server and the screens share one copy and the tests can pin it down.
 *
 * A freight charge is what we owe a contract carrier for one completed
 * 3rd-party delivery (or a charge added by hand, e.g. detention):
 *
 *   draft ──approve──▶ approved ──pay──▶ paid
 *     │  ◀──unapprove──   │                 ▲
 *     ├──────void─────────┴──▶ void         │   (paid and void are final)
 *     └──────────pay (one step)─────────────┘
 *
 * One step (owner, 2026-10-09): someone who holds both Approve and Mark paid
 * can pay a draft directly. The approval checks still run (an amount, a
 * carrier, not a per-invoice carrier), and the history records both the
 * approval and the payment. Someone with Mark paid alone still needs an
 * approved charge — that's where approval is a real second check.
 *
 * While a charge is a draft it follows the schedule — carrier, BOL, agreed
 * price, date, branch — except for fields someone corrected by hand. Once it
 * is approved it is frozen: a later change to the delivery raises a flag for
 * review instead of quietly rewriting money someone signed off. (The Daily
 * Report's lesson: a draft follows the source; a final record keeps what was
 * signed.)
 *
 * Carriers are paid either per delivery (each charge approved and paid on its
 * own) or per invoice (charges grouped on the carrier's invoice, which is
 * approved and paid once).
 */
import { toCents, sumCents, isValidAmount } from './money.js';

export const CHARGE_STATUSES = Object.freeze(['draft', 'approved', 'paid', 'void']);
export const INVOICE_STATUSES = Object.freeze(['draft', 'approved', 'paid', 'void']);
export const PAYMENT_TERMS = Object.freeze({ PER_DELIVERY: 'per_delivery', PER_INVOICE: 'per_invoice' });
export const PAYMENT_METHODS = Object.freeze(['check', 'ach', 'card', 'cash', 'other']);

export const STATUS_LABELS = Object.freeze({ draft: 'To approve', approved: 'Approved', paid: 'Paid', void: 'Void' });

// ── Carriers ─────────────────────────────────────────────────────────────

const ENTITY_SUFFIX = /\b(incorporated|inc|llc|l\.l\.c|ltd|limited|co|corp|corporation|company)\b\.?/g;

/**
 * The comparable form of a carrier name, so "ABC Freight, Inc." and
 * "abc freight" are the same carrier. Typed freely on deliveries, so the
 * carrier list matches on this plus each carrier's aliases.
 */
export const normalizeCarrierName = (name) => String(name || '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(ENTITY_SUFFIX, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/^the\s+/, '')
  .trim();

/** The carrier a typed name belongs to (active ones first), or null. */
export function matchCarrier(carriers = [], rawName) {
  const key = normalizeCarrierName(rawName);
  if (!key) return null;
  const hits = carriers.filter((c) => [c.name, ...(c.aliases || [])].some((n) => normalizeCarrierName(n) === key));
  return hits.find((c) => c.active !== false) || hits[0] || null;
}

// ── Deliveries → charges ─────────────────────────────────────────────────

/** Fields a charge takes from its delivery. */
export const DERIVED_FIELDS = Object.freeze(['soNumber', 'customerName', 'deliveryDate', 'location', 'carrierNameRaw', 'bolNumber', 'amountCents']);

export const FIELD_LABELS = Object.freeze({
  soNumber: 'SO#', customerName: 'Customer', deliveryDate: 'Date', location: 'Branch',
  carrierNameRaw: 'Carrier (as typed)', carrierId: 'Carrier', bolNumber: 'BOL #', amountCents: 'Amount',
  description: 'Description', notes: 'Notes'
});

/**
 * A charge is owed once a 3rd-party delivery is completed (owner's call,
 * 2026-10-09). A will call has no carrier; any other type on a 3rd-party
 * truck — jobsite, transfer, return — does.
 */
export const qualifiesForCharge = (delivery, isThirdPartyTruck) => Boolean(
  delivery && isThirdPartyTruck && delivery.status === 'completed' && delivery.deliveryType !== 'will_call'
);

/** Why a delivery no longer creates a charge — shown on the review flag. */
export function whyNotOwed(delivery, isThirdPartyTruck) {
  if (!delivery) return 'The delivery was deleted';
  if (delivery.status === 'cancelled') return 'The delivery was cancelled';
  if (delivery.deliveryType === 'will_call') return 'The delivery became a will call';
  if (!isThirdPartyTruck) return 'The delivery was moved off the 3rd-party truck';
  if (delivery.status !== 'completed') return 'The delivery is no longer marked completed';
  return '';
}

/** The values a charge takes from a delivery. No agreed price → no amount (not $0). */
export function derivedFromDelivery(delivery = {}) {
  const fee = Number(delivery.freightFee);
  const cents = fee > 0 ? toCents(fee) : null;
  return {
    soNumber: String(delivery.soNumber || '').trim(),
    customerName: String(delivery.customerName || '').trim(),
    deliveryDate: String(delivery.date || ''),
    location: String(delivery.location || ''),
    carrierNameRaw: String(delivery.carrierName || '').trim(),
    bolNumber: String(delivery.proNumber || '').trim(),
    amountCents: Number.isSafeInteger(cents) ? cents : null
  };
}

const sameValue = (a, b) => (a ?? null) === (b ?? null);

/**
 * What to do with a delivery's charge after the delivery changed.
 *
 * `charge` is the existing charge (or null), `delivery` the delivery (or null
 * if deleted), `thirdParty` whether its truck is contract freight, and
 * `carrierId` the carrier its typed name matches (or null), and `startDate`
 * the first delivery date that creates a charge. Returns
 *   { op: 'none' }
 *   { op: 'create', doc }
 *   { op: 'update', set, flag?, clearReopened? }
 * where `flag` is a review flag to add ({ code, detail }).
 */
export function planSync({ charge = null, delivery = null, thirdParty = false, carrierId = null, startDate = '', now = new Date() } = {}) {
  const owed = qualifiesForCharge(delivery, thirdParty);
  const derived = delivery ? derivedFromDelivery(delivery) : null;

  if (!charge) {
    if (!owed) return { op: 'none' };
    // Deliveries before Accounting went live were settled the old way (SPS);
    // only those on or after the start date become charges.
    if (startDate && String(delivery.date || '') < startDate) return { op: 'none' };
    return {
      op: 'create',
      doc: {
        source: 'delivery',
        deliveryId: delivery.id,
        ...derived,
        carrierId: carrierId || null,
        status: 'draft',
        sourceSnapshot: derived,
        handSet: [],
        flags: []
      }
    };
  }

  // Void is final; nothing the schedule does brings it back.
  if (charge.status === 'void' || charge.source !== 'delivery') return { op: 'none' };

  const hasOpenFlag = (code) => (charge.flags || []).some((f) => f.code === code && !f.resolvedAt);

  if (!owed) {
    if (hasOpenFlag('delivery_reopened')) return { op: 'none' };
    return { op: 'update', set: {}, flag: { code: 'delivery_reopened', detail: whyNotOwed(delivery, thirdParty), at: now } };
  }

  const snapshot = charge.sourceSnapshot || {};
  const changed = DERIVED_FIELDS.filter((f) => !sameValue(snapshot[f], derived[f]));
  const reopenedAgain = hasOpenFlag('delivery_reopened');

  if (charge.status === 'draft') {
    const handSet = new Set(charge.handSet || []);
    const set = { sourceSnapshot: derived };
    for (const f of DERIVED_FIELDS) {
      if (!handSet.has(f) && !sameValue(charge[f], derived[f])) set[f] = derived[f];
    }
    if (!handSet.has('carrierId') && carrierId && String(charge.carrierId || '') !== String(carrierId)) set.carrierId = carrierId;
    const moneyChanged = Object.keys(set).length > 1;
    if (!moneyChanged && !changed.length && !reopenedAgain) return { op: 'none' };
    return { op: 'update', set, clearReopened: reopenedAgain };
  }

  // Approved or paid: frozen. Record what the delivery now says, and flag it.
  if (!changed.length) return reopenedAgain ? { op: 'update', set: {}, clearReopened: true } : { op: 'none' };
  const detail = changed.map((f) => `${FIELD_LABELS[f]}: ${display(f, snapshot[f])} → ${display(f, derived[f])}`).join('; ');
  return {
    op: 'update',
    set: { sourceSnapshot: derived },
    flag: { code: 'delivery_changed', detail, at: now },
    clearReopened: reopenedAgain
  };
}

const display = (field, v) => {
  if (field === 'amountCents') return v === null || v === undefined ? 'no price' : `$${(v / 100).toFixed(2)}`;
  return v ? String(v) : '(blank)';
};

// ── What each status allows ──────────────────────────────────────────────

/** Review flags nobody has dealt with yet. */
export const openFlags = (record) => (record?.flags || []).filter((f) => !f.resolvedAt);

/**
 * A charge with an open review flag (its delivery was deleted, cancelled or
 * changed) can't be approved or paid until someone marks it reviewed — "yes,
 * we still owe this" — or voids it. Otherwise a one-step Approve & pay could
 * pay for a delivery that no longer exists without anyone seeing the flag.
 */
export function flagProblem(charge) {
  const open = openFlags(charge);
  if (!open.length) return null;
  const why = open[0].detail || 'The delivery changed';
  return `${why}. Mark it reviewed (or void it) before approving or paying.`;
}

/** null when allowed, else a sentence saying why not. */
export function editProblem(charge) {
  if (!charge) return 'Charge not found.';
  if (charge.status !== 'draft') return `A ${STATUS_LABELS[charge.status].toLowerCase()} charge can't be edited.`;
  return null;
}

export function approveProblem(charge, carrier) {
  if (!charge) return 'Charge not found.';
  if (charge.status !== 'draft') return 'Only a charge waiting for approval can be approved.';
  const flagged = flagProblem(charge);
  if (flagged) return flagged;
  if (!isValidAmount(charge.amountCents)) return 'Add the amount before approving.';
  if (!charge.carrierId || !carrier) return 'Pick the carrier before approving.';
  if (charge.invoiceId) return 'This charge is on a carrier invoice — approve the invoice instead.';
  if (carrier.paymentTerms === PAYMENT_TERMS.PER_INVOICE) return `${carrier.name} is paid per invoice — add this charge to their invoice and approve that.`;
  return null;
}

export function unapproveProblem(charge) {
  if (!charge) return 'Charge not found.';
  if (charge.status !== 'approved') return 'Only an approved charge can go back to approval.';
  if (charge.invoiceId) return 'This charge is on a carrier invoice — change the invoice instead.';
  return null;
}

/**
 * Can this charge be marked paid? `canApprove`: the person also holds
 * Approve, so a draft is approved and paid in one step (approveProblem's
 * checks apply). `carrier` is the charge's carrier, for those checks.
 */
export function payProblem(charge, { carrier = null, canApprove = false } = {}) {
  if (!charge) return 'Charge not found.';
  if (charge.status === 'paid') return 'This charge is already paid.';
  if (charge.status === 'void') return "A void charge can't be paid.";
  if (charge.invoiceId) return 'This charge is on a carrier invoice — pay the invoice instead.';
  const flagged = flagProblem(charge);
  if (flagged) return flagged;
  if (charge.status === 'draft') {
    if (!canApprove) return 'Approve the charge before marking it paid — or ask someone who can approve.';
    return approveProblem(charge, carrier);
  }
  return null;
}

/** Paying it also approves it (a draft paid in one step). */
export const approvesWhenPaid = (record) => record?.status === 'draft';

/**
 * One payment is money to one carrier — a check is written to one payee — so
 * a batch marked paid together must be for a single carrier.
 */
export function paymentBatchProblem(charges = []) {
  if (!charges.length) return 'Pick at least one charge.';
  const carriers = new Set(charges.map((c) => String(c.carrierId || '')));
  if (carriers.size > 1) return 'A payment goes to one carrier — mark each carrier’s charges paid separately.';
  return null;
}

export function voidProblem(charge) {
  if (!charge) return 'Charge not found.';
  if (charge.status === 'paid') return "A paid charge can't be voided.";
  if (charge.status === 'void') return 'This charge is already void.';
  if (charge.invoiceId) return 'This charge is on a carrier invoice — remove it from the invoice first.';
  return null;
}

// ── Carrier invoices ─────────────────────────────────────────────────────

/** Can these charges go on one invoice for `carrierId`? null or a reason. */
export function invoiceChargesProblem(charges = [], carrierId, { invoiceId = null } = {}) {
  if (!charges.length) return 'Pick at least one charge for the invoice.';
  for (const c of charges) {
    if (String(c.carrierId || '') !== String(carrierId)) return `SO# ${c.soNumber || '—'} is for a different carrier.`;
    if (c.status !== 'draft') return `SO# ${c.soNumber || '—'} is ${STATUS_LABELS[c.status].toLowerCase()} — only charges waiting for approval can go on an invoice.`;
    if (c.invoiceId && String(c.invoiceId) !== String(invoiceId || '')) return `SO# ${c.soNumber || '—'} is already on another invoice.`;
  }
  return null;
}

/** Can the invoice be approved? Its total must equal its charges exactly. */
export function invoiceApproveProblem(invoice, charges = []) {
  if (!invoice) return 'Invoice not found.';
  if (invoice.status !== 'draft') return 'Only an invoice waiting for approval can be approved.';
  if (!charges.length) return 'The invoice has no charges.';
  const flagged = charges.find((c) => openFlags(c).length);
  if (flagged) return `SO# ${flagged.soNumber || '—'}: ${flagProblem(flagged)}`;
  const missing = charges.find((c) => !isValidAmount(c.amountCents));
  if (missing) return `SO# ${missing.soNumber || '—'} has no amount yet.`;
  const sum = sumCents(charges.map((c) => c.amountCents));
  if (sum !== invoice.totalCents) {
    return `The charges add up to $${(sum / 100).toFixed(2)}, but the invoice total is $${(invoice.totalCents / 100).toFixed(2)}.`;
  }
  return null;
}

/** As payProblem, for a carrier invoice and its charges. */
export function invoicePayProblem(invoice, charges = [], { canApprove = false } = {}) {
  if (!invoice) return 'Invoice not found.';
  if (invoice.status === 'paid') return 'This invoice is already paid.';
  if (invoice.status === 'void') return "A void invoice can't be paid.";
  const flagged = charges.find((c) => openFlags(c).length);
  if (flagged) return `SO# ${flagged.soNumber || '—'}: ${flagProblem(flagged)}`;
  if (invoice.status === 'draft') {
    if (!canApprove) return 'Approve the invoice before marking it paid — or ask someone who can approve.';
    return invoiceApproveProblem(invoice, charges);
  }
  return null;
}

export function invoiceVoidProblem(invoice) {
  if (!invoice) return 'Invoice not found.';
  if (invoice.status === 'paid') return "A paid invoice can't be voided.";
  if (invoice.status === 'void') return 'This invoice is already void.';
  return null;
}

// ── Branches ─────────────────────────────────────────────────────────────

/** Accounting staff see their assigned branches ('*' = every branch). */
export const canSeeBranch = (userLocations = [], location) =>
  userLocations.includes('*') || userLocations.includes(location);

/** A Mongo clause limiting charges to the user's branches (and an optional pick). */
export function branchClause(userLocations = [], requested = '') {
  if (requested) return canSeeBranch(userLocations, requested) ? { location: requested } : null;
  if (userLocations.includes('*')) return {};
  return { location: { $in: userLocations } };
}
