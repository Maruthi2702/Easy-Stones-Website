/**
 * Operations: deliveries (the Delivery Schedule's tickets — jobsite, transfer,
 * will call, return), each branch's Daily Report with its lines, and the
 * Payments page. MongoDB kept a report's lines and a payment's history inside
 * the record; here each is its own table, ordered by `position`.
 *
 * Branches are linked by id (`location_id`); people stay names where the app
 * saves names (a rep, who received, who submitted).
 */
import {
  pgTable, text, boolean, integer, bigint, index, uniqueIndex, primaryKey
} from 'drizzle-orm/pg-core';
import { objectId, moment, day, decimal, textArray, idFormat, oneOf } from './columns.ts';
import { locations } from './reference.ts';
import { customers } from './customers.ts';

export const DELIVERY_STATUSES = ['pending', 'scheduled', 'completed', 'delayed', 'cancelled'] as const;
export const DELIVERY_TYPES = ['jobsite', 'transfer', 'will_call', 'return'] as const;

export const deliveries = pgTable('deliveries', {
  id: objectId('id').primaryKey(),
  /** The id the app and its links use ('del_…'). */
  ticketId: text('ticket_id').notNull(),
  /** Null when the ticket names no customer or one that no longer exists (customer_name stays). */
  customerId: objectId('customer_id').references(() => customers.id),
  customerName: text('customer_name').notNull(),
  address: text('address').notNull().default(''),
  salesRepName: text('sales_rep_name').notNull().default(''),
  /** The board column it's on: a driver key ('drv_…'), '' = not assigned. Not a record. */
  truckKey: text('truck_key').notNull().default(''),
  day: day('day'),
  /** As the board shows it, e.g. '09:00 AM'. */
  time: text('time').notNull().default('09:00 AM'),
  status: text('status').notNull().default('pending'),
  notes: text('notes').notNull().default(''),
  soNumber: text('so_number').notNull().default(''),
  invoiceNumber: text('invoice_number').notNull().default(''),
  routeNumber: integer('route_number').notNull().default(1),
  /** The branch it belongs to; null only if its stored branch isn't a location (reported). */
  locationId: objectId('location_id').references(() => locations.id),
  driver: text('driver').notNull().default(''),

  deliveryType: text('delivery_type').notNull().default('jobsite'),
  customerDropOff: boolean('customer_drop_off').notNull().default(false),
  transferDestinationId: objectId('transfer_destination_id').references(() => locations.id),
  expectedArrivalDay: day('expected_arrival_day'),
  receivedAt: moment('received_at'),
  receivedBy: text('received_by').notNull().default(''),
  /** Log arrival: who recorded a transfer the sender never logged. */
  arrivalLoggedByName: text('arrival_logged_by_name'),
  arrivalLoggedByLocation: text('arrival_logged_by_location'),
  arrivalLoggedAt: moment('arrival_logged_at'),
  pickupInfo: text('pickup_info').notNull().default(''),
  carrierName: text('carrier_name').notNull().default(''),
  proNumber: text('pro_number').notNull().default(''),
  freightFee: decimal('freight_fee').notNull().default('0'),
  numberOfSlabs: integer('number_of_slabs').notNull().default(0),

  packingListUrl: text('packing_list_url').notNull().default(''),
  packingListFilename: text('packing_list_filename').notNull().default(''),
  packingListPublicId: text('packing_list_public_id').notNull().default(''),

  /** Proof of delivery (the driver's ePOD). */
  podSigneeName: text('pod_signee_name').notNull().default(''),
  podDriverName: text('pod_driver_name').notNull().default(''),
  podCustomerSignature: text('pod_customer_signature').notNull().default(''),
  podDriverSignature: text('pod_driver_signature').notNull().default(''),
  podCustomerSignedAt: moment('pod_customer_signed_at'),
  podDriverSignedAt: moment('pod_driver_signed_at'),
  podSignedAt: moment('pod_signed_at'),
  podPhotos: textArray('pod_photos'),
  podNotes: text('pod_notes').notNull().default(''),
  podSignedPdfUrl: text('pod_signed_pdf_url').notNull().default(''),
  podSignedPdfFilename: text('pod_signed_pdf_filename').notNull().default(''),
  podSignedPdfPublicId: text('pod_signed_pdf_public_id').notNull().default(''),
  podVerified: boolean('pod_verified').notNull().default(false),
  podClearedAt: moment('pod_cleared_at'),
  podClearedBy: text('pod_cleared_by').notNull().default(''),
  podClearReason: text('pod_clear_reason').notNull().default(''),

  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('deliveries'),
  uniqueIndex('deliveries_ticket_id_key').on(t.ticketId),
  index('deliveries_location_day_idx').on(t.locationId, t.day),
  index('deliveries_customer_idx').on(t.customerId),
  index('deliveries_truck_day_idx').on(t.truckKey, t.day),
  index('deliveries_transfer_destination_idx').on(t.transferDestinationId),
  oneOf('deliveries', 'status', DELIVERY_STATUSES),
  oneOf('deliveries', 'delivery_type', DELIVERY_TYPES)
]);

/** The Delivery Schedule's own truck list (empty today: columns come from drivers). */
export const trucks = pgTable('trucks', {
  id: objectId('id').primaryKey(),
  truckKey: text('truck_key').notNull(),
  name: text('name').notNull(),
  driver: text('driver').notNull().default(''),
  color: text('color').notNull().default('#D4AF37'),
  location: text('location').notNull().default(''),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [idFormat('trucks'), uniqueIndex('trucks_truck_key_key').on(t.truckKey)]);

export const DAILY_REPORT_STATUSES = ['draft', 'submitted', 'closed'] as const;
export const PAYMENT_METHODS = ['ach', 'cash', 'card', 'check', 'return'] as const;

/**
 * One branch's day. A figure left null means nobody has counted it yet (the
 * sheet derives it until a person sets it — see CLAUDE.md's Daily Report incident).
 */
export const dailyReports = pgTable('daily_reports', {
  id: objectId('id').primaryKey(),
  day: day('day').notNull(),
  locationId: objectId('location_id').notNull().references(() => locations.id),
  status: text('status').notNull().default('draft'),
  visitorsHomeowners: integer('visitors_homeowners').notNull().default(0),
  visitorsFabricators: integer('visitors_fabricators'),
  visitorsDesigners: integer('visitors_designers'),
  deliveriesAssigned: integer('deliveries_assigned').notNull().default(0),
  deliveriesCapacity: integer('deliveries_capacity'),
  pickupsAssigned: integer('pickups_assigned').notNull().default(0),
  pickupsCapacity: integer('pickups_capacity'),
  returns: integer('returns'),
  returnsSlabs: integer('returns_slabs'),
  sinks: integer('sinks'),
  /** Payments typed on the sheet (days before the Payments page; null = not recorded). */
  paymentAchCount: integer('payment_ach_count'),
  paymentAchAmount: decimal('payment_ach_amount'),
  paymentCashCount: integer('payment_cash_count'),
  paymentCashAmount: decimal('payment_cash_amount'),
  paymentCardCount: integer('payment_card_count'),
  paymentCardAmount: decimal('payment_card_amount'),
  paymentCheckCount: integer('payment_check_count'),
  paymentCheckAmount: decimal('payment_check_amount'),
  paymentReturnCount: integer('payment_return_count'),
  paymentReturnAmount: decimal('payment_return_amount'),
  notes: text('notes').notNull().default(''),
  submittedBy: text('submitted_by').notNull().default(''),
  submittedAt: moment('submitted_at'),
  autoSubmitted: boolean('auto_submitted').notNull().default(false),
  reopenedBy: text('reopened_by').notNull().default(''),
  reopenedAt: moment('reopened_at'),
  reopenReason: text('reopen_reason').notNull().default(''),
  updatedBy: text('updated_by').notNull().default(''),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('daily_reports'),
  uniqueIndex('daily_reports_location_day_key').on(t.locationId, t.day),
  oneOf('daily_reports', 'status', DAILY_REPORT_STATUSES)
]);

/** A report's transfer lines, in the sheet's order. */
export const dailyReportTransfers = pgTable('daily_report_transfers', {
  reportId: objectId('report_id').notNull().references(() => dailyReports.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  /** 'SEA — SLC', origin first whatever the direction. */
  fromTo: text('from_to').notNull().default(''),
  transferNumber: text('transfer_number').notNull().default(''),
  count: integer('count').notNull().default(0),
  slabs: integer('slabs').notNull().default(0),
  auto: boolean('auto').notNull().default(false),
  /** Null on lines saved before directions: read from the route (transferDirection.ts). */
  direction: text('direction'),
  received: boolean('received'),
  receivedAt: moment('received_at'),
  receivedBy: text('received_by').notNull().default(''),
  ticketIds: textArray('ticket_ids'),
  addedAfterSubmitAt: moment('added_after_submit_at')
}, t => [
  primaryKey({ columns: [t.reportId, t.position] }),
  oneOf('daily_report_transfers', 'direction', ['out', 'in'])
]);

export const dailyReportContainers = pgTable('daily_report_containers', {
  reportId: objectId('report_id').notNull().references(() => dailyReports.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  /** Blank continues the PO of the line above. */
  poNumber: text('po_number').notNull().default(''),
  material: text('material').notNull().default(''),
  slabs: integer('slabs').notNull().default(0)
}, t => [primaryKey({ columns: [t.reportId, t.position] })]);

/** Submit / reopen / email / late-transfer lines (View Log), never edited. */
export const dailyReportLog = pgTable('daily_report_log', {
  reportId: objectId('report_id').notNull().references(() => dailyReports.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  at: moment('at').notNull(),
  by: text('by').notNull().default(''),
  action: text('action').notNull(),
  note: text('note').notNull().default(''),
  /** Copied from a day's fields from before the log existed. */
  earlier: boolean('earlier')
}, t => [primaryKey({ columns: [t.reportId, t.position] })]);

/** Operations → Payments: one row per payment taken. Voided, never deleted. */
export const paymentsReceived = pgTable('payments_received', {
  id: objectId('id').primaryKey(),
  locationId: objectId('location_id').notNull().references(() => locations.id),
  day: day('day').notNull(),
  /** Null only if the customer was deleted since (customer_name stays). */
  customerId: objectId('customer_id').references(() => customers.id),
  customerName: text('customer_name').notNull().default(''),
  method: text('method').notNull(),
  /** Negative for a Return. */
  cents: bigint('cents', { mode: 'number' }).notNull(),
  invoice: text('invoice').notNull().default(''),
  reference: text('reference').notNull().default(''),
  note: text('note').notNull().default(''),
  enteredBy: text('entered_by').notNull().default(''),
  updatedBy: text('updated_by').notNull().default(''),
  voidedAt: moment('voided_at'),
  voidedBy: text('voided_by').notNull().default(''),
  voidReason: text('void_reason').notNull().default(''),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('payments_received'),
  index('payments_received_location_day_idx').on(t.locationId, t.day),
  index('payments_received_customer_idx').on(t.customerId),
  oneOf('payments_received', 'method', PAYMENT_METHODS)
]);

export const paymentHistory = pgTable('payment_history', {
  paymentId: objectId('payment_id').notNull().references(() => paymentsReceived.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  at: moment('at').notNull(),
  by: text('by').notNull().default(''),
  action: text('action').notNull(),
  changes: text('changes').notNull().default('')
}, t => [
  primaryKey({ columns: [t.paymentId, t.position] }),
  oneOf('payment_history', 'action', ['added', 'edited', 'voided'])
]);

