import mongoose from 'mongoose';

/**
 * What a merge or delete from the import screen's duplicate list removed and
 * changed, saved before any of it happened — the Undo button's source.
 *
 * Kept in the database rather than on disk (where the merge script writes its
 * backups) because the server's disk is wiped on every deploy.
 *
 * `group` is exactly what snapshotMerge in src/services/customerMerge.ts
 * returns: survivorId, survivorBefore, losers, moved. Mixed, because it holds
 * whole customer documents as they were, including fields the Customer schema
 * may no longer define.
 */
/** A raw collection snapshot can include keys no longer present in today's schema. */
export interface CustomerMergeSnapshot {
  survivorId: string;
  survivorBefore: Record<string, unknown>;
  losers: Record<string, unknown>[];
  moved: { collection: string; field: string; type: string; from: string; ids: string[] }[];
}
export interface CustomerMergeBackupRecord {
  group: CustomerMergeSnapshot;
  action: string;
  createdBy: string;
  undoneAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const customerMergeBackupSchema = new mongoose.Schema<CustomerMergeBackupRecord>({
  group: { type: mongoose.Schema.Types.Mixed, required: true },
  // 'merge' | 'delete' — for the record, and for the Undo message
  action: { type: String, default: '' },
  createdBy: { type: String, default: '' },
  undoneAt: { type: Date, default: null }
}, {
  timestamps: true
});

export default mongoose.model('CustomerMergeBackup', customerMergeBackupSchema);
