import mongoose from 'mongoose';

/**
 * What a merge or delete from the import screen's duplicate list removed and
 * changed, saved before any of it happened — the Undo button's source.
 *
 * Kept in the database rather than on disk (where the merge script writes its
 * backups) because the server's disk is wiped on every deploy.
 *
 * `group` is exactly what snapshotMerge in src/services/customerMerge.js
 * returns: survivorId, survivorBefore, losers, moved. Mixed, because it holds
 * whole customer documents as they were, including fields the Customer schema
 * may no longer define.
 */
const customerMergeBackupSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.Mixed, required: true },
  // 'merge' | 'delete' — for the record, and for the Undo message
  action: { type: String, default: '' },
  createdBy: { type: String, default: '' },
  undoneAt: { type: Date, default: null }
}, {
  timestamps: true
});

export default mongoose.model('CustomerMergeBackup', customerMergeBackupSchema);
