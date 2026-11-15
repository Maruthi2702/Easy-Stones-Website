/**
 * What Purchasing reads that is NOT its own data: stock, sales reports, holds' reservations,
 * the branch list and the inventory revision. They stay on MongoDB until their own areas
 * move; each read is one small function here so moving it is a change to this file only.
 * (Transit shipments are read by data.ts / router.ts directly and are not part of this move.)
 */
import type { ClientSession } from 'mongoose';
import InventoryItem from '../../models/InventoryItem.ts';
import InventorySalesRecord from '../../models/InventorySalesRecord.ts';
import Location from '../../models/Location.ts';
import { SlabReservation } from '../../holds/models.ts';
import { inInventoryTransaction } from '../../services/inventoryTransaction.ts';

type Session = ClientSession | null;

/** Branch names, A–Z. */
export const readBranchNames = async (session: Session): Promise<string[]> =>
  (await Location.find({}, 'name').session(session).sort({ name: 1 }).lean()).map(row => row.name);

/** The stock rows Purchasing plans from, at these branches. The swap point for the Inventory area. */
export const readStockForPurchasing = (branches: string[], session: Session) =>
  InventoryItem.find(
    { location: { $in: branches } },
    'product location units type instockQty availableSlabs availableQuantity slabStatus remnant serialNumber importedAt',
  ).session(session).sort({ _id: 1 }).lean();

export const readSalesRecordsForPurchasing = (session: Session) =>
  InventorySalesRecord.find({}, 'product uom slabsSold quantitySold location periodStart periodEnd importedAt')
    .session(session).sort({ _id: 1 }).lean();

export const readReservationsForPurchasing = (branches: string[], session: Session) =>
  SlabReservation.find({ branch: { $in: branches } }, 'slabKey branch holdId updatedAt').session(session).sort({ _id: 1 }).lean();

/**
 * The inventory revision is bumped by every purchasing write (it tells open screens to
 * refresh). On MongoDB that happens inside the write's own transaction; with Purchasing on
 * Postgres it is bumped here, right after the Postgres commit.
 */
export const bumpInventoryRevision = (): Promise<void> => inInventoryTransaction(async () => {});
