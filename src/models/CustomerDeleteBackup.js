import mongoose from 'mongoose';

/**
 * A customer deleted from the Customer List's bulk bar, saved whole before it
 * was removed — the Undo button's source (src/routes/customerBulkDelete.js).
 *
 * One document per customer, grouped by `batchId` (one delete click), rather
 * than one per click: a customer carries its visits and resources, and a
 * hundred of them in one document could pass MongoDB's 16 MB limit.
 * `customer` is the raw document as it was (Mixed: it may hold fields the
 * Customer schema no longer defines), so Undo restores it exactly, same _id.
 */
const customerDeleteBackupSchema = new mongoose.Schema({
  batchId: { type: String, required: true, index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  customer: { type: mongoose.Schema.Types.Mixed, required: true },
  deletedBy: { type: String, default: '' },
  undoneAt: { type: Date, default: null },
  undoneBy: { type: String, default: '' }
}, {
  timestamps: true,
  minimize: false
});

export default mongoose.model('CustomerDeleteBackup', customerDeleteBackupSchema);
