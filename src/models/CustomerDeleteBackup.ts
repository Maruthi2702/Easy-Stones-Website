// Legacy BSON records remain flexible; runtime schemas still validate every write.
import type { Loose } from '../types/records.ts';
import mongoose from 'mongoose';

/**
 * A customer deleted from the Customer List's bulk bar, saved whole before it
 * was removed — the Undo button's source (src/routes/customerBulkDelete.ts).
 *
 * One document per customer, grouped by `batchId` (one delete click), rather
 * than one per click: a customer carries its visits and resources, and a
 * hundred of them in one document could pass MongoDB's 16 MB limit.
 * `customer` is the raw document as it was (Mixed: it may hold fields the
 * Customer schema no longer defines), so Undo restores it exactly, same _id.
 */
const customerDeleteBackupSchema = new mongoose.Schema<Loose>({
  batchId: { type: String, required: true, index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  customer: { type: mongoose.Schema.Types.Mixed, required: true },
  // 'bulk' (the list's selection bar) or 'single' (one customer's Delete)
  source: { type: String, default: 'bulk' },
  deletedBy: { type: String, default: '' },
  // SPS import: someone chose "Keep deleted" for this customer, so the next
  // import doesn't ask again (src/services/spsImportRunner.ts).
  spsKeepDeleted: { type: Boolean, default: false },
  spsKeepRun: { type: String, default: '' },
  undoneAt: { type: Date, default: null },
  undoneBy: { type: String, default: '' }
}, {
  timestamps: true,
  minimize: false
});

export default mongoose.model('CustomerDeleteBackup', customerDeleteBackupSchema);
