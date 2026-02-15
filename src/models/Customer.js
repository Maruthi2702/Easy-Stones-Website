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
    required: true
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
    name: { type: String, required: true },
    phone: String,
    email: String,
    role: String,
    isPrimary: { type: Boolean, default: false },
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
// Indices correctly defined in field definitions above:
// - email (unique: true)
customerSchema.index({ isActive: 1 }); // Index for filtering active customers
customerSchema.index({ isActive: 1, email: 1 }); // Compound index for common queries
customerSchema.index({ priceLevel: 1 }); // Index for price level queries
customerSchema.index({ createdAt: -1 }); // Index for sorting by creation date

// Hash password before saving
// Hash password before saving
customerSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  } catch (error) {
    throw new Error(error);
  }
});

// Method to compare passwords
customerSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Check if account is locked
customerSchema.methods.isLocked = function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

// Increment login attempts
customerSchema.methods.incLoginAttempts = async function() {
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
customerSchema.methods.resetLoginAttempts = async function() {
  return await this.updateOne({
    $set: { loginAttempts: 0 },
    $unset: { lockUntil: 1 }
  });
};

export default mongoose.model('Customer', customerSchema);
