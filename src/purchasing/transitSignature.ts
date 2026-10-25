import { createHash } from 'node:crypto';
import type { TransitShipment } from '../types/inventory.ts';
/** Source content, independent of export row order and upload timestamp. */
export function transitSignature(shipment: TransitShipment<Date | string>): string {
  const lines = shipment.lines.map(line => JSON.stringify([line.product, line.sku, line.siplNumber,
    line.slabs, line.quantity, line.units, line.supplier, line.status,
    line.etaDate ? new Date(line.etaDate).toISOString().slice(0, 10) : null])).sort();
  return createHash('sha256').update(JSON.stringify([shipment.poNumber, shipment.containerNumber, shipment.location, lines])).digest('hex');
}
