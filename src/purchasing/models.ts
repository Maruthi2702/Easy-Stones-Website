import mongoose from 'mongoose';
import type { Model, Schema as SchemaType } from 'mongoose';
const { Schema } = mongoose;
const options = { timestamps: true, optimisticConcurrency: true };
const scope = new Schema(
  {
    name: String,
    branches: [String],
    cohortId: String,
    cohortRevision: String,
    observedThrough: String,
    salesCoverageConfirmation: {
      type: new Schema({
        cohortId: { type: String, required: true }, through: { type: String, required: true },
        confirmedAt: { type: Date, required: true },
        confirmedBy: { id: { type: String, default: null }, name: { type: String, required: true } },
        source: { type: String, enum: ['scope-form', 'owner-confirmation'], required: true },
      }, { _id: false }), default: null,
    },
    fullSalesCoverage: Boolean,
    stockSnapshotId: String,
    stockCoverageConfirmed: Boolean,
    freeStockValidated: Boolean,
    policyConfirmed: Boolean,
    reviewDays: { type: Number, default: 7 },
    bufferDays: { type: Number, default: 21 },
    stockMaxHours: { type: Number, default: 24 },
    salesMaxDays: { type: Number, default: 14 },
    aliases: [{ _id: false, salesProduct: String, stockProduct: String }],
    policies: [
      {
        _id: false,
        product: String,
        supplier: String,
        bundleSlabs: Number,
        minimumSlabs: Number,
        sfPerSlab: Number,
        weightKg: Number,
        mixGroup: String,
        active: Boolean,
      },
    ],
    container: {
      payloadKg: Number,
      tareKg: Number,
      maxSlabs: Number,
      layoutConfirmed: Boolean,
      mixingConfirmed: Boolean,
    },
    updatedBy: String,
  },
  { ...options, collection: 'purchasing_scopes' },
);
const inbound = new Schema(
  {
    scopeId: { type: Schema.Types.ObjectId, required: true, index: true },
    complete: Boolean,
    branches: { type: [String], default: undefined },
    importedBy: String,
    rows: [Schema.Types.Mixed],
    receipts: [Schema.Types.Mixed],
  },
  { ...options, collection: 'purchasing_inbound' },
);
inbound.index({ scopeId: 1, createdAt: -1 });
const draft = new Schema(
  {
    scopeId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ['draft', 'approved', 'ordered', 'cancelled'], default: 'draft' },
    fingerprint: String,
    inputSnapshot: Schema.Types.Mixed,
    lines: [Schema.Types.Mixed],
    loads: [Schema.Types.Mixed],
    note: String,
    createdBy: { id: String, name: String },
    existingPoLines: [String],
    existingTransitParents: [String],
    linkedPoLines: [String],
    history: [{ _id: false, action: String, at: Date, name: String, note: String }],
  },
  { ...options, collection: 'purchasing_drafts' },
);
draft.index({ scopeId: 1, createdAt: -1 });
// A scope-wide product is reserved at every member branch, preventing a second
// buyer from using an overlapping single-branch or network scope for that color.
const lock = new Schema(
  { _id: String, draftId: { type: Schema.Types.ObjectId, required: true }, scopeId: Schema.Types.ObjectId },
  { collection: 'purchasing_locks' },
);
lock.index({ draftId: 1 });
const model = <T>(name: string, schema: SchemaType<T>): Model<T> => (mongoose.models[name] as Model<T> | undefined) || mongoose.model<T>(name, schema);
export const PurchasingScope = model('PurchasingScope', scope);
export const PurchasingInbound = model('PurchasingInbound', inbound);
export const PurchasingDraft = model('PurchasingDraft', draft);
export const PurchasingLock = model('PurchasingLock', lock);
export const PurchasingPoLink = model(
  'PurchasingPoLink',
  new Schema(
    { _id: String, draftId: { type: Schema.Types.ObjectId, required: true } },
    { collection: 'purchasing_po_links' },
  ),
);
