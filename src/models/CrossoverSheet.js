import mongoose from 'mongoose';

// One subdocument per distributor's mapping to the parent document's
// Easy Stones color. Its own timestamps track when that specific mapping
// was added/edited, independent of the color document as a whole.
const crossoverEntrySchema = new mongoose.Schema({
  distributorName: {
    type: String,
    required: true,
    trim: true
  },
  distributorColorName: {
    type: String,
    required: true,
    trim: true
  },
  matchType: {
    type: String,
    enum: ['Direct Crossover', 'Similar'],
    default: 'Similar'
  },
  notes: {
    type: String,
    default: ''
  },
  addedByName: {
    type: String,
    default: ''
  },
  addedById: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// One document per Easy Stones color, holding every distributor's mapping
// to it. Was previously one flat document per distributor mapping (see git
// history) — migrated to this shape so the Matrix view's "one row per
// color" grouping is how the data is actually stored, not just how it's
// displayed.
const crossoverSheetSchema = new mongoose.Schema({
  easyStonesName: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  crossovers: [crossoverEntrySchema]
}, {
  timestamps: true,
  collection: 'CrossoverList'
});

crossoverSheetSchema.index({
  easyStonesName: 'text',
  'crossovers.distributorName': 'text',
  'crossovers.distributorColorName': 'text'
});
crossoverSheetSchema.index({ 'crossovers.matchType': 1 });
crossoverSheetSchema.index({ 'crossovers.distributorName': 1 });

export default mongoose.model('CrossoverSheet', crossoverSheetSchema);
