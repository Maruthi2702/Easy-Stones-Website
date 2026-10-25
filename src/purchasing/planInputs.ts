import type { Scope, Cohort, Sale, InboundRow, Receipt, StockBreakdown } from './types.ts';
import type { OverviewStockRow } from './stockOverview.ts';
import type { TransitShipment } from '../types/inventory.ts';
export interface PlanningStock extends OverviewStockRow {
  _id?: unknown; product: string; location: string; units: string; importedAt?: Date | string;
}
export type PlanningScope = Pick<Scope, 'branches' | 'observedThrough' | 'fullSalesCoverage' | 'stockSnapshotId' |
  'stockCoverageConfirmed' | 'freeStockValidated' | 'policyConfirmed' | 'reviewDays' | 'bufferDays' | 'stockMaxHours' |
  'salesMaxDays' | 'aliases' | 'policies'> & Partial<Omit<Scope, '_id'>> & { _id?: unknown };
export type PlanningSale = Omit<Sale, 'slabsSold'> & { slabsSold?: number; importedAt?: Date };
export type PlanningCohort = Pick<Cohort, 'id' | 'start' | 'end' | 'importedAt'> & Partial<Cohort> & { records: PlanningSale[] };
export interface PlanInputs {
  scope: PlanningScope; stock: PlanningStock[]; cohort: PlanningCohort | null;
  inbound: { _id?: unknown; complete: boolean; createdAt: Date | string; rows?: InboundRow[]; receipts?: Receipt[] } | null;
  reservations: { branch: string; slabKey: string; holdId?: unknown }[];
  locks: { _id: string; draftId: unknown }[];
  transitShipments?: (TransitShipment<Date | string> & { _id?: unknown; active?: boolean; importedAt?: Date | string;
    sourceSignature?: string; confirmedSignature?: string; usableReceiptDate?: Date | string | null })[];
}
export interface PlanningStockGroup {
  product: string; uom: string; readySlabs: number | null; readyQuantity: number | null;
  excludedSlabs: number | null; problems: string[]; summary: StockBreakdown;
}
