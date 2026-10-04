import mongoose from 'mongoose';

// Street / suite / city / state / ZIP — zipCode, not zip, to match Customer
// and src/utils/geocode.js's addressKeyOf.
const addressSchema = new mongoose.Schema({
  street: { type: String, trim: true, default: '' },
  suite: { type: String, trim: true, default: '' },
  city: { type: String, trim: true, default: '' },
  state: { type: String, trim: true, default: '' },
  zipCode: { type: String, trim: true, default: '' }
}, { _id: false });

// Everything beyond name/shortCode is filled in by Add / Edit location
// (src/components/sales/locations/LocationForm.jsx); the rules live in
// src/utils/locationForm.js. Locations created before those fields existed
// simply have them empty — the selection sheet then prints the Kent address
// (DEFAULT_LETTERHEAD) until someone adds theirs.
const locationSchema = new mongoose.Schema({
  // The short name ("Charlotte") — the key stored on users' assignedLocations,
  // check-ins, daily reports and more, so it is never renamed.
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  // Short code used as a compact label (e.g. SEA, SPK, ATL). Optional —
  // locations created before codes existed have none. Uniqueness is
  // enforced in the POST/PATCH routes (case-insensitive), not by an index.
  shortCode: {
    type: String,
    trim: true,
    uppercase: true,
    default: ''
  },
  // What prints: "Easy Stones - Charlotte".
  fullName: { type: String, trim: true, default: '' },
  region: { type: String, trim: true, default: '' },
  // Regional distribution center: another location's short name, or ''.
  rdc: { type: String, trim: true, default: '' },
  profitCenter: { type: Boolean, default: false },
  warehouse: { type: Boolean, default: false },

  primaryContact: {
    name: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    fax: { type: String, trim: true, default: '' },
    website: { type: String, trim: true, default: '' },
    address: { type: addressSchema, default: () => ({}) }
  },
  // Looked up from the primary address on save (src/utils/geocode.js).
  coordinates: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null }
  },
  geocode: {
    status: { type: String, default: '' },
    precision: { type: String, default: '' },
    formattedAddress: { type: String, default: '' },
    addressKey: { type: String, default: '' },
    updatedAt: { type: Date, default: null },
    error: { type: String, default: '' }
  },

  accountingSameAsPrimary: { type: Boolean, default: true },
  accountingContact: {
    name: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    address: { type: addressSchema, default: () => ({}) }
  },

  salesDefaults: {
    salesRep: { type: String, trim: true, default: '' },
    priceLevel: { type: Number, min: 1, max: 4, default: null },
    paymentTerms: { type: String, trim: true, default: '' },
    salesTaxArea: { type: String, trim: true, default: '' },
    salesTaxRate: { type: Number, min: 0, max: 20, default: null }
  },
  costOverrides: {
    avgUnitFreight: { type: Number, min: 0, default: null },
    unitOverheadPct: { type: Number, min: 0, max: 100, default: null }
  },

  // "Last changed by X · date" in the edit form's footer.
  editedBy: { type: String, default: '' },
  editedAt: { type: Date, default: null }
}, {
  timestamps: true
});

export default mongoose.model('Location', locationSchema);
