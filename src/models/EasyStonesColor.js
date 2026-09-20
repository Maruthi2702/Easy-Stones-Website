import mongoose from 'mongoose';

const easyStonesColorSchema = new mongoose.Schema({
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
