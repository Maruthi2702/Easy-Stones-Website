/**
 * Every model whose indexes need creating on startup — the one list both
 * server.js and ensure-indexes.js sync against.
 *
 * autoIndex is disabled on the connection (see mongoose.set('autoIndex',
 * false) in server.js), so nothing here creates an index by just existing —
 * a model missing from this list silently runs with no indexes at all,
 * which is exactly what happened to Delivery/Truck/LostSale in the past
 * (full collection scans on the delivery board, and Delivery.id's unique
 * constraint unenforced) and, separately, to InventoryItem/
 * InventorySalesRecord/DailyReport, which existed only in one of the two
 * hand-maintained lists this module replaces — or in neither.
 *
 * That was two lists kept in sync by memory, the same failure shape as
 * src/utils/deliveryTypes.js existed to fix for the delivery board: every
 * model is listed here once, and both call sites import this array rather
 * than maintaining their own. Every model in src/models/ is included, not
 * just the ones that currently declare an index — a model with none today
 * still costs nothing to include (createIndexes() on one is a no-op beyond
 * the implicit _id index it already has), and doing so removes the
 * judgment call ("does this one need it yet?") that let the list drift in
 * the first place. Adding a model file without adding it here is the one
 * way to reintroduce the bug — nothing enforces that at build time.
 */
import Customer from '../models/Customer.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import OfficeCheckIn from '../models/OfficeCheckIn.js';
import ActivityLog from '../models/ActivityLog.js';
import Schedule from '../models/Schedule.js';
import Delivery from '../models/Delivery.js';
import Truck from '../models/Truck.js';
import LostSale from '../models/LostSale.js';
import Location from '../models/Location.js';
import Role from '../models/Role.js';
import DailyReport from '../models/DailyReport.js';
import CrossoverSheet from '../models/CrossoverSheet.js';
import InventoryItem from '../models/InventoryItem.js';
import InventorySalesRecord from '../models/InventorySalesRecord.js';
import ContactSubmission from '../models/ContactSubmission.js';
import SalesResource from '../models/SalesResource.js';
import SalesDashboardResource from '../models/SalesDashboardResource.js';

export const INDEXED_MODELS = [
  ['Customer', Customer],
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
  ['InventoryItem', InventoryItem],
  ['InventorySalesRecord', InventorySalesRecord],
  ['ContactSubmission', ContactSubmission],
  ['SalesResource', SalesResource],
  ['SalesDashboardResource', SalesDashboardResource]
];
