import mongoose from 'mongoose';

/**
 * Site-wide settings that belong to no one user: one document per `key`.
 * The first is 'navOrder' — the side nav's admin-set order
 * (src/routes/navOrder.js, src/utils/navPins.js).
 */
const appSettingSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  value: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  updatedBy: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

export default mongoose.models.AppSetting || mongoose.model('AppSetting', appSettingSchema);
