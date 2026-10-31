// Legacy BSON records remain flexible; runtime schemas still validate every write.
import type { Loose } from '../types/records.ts';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const visitSchema = new mongoose.Schema<Loose>({
  resourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  date: { type: String, required: true },
  purpose: String,
  notes: String,
  outcome: String,
  followUp: String,
  followUpDate: String,
  // Ticked done on Dashboard → Follow-ups (src/utils/followUpList.ts): when,
  // the day on the ticker's clock, who, and what happened. Blank = pending.
  followUpDoneAt: String,
  followUpDoneOn: String,
  followUpDoneBy: String,
  followUpDoneByName: String,
  followUpOutcome: String,
  // Every snooze (from → to), tick and reopen, oldest first — kept, never trimmed.
  followUpHistory: [{
    _id: false, action: String, at: String, on: String, by: String, byName: String, from: String, to: String
  }],
  managerComment: String,
  headquartersComment: String,
  image: mongoose.Schema.Types.Mixed,  // Use Mixed to support both legacy Strings and new Arrays
  createdBy: String,  // User ID or Customer ID who created this visit
  createdByName: String,  // Display name of the creator
  customerContactName: String,  // Contact name of the customer being visited
  reactions: [{
    type: { type: String, required: true }, // e.g., 'like', 'love'
    userId: String, // Who reacted
    userName: String, // Name of reactor for display/tooltip
    createdAt: { type: String }
  }],
  createdAt: { type: String },
  updatedBy: String,  // User ID or Customer ID who last updated this visit
  updatedByName: String,  // Display name of the person who last updated this visit
  updatedAt: String
});

const customerSchema = new mongoose.Schema<Loose>({
  contactName: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  marketingEmail: {
    type: String,
    lowercase: true,
    required: false
  },
  receiveMarketing: {
    type: Boolean,
    default: true
  },
  password: {
    type: String,
    required: false
  },
  // Lead Management Fields
  status: {
    type: String,
    enum: ['New Lead', 'Trying to Onboard', 'Contacted / In Discussion', 'Onboarded', 'Different Sales Person', 'Not Interested', 'Inactive'],
    default: 'Onboarded'
  },
  customerType: {
    type: String,
    enum: ['Fabricator', 'Contractor', 'Dealer', 'Floor Covering', 'Designer', 'Builder'],
    default: 'Fabricator'
  },
  level: {
    type: String,
    enum: ['Level - 1', 'Level - 2', 'Level - 3', 'Level - 4'],
    default: 'Level - 3'
  },
  modaDisplay: {
    type: String,
    default: 'No'
  },
  modaBinder: {
    type: String,
    default: '0'
  },
  followUpDate: String,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  // Who owns the account. Distinct from createdBy, which only records whoever
  // typed the record in. salesRep is the durable link; salesRepName is the label
  // the customer list, its filters and its export read, denormalized because
  // that list is an aggregation and a cached name spares it a $lookup against
  // users on every page. Always derived server-side from salesRep, never taken
  // from the client, or the two drift apart the first time a name is edited.
  salesRep: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  salesRepName: {
    type: String,
    default: '',
    trim: true
  },
  // Which Easy Stones branch the account belongs to. A plain String rather than
  // an enum so a branch added through Admin › Locations works without a schema
  // change — the same way User.location and LostSale.location already behave.
  location: {
    type: String,
    default: 'Seattle',
    trim: true
  },
  company: String,
  phone: String,
  address: {
    street: String,
    city: String,
    state: String,
    zipCode: String
  },
  // Where the account actually is, so a rep can plan a day by area instead of
  // keeping a private pin board. Derived from address by the geocoder, never
  // typed — see geocodeCustomerAddress() in server.ts.
  coordinates: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null }
  },
  geocode: {
    // 'ok' means we hold a point for this address. 'failed' means the geocoder
    // ran and found nothing, which is a data problem worth showing someone —
    // distinct from 'pending', which only means we have not asked yet.
    status: {
      type: String,
      enum: ['pending', 'ok', 'failed'],
      default: 'pending'
    },
    // How exact the point is. A city-level hit and a rooftop hit look identical
    // on a map, so route planning has to be able to tell them apart: driving to
    // a city centroid wastes the stop. Mirrors Google's location_type.
    precision: {
      type: String,
      enum: ['rooftop', 'range', 'geometric', 'approximate', ''],
      default: ''
    },
    formattedAddress: { type: String, default: '' },
    // The address the point was derived from. Compared on save so an edit that
    // leaves the address alone does not spend a geocoding call, and one that
    // changes it always re-runs.
    addressKey: { type: String, default: '' },
    updatedAt: { type: Date, default: null },
    error: { type: String, default: '' }
  },
  isVerified: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  priceLevel: { type: Number, default: 1, min: 1, max: 4 },
  loginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Date },
  loginIps: { type: [String], default: [] },
  contacts: [{
    name: { type: String, trim: true },
    phone: String,
    email: String,
    role: String,
    notes: String,
    createdAt: { type: String }
  }],
  visits: [visitSchema],
  resources: [{
    visitId: { type: mongoose.Schema.Types.ObjectId, default: null },
    date: { type: String, default: null },
    customer: String,
    location: String,
    resourceType: String,
    // How many were left (src/utils/resourceForm.ts); missing on resources saved before 2026-10-30 = 1.
    qty: Number,
    title: { type: String, required: true },
    image: mongoose.Schema.Types.Mixed, // Use Mixed to support both legacy Strings and new Arrays
    description: String,
    notes: String,
    status: { type: String, default: 'Active' },
    url: String,
    uploadedBy: String,
    createdAt: { type: String }
  }],
  quickNote: { type: String, default: '' },
  associatedCustomers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer'
  }],
  // Customers someone looked at as possible duplicates and said are separate
  // accounts (import screen → "Keep as a separate account"). Written to both
  // sides; withoutSeparated in src/utils/customerMatch.ts reads it so the pair
  // stops being flagged — and the merge script stops merging it.
  notDuplicateOf: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer'
  }],
  // The SPS customer this one is (src/utils/spsSheet.ts). `key` is the SPS
  // Name, trimmed and lowercased; the partial unique index below means two
  // customers can never hold the same one. Set only by the SPS import and its
  // connect step — never from a request body (PROTECTED_CUSTOMER_FIELDS).
  sps: {
    key: { type: String },
    name: { type: String },
    code: { type: String },
    firstImportedAt: { type: Date },
    lastSeenAt: { type: Date },
    // Step 3 (connect existing customers): who connected it and when, and a
    // person's answer 'none' = SPS has no such customer.
    connectedAt: { type: Date },
    connectedBy: { type: String },
    reviewedAs: { type: String },
    // The SPS import run that added this customer (src/models/SpsImportRun.ts).
    runId: { type: String }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
  autoIndex: false
});

// ── MONGOOSE INDEXES FOR HIGH PERFORMANCE & SCALABILITY ──
// One customer per SPS customer. Partial, so the thousands of customers with
// no SPS key (and any that never get one) don't collide on "missing".
customerSchema.index({ 'sps.key': 1 }, { unique: true, partialFilterExpression: { 'sps.key': { $type: 'string' } } });
customerSchema.index({ company: 1, contactName: 1 }); // Pre-sorted dropdowns & selection API
customerSchema.index({ status: 1, createdBy: 1 }); // Status & rep ownership filter
customerSchema.index({ customerType: 1, level: 1 }); // Type & Level filter
customerSchema.index({ isActive: 1, createdAt: -1 }); // Active customer lists
customerSchema.index({ priceLevel: 1, isActive: 1 }); // Price level filter
customerSchema.index({ 'visits.date': -1 }); // Visit logs & dashboard max visit calculation
customerSchema.index({ 'address.city': 1 }); // City filter
customerSchema.index({ location: 1, status: 1 }); // Branch column & filter
customerSchema.index({ salesRep: 1, status: 1 }); // Rep ownership filter ("my accounts")
// No text index: customer and partner search run on $regex, and nothing in the
// app ever issues a $text query. Carrying one only added write cost on every
// customer save and collided with the differently-named index already in the
// database. Reinstate deliberately if search is moved to $text.

// Hash password before saving
// Hash password before saving
customerSchema.pre('save', async function () {
  if (!this.isModified('password')) return;

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password!, salt);
  } catch (error) {
    throw new Error(error as string);
  }
});

// Method to compare passwords
customerSchema.methods.comparePassword = async function (candidatePassword: string) {
  return await bcrypt.compare(candidatePassword, this.password!);
};

// Check if account is locked
customerSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

// Increment login attempts
customerSchema.methods.incLoginAttempts = async function () {
  // If lock has expired, reset attempts
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return await this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 }
    });
  }

  const updates: mongoose.UpdateQuery<mongoose.InferSchemaType<typeof customerSchema>> = { $inc: { loginAttempts: 1 } };
  const maxAttempts = 5;
  const lockTime = 15 * 60 * 1000; // 15 minutes

  // Lock account after max attempts
  if (this.loginAttempts + 1 >= maxAttempts && !this.isLocked()) {
    updates.$set = { lockUntil: Date.now() + lockTime };
  }

  return await this.updateOne(updates);
};

// Reset login attempts
customerSchema.methods.resetLoginAttempts = async function () {
  return await this.updateOne({
    $set: { loginAttempts: 0 },
    $unset: { lockUntil: 1 }
  });
};

export default mongoose.model('Customer', customerSchema);
