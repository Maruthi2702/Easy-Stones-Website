import mongoose from 'mongoose';

// One row per slab/lot from SPS's "Inventory In Stock - Detail" export. This
// is a full mirror of what SPS reports as on hand right now, not a ledger —
// every import wipes and replaces the whole collection (see
// /api/inventory-analysis/import/stock/apply in server.js), so a row missing
// after an import means SPS no longer shows that lot as in stock (sold,
// transferred, etc.), not that it was deleted by mistake.
const inventoryItemSchema = new mongoose.Schema({
  product: { type: String, required: true, trim: true, index: true },
  sku: { type: String, default: '' },
  genericSku: { type: String, default: '' },
  type: { type: String, default: '' },
  category: { type: String, default: '', index: true },
  subCategory: { type: String, default: '' },
  group: { type: String, default: '' },
  kind: { type: String, default: '' },
  serialNumber: { type: String, default: '' },
  // Not indexed — never filtered/sorted on anywhere (display-only), and
  // every index here has to be updated on every one of the ~11k rows in a
  // full-catalog stock import, so an unused one is pure write-time cost.
  barcodeId: { type: String, default: '' },
  bundle: { type: String, default: '' },
  slabNumber: { type: String, default: '' },
  block: { type: String, default: '' },
  idFour: { type: String, default: '' },
  idFive: { type: String, default: '' },
  suppBarcodeId: { type: String, default: '' },
  bin: { type: String, default: '' },
  dimensions: { type: String, default: '' },
  instockQty: { type: Number, default: 0 },
  availableSlabs: { type: Number, default: 0 },
  availableQuantity: { type: Number, default: 0 },
  units: { type: String, default: '' },
  supplier: { type: String, default: '' },
  unitFobCost: { type: Number, default: 0 },
  unitLandedCost: { type: Number, default: 0 },
  purchaseCost: { type: Number, default: 0 },
  assetValue: { type: Number, default: 0 },
  // SPS calls this "Location" but most values are third-party fabricator/
  // customer names, not Easy Stones branches — consigned stock sitting at a
  // shop, not a warehouse. Only a handful of values (e.g. "Seattle") are
  // actual branches.
  location: { type: String, default: '', index: true },
  slabStatus: { type: String, default: '' },
  notes: { type: String, default: '' },
  remnant: { type: String, default: '' },
  receivedDate: { type: Date, default: null, index: true },

  importedAt: { type: Date, default: Date.now, index: true },
  importedByName: { type: String, default: '' },
  importedById: { type: String, default: null }
}, {
  timestamps: true,
  collection: 'InventoryItems'
});

// A text index used to exist here for product/supplier search, but nothing
// in the app ever issues a $text query — the actual search (buildInventoryItemQuery
// in server.js) is a plain regex $or, which a text index can't accelerate
// anyway. Text indexes are also the most expensive kind to maintain (every
// value gets tokenized on every write), so this was pure cost on every
// import with zero query benefit. Removed rather than left unused.

export default mongoose.models.InventoryItem || mongoose.model('InventoryItem', inventoryItemSchema);
