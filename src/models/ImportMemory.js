import mongoose from 'mongoose';

/**
 * What the admin told the importer on earlier uploads, so the next upload of
 * the same export doesn't ask again.
 *
 * One document per import kind ('customer'), not per user — "Brian Standow
 * left, his accounts are Krish's" is a fact about the business, and the next
 * person to upload the sheet should get the same answer.
 *
 * Keys are normalized (importNormalize / importRowKey in
 * src/utils/customerImport.js): letters, digits and '|' only, which is what
 * makes them safe as Mongo map keys.
 */
const importMemorySchema = new mongoose.Schema({
  kind: { type: String, required: true, unique: true },
  // normalized sheet rep name → User _id, or '' for "leave unassigned"
  repAliases: { type: Map, of: String, default: {} },
  // normalized sheet branch name → Location name, or '' for "default branch"
  branchAliases: { type: Map, of: String, default: {} },
  // importRowKey → Customer _id this row was settled as
  decisions: { type: Map, of: String, default: {} },
  updatedBy: { type: String, default: '' }
}, {
  timestamps: true
});

export default mongoose.model('ImportMemory', importMemorySchema);
