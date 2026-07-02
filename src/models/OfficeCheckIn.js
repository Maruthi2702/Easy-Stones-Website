import mongoose from 'mongoose';

const officeCheckInSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    default: ''
  },
  fabricatorCompany: {
    type: String,
    trim: true,
    default: ''
  },
  fabricatorName: {
    type: String,
    trim: true,
    default: ''
  },
  fabricatorPhone: {
    type: String,
    trim: true,
    default: ''
  },
  status: {
    type: String,
    enum: ['New', 'Processed'],
    default: 'New'
  },
  builderName: {
    type: String,
    trim: true,
    default: ''
  },
  builderPhone: {
    type: String,
    trim: true,
    default: ''
  },
  selections: [
    {
      material: { type: String, default: '' },
      details: { type: String, default: '' },
      size: { type: String, default: '' },
      lot: { type: String, default: '' }
    }
  ],
  specialNotes: {
    type: String,
    default: ''
  },
  salesRep: {
    type: String,
    trim: true,
    default: ''
  }
}, {
  timestamps: true
});

// Index for listing check-ins by time
officeCheckInSchema.index({ createdAt: -1 });

const OfficeCheckIn = mongoose.model('OfficeCheckIn', officeCheckInSchema);

export default OfficeCheckIn;
