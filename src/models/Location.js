import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  // Short code used as a compact label (e.g. SEA, SPK, ATL). Optional —
  // locations created before codes existed have none. Uniqueness is
  // enforced in the POST/PATCH routes (case-insensitive), not by an index.
  shortCode: {
    type: String,
    trim: true,
    uppercase: true,
    default: ''
  }
}, {
  timestamps: true
});

export default mongoose.model('Location', locationSchema);
