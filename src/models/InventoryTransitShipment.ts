import mongoose from 'mongoose';
import type { Model } from 'mongoose';
import type { TransitShipment } from '../types/inventory.ts';

type ShipmentDocument = TransitShipment & { importedAt: Date; importedByName: string };

const lineSchema = new mongoose.Schema({
  product: String, sku: String, poNumber: String, containerNumber: String, location: String,
  poDate: Date, poEtaDate: Date, supplierSoNumber: String, siplNumber: String,
  slabs: Number, quantity: Number, units: String, supplier: String,
  freightForwarder: String, shipDate: Date, portEtaDate: Date, etaDate: Date,
  vessel: String, customerReference: String, status: String
}, { _id: false });
const schema = new mongoose.Schema({
  poNumber: { type: String, required: true },
  containerNumber: { type: String, required: true },
  location: { type: String, required: true },
  lines: [lineSchema],
  importedAt: Date, importedByName: String
}, { timestamps: true, collection: 'InventoryTransitShipments' });
schema.index({ poNumber: 1, containerNumber: 1, location: 1 }, { unique: true });
export default (mongoose.models.InventoryTransitShipment as Model<ShipmentDocument>) || mongoose.model<ShipmentDocument>('InventoryTransitShipment', schema);
