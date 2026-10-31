// Legacy BSON records remain flexible; runtime schemas still validate every write.
import type { Loose } from '../types/records.ts';
import mongoose from 'mongoose';

/**
 * One SPS customer's outcome in one import run, frozen when the run starts and
 * worked through in batches. `state` is what makes a restart safe: only
 * 'pending' items are picked up again, and every write is idempotent.
 */
const spsImportItemSchema = new mongoose.Schema<Loose>({
  runId: { type: String, required: true },
  seq: { type: Number, required: true },
  key: { type: String, required: true },
  rowNumber: { type: Number, default: 0 },
  name: { type: String, default: '' },
  // new | update | unchanged | restore | keptDeleted
  action: { type: String, required: true },
  customerId: { type: String, default: '' },
  connect: { type: Boolean, default: false },
  create: { type: mongoose.Schema.Types.Mixed, default: undefined },
  apply: { type: mongoose.Schema.Types.Mixed, default: undefined },
  before: { type: mongoose.Schema.Types.Mixed, default: undefined },
  unset: { type: [String], default: [] },
  changes: { type: mongoose.Schema.Types.Mixed, default: [] },
  deleted: { type: mongoose.Schema.Types.Mixed, default: undefined },
  warnings: { type: [String], default: [] },
  state: { type: String, default: 'pending' },
  // added | updated | unchanged | restored | keptDeleted | failed
  result: { type: String, default: '' },
  reason: { type: String, default: '' },
  // The customer this item made (added / restored), for Undo and "See the new customers".
  createdId: { type: String, default: '' }
}, { minimize: false });

spsImportItemSchema.index({ runId: 1, seq: 1 });
spsImportItemSchema.index({ runId: 1, state: 1, seq: 1 });

export default mongoose.model('SpsImportItem', spsImportItemSchema);
