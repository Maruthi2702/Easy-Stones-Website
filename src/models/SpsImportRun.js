import mongoose from 'mongoose';

/**
 * One SPS customer import (step 5 of the "SPS Import Redesign" artifact): the
 * file, every answer, and how it went. Saved on the server so a half-answered
 * import comes back, a running one survives a restart, and Import history /
 * the report / Undo have something to read. The per-row work lives in
 * SpsImportItem.
 */
const spsImportRunSchema = new mongoose.Schema({
  fileName: { type: String, default: '' },
  fingerprint: { type: String, default: '' },
  // The upload itself, until the import starts (then it is dropped: the plan is frozen into the items).
  file: { type: Buffer, default: undefined, select: false },
  createdBy: { type: String, default: '' },
  // draft → running → done | failed;  done → undone
  status: { type: String, default: 'draft', index: true },
  mapping: { type: mongoose.Schema.Types.Mixed, default: {} },
  repAliases: { type: mongoose.Schema.Types.Mixed, default: {} },
  branchAliases: { type: mongoose.Schema.Types.Mixed, default: {} },
  // spsKey → 'new' | 'restore' | 'keep' | customerId
  answers: { type: mongoose.Schema.Types.Mixed, default: {} },
  fileCheck: { type: mongoose.Schema.Types.Mixed, default: null },
  rowsRead: { type: Number, default: 0 },
  // Frozen at start
  total: { type: Number, default: 0 },
  done: { type: Number, default: 0 },
  results: { type: mongoose.Schema.Types.Mixed, default: {} },
  planCounts: { type: mongoose.Schema.Types.Mixed, default: {} },
  verify: { type: mongoose.Schema.Types.Mixed, default: null },
  error: { type: String, default: '' },
  startedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
  undoneAt: { type: Date, default: null },
  undoneBy: { type: String, default: '' }
}, { timestamps: true, minimize: false });

export default mongoose.model('SpsImportRun', spsImportRunSchema);
