import mongoose from 'mongoose';

const officeCheckInSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [200, 'Name is too long']
  },
  location: {
    type: String,
    required: [true, 'Location is required'],
    default: 'Seattle',
    trim: true,
    index: true,
    maxlength: [100, 'Location is too long']
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    index: true,
    maxlength: [30, 'Phone number is too long']
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    default: '',
    maxlength: [254, 'Email is too long']
  },
  fabricatorCompany: {
    type: String,
    trim: true,
    default: '',
    maxlength: [200, 'Company name is too long']
  },
  fabricatorName: {
    type: String,
    trim: true,
    default: '',
    maxlength: [200, 'Fabricator name is too long']
  },
  fabricatorPhone: {
    type: String,
    trim: true,
    default: '',
    maxlength: [30, 'Company phone is too long']
  },
  status: {
    type: String,
    enum: ['New', 'Processed'],
    default: 'New'
  },
  builderName: {
    type: String,
    trim: true,
    default: '',
    maxlength: [200, 'Builder name is too long']
  },
  builderPhone: {
    type: String,
    trim: true,
    default: '',
    maxlength: [30, 'Builder phone is too long']
  },
  selections: [
    {
      material: { type: String, default: '', maxlength: [200, 'Material is too long'] },
      details: { type: String, default: '', maxlength: [2000, 'Details are too long'] },
      size: { type: String, default: '', maxlength: [200, 'Size is too long'] },
      lot: { type: String, default: '', maxlength: [200, 'Lot/bundle number is too long'] }
    }
  ],
  specialNotes: {
    type: String,
    default: '',
    maxlength: [5000, 'Special notes are too long']
  },
  salesRep: {
    type: String,
    trim: true,
    default: '',
    maxlength: [200, 'Sales rep name is too long']
  },
  salesRepEmail: {
    type: String,
    trim: true,
    default: '',
    maxlength: [254, 'Sales rep email is too long']
  },
  loggedBy: {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    // Their Display Name at the time of the check-in. Recorded alongside the
    // username so the log keeps reading correctly if they later rename.
    displayName: {
      type: String,
      default: ''
    },
    username: {
      type: String,
      trim: true
    }
  }
}, {
  timestamps: true
});

// Index for listing check-ins by time
officeCheckInSchema.index({ createdAt: -1 });

// The check-in log always scopes by location (a user's assigned branches) and
// sorts newest-first, so serve both from one compound index.
officeCheckInSchema.index({ location: 1, createdAt: -1 });

const OfficeCheckIn = mongoose.model('OfficeCheckIn', officeCheckInSchema);

export default OfficeCheckIn;
