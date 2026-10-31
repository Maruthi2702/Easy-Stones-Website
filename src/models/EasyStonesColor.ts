// Legacy BSON records remain flexible; runtime schemas still validate every write.
import type { Loose } from '../types/records.ts';
import mongoose from 'mongoose';

const easyStonesColorSchema = new mongoose.Schema<Loose & { _id: mongoose.Types.ObjectId }>({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  order: {
    type: Number,
    required: true,
    default: 0
  }
}, {
  timestamps: true
});

export default mongoose.model('EasyStonesColor', easyStonesColorSchema);
