import mongoose from 'mongoose';
import type { InferSchemaType, Model } from 'mongoose';

const runSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  version: { type: Number, required: true },
  sourceFilename: { type: String, default: '' },
  sourceHash: { type: String, default: '' },
  count: { type: Number, required: true },
  previousCount: { type: Number, required: true },
  backupChunks: { type: Number, required: true },
  importedAt: { type: Date, required: true },
  importedById: { type: String, default: null },
  importedByName: { type: String, default: '' },
  backupExpiresAt: { type: Date, required: true },
}, { collection: 'inventory_stock_imports', versionKey: false });
runSchema.index({ importedAt: -1 });

// Chunks avoid putting an entire catalog into one BSON document. TTL removes
// recovery data after seven days; lightweight import metadata remains.
const backupSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  importId: { type: String, required: true, index: true },
  chunk: { type: Number, required: true },
  items: { type: [mongoose.Schema.Types.Mixed], required: true },
  expiresAt: { type: Date, required: true },
}, { collection: 'inventory_stock_backups', versionKey: false });
backupSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const stateSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  version: { type: Number, default: 0 },
  importId: String,
}, { collection: 'inventory_stock_state', versionKey: false });

type Run = InferSchemaType<typeof runSchema>;
type Backup = InferSchemaType<typeof backupSchema>;
type State = InferSchemaType<typeof stateSchema>;
export const InventoryStockImport = (mongoose.models.InventoryStockImport as Model<Run>) || mongoose.model<Run>('InventoryStockImport', runSchema);
export const InventoryStockBackup = (mongoose.models.InventoryStockBackup as Model<Backup>) || mongoose.model<Backup>('InventoryStockBackup', backupSchema);
export const InventoryStockState = (mongoose.models.InventoryStockState as Model<State>) || mongoose.model<State>('InventoryStockState', stateSchema);
