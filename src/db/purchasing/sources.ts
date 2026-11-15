/**
 * What Purchasing reads that is NOT its own data: stock and sales reports (the Inventory layer), holds'
 * reservations and the branch list (still MongoDB until Cart & Holds and Locations move) and the inventory
 * revision. Each read is one small function here so moving one is a change to this file only.
 */
import type { ClientSession } from 'mongoose';
import { stockForPurchasing, salesRecordsForPurchasing } from '../inventory/index.ts';
import Location from '../../models/Location.ts';
import { SlabReservation } from '../../holds/models.ts';
import { inInventoryTransaction } from '../../services/inventoryTransaction.ts';

type Session = ClientSession | null;

/** Branch names, A–Z. */
export const readBranchNames = async (session: Session): Promise<string[]> =>
  (await Location.find({}, 'name').session(session).sort({ name: 1 }).lean()).map(row => row.name);

/** The stock and sales Purchasing plans from: the Inventory data layer (MongoDB or Postgres, by `DB_INVENTORY`). */
export const readStockForPurchasing = (branches: string[], session: Session, tx: unknown = null) => stockForPurchasing(branches, session, tx);

export const readSalesRecordsForPurchasing = (session: Session, tx: unknown = null) => salesRecordsForPurchasing(session, tx);

export const readReservationsForPurchasing = (branches: string[], session: Session) =>
  SlabReservation.find({ branch: { $in: branches } }, 'slabKey branch holdId updatedAt').session(session).sort({ _id: 1 }).lean();

/**
 * The inventory revision is bumped by every purchasing write (it tells open screens to
 * refresh). On MongoDB that happens inside the write's own transaction; with Purchasing on
 * Postgres it is bumped here, right after the Postgres commit.
 */
export const bumpInventoryRevision = (): Promise<void> => inInventoryTransaction(async () => {});
