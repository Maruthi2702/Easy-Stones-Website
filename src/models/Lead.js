import mongoose from 'mongoose';

const leadSchema = new mongoose.Schema({
  company: {
    type: String,
    required: true,
    trim: true
  },
  name: {
    type: String,
    trim: true,
    default: ''
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    default: ''
  },
  phone: {
    type: String,
    trim: true,
    default: ''
  },
  notes: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['New', 'Contacted', 'Qualified', 'Lost', 'Converted'],
    default: 'New'
  },
  followUpDate: {
    type: Date,
    default: null
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  }
}, {
  timestamps: true
});

// Index for efficient queries
leadSchema.index({ createdBy: 1, name: 1 });
leadSchema.index({ createdBy: 1, status: 1 });

const Lead = mongoose.model('Lead', leadSchema);

export default Lead;
