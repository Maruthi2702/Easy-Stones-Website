/**
 * Accounting's records (2026-10-09). Their own collections (acct_*), so
 * nothing else in the app writes them by accident, and every one of them is
 * reached only through src/accounting/ — the one folder a later move to
 * another database would touch.
 *
 * Money is whole cents (see money.js). `__v` is the version a client must
 * send back with an edit, so two people can't silently overwrite each other.
 */
import mongoose from 'mongoose';
import { CHARGE_STATUSES, INVOICE_STATUSES, PAYMENT_TERMS, PAYMENT_METHODS } from './freightRules.js';
import { newTxnId } from './ids.js';

const { Schema } = mongoose;

const person = { id: { type: String, default: '' }, name: { type: String, default: '' } };
const cents = { type: Number, default: null, validate: { validator: (v) => v === null || Number.isSafeInteger(v), message: 'Amounts are whole cents' } };

const paymentSchema = new Schema({
  // The payment (acct_payments) this was paid by: PAY-YYYYMMDD-XXXXXXXX.
  paymentId: { type: String, default: '' },
  paidOn: { type: String, default: '' },          // YYYY-MM-DD the money went out
  method: { type: String, enum: [...PAYMENT_METHODS, ''], default: '' },
  reference: { type: String, default: '' },       // check # / ACH ref
  recordedAt: { type: Date, default: null },
  recordedBy: person
}, { _id: false });

// ── Carrier ──────────────────────────────────────────────────────────────
const carrierSchema = new Schema({
  name: { type: String, required: true, trim: true },
  // normalizeCarrierName(name) — unique, so "ABC Freight Inc" can't be added twice.
  nameKey: { type: String, required: true, unique: true },
  aliases: [{ type: String, trim: true }],
  paymentTerms: { type: String, enum: Object.values(PAYMENT_TERMS), default: PAYMENT_TERMS.PER_DELIVERY },
  active: { type: Boolean, default: true },
  notes: { type: String, default: '' },
  createdBy: person,
  updatedBy: person
}, { timestamps: true, optimisticConcurrency: true, collection: 'acct_carriers' });

// ── Freight charge ───────────────────────────────────────────────────────
const flagSchema = new Schema({
  code: { type: String, enum: ['delivery_reopened', 'delivery_changed'], required: true },
  detail: { type: String, default: '' },
  at: { type: Date, default: Date.now },
  resolvedAt: { type: Date, default: null },
  resolvedBy: person
}, { _id: true });

const derivedSnapshot = {
  soNumber: String, customerName: String, deliveryDate: String, location: String,
  carrierNameRaw: String, bolNumber: String, amountCents: Number
};

const chargeSchema = new Schema({
  source: { type: String, enum: ['delivery', 'manual'], required: true },
  // One charge per delivery. Sparse: hand-added charges have none.
  deliveryId: { type: String, default: undefined },
  soNumber: { type: String, default: '' },
  customerName: { type: String, default: '' },
  deliveryDate: { type: String, default: '', index: true },
  location: { type: String, default: '', index: true },
  carrierId: { type: Schema.Types.ObjectId, ref: 'AcctCarrier', default: null, index: true },
  carrierNameRaw: { type: String, default: '' },
  bolNumber: { type: String, default: '' },
  amountCents: cents,
  description: { type: String, default: '' },
  notes: { type: String, default: '' },
  status: { type: String, enum: CHARGE_STATUSES, default: 'draft', index: true },
  invoiceId: { type: Schema.Types.ObjectId, ref: 'AcctCarrierInvoice', default: null, index: true },
  // What the delivery said the last time it was read, and which fields a person
  // corrected by hand (those stop following the schedule).
  sourceSnapshot: derivedSnapshot,
  handSet: [{ type: String }],
  flags: [flagSchema],
  approvedAt: { type: Date, default: null },
  approvedBy: person,
  payment: { type: paymentSchema, default: () => ({}) },
  voidedAt: { type: Date, default: null },
  voidedBy: person,
  voidReason: { type: String, default: '' },
  createdBy: person,
  updatedBy: person
}, { timestamps: true, optimisticConcurrency: true, collection: 'acct_freight_charges' });

chargeSchema.index({ deliveryId: 1 }, { unique: true, partialFilterExpression: { deliveryId: { $type: 'string' } } });
chargeSchema.index({ location: 1, status: 1, deliveryDate: -1 });

// ── Carrier invoice ──────────────────────────────────────────────────────
const invoiceSchema = new Schema({
  carrierId: { type: Schema.Types.ObjectId, ref: 'AcctCarrier', required: true, index: true },
  invoiceNumber: { type: String, required: true, trim: true },
  invoiceDate: { type: String, default: '' },
  totalCents: { ...cents, default: undefined, required: true },
  chargeIds: [{ type: Schema.Types.ObjectId, ref: 'AcctFreightCharge' }],
  // The branches of its charges, so branch scoping can check an invoice
  // without loading every charge.
  locations: [{ type: String }],
  status: { type: String, enum: INVOICE_STATUSES, default: 'draft', index: true },
  notes: { type: String, default: '' },
  approvedAt: { type: Date, default: null },
  approvedBy: person,
  payment: { type: paymentSchema, default: () => ({}) },
  voidedAt: { type: Date, default: null },
  voidedBy: person,
  voidReason: { type: String, default: '' },
  createdBy: person,
  updatedBy: person
}, { timestamps: true, optimisticConcurrency: true, collection: 'acct_carrier_invoices' });

invoiceSchema.index({ carrierId: 1, invoiceNumber: 1 }, { unique: true });

// ── History (append-only) ────────────────────────────────────────────────
const auditSchema = new Schema({
  // Every entry's own ID (TX-YYYYMMDD-XXXXXXXX, ids.js), set when it's written.
  txnId: { type: String, required: true, unique: true, default: () => newTxnId() },
  // The payment it belongs to, on 'approved' / 'paid' lines written by a payment.
  paymentId: { type: String, default: '' },
  entityType: { type: String, enum: ['charge', 'invoice', 'carrier'], required: true },
  entityId: { type: String, required: true },
  action: { type: String, required: true },
  by: person,
  at: { type: Date, default: Date.now },
  changes: [{ _id: false, field: String, from: Schema.Types.Mixed, to: Schema.Types.Mixed }],
  note: { type: String, default: '' }
}, { collection: 'acct_audit', versionKey: false });

auditSchema.index({ entityType: 1, entityId: 1, at: -1 });
auditSchema.index({ paymentId: 1 }, { partialFilterExpression: { paymentId: { $gt: '' } } });

// ── Payments (append-only) ───────────────────────────────────────────────
// The payment register: one row per Mark paid — the money that went out to
// one carrier and exactly which charges (or which invoice) it paid. Its
// paymentId is copied onto each of those charges and onto their history
// lines, so a check stub, a charge and the register all point at each other.
// `requestId` is the browser's ID for that one click: the same request sent
// twice (a double-click, a retry after a dropped connection) finds this row
// and returns it instead of paying again.
const paymentRecordSchema = new Schema({
  paymentId: { type: String, required: true, unique: true },
  requestId: { type: String, default: undefined },
  kind: { type: String, enum: ['charges', 'invoice'], required: true },
  carrierId: { type: Schema.Types.ObjectId, ref: 'AcctCarrier', default: null, index: true },
  invoiceId: { type: Schema.Types.ObjectId, ref: 'AcctCarrierInvoice', default: null },
  chargeIds: [{ type: Schema.Types.ObjectId, ref: 'AcctFreightCharge' }],
  locations: [{ type: String }],
  totalCents: { ...cents, default: undefined, required: true },
  paidOn: { type: String, required: true },
  method: { type: String, enum: PAYMENT_METHODS, required: true },
  reference: { type: String, default: '' },
  // True when some of what it paid was approved by this same payment.
  approvedInSameStep: { type: Boolean, default: false },
  recordedAt: { type: Date, default: Date.now },
  recordedBy: person
}, { collection: 'acct_payments', versionKey: false });

paymentRecordSchema.index({ requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: 'string' } } });
paymentRecordSchema.index({ paidOn: -1 });

// History is never edited or removed — any attempt is a bug, so it throws.
const refuse = function refuse() {
  throw new Error('Accounting history is append-only');
};
for (const schema of [auditSchema, paymentRecordSchema]) {
  for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
    'deleteOne', 'deleteMany', 'findOneAndDelete']) {
    schema.pre(op, refuse);
  }
  schema.pre('save', function onlyNew() {
    if (!this.isNew) throw new Error('Accounting history is append-only');
  });
}

const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

export const Carrier = model('AcctCarrier', carrierSchema);
export const FreightCharge = model('AcctFreightCharge', chargeSchema);
export const CarrierInvoice = model('AcctCarrierInvoice', invoiceSchema);
export const AccountingAudit = model('AcctAudit', auditSchema);
export const Payment = model('AcctPayment', paymentRecordSchema);
