import mongoose from 'mongoose';

/**
 * One payment taken at a branch (src/utils/paymentsReceived.ts for the rules,
 * src/routes/paymentsReceived.ts for the API). The Daily Report's Payments
 * grid is meant to become the sum of these, once the owner has tested the
 * page and confirmed the switch-over.
 *
 * `_id` is made by the screen before it saves, so a repeated save of the same
 * payment finds it instead of adding a second one. Amounts are whole cents; a
 * Return is negative. A payment is never deleted: a void keeps it, struck
 * through, and every add, edit and void is kept in `history`.
 */
const historySchema = new mongoose.Schema({
  at: { type: Date, required: true },
  by: { type: String, default: '' },
  action: { type: String, enum: ['added', 'edited', 'voided'], required: true },
  changes: { type: String, default: '' }
}, { _id: false });

const paymentReceivedSchema = new mongoose.Schema({
  location: { type: String, required: true },
  // The branch's calendar day, 'YYYY-MM-DD' — the Daily Report's day.
  date: { type: String, required: true },
  customerId: { type: String, required: true },
  // As the dropdown showed it when saved, so a renamed or deleted customer
  // still reads on an old day.
  customerName: { type: String, required: true },
  method: { type: String, enum: ['ach', 'cash', 'card', 'check', 'return'], required: true },
  cents: { type: Number, required: true },
  invoice: { type: String, default: '' },
  reference: { type: String, default: '' },
  note: { type: String, default: '' },
  enteredBy: { type: String, default: '' },
  updatedBy: { type: String, default: '' },
  voidedAt: { type: Date, default: null },
  voidedBy: { type: String, default: '' },
  voidReason: { type: String, default: '' },
  history: { type: [historySchema], default: [] }
}, { timestamps: true });

// A branch's day is the only way the page and the report read them.
paymentReceivedSchema.index({ location: 1, date: 1 });

type PaymentReceivedDoc = mongoose.InferSchemaType<typeof paymentReceivedSchema>;
const PaymentReceived: mongoose.Model<PaymentReceivedDoc> = (mongoose.models.PaymentReceived as mongoose.Model<PaymentReceivedDoc> | undefined)
  || mongoose.model('PaymentReceived', paymentReceivedSchema);
export default PaymentReceived;
