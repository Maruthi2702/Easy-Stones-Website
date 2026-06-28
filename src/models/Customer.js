import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const visitSchema = new mongoose.Schema({
  date: { type: String, required: true },
  purpose: String,
  notes: String,
  outcome: String,
  followUp: String,
  followUpDate: Date,
  managerComment: String,
  headquartersComment: String,
  image: mongoose.Schema.Types.Mixed,  // Use Mixed to support both legacy Strings and new Arrays
  createdBy: String,  // User ID or Customer ID who created this visit
  createdByName: String,  // Display name of the creator
  customerContactName: String,  // Contact name of the customer being visited
  reactions: [{
    type: { type: String, required: true }, // e.g., 'like', 'love'
    userId: String, // Who reacted
    userName: String, // Name of reactor for display/tooltip
    createdAt: { type: String }
  }],
  createdAt: { type: String },
  updatedBy: String,  // User ID or Customer ID who last updated this visit
  updatedByName: String,  // Display name of the person who last updated this visit
  updatedAt: String
});

const customerSchema = new mongoose.Schema({
  contactName: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  password: {
    type: String,
    required: false
  },
  // Lead Management Fields
  status: {
    type: String,
    enum: ['New', 'Qualified', 'Met', 'Won', 'Lost', 'Not Contacted'],
    default: 'New'
  },
  customerType: {
    type: String,
    enum: ['Fabricator', 'Contractor', 'Dealer', 'Floor Covering', 'Designer', 'Builder'],
    default: 'Fabricator'
  },
  level: {
    type: String,
    enum: ['Level - 1', 'Level - 2', 'Level - 3', 'Level - 4'],
    default: 'Level - 3'
  },
  modaDisplay: {
    type: String,
    default: 'No'
  },
  modaBinder: {
    type: String,
    default: '0'
  },
  followUpDate: Date,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  company: String,
  phone: String,
  address: {
    street: String,
    city: String,
    state: String,
    zipCode: String
  },
  isVerified: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  priceLevel: { type: Number, default: 1, min: 1, max: 4 },
  loginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Date },
  loginIps: { type: [String], default: [] },
  contacts: [{
    name: { type: String, trim: true },
    phone: String,
    email: String,
    role: String,
    notes: String,
    createdAt: { type: String }
  }],
  visits: [visitSchema],
  resources: [{
    date: { type: String, default: null },
    customer: String,
    location: String,
    resourceType: String,
    title: { type: String, required: true },
    image: mongoose.Schema.Types.Mixed, // Use Mixed to support both legacy Strings and new Arrays
    description: String,
    notes: String,
    status: { type: String, default: 'Active' },
    url: String,
    uploadedBy: String,
    createdAt: { type: String }
  }],
  quickNote: { type: String, default: '' }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
  autoIndex: false
});

// Indexes for performance optimization
customerSchema.index({ contactName: 'text', company: 'text', email: 'text' }); // Text search index
customerSchema.index({ 'visits.date': -1 }); // Index for dashboard max visit calculation
customerSchema.index({ isActive: 1, createdAt: -1 }); // Index for listing all active customers
customerSchema.index({ priceLevel: 1, isActive: 1 }); // Index for price level filtering

// Hash password before saving
// Hash password before saving
customerSchema.pre('save', async function () {
  if (!this.isModified('password')) return;

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  } catch (error) {
    throw new Error(error);
  }
});

// Method to compare passwords
customerSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Check if account is locked
customerSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

// Increment login attempts
customerSchema.methods.incLoginAttempts = async function () {
  // If lock has expired, reset attempts
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return await this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 }
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };
  const maxAttempts = 5;
  const lockTime = 15 * 60 * 1000; // 15 minutes

  // Lock account after max attempts
  if (this.loginAttempts + 1 >= maxAttempts && !this.isLocked()) {
    updates.$set = { lockUntil: Date.now() + lockTime };
  }

  return await this.updateOne(updates);
};

// Reset login attempts
customerSchema.methods.resetLoginAttempts = async function () {
  return await this.updateOne({
    $set: { loginAttempts: 0 },
    $unset: { lockUntil: 1 }
  });
};

export default mongoose.model('Customer', customerSchema);
