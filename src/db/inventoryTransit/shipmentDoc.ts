/** Postgres transit rows → the shipment as MongoDB held it (`_id`, its `lines`), so routes and screens never learn which database answered. */
import type { inventoryTransitShipments, inventoryTransitLines } from '../schema/inventory.ts';
import type { Loose } from '../../types/records.ts';

/** A text MongoDB never stored is left out; one it stored as '' stays ''. */
const text = (v: string | null) => (v == null ? undefined : v);
const num = (v: string | null) => (v == null ? null : Number(v));

export function lineDoc(l: typeof inventoryTransitLines.$inferSelect): Loose {
  return {
    product: text(l.product), sku: text(l.sku), poNumber: text(l.poNumber), containerNumber: text(l.containerNumber),
    location: text(l.location), poDate: l.poDate, poEtaDate: l.poEtaDate, supplierSoNumber: text(l.supplierSoNumber),
    siplNumber: text(l.siplNumber), slabs: num(l.slabs), quantity: num(l.quantity), units: text(l.units),
    supplier: text(l.supplier), freightForwarder: text(l.freightForwarder), shipDate: l.shipDate,
    portEtaDate: l.portEtaDate, etaDate: l.etaDate, vessel: text(l.vessel), customerReference: text(l.customerReference),
    supplierPurchaseNote: text(l.supplierPurchaseNote), status: text(l.status)
  };
}

export function shipmentDoc(r: typeof inventoryTransitShipments.$inferSelect, lines: (typeof inventoryTransitLines.$inferSelect)[]): Loose {
  return {
    _id: r.id,
    poNumber: r.poNumber,
    containerNumber: r.containerNumber,
    location: r.location,
    lines: lines.map(lineDoc),
    active: r.active,
    reportId: text(r.reportId),
    sourceSignature: text(r.sourceSignature),
    confirmedSignature: text(r.confirmedSignature),
    usableReceiptDate: r.usableReceiptDate,
    receiptConfirmedAt: r.receiptConfirmedAt,
    receiptConfirmedBy: text(r.receiptConfirmedBy),
    inactiveAt: r.inactiveAt ?? undefined,
    inactiveReason: text(r.inactiveReason),
    importedAt: r.importedAt ?? undefined,
    importedByName: text(r.importedByName),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}
