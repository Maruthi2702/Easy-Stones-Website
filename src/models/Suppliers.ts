import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * Supplier POs (rules: src/utils/supplierBlocks.ts; staff API:
 * src/routes/suppliers.ts; supplier portal API: src/routes/supplierPortal.ts).
 *
 *   Supplier       a company we buy from, matched to SPS by `spsKey`
 *   SupplierLogin  a person who signs in to the supplier portal (one per supplier for now)
 *   SupplierPO     a PO assigned to a supplier: its material lines (no prices, ever)
 *   SupplierBlock  a block the supplier offers against one line, with its bundles
 *
 * History is pushed, never trimmed; nothing here is deleted except a block
 * the supplier never sent.
 */

const historySchema = new mongoose.Schema({
  at: { type: Date, required: true },
  by: { type: String, default: '' },
  /** 'staff' or 'supplier' — who did it. */
  side: { type: String, default: 'staff' },
  action: { type: String, required: true },
  changes: { type: String, default: '' }
}, { _id: false });

const noteSchema = new mongoose.Schema({
  text: { type: String, default: '' },
  lang: { type: String, default: 'en' },
  translations: { type: mongoose.Schema.Types.Mixed, default: null },
  by: { type: String, default: '' },
  at: { type: Date, default: null }
}, { _id: false });

// ── Supplier ───────────────────────────────────────────────────────────────

const supplierSchema = new mongoose.Schema({
  name: { type: String, required: true },
  // SPS's supplier name, trimmed and lowercased (spsKey): how an SPS PO finds us.
  spsName: { type: String, default: '' },
  spsKey: { type: String, default: '' },
  country: { type: String, default: '' },
  language: { type: String, default: 'en' },
  timeZone: { type: String, default: '' },
  contactName: { type: String, default: '' },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  notes: { type: String, default: '' },
  active: { type: Boolean, default: true },
  createdBy: { type: String, default: '' },
  history: { type: [historySchema], default: [] }
}, { timestamps: true });
supplierSchema.index({ spsKey: 1 }, { unique: true, partialFilterExpression: { spsKey: { $gt: '' } } });
supplierSchema.index({ name: 1 });

// ── Supplier login ─────────────────────────────────────────────────────────

const supplierLoginSchema = new mongoose.Schema({
  supplierId: { type: String, required: true },
  name: { type: String, required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  password: { type: String, default: '' },
  language: { type: String, default: 'en' },
  active: { type: Boolean, default: true },
  // Bumped on every password change and when the login is turned off: older sessions end.
  sessionVersion: { type: Number, default: 0 },
  // An invite or reset link: only its hash is kept; one use, 7 days.
  linkTokenHash: { type: String, default: '' },
  linkExpiresAt: { type: Date, default: null },
  loginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Date, default: null },
  lastLoginAt: { type: Date, default: null },
  lastSeenAt: { type: Date, default: null },
  invitedAt: { type: Date, default: null },
  invitedBy: { type: String, default: '' }
}, { timestamps: true });
supplierLoginSchema.index({ email: 1 }, { unique: true });
supplierLoginSchema.index({ supplierId: 1 });
supplierLoginSchema.index({ linkTokenHash: 1 }, { partialFilterExpression: { linkTokenHash: { $gt: '' } } });

supplierLoginSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return;
  this.password = await bcrypt.hash(this.password, await bcrypt.genSalt(10));
});

// ── PO ─────────────────────────────────────────────────────────────────────

const poLineSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  material: { type: String, required: true },
  thickness: { type: String, default: '' },
  finish: { type: String, default: '' },
  slabs: { type: Number, required: true },
  note: { type: String, default: '' }
}, { _id: false });

const supplierPoSchema = new mongoose.Schema({
  // poKey(): trimmed, upper case. One PO per number, typed or from SPS.
  poNumber: { type: String, required: true },
  supplierId: { type: String, required: true },
  supplierName: { type: String, default: '' },
  shipTo: { type: String, default: '' },
  readyBy: { type: String, default: '' },
  buyerId: { type: String, default: '' },
  buyerName: { type: String, default: '' },
  lines: { type: [poLineSchema], default: [] },
  note: { type: noteSchema, default: null },
  source: { type: String, enum: ['typed', 'sps'], default: 'typed' },
  status: { type: String, enum: ['open', 'closed', 'cancelled'], default: 'open' },
  statusReason: { type: String, default: '' },
  // When the supplier was given it (a reassignment restarts it): the scorecard's start.
  assignedAt: { type: Date, default: null },
  createdBy: { type: String, default: '' },
  history: { type: [historySchema], default: [] }
}, { timestamps: true, optimisticConcurrency: true });
supplierPoSchema.index({ poNumber: 1 }, { unique: true });
supplierPoSchema.index({ supplierId: 1, status: 1 });
supplierPoSchema.index({ status: 1, updatedAt: -1 });

// ── Block ──────────────────────────────────────────────────────────────────

const stepSchema = new mongoose.Schema({
  decision: { type: String, enum: ['approve', 'reject', 'retake'], required: true },
  by: { type: String, default: '' },
  byName: { type: String, default: '' },
  at: { type: Date, required: true },
  reason: { type: String, default: '' }
}, { _id: false });

const photoSchema = new mongoose.Schema({ url: { type: String, default: '' }, at: { type: Date, default: null } }, { _id: false });
const unlockSchema = new mongoose.Schema({ by: { type: String, default: '' }, at: { type: Date, default: null }, reason: { type: String, default: '' } }, { _id: false });
const sizeSchema = new mongoose.Schema({ length: Number, height: Number, unit: { type: String, enum: ['in', 'cm'], default: 'in' } }, { _id: false });

const bundleSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  n: { type: Number, required: true },
  slabs: { type: Number, default: null },
  photoUrl: { type: String, default: '' },
  photoAt: { type: Date, default: null },
  previousPhotos: { type: [photoSchema], default: [] },
  status: { type: String, enum: ['draft', 'review', 'final', 'approved', 'rejected', 'retake', 'unlocked'], default: 'draft' },
  round: { type: Number, default: 0 },
  sentAt: { type: Date, default: null },
  step1: { type: stepSchema, default: null },
  step2: { type: stepSchema, default: null },
  reason: { type: String, default: '' },
  comment: { type: noteSchema, default: null },
  unlock: { type: unlockSchema, default: null }
}, { _id: false });

const supplierBlockSchema = new mongoose.Schema({
  poId: { type: String, required: true },
  poNumber: { type: String, required: true },
  supplierId: { type: String, required: true },
  lineId: { type: String, required: true },
  // Copied from the PO line when offered, so an edit to the PO doesn't rename an offered block.
  material: { type: String, default: '' },
  thickness: { type: String, default: '' },
  finish: { type: String, default: '' },
  blockNumber: { type: String, default: '' },
  size: { type: sizeSchema, default: null },
  note: { type: noteSchema, default: null },
  // The last message staff sent with their decisions, for the supplier's result screen.
  decisionNote: { type: noteSchema, default: null },
  bundles: { type: [bundleSchema], default: [] },
  // blockStage(): kept for listing and counting; recomputed on every save.
  stage: { type: String, default: 'draft' },
  firstSentAt: { type: Date, default: null },
  sentAt: { type: Date, default: null },
  createdBy: { type: String, default: '' },
  history: { type: [historySchema], default: [] }
  // Two reviewers (or a reviewer and the supplier) saving the same block at
  // once: the second save fails with a VersionError (answered 409, reload)
  // instead of quietly undoing the first.
}, { timestamps: true, optimisticConcurrency: true });
supplierBlockSchema.index({ poId: 1 });
supplierBlockSchema.index({ supplierId: 1, stage: 1 });
supplierBlockSchema.index({ stage: 1, sentAt: 1 });
supplierBlockSchema.index({ 'bundles.status': 1 });

type SupplierDoc = mongoose.InferSchemaType<typeof supplierSchema>;
type LoginDoc = mongoose.InferSchemaType<typeof supplierLoginSchema>;
type PoDoc = mongoose.InferSchemaType<typeof supplierPoSchema>;
type BlockDoc = mongoose.InferSchemaType<typeof supplierBlockSchema>;

export const Supplier: mongoose.Model<SupplierDoc> = (mongoose.models.Supplier as mongoose.Model<SupplierDoc> | undefined)
  || mongoose.model('Supplier', supplierSchema);
export const SupplierLogin: mongoose.Model<LoginDoc> = (mongoose.models.SupplierLogin as mongoose.Model<LoginDoc> | undefined)
  || mongoose.model('SupplierLogin', supplierLoginSchema);
export const SupplierPO: mongoose.Model<PoDoc> = (mongoose.models.SupplierPO as mongoose.Model<PoDoc> | undefined)
  || mongoose.model('SupplierPO', supplierPoSchema);
export const SupplierBlock: mongoose.Model<BlockDoc> = (mongoose.models.SupplierBlock as mongoose.Model<BlockDoc> | undefined)
  || mongoose.model('SupplierBlock', supplierBlockSchema);

export const SUPPLIER_MODELS = [Supplier, SupplierLogin, SupplierPO, SupplierBlock] as const;
