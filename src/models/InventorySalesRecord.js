import mongoose from 'mongoose';

// One row per product from an SPS "Fast Moving Inventory" (sold/velocity)
// export, scoped to the location and date range the report was run for.
// Unlike InventoryItem (a full point-in-time mirror), these accumulate across
// imports — each (product, location, periodStart, periodEnd) is its own
// snapshot, so multiple periods/locations can coexist for trend comparisons.
// Re-importing the same period+location replaces just that combination (see
// /api/inventory-analysis/import/sales/apply in server.js).
const inventorySalesRecordSchema = new mongoose.Schema({
  product: { type: String, required: true, trim: true, index: true },
  sku: { type: String, default: '' },
  type: { type: String, default: '' },
  category: { type: String, default: '', index: true },
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

  location: { type: String, required: true, index: true },
  periodStart: { type: Date, required: true, index: true },
  periodEnd: { type: Date, required: true, index: true },

  importedAt: { type: Date, default: Date.now },
  importedByName: { type: String, default: '' },
  importedById: { type: String, default: null }
}, {
  timestamps: true,
  collection: 'InventorySalesRecords'
});

inventorySalesRecordSchema.index({ product: 1, location: 1, periodStart: 1, periodEnd: 1 }, { unique: true });

export default mongoose.models.InventorySalesRecord || mongoose.model('InventorySalesRecord', inventorySalesRecordSchema);
