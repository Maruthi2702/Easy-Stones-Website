import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const visitSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  purpose: String,
  notes: String,
  outcome: String,
  nextAction: String,
  image: mongoose.Schema.Types.Mixed,  // Use Mixed to support both legacy Strings and new Arrays
  createdBy: String,  // User ID or Customer ID who created this visit
  createdByName: String,  // Display name of the creator
  createdAt: { type: Date, default: Date.now }
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
    createdAt: { type: Date, default: Date.now }
  }],
  visits: [visitSchema],
  resources: [{
    date: { type: Date, default: Date.now },
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
    createdAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

// Indexes for performance optimization
customerSchema.index({ email: 1 }, { unique: true }); // Unique index for login
customerSchema.index({ isActive: 1 }); // Index for filtering active customers
customerSchema.index({ priceLevel: 1 }); // Index for price level queries

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
