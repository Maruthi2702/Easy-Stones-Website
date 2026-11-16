/**
 * What Purchasing reads that is NOT its own data: stock and sales reports (the Inventory layer), holds'
 * slab locks (the Holds layer) and the branch list (still MongoDB until Locations move) and the inventory
 * revision. Each read is one small function here so moving one is a change to this file only.
 */
import type { ClientSession } from 'mongoose';
import { stockForPurchasing, salesRecordsForPurchasing } from '../inventory/index.ts';
import * as staffData from '../staff/index.ts';
import { lockedSlabsAtBranches } from '../holds/index.ts';
import { inInventoryTransaction } from '../../services/inventoryTransaction.ts';

type Session = ClientSession | null;

/** Branch names, A–Z. */
export const readBranchNames = async (session: Session): Promise<string[]> =>
  await staffData.locationNames();

/** The stock and sales Purchasing plans from: the Inventory data layer (MongoDB or Postgres, by `DB_INVENTORY`). */
export const readStockForPurchasing = (branches: string[], session: Session, tx: unknown = null) => stockForPurchasing(branches, session, tx);

export const readSalesRecordsForPurchasing = (session: Session, tx: unknown = null) => salesRecordsForPurchasing(session, tx);

export const readReservationsForPurchasing = (branches: string[], session: Session, tx: unknown = null) => lockedSlabsAtBranches(branches, session, tx);

/**
 * The inventory revision is bumped by every purchasing write (it tells open screens to
 * refresh). On MongoDB that happens inside the write's own transaction; with Purchasing on
 * Postgres it is bumped here, right after the Postgres commit.
 */
export const bumpInventoryRevision = (): Promise<void> => inInventoryTransaction(async () => {});
