import type { TransitLine } from '../types/inventory.ts';
import type { ImportedTransitLine } from './types.ts';
import { transitSignature } from './transitSignature.ts';
import { variantKey } from './planning.ts';

type Shipment = {
  _id?: unknown; active?: boolean; sourceSignature?: string; confirmedSignature?: string;
  usableReceiptDate?: Date | string | null;
  poNumber: string;
  containerNumber: string;
  location: string;
  importedAt?: Date | string | null;
  lines: TransitLine<Date | string>[];
};
const iso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** Read the same imported shipments shown in Inventory Analysis, scoped by branch. */
export function transitSupply(shipments: Shipment[], branches: string[]): ImportedTransitLine[] {
  return shipments.filter(shipment => shipment.active !== false && branches.includes(shipment.location)).flatMap(shipment =>
    shipment.lines.filter(line => branches.includes(line.location) && line.status === 'INTRANSIT').map((line, index) => ({
      shipmentId: shipment._id ? String(shipment._id) : undefined,
      sourceSignature: shipment.sourceSignature || transitSignature(shipment),
      usableReceiptDate: shipment.confirmedSignature === (shipment.sourceSignature || transitSignature(shipment)) ? iso(shipment.usableReceiptDate)?.slice(0, 10) || null : null,
      receiptConfirmed: !!shipment.usableReceiptDate && shipment.confirmedSignature === (shipment.sourceSignature || transitSignature(shipment)),
      key: JSON.stringify([shipment.poNumber, shipment.containerNumber, shipment.location, index]),
      poNumber: line.poNumber,
      containerNumber: line.containerNumber,
      siplNumber: line.siplNumber,
      product: line.product,
      branch: line.location,
      supplier: line.supplier,
      slabs: line.slabs ?? null,
      quantity: line.quantity,
      units: line.units.trim().toUpperCase(),
      // SPS destination ETA only: port ETA is not warehouse availability.
      eta: iso(line.etaDate)?.slice(0, 10) || null,
      importedAt: iso(shipment.importedAt),
    })));
}

/** A verified PO snapshot already includes shipped and unshipped parent supply. */
export const parentSupplyKey = (po: string, product: string, branch: string): string =>
  JSON.stringify([po, variantKey(product), branch]);
