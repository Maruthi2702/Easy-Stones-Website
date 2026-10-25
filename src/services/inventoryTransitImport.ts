import { randomUUID } from 'node:crypto';
import InventoryTransitShipment from '../models/InventoryTransitShipment.ts';
import InventoryTransitReport, { InventoryTransitEvent } from '../models/InventoryTransitReport.ts';
import { inInventoryTransaction } from './inventoryTransaction.ts';
import { transitSignature } from '../purchasing/transitSignature.ts';
import type { TransitShipment } from '../types/inventory.ts';
interface TransitPublication {
  shipments: TransitShipment[]; branches: string[]; complete: boolean;
  sourceFilename?: string; sourceHash?: string; importedByName?: string;
}
export async function publishTransitReport({ shipments, branches, complete, sourceFilename = '', sourceHash = '', importedByName = '' }: TransitPublication) {
  const coverage = [...new Set(branches.map(b => b.trim()).filter(Boolean))];
  if (!coverage.length || shipments.some(s => !coverage.includes(s.location))) throw new Error('Select the branches covered by this transit report');
  const importId = randomUUID(), importedAt = new Date();
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
