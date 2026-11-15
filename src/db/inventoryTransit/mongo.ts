/** In-transit shipments on MongoDB — the import's and the routes' own Mongoose calls, moved here unchanged. */
import InventoryTransitShipment from '../../models/InventoryTransitShipment.ts';
import InventoryTransitReport, { InventoryTransitEvent } from '../../models/InventoryTransitReport.ts';
import { inInventoryTransaction } from '../../services/inventoryTransaction.ts';
import { transitSignature } from '../../purchasing/transitSignature.ts';
import { newId } from '../ids.ts';
import type { Loose } from '../../types/records.ts';
import type { TransitPublish, TransitPublished } from './types.ts';

/** Shipments still in transit, in PO order. */
export async function listActiveShipments(): Promise<Loose[]> {
  return InventoryTransitShipment.find({ active: { $ne: false } }).sort({ poNumber: 1, containerNumber: 1 }).lean() as unknown as Promise<Loose[]>;
}

/** Every shipment whose PO # is this one (blanks around it and capitals ignored): active first, newest import first, at most 50. */
export async function findShipmentsByPo(po: string): Promise<Loose[]> {
  const escaped = po.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return InventoryTransitShipment.find({ poNumber: new RegExp(`^\\s*${escaped}\\s*$`, 'i') }).sort({ active: -1, importedAt: -1 }).limit(50).lean() as unknown as Promise<Loose[]>;
}

export async function publishTransit({ importId, importedAt, shipments, coverage, complete, sourceFilename, sourceHash, importedByName }: TransitPublish): Promise<TransitPublished> {
  await Promise.all([InventoryTransitShipment.createCollection(), InventoryTransitReport.createCollection(), InventoryTransitEvent.createCollection()]);
  return inInventoryTransaction(async session => {
    const previous = await InventoryTransitShipment.find({ location: { $in: coverage } }).session(session).lean();
    const identity = (s: { poNumber: string; containerNumber: string; location: string }) => JSON.stringify([s.poNumber, s.containerNumber, s.location]);
    const prior = new Map(previous.map(s => [identity(s), s]));
    const present = new Set(shipments.map(identity));
    for (const shipment of shipments) {
      const before = prior.get(identity(shipment)), signature = transitSignature(shipment);
      const keepConfirmation = before?.active !== false && before?.confirmedSignature === signature;
      const record = await InventoryTransitShipment.findOneAndUpdate({ poNumber: shipment.poNumber,
        containerNumber: shipment.containerNumber, location: shipment.location }, {
        $set: { ...shipment, active: true, reportId: importId, sourceSignature: signature, importedAt, importedByName,
          ...(keepConfirmation ? {} : { usableReceiptDate: null, receiptConfirmedAt: null, receiptConfirmedBy: '', confirmedSignature: '' }) },
        $unset: { inactiveReason: '', inactiveAt: '' }, $inc: { __v: 1 },
      }, { session, upsert: true, returnDocument: 'after' }).lean();
      await InventoryTransitEvent.create([{ shipmentId: String(record!._id), reportId: importId,
        action: 'reported', at: importedAt, actor: importedByName, snapshot: shipment }], { session });
    }
    const withdrawn = complete ? previous.filter(s => s.active !== false && !present.has(identity(s))) : [];
    if (withdrawn.length) {
      await InventoryTransitShipment.updateMany({ _id: { $in: withdrawn.map(s => s._id) } }, {
        $set: { active: false, inactiveReason: 'not-reported', inactiveAt: importedAt }, $inc: { __v: 1 },
      }, { session });
      await InventoryTransitEvent.insertMany(withdrawn.map(s => ({ shipmentId: String(s._id), reportId: importId,
        action: 'not-reported', at: importedAt, actor: importedByName, snapshot: s })), { session });
    }
    await InventoryTransitReport.create([{ _id: importId, branches: coverage, complete, sourceFilename, sourceHash,
      importedAt, importedByName, lineCount: shipments.reduce((n, s) => n + s.lines.length, 0), shipmentCount: shipments.length,
      withdrawnCount: withdrawn.length }], { session });
    return { importId, importedAt, shipmentCount: shipments.length, withdrawnCount: withdrawn.length };
  });
}

type Session = import('mongoose').ClientSession | null;

/** Purchasing: the shipments still in transit at these branches, in `_id` order. */
export async function shipmentsForBranches(branches: string[], session: Session): Promise<Loose[]> {
  return InventoryTransitShipment.find({ location: { $in: branches }, active: { $ne: false } }).session(session).sort({ _id: 1 }).lean() as unknown as Promise<Loose[]>;
}

/** Purchasing: the one active shipment at these branches a receiving date may be confirmed for. */
export async function findShipmentForReceipt(id: string, branches: string[], session: Session): Promise<Loose | null> {
  return InventoryTransitShipment.findOne({ _id: id, location: { $in: branches }, active: { $ne: false } }).session(session).lean() as unknown as Promise<Loose | null>;
}

export interface ReceiptConfirmation { date: string; signature: string; at: Date; by: string }

/** Purchasing: save the confirmed receiving date and its history line. */
export async function saveReceiptConfirmation(shipment: Loose, { date, signature, at, by }: ReceiptConfirmation, session: Session): Promise<void> {
  await InventoryTransitShipment.updateOne({ _id: shipment._id }, { $set: { usableReceiptDate: new Date(date),
    receiptConfirmedAt: at, receiptConfirmedBy: by, confirmedSignature: signature }, $inc: { __v: 1 } }, { session: session ?? undefined });
  await InventoryTransitEvent.create([{ _id: newId(), shipmentId: String(shipment._id), at, actor: by,
    action: 'receipt-confirmed', snapshot: { date, signature } }], { session });
}
