import type { ClientSession } from 'mongoose';
import type { Loose } from '../../types/records.ts';

export interface StockImportInput {
  rows: Record<string, unknown>[];
  sourceFilename?: string;
  sourceHash?: string;
  importedById?: string | null;
  importedByName?: string;
}

export interface StockImportResult {
  importId: string;
  count: number;
  importedAt: Date;
  version: number;
}

/** One location + period of sales, replaced whole. */
export interface SalesPeriodInput {
  location: string;
  periodStart: Date;
  periodEnd: Date;
  rows: Record<string, unknown>[];
  importedAt: Date;
  importedByName: string;
  importedById: unknown;
}

/**
 * Runs inside the replacement's transaction with the records about to be replaced (only
 * when there are some). `session` is MongoDB's; on Postgres it is undefined, and whatever
 * the callback writes elsewhere (Purchasing's cohort links) is not in that transaction
 * until Purchasing moves too.
 */
export type BeforeReplace = (previous: Loose[], ctx: { session?: ClientSession; tx?: unknown }) => Promise<void>;

/** One product's row on the grouped Stock Detail: totals over its slabs. */
export interface StockGroup {
  _id: string;
  category: string;
  units: string;
  slabCount: number;
  totalOnHand: number;
  totalAvailable: number;
  totalAssetValue: number;
  locations: string[];
  oldestReceivedDate: Date | null;
  statuses: string[];
}
