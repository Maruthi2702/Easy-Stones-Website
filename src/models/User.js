import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  // Login identifier. Forced lower-case so signing in is not case-sensitive —
  // which is exactly why it is a poor thing to show people. Use displayName.
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  // What the app shows wherever this person's name appears: their own casing,
  // spacing and punctuation, e.g. "3rd Party - Delivery". Optional — when it is
  // blank the username is tidied up for display instead.
  displayName: {
    type: String,
    trim: true,
    default: ''
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  role: {
    type: String,
    default: 'sales_rep'
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date
  },
  location: {
    type: String,
    trim: true
  },
  assignedLocations: {
    type: [String],
    default: ['Seattle']
  },
  googleAccessToken: {
    type: String,
    default: null
  },
  googleRefreshToken: {
    type: String,
    default: null
  },
  googleEmail: {
    type: String,
    default: null
  },
  googleCalendarSyncEnabled: {
    type: Boolean,
    default: false
  },
  icloudUsername: {
    type: String,
    default: null
  },
  icloudPassword: {
    type: String,
    default: null
  },
  icloudCalendarUrl: {
    type: String,
    default: null
  },
  icloudCalendarName: {
    type: String,
    default: null
  },
  icloudSyncEnabled: {
    type: Boolean,
    default: false
  },
  // Route Planner's "Sales Rep Filter" toggle state, saved per-user so it
  // survives leaving and reopening the panel instead of resetting to the
  // role-based default every time. Mixed rather than a fixed sub-schema
  // since it's keyed by rep id ('unassigned' included) — a set that grows
  // as staff are added, not a known list of fields.
  routePlannerFilters: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function() {
  // Only hash if password is modified
  if (!this.isModified('password')) return;
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  } catch (error) {
    throw new Error(error);
  }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Check if account is locked
userSchema.methods.isLocked = function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

// Increment login attempts
userSchema.methods.incLoginAttempts = function() {
  // If lock has expired, restart attempts
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
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
  
  return this.updateOne(updates);
};

// Reset login attempts
userSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $set: { loginAttempts: 0 },
    $unset: { lockUntil: 1 }
  });
};

const User = mongoose.model('User', userSchema);

export default User;
