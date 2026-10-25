import mongoose from 'mongoose';
import type { InferSchemaType, Model } from 'mongoose';
const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  revision: { type: Number, required: true, default: 0 },
}, { collection: 'inventory_revision', versionKey: false });
type Revision = InferSchemaType<typeof schema>;
export default (mongoose.models.InventoryRevision as Model<Revision>) || mongoose.model<Revision>('InventoryRevision', schema);
