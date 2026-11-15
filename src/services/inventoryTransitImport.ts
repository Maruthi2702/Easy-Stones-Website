import { randomUUID } from 'node:crypto';
import { publishTransit } from '../db/inventoryTransit/index.ts';
import type { TransitShipment } from '../types/inventory.ts';
interface TransitPublication {
  shipments: TransitShipment[]; branches: string[]; complete: boolean;
  sourceFilename?: string; sourceHash?: string; importedByName?: string;
}
/** Checks the report's branch coverage, then publishes it through the in-transit data layer (src/db/inventoryTransit/). */
export async function publishTransitReport({ shipments, branches, complete, sourceFilename = '', sourceHash = '', importedByName = '' }: TransitPublication) {
  const coverage = [...new Set(branches.map(b => b.trim()).filter(Boolean))];
  if (!coverage.length || shipments.some(s => !coverage.includes(s.location))) throw new Error('Select the branches covered by this transit report');
  return publishTransit({ importId: randomUUID(), importedAt: new Date(), shipments, coverage, complete, sourceFilename, sourceHash, importedByName });
}
