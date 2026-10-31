import mongoose from 'mongoose';

/**
 * One visit type (Admin → Visit Types). The list the Add / Edit visit form
 * offers, in `order`, comes from here and nowhere else (src/routes/typeLists.js).
 *
 * `name` is the value visits store in `purpose` and never changes once saved —
 * lists, filters, reports and the calendar match on it. `label` is what staff
 * read and can be renamed. `fields` says which parts of the form the type uses
 * (src/utils/typeLists.js has the shape).
 */
const visitTypeSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  label: { type: String, required: true, trim: true },
  order: { type: Number, default: 0, index: true },
  // false = hidden from the Add dropdown; old visits that have it still show it.
  active: { type: Boolean, default: true },
  // The types the app started with can be reordered, renamed and hidden, never deleted.
  system: { type: Boolean, default: false },
  fields: {
    notes: { type: Boolean, default: true },
    outcome: { type: Boolean, default: true },
    // 'none' | 'optional' (behind a toggle) | 'always' (open)
    followUp: { type: String, enum: ['none', 'optional', 'always'], default: 'optional' }
  },
  updatedBy: { type: String, default: '' }
}, { timestamps: true });

export default mongoose.models.VisitType || mongoose.model('VisitType', visitTypeSchema);
