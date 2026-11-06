import mongoose from 'mongoose';

/**
 * Credit Card Receipts (src/utils/cardReceipts.ts for the rules,
 * src/routes/cardReceipts.ts for the API).
 *
 *   CompanyCard     one per person: the card ID accounting uses (MARU92069).
 *   ReceiptCategory the Admin list staff pick from (Travel Lunch, Customer Lunch…).
 *   CardExpense     one per receipt, made by the cardholder's upload.
 */

const companyCardSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  label: { type: String, required: true },
  issuer: { type: String, enum: ['amex', 'other'], default: 'amex' },
  lastDigits: { type: String, required: true },
  active: { type: Boolean, default: true },
  updatedBy: { type: String, default: '' }
}, { timestamps: true });
// One card per person: a person holds at most one active card, and a card ID names one card.
companyCardSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { active: true } });
companyCardSchema.index({ label: 1 }, { unique: true, partialFilterExpression: { active: true } });

const receiptCategorySchema = new mongoose.Schema({
  // Stored on expenses and never changes; `label` is what staff read.
  name: { type: String, required: true, unique: true },
  label: { type: String, required: true },
  order: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  fields: {
    customer: { type: Boolean, default: false },
    attendees: { type: Boolean, default: false },
    purpose: { type: Boolean, default: false },
    recurring: { type: Boolean, default: false }
  },
  updatedBy: { type: String, default: '' }
}, { timestamps: true });

const historySchema = new mongoose.Schema({
  at: { type: Date, required: true },
  by: { type: String, default: '' },
  action: { type: String, required: true },
  changes: { type: String, default: '' }
}, { _id: false });

const decisionSchema = new mongoose.Schema({
  by: { type: String, default: '' },
  byName: { type: String, default: '' },
  at: { type: Date, required: true },
  comment: { type: String, default: '' }
}, { _id: false });

const cardExpenseSchema = new mongoose.Schema({
  // The cardholder (who uploaded it) and their card, as they were when saved.
  userId: { type: String, required: true },
  holderName: { type: String, default: '' },
  cardId: { type: String, required: true },
  cardLabel: { type: String, required: true },
  // The cardholder's home location when it was saved, so a later move keeps
  // old expenses where they were.
  location: { type: String, default: '' },
  // 'YYYY-MM-DD', the day on the receipt; `month` is its first 7 characters.
  date: { type: String, required: true },
  month: { type: String, required: true },
  merchant: { type: String, required: true },
  cents: { type: Number, required: true },
  subtotalCents: { type: Number, default: null },
  taxCents: { type: Number, default: null },
  tipCents: { type: Number, default: null },
  category: { type: String, default: '' },
  customerId: { type: String, default: '' },
  customerName: { type: String, default: '' },
  attendees: { type: [String], default: [] },
  purpose: { type: String, default: '' },
  note: { type: String, default: '' },
  recurring: { type: Boolean, default: false },
  receiptUrl: { type: String, default: '' },
  lostReason: { type: String, default: '' },
  status: { type: String, enum: ['missing', 'draft', 'waiting', 'sent_back', 'approved'], required: true },
  approval: { type: decisionSchema, default: null },
  sentBack: { type: decisionSchema, default: null },
  createdBy: { type: String, default: '' },
  voidedAt: { type: Date, default: null },
  voidedBy: { type: String, default: '' },
  voidReason: { type: String, default: '' },
  history: { type: [historySchema], default: [] }
}, { timestamps: true });

cardExpenseSchema.index({ month: 1, date: -1 });
cardExpenseSchema.index({ userId: 1, month: 1 });
cardExpenseSchema.index({ status: 1, userId: 1 });

type CardDoc = mongoose.InferSchemaType<typeof companyCardSchema>;
type CategoryDoc = mongoose.InferSchemaType<typeof receiptCategorySchema>;
type ExpenseDoc = mongoose.InferSchemaType<typeof cardExpenseSchema>;

export const CompanyCard: mongoose.Model<CardDoc> = (mongoose.models.CompanyCard as mongoose.Model<CardDoc> | undefined)
  || mongoose.model('CompanyCard', companyCardSchema);
export const ReceiptCategory: mongoose.Model<CategoryDoc> = (mongoose.models.ReceiptCategory as mongoose.Model<CategoryDoc> | undefined)
  || mongoose.model('ReceiptCategory', receiptCategorySchema);
export const CardExpense: mongoose.Model<ExpenseDoc> = (mongoose.models.CardExpense as mongoose.Model<ExpenseDoc> | undefined)
  || mongoose.model('CardExpense', cardExpenseSchema);
