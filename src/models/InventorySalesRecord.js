import mongoose from 'mongoose';

// One row per product from an SPS "Fast Moving Inventory" (sold/velocity)
// export, scoped to the location and date range the report was run for.
// Unlike InventoryItem (a full point-in-time mirror), these accumulate across
// imports — each (product, location, periodStart, periodEnd) is its own
// snapshot, so multiple periods/locations can coexist for trend comparisons.
// Re-importing the same period+location replaces just that combination (see
// /api/inventory-analysis/import/sales/apply in server.js).
const inventorySalesRecordSchema = new mongoose.Schema({
  // Not indexed individually — server.js only ever queries this collection
  // by { location }, or by { location, periodStart, periodEnd } (see the
  // velocity/apply routes). Nothing filters by product, category, or a
  // period boundary alone, so the compound index below (led by location)
  // already covers every real query as a prefix match; a separate
  // single-field index on any of these would just be extra write cost with
  // no query it actually serves.
  product: { type: String, required: true, trim: true },
  sku: { type: String, default: '' },
  type: { type: String, default: '' },
  category: { type: String, default: '' },
  subCategory: { type: String, default: '' },
  group: { type: String, default: '' },
  origin: { type: String, default: '' },

  slabsSold: { type: Number, default: 0 },
  quantitySold: { type: Number, default: 0 },
  uom: { type: String, default: '' },
  saleValue: { type: Number, default: 0 },
  cost: { type: Number, default: 0 },
  avgSellingPrice: { type: Number, default: 0 },
  avgCost: { type: Number, default: 0 },
  margin: { type: Number, default: 0 },
  marginPercent: { type: Number, default: 0 },

  location: { type: String, required: true },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },

  importedAt: { type: Date, default: Date.now },
  importedByName: { type: String, default: '' },
  importedById: { type: String, default: null }
}, {
  timestamps: true,
  collection: 'InventorySalesRecords'
});

// Led by `location` (not `product`) specifically so a location-only query —
// the velocity endpoint's actual filter — hits this index as a prefix match
// instead of needing a separate index. Field order changes which query
// shapes benefit from a compound index; uniqueness itself doesn't care
// about order, so reordering away from insertion order costs nothing.
inventorySalesRecordSchema.index({ location: 1, periodStart: 1, periodEnd: 1, product: 1 }, { unique: true });

export default mongoose.models.InventorySalesRecord || mongoose.model('InventorySalesRecord', inventorySalesRecordSchema);
