import type { TransitShipment } from '../../types/inventory.ts';

/** What one transit report import publishes (the service checks the branches first). */
export interface TransitPublish {
  /** Made by the caller, so both databases hold the same id. */
  importId: string;
  importedAt: Date;
  shipments: TransitShipment[];
  /** Branches the report covers, already trimmed and de-duplicated. */
  coverage: string[];
  complete: boolean;
  sourceFilename: string;
  sourceHash: string;
  importedByName: string;
}

export interface TransitPublished {
  importId: string;
  importedAt: Date;
  shipmentCount: number;
  withdrawnCount: number;
}
