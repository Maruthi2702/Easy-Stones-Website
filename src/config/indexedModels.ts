/**
 * Every model whose indexes need creating on startup — the one list both
 * server.ts and ensure-indexes.ts sync against.
 *
 * autoIndex is disabled on the connection (see mongoose.set('autoIndex',
 * false) in server.ts), so nothing here creates an index by just existing —
 * a model missing from this list silently runs with no indexes at all,
 * which is exactly what happened to Delivery/Truck/LostSale in the past
 * (full collection scans on the delivery board, and Delivery.id's unique
 * constraint unenforced) and, separately, to InventoryItem/
 * InventorySalesRecord/DailyReport, which existed only in one of the two
 * hand-maintained lists this module replaces — or in neither.
 *
 * That was two lists kept in sync by memory, the same failure shape as
 * src/utils/deliveryTypes.ts existed to fix for the delivery board: every
 * model is listed here once, and both call sites import this array rather
 * than maintaining their own. Every model in src/models/ is included, not
 * just the ones that currently declare an index — a model with none today
 * still costs nothing to include (createIndexes() on one is a no-op beyond
 * the implicit _id index it already has), and doing so removes the
 * judgment call ("does this one need it yet?") that let the list drift in
 * the first place. Adding a model file without adding it here is the one
 * way to reintroduce the bug — nothing enforces that at build time.
 */
import { FUEL_MODELS } from '../fuelman/models.ts';
import Customer from '../models/Customer.ts';
import Product from '../models/Product.ts';
import User from '../models/User.ts';
import OfficeCheckIn from '../models/OfficeCheckIn.ts';
import ActivityLog from '../models/ActivityLog.ts';
import Schedule from '../models/Schedule.ts';
import Delivery from '../models/Delivery.ts';
import Truck from '../models/Truck.ts';
import LostSale from '../models/LostSale.ts';
import Location from '../models/Location.ts';
import Role from '../models/Role.ts';
import DailyReport from '../models/DailyReport.ts';
import CrossoverSheet from '../models/CrossoverSheet.ts';
import EasyStonesColor from '../models/EasyStonesColor.ts';
import InventoryTransitReport, { InventoryTransitEvent } from '../models/InventoryTransitReport.ts';
import InventoryRevision from '../models/InventoryRevision.ts';
import InventoryItem from '../models/InventoryItem.ts';
import { InventoryStockImport, InventoryStockBackup, InventoryStockState } from '../models/InventoryStockImport.ts';
import InventorySalesRecord from '../models/InventorySalesRecord.ts';
import InventoryTransitShipment from '../models/InventoryTransitShipment.ts';
import VisitType from '../models/VisitType.ts';
import ResourceType from '../models/ResourceType.ts';
import ContactSubmission from '../models/ContactSubmission.ts';
import SalesResource from '../models/SalesResource.ts';
import SalesDashboardResource from '../models/SalesDashboardResource.ts';
import ImportMemory from '../models/ImportMemory.ts';
import CustomerMergeBackup from '../models/CustomerMergeBackup.ts';
import CustomerDeleteBackup from '../models/CustomerDeleteBackup.ts';
import { Cart, Hold, SlabReservation, Counter, HoldHistory } from '../holds/models.ts';

import { PurchasingScope, PurchasingInbound, PurchasingDraft, PurchasingLock, PurchasingPoLink } from '../purchasing/models.ts';

export const INDEXED_MODELS = [
  ...FUEL_MODELS.map(model => [model.modelName, model]),
  ['PurchasingScope', PurchasingScope], ['PurchasingInbound', PurchasingInbound],
  ['PurchasingDraft', PurchasingDraft], ['PurchasingLock', PurchasingLock], ['PurchasingPoLink', PurchasingPoLink],
  ['Customer', Customer],
  ['VisitType', VisitType],
  ['ResourceType', ResourceType],
  ['Product', Product],
  ['User', User],
  ['OfficeCheckIn', OfficeCheckIn],
  ['ActivityLog', ActivityLog],
  ['Schedule', Schedule],
  ['Delivery', Delivery],
  ['Truck', Truck],
  ['LostSale', LostSale],
  ['Location', Location],
  ['Role', Role],
  ['DailyReport', DailyReport],
  ['CrossoverSheet', CrossoverSheet],
  ['EasyStonesColor', EasyStonesColor],
  ['InventoryItem', InventoryItem],
  ['InventoryRevision', InventoryRevision],
  ['InventoryTransitReport', InventoryTransitReport],
  ['InventoryTransitEvent', InventoryTransitEvent],
  ['InventoryStockImport', InventoryStockImport],
  ['InventoryStockBackup', InventoryStockBackup],
  ['InventoryStockState', InventoryStockState],
  ['InventorySalesRecord', InventorySalesRecord],
  ['InventoryTransitShipment', InventoryTransitShipment],
  ['ContactSubmission', ContactSubmission],
  ['SalesResource', SalesResource],
  ['SalesDashboardResource', SalesDashboardResource],
  ['ImportMemory', ImportMemory],
  ['CustomerMergeBackup', CustomerMergeBackup],
  ['CustomerDeleteBackup', CustomerDeleteBackup],
  // Cart & Holds (src/holds/): the unique indexes here are what stop two people holding
  // the same slab (SalesSlabReservation.slabKey), duplicate hold numbers and a second
  // cart per person — they were missing from this list, so never created.
  ['SalesCart', Cart],
  ['SalesHold', Hold],
  ['SalesSlabReservation', SlabReservation],
  ['SalesCounter', Counter],
  ['SalesHoldHistory', HoldHistory]
];
