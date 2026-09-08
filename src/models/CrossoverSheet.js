import mongoose from 'mongoose';

const crossoverSheetSchema = new mongoose.Schema({
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
  easyStonesName: {
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
  timestamps: true,
  collection: 'CrossoverList'
});

crossoverSheetSchema.index({ distributorName: 'text', distributorColorName: 'text', easyStonesName: 'text' });
crossoverSheetSchema.index({ matchType: 1 });
crossoverSheetSchema.index({ distributorName: 1 });

export default mongoose.model('CrossoverSheet', crossoverSheetSchema);
