/**
 * Cart & Holds records (2026-10-10), in their own collections and reached only
 * through src/holds/.
 *
 *   Cart             one per person: the slabs they've picked, an optional
 *                    customer, a note per slab. Reserves nothing.
 *   Hold             a numbered reservation for a customer, with a snapshot of
 *                    every slab and its price, so an SPS import never changes it.
 *   SlabReservation  the lock: one document per slab on an active hold. The
 *                    unique index on slabKey is what makes double-booking
 *                    impossible, even for two people clicking at once.
 *   Counter          hold numbers, 1, 2, 3… issued inside the save itself.
 *   HoldHistory      every change, append-only.
 *
 * `__v` is the version a client sends back with an edit (optimisticConcurrency),
 * so a stale screen can't overwrite someone else's change.
 */
import mongoose from 'mongoose';
import { HOLD_STATUSES } from './holdRules.js';

const { Schema } = mongoose;

const person = { _id: false, id: { type: String, default: '' }, name: { type: String, default: '' } };
const wholeNumber = (field) => ({ validator: (v) => v === null || v === undefined || Number.isSafeInteger(v), message: `${field} must be a whole number` });

// ── Cart ─────────────────────────────────────────────────────────────────
const cartLineSchema = new Schema({
  slabKey: { type: String, required: true },
  product: { type: String, default: '' },
  note: { type: String, default: '', maxlength: 300 },
  addedAt: { type: Date, default: Date.now }
}, { _id: false });

const cartSchema = new Schema({
  userId: { type: String, required: true, unique: true },
  // Shown to others as "Maria has it in her cart".
  userName: { type: String, default: '' },
  customer: {
    type: new Schema({ id: { type: String, default: '' }, name: { type: String, default: '' } }, { _id: false }),
    default: null
  },
  lines: { type: [cartLineSchema], default: [] }
}, { timestamps: true, collection: 'sales_carts' });

cartSchema.index({ 'lines.slabKey': 1 });

// ── Hold ─────────────────────────────────────────────────────────────────
const holdLineSchema = new Schema({
  slabKey: { type: String, required: true },
  serial: { type: String, default: '' },
  barcode: { type: String, default: '' },
  product: { type: String, default: '' },
  category: { type: String, default: '' },
  bundle: { type: String, default: '' },
  slabNumber: { type: String, default: '' },
  block: { type: String, default: '' },
  bin: { type: String, default: '' },
  location: { type: String, default: '' },
  dimensions: { type: String, default: '' },
  sfHundredths: { type: Number, required: true, validate: wholeNumber('SF') },
  priceCentsPerSf: { type: Number, default: null, validate: wholeNumber('Price') },
  note: { type: String, default: '', maxlength: 300 }
}, { _id: false });

const customerSnapshot = new Schema({
  id: { type: String, default: '' },
  name: { type: String, default: '' },
  contact: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  address: { type: String, default: '' }
}, { _id: false });

const holdSchema = new Schema({
  number: { type: Number, required: true, unique: true },
  status: { type: String, enum: HOLD_STATUSES, default: 'active', index: true },
  branch: { type: String, required: true, index: true },
  customer: { type: customerSnapshot, required: true },
  job: { type: String, default: '', maxlength: 200 },
  notes: { type: String, default: '', maxlength: 2000 },
  commissionNotes: { type: String, default: '', maxlength: 500 },
  chanceToClose: { type: Number, default: null, min: 0, max: 100 },
  expiresOn: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: true },
  releaseAt: { type: Date, required: true, index: true },
  // When the release job logged "expired" (cleared again if it's extended).
  expiredNotedAt: { type: Date, default: null },
  lines: { type: [holdLineSchema], default: [] },
  // Searchable copies, kept in step with `lines` on every save.
  slabKeys: { type: [String], default: [], index: true },
  createdBy: { type: person, default: () => ({}) },
  updatedBy: { type: person, default: () => ({}) },
  releasedAt: { type: Date, default: null },
  releasedBy: { type: person, default: null },
  releaseReason: { type: String, default: '' },
  // The create request's one-time id: a double tap gets the same hold back.
  requestId: { type: String, default: undefined }
}, { timestamps: true, optimisticConcurrency: true, collection: 'sales_holds' });

holdSchema.index({ requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: 'string' } } });
holdSchema.index({ status: 1, branch: 1, createdAt: -1 });
holdSchema.index({ 'createdBy.id': 1, createdAt: -1 });
holdSchema.pre('validate', function syncKeys() {
  this.slabKeys = (this.lines || []).map((l) => l.slabKey);
});

// ── Lock ─────────────────────────────────────────────────────────────────
const reservationSchema = new Schema({
  slabKey: { type: String, required: true, unique: true },
  holdId: { type: Schema.Types.ObjectId, required: true, index: true },
  holdNumber: { type: Number, required: true },
  customerName: { type: String, default: '' },
  branch: { type: String, default: '' },
  by: { type: person, default: () => ({}) },
  expiresOn: { type: String, default: '' }
}, { timestamps: true, collection: 'sales_slab_reservations' });

// ── Numbers ──────────────────────────────────────────────────────────────
const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
}, { collection: 'sales_counters', versionKey: false });

// ── History (append-only) ────────────────────────────────────────────────
const historySchema = new Schema({
  holdId: { type: Schema.Types.ObjectId, required: true },
  holdNumber: { type: Number, required: true },
  action: { type: String, required: true },
  by: { type: person, default: () => ({}) },
  at: { type: Date, default: Date.now },
  changes: [{ _id: false, field: String, from: Schema.Types.Mixed, to: Schema.Types.Mixed }],
  note: { type: String, default: '' }
}, { collection: 'sales_hold_history', versionKey: false });

historySchema.index({ holdId: 1, at: -1 });

const refuse = function refuse() { throw new Error('Hold history is append-only'); };
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  historySchema.pre(op, refuse);
}
historySchema.pre('save', function onlyNew() {
  if (!this.isNew) throw new Error('Hold history is append-only');
});

const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

export const Cart = model('SalesCart', cartSchema);
export const Hold = model('SalesHold', holdSchema);
export const SlabReservation = model('SalesSlabReservation', reservationSchema);
export const Counter = model('SalesCounter', counterSchema);
export const HoldHistory = model('SalesHoldHistory', historySchema);

/** The next number for `name` (e.g. 'hold'): 1, 2, 3… — inside the caller's transaction. */
export async function nextNumber(name, session) {
  const doc = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', session }
  );
  return doc.seq;
}
