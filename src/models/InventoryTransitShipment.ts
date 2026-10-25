import mongoose from 'mongoose';
import type { Model } from 'mongoose';
import type { TransitShipment } from '../types/inventory.ts';

type ShipmentDocument = TransitShipment & { importedAt: Date; importedByName: string;
  active?: boolean; reportId?: string; sourceSignature?: string; confirmedSignature?: string;
  usableReceiptDate?: Date | null; receiptConfirmedAt?: Date | null; receiptConfirmedBy?: string;
  inactiveAt?: Date; inactiveReason?: string;
};

const lineSchema = new mongoose.Schema({
  product: String, sku: String, poNumber: String, containerNumber: String, location: String,
  poDate: Date, poEtaDate: Date, supplierSoNumber: String, siplNumber: String,
  slabs: Number, quantity: Number, units: String, supplier: String,
  freightForwarder: String, shipDate: Date, portEtaDate: Date, etaDate: Date,
  vessel: String, customerReference: String, supplierPurchaseNote: String, status: String
}, { _id: false });
const schema = new mongoose.Schema({
  poNumber: { type: String, default: '' },
  containerNumber: { type: String, default: '' },
  location: { type: String, required: true },
  lines: [lineSchema],
  active: { type: Boolean, default: true }, reportId: String, sourceSignature: String,
  confirmedSignature: String, usableReceiptDate: Date, receiptConfirmedAt: Date, receiptConfirmedBy: String,
  inactiveAt: Date, inactiveReason: String,
  importedAt: Date, importedByName: String
}, { timestamps: true, collection: 'InventoryTransitShipments' });
schema.index({ active: 1, location: 1 });
schema.index({ poNumber: 1, containerNumber: 1, location: 1 }, { unique: true });
export default (mongoose.models.InventoryTransitShipment as Model<ShipmentDocument>) || mongoose.model<ShipmentDocument>('InventoryTransitShipment', schema);
