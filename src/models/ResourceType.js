import mongoose from 'mongoose';

/**
 * One resource type (Admin → Resource Types): the list the Add / Edit resource
 * form offers, in `order`. `name` is what a resource stores in `resourceType`
 * and never changes; `label` is what staff read. `family` groups it in the
 * Resources list's Filters panel (src/utils/typeLists.js).
 */
const resourceTypeSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  label: { type: String, required: true, trim: true },
  order: { type: Number, default: 0, index: true },
  active: { type: Boolean, default: true },
  family: { type: String, enum: ['tower', 'tabletop', 'binder', 'samples', 'other'], default: 'other' },
  updatedBy: { type: String, default: '' }
}, { timestamps: true });

export default mongoose.models.ResourceType || mongoose.model('ResourceType', resourceTypeSchema);
