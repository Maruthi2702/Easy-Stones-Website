import mongoose from 'mongoose';

/**
 * One resource family (Admin → Resource Types → Families): what a resource type
 * is a kind of. A type stores the family's `name` in its `family`, so `name`
 * never changes; `label` is what staff read. `order` is the order of the Family
 * dropdown and of the groups in Dashboard → Resources' Filters. The five the list
 * started with are `system` (never deleted): `tower` and `binder` drive the Moda
 * Display / Binders counts (src/utils/modaTotals.ts).
 */
const resourceFamilySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  label: { type: String, required: true, trim: true },
  order: { type: Number, default: 0, index: true },
  // false = not offered for a type; the types already in it keep it.
  active: { type: Boolean, default: true },
  system: { type: Boolean, default: false },
  updatedBy: { type: String, default: '' }
}, { timestamps: true });

export default ((mongoose.models.ResourceFamily as mongoose.Model<mongoose.InferSchemaType<typeof resourceFamilySchema>> | undefined) || mongoose.model('ResourceFamily', resourceFamilySchema)) as mongoose.Model<mongoose.InferSchemaType<typeof resourceFamilySchema>>;
