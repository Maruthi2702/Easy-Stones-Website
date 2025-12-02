import mongoose from 'mongoose';

const salesCustomerSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    index: true
  },
  customerName: {
    type: String,
    required: true,
    trim: true
  },
  company: {
    type: String,
    trim: true,
    default: ''
  },
  address: {
    type: String,
    required: true,
    trim: true
  },
  coordinates: {
    lat: { type: Number },
    lng: { type: Number }
  },
  phone: {
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
  notes: {
    type: String,
    default: ''
  },
  lastVisit: {
    type: Date,
    default: null
  },
  nextVisit: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: ['prospect', 'active', 'inactive'],
    default: 'prospect'
  },
  tags: [{
    type: String,
    trim: true
  }]
}, {
  timestamps: true
});

// Index for efficient queries
salesCustomerSchema.index({ userId: 1, customerName: 1 });
salesCustomerSchema.index({ userId: 1, status: 1 });

const SalesCustomer = mongoose.model('SalesCustomer', salesCustomerSchema);

export default SalesCustomer;
