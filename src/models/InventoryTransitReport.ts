import mongoose from 'mongoose';
import type { InferSchemaType, Model } from 'mongoose';
const schema = new mongoose.Schema({
  _id: { type: String, required: true }, branches: [String], complete: Boolean,
  sourceFilename: String, sourceHash: String, importedAt: Date, importedByName: String,
  lineCount: Number, shipmentCount: Number, withdrawnCount: Number,
}, { collection: 'inventory_transit_reports', versionKey: false });
schema.index({ importedAt: -1 });
type Report = InferSchemaType<typeof schema>;
export default (mongoose.models.InventoryTransitReport as Model<Report>) || mongoose.model<Report>('InventoryTransitReport', schema);
const eventSchema = new mongoose.Schema({
  shipmentId: { type: String, required: true, index: true }, reportId: String,
  at: { type: Date, required: true }, actor: String,
  action: { type: String, enum: ['reported', 'not-reported', 'receipt-confirmed'], required: true },
  snapshot: mongoose.Schema.Types.Mixed,
}, { collection: 'inventory_transit_events', versionKey: false });
eventSchema.index({ shipmentId: 1, at: -1 });
type Event = InferSchemaType<typeof eventSchema>;
export const InventoryTransitEvent = (mongoose.models.InventoryTransitEvent as Model<Event>) || mongoose.model<Event>('InventoryTransitEvent', eventSchema);
