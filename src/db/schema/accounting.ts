/**
 * Accounting: 3rd-party freight (carriers, a charge per delivery, carrier
 * invoices, payments) with its append-only audit, and Fuel Man (fuel card
 * reports, who drove what, the cost per branch, closed months).
 *
 * Payments and the audit are append-only in the app (src/accounting/models.ts
 * refuses updates); here they reference charges by id but are never cascaded.
 * A charge names its delivery by ticket id ('del_…') with no foreign key: a
 * charge outlives a deleted ticket. People are id + name, as stored.
 */
import { pgTable, text, integer, bigint, boolean, jsonb, index, uniqueIndex, primaryKey, customType } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { objectId, moment, day, textArray, idFormat, oneOf } from './columns.ts';
import { locations } from './reference.ts';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const cents = (name: string) => bigint(name, { mode: 'number' });
export const CHARGE_STATUSES = ['draft', 'approved', 'paid', 'void'] as const;
export const ACCT_PAYMENT_METHODS = ['check', 'ach', 'card', 'cash', 'other'] as const;
export const PAYMENT_TERMS = ['per_delivery', 'per_invoice'] as const;

export const acctCarriers = pgTable('acct_carriers', {
  id: objectId('id').primaryKey(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull(),
  aliases: textArray('aliases'),
  paymentTerms: text('payment_terms').notNull().default('per_delivery'),
  active: boolean('active').notNull().default(true),
  notes: text('notes').notNull().default(''),
  createdById: text('created_by_id').notNull().default(''),
  createdByName: text('created_by_name').notNull().default(''),
  updatedById: text('updated_by_id').notNull().default(''),
  updatedByName: text('updated_by_name').notNull().default(''),
  version: integer('version').notNull().default(0),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('acct_carriers'),
  uniqueIndex('acct_carriers_name_key_key').on(t.nameKey),
  oneOf('acct_carriers', 'payment_terms', PAYMENT_TERMS)
]);

/** How a charge or invoice was paid (blank until it is). */
const paymentColumns = () => ({
  paymentId: text('payment_id').notNull().default(''),
  paidOn: day('paid_on'),
  paymentMethod: text('payment_method').notNull().default(''),
  paymentReference: text('payment_reference').notNull().default(''),
  paymentRecordedAt: moment('payment_recorded_at'),
  paymentRecordedById: text('payment_recorded_by_id').notNull().default(''),
  paymentRecordedByName: text('payment_recorded_by_name').notNull().default('')
});

export const acctCarrierInvoices = pgTable('acct_carrier_invoices', {
  id: objectId('id').primaryKey(),
  carrierId: objectId('carrier_id').notNull().references(() => acctCarriers.id),
  invoiceNumber: text('invoice_number').notNull(),
  invoiceDate: day('invoice_date'),
  totalCents: cents('total_cents').notNull(),
  locations: textArray('locations'),
  status: text('status').notNull().default('draft'),
  notes: text('notes').notNull().default(''),
  approvedAt: moment('approved_at'),
  approvedById: text('approved_by_id').notNull().default(''),
  approvedByName: text('approved_by_name').notNull().default(''),
  ...paymentColumns(),
  voidedAt: moment('voided_at'),
  voidedById: text('voided_by_id').notNull().default(''),
  voidedByName: text('voided_by_name').notNull().default(''),
  voidReason: text('void_reason').notNull().default(''),
  createdById: text('created_by_id').notNull().default(''),
  createdByName: text('created_by_name').notNull().default(''),
  updatedById: text('updated_by_id').notNull().default(''),
  updatedByName: text('updated_by_name').notNull().default(''),
  version: integer('version').notNull().default(0),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('acct_carrier_invoices'),
  uniqueIndex('acct_carrier_invoices_number_key').on(t.carrierId, t.invoiceNumber),
  oneOf('acct_carrier_invoices', 'status', CHARGE_STATUSES)
]);

export const acctFreightCharges = pgTable('acct_freight_charges', {
  id: objectId('id').primaryKey(),
  source: text('source').notNull(),
  /** The delivery's ticket id ('del_…'); null for a manual charge. */
  deliveryTicketId: text('delivery_ticket_id'),
  soNumber: text('so_number').notNull().default(''),
  customerName: text('customer_name').notNull().default(''),
  deliveryDay: day('delivery_day'),
  locationId: objectId('location_id').references(() => locations.id),
  carrierId: objectId('carrier_id').references(() => acctCarriers.id),
  carrierNameRaw: text('carrier_name_raw').notNull().default(''),
  bolNumber: text('bol_number').notNull().default(''),
  amountCents: cents('amount_cents'),
  description: text('description').notNull().default(''),
  notes: text('notes').notNull().default(''),
  status: text('status').notNull().default('draft'),
  invoiceId: objectId('invoice_id').references(() => acctCarrierInvoices.id),
  /** The delivery as it was when the charge was made (to flag later changes). */
  sourceSoNumber: text('source_so_number'),
  sourceCustomerName: text('source_customer_name'),
  sourceDeliveryDate: text('source_delivery_date'),
  sourceLocation: text('source_location'),
  sourceCarrierNameRaw: text('source_carrier_name_raw'),
  sourceBolNumber: text('source_bol_number'),
  sourceAmountCents: cents('source_amount_cents'),
  /** Fields a person set by hand, which a delivery change no longer overwrites. */
  handSet: textArray('hand_set'),
  approvedAt: moment('approved_at'),
  approvedById: text('approved_by_id').notNull().default(''),
  approvedByName: text('approved_by_name').notNull().default(''),
  ...paymentColumns(),
  voidedAt: moment('voided_at'),
  voidedById: text('voided_by_id').notNull().default(''),
  voidedByName: text('voided_by_name').notNull().default(''),
  voidReason: text('void_reason').notNull().default(''),
  createdById: text('created_by_id').notNull().default(''),
  createdByName: text('created_by_name').notNull().default(''),
  updatedById: text('updated_by_id').notNull().default(''),
  updatedByName: text('updated_by_name').notNull().default(''),
  version: integer('version').notNull().default(0),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('acct_freight_charges'),
  uniqueIndex('acct_freight_charges_delivery_key').on(t.deliveryTicketId).where(sql`delivery_ticket_id is not null`),
  index('acct_freight_charges_location_status_idx').on(t.locationId, t.status, t.deliveryDay),
  index('acct_freight_charges_carrier_idx').on(t.carrierId),
  index('acct_freight_charges_invoice_idx').on(t.invoiceId),
  oneOf('acct_freight_charges', 'source', ['delivery', 'manual']),
  oneOf('acct_freight_charges', 'status', CHARGE_STATUSES)
]);

/** Why a charge needs another look (its delivery reopened or changed). */
export const acctFreightChargeFlags = pgTable('acct_freight_charge_flags', {
  id: objectId('id').primaryKey(),
  chargeId: objectId('charge_id').notNull().references(() => acctFreightCharges.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  code: text('code').notNull(),
  detail: text('detail').notNull().default(''),
  at: moment('at').notNull(),
  resolvedAt: moment('resolved_at'),
  resolvedById: text('resolved_by_id').notNull().default(''),
  resolvedByName: text('resolved_by_name').notNull().default('')
}, t => [
  idFormat('acct_freight_charge_flags'),
  oneOf('acct_freight_charge_flags', 'code', ['delivery_reopened', 'delivery_changed'])
]);

export const acctInvoiceCharges = pgTable('acct_invoice_charges', {
  invoiceId: objectId('invoice_id').notNull().references(() => acctCarrierInvoices.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  chargeId: objectId('charge_id').notNull().references(() => acctFreightCharges.id)
}, t => [primaryKey({ columns: [t.invoiceId, t.position] })]);

/** One payment (append-only). */
export const acctPayments = pgTable('acct_payments', {
  id: objectId('id').primaryKey(),
  paymentId: text('payment_id').notNull(),
  requestId: text('request_id'),
  kind: text('kind').notNull(),
  carrierId: objectId('carrier_id').references(() => acctCarriers.id),
  invoiceId: objectId('invoice_id').references(() => acctCarrierInvoices.id),
  locations: textArray('locations'),
  totalCents: cents('total_cents').notNull(),
  paidOn: day('paid_on').notNull(),
  method: text('method').notNull(),
  reference: text('reference').notNull().default(''),
  approvedInSameStep: boolean('approved_in_same_step').notNull().default(false),
  recordedAt: moment('recorded_at').notNull(),
  recordedById: text('recorded_by_id').notNull().default(''),
  recordedByName: text('recorded_by_name').notNull().default('')
}, t => [
  idFormat('acct_payments'),
  uniqueIndex('acct_payments_payment_id_key').on(t.paymentId),
  uniqueIndex('acct_payments_request_key').on(t.requestId).where(sql`request_id is not null`),
  index('acct_payments_paid_on_idx').on(t.paidOn),
  oneOf('acct_payments', 'kind', ['charges', 'invoice']),
  oneOf('acct_payments', 'method', ACCT_PAYMENT_METHODS)
]);

export const acctPaymentCharges = pgTable('acct_payment_charges', {
  paymentRowId: objectId('payment_row_id').notNull().references(() => acctPayments.id),
  position: integer('position').notNull(),
  chargeId: objectId('charge_id').notNull().references(() => acctFreightCharges.id)
}, t => [primaryKey({ columns: [t.paymentRowId, t.position] })]);

/** Every change to a charge, invoice or carrier (append-only; outlives what it describes). */
export const acctAudit = pgTable('acct_audit', {
  id: objectId('id').primaryKey(),
  txnId: text('txn_id').notNull(),
  paymentId: text('payment_id').notNull().default(''),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  byId: text('by_id').notNull().default(''),
  byName: text('by_name').notNull().default(''),
  at: moment('at').notNull(),
  /** [{ field, from, to }] — from / to hold whatever the field held. */
  changes: jsonb('changes').notNull().default(sql`'[]'::jsonb`),
  note: text('note').notNull().default('')
}, t => [
  idFormat('acct_audit'),
  uniqueIndex('acct_audit_txn_key').on(t.txnId),
  index('acct_audit_entity_idx').on(t.entityType, t.entityId, t.at),
  index('acct_audit_payment_idx').on(t.paymentId).where(sql`payment_id > ''`),
  oneOf('acct_audit', 'entity_type', ['charge', 'invoice', 'carrier'])
]);

/* ---- Fuel Man ---- */

export const FUEL_REPORT_STATUSES = ['draft', 'posted', 'superseded', 'reversed'] as const;

/** One imported fuel card statement and what was decided about each line. */
export const fuelReports = pgTable('acct_fuelman_reports', {
  id: objectId('id').primaryKey(),
  scopeKey: text('scope_key').notNull(),
  fileHash: text('file_hash').notNull(),
  contentHash: text('content_hash').notNull(),
  periodKey: text('period_key').notNull(),
  filename: text('filename'),
  /** The statement as read (lines, totals, month) — the reader's own shape. */
  parsed: jsonb('parsed'),
  revision: integer('revision'),
  status: text('status').notNull().default('draft'),
  dispositions: jsonb('dispositions').notNull(),
  overrides: jsonb('overrides').notNull(),
  importedAt: moment('imported_at'),
  importedById: text('imported_by_id'),
  importedByName: text('imported_by_name'),
  frozenReview: jsonb('frozen_review'),
  publishedAt: moment('published_at'),
  note: text('note'),
  version: integer('version').notNull().default(0)
}, t => [
  idFormat('acct_fuelman_reports'),
  uniqueIndex('acct_fuelman_reports_file_key').on(t.fileHash),
  uniqueIndex('acct_fuelman_reports_content_key').on(t.scopeKey, t.contentHash),
  uniqueIndex('acct_fuelman_reports_period_revision_key').on(t.periodKey, t.revision),
  index('acct_fuelman_reports_imported_idx').on(t.importedAt),
  oneOf('acct_fuelman_reports', 'status', FUEL_REPORT_STATUSES)
]);

/** Who a fuel card belonged to, from when to when. */
export const fuelAssignments = pgTable('acct_fuelman_assignments', {
  id: objectId('id').primaryKey(),
  scopeKey: text('scope_key').notNull(),
  externalId: text('external_id').notNull(),
  reportedName: text('reported_name'),
  driverKey: text('driver_key'),
  driverName: text('driver_name'),
  fromDay: day('from_day'),
  /** Null = still assigned. */
  toDay: day('to_day'),
  updatedById: text('updated_by_id'),
  updatedByName: text('updated_by_name'),
  updatedAt: moment('updated_at')
}, t => [
  idFormat('acct_fuelman_assignments'),
  uniqueIndex('acct_fuelman_assignments_card_from_key').on(t.scopeKey, t.externalId, t.fromDay)
]);

/** How an assignment's cost is split between branches (basis points: 10000 = all of it). */
export const fuelAssignmentAllocations = pgTable('acct_fuelman_assignment_allocations', {
  assignmentId: objectId('assignment_id').notNull().references(() => fuelAssignments.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  location: text('location'),
  basisPoints: integer('basis_points')
}, t => [primaryKey({ columns: [t.assignmentId, t.position] })]);

export const fuelProfiles = pgTable('acct_fuelman_profiles', {
  id: objectId('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  createdById: text('created_by_id'),
  createdByName: text('created_by_name')
}, t => [idFormat('acct_fuelman_profiles'), oneOf('acct_fuelman_profiles', 'kind', ['driver', 'shared'])]);

/** The statement PDF itself. */
export const fuelSources = pgTable('acct_fuelman_sources', {
  id: objectId('id').primaryKey(),
  reportId: objectId('report_id').notNull().references(() => fuelReports.id, { onDelete: 'cascade' }),
  pdf: bytea('pdf').notNull()
}, t => [idFormat('acct_fuelman_sources'), uniqueIndex('acct_fuelman_sources_report_key').on(t.reportId)]);

/** One cost on a branch from one statement line. */
export const fuelExpenses = pgTable('acct_fuelman_expenses', {
  id: objectId('id').primaryKey(),
  reportId: objectId('report_id').notNull().references(() => fuelReports.id, { onDelete: 'cascade' }),
  /** 'YYYY-MM' */
  month: text('month'),
  scopeKey: text('scope_key'),
  externalId: text('external_id'),
  driverKey: text('driver_key'),
  driverName: text('driver_name'),
  /** The branch (or label) the cost is spread to, as Fuel Man names it. */
  location: text('location'),
  category: text('category'),
  amountCents: cents('amount_cents'),
  sourceLine: integer('source_line'),
  day: day('day')
}, t => [
  idFormat('acct_fuelman_expenses'),
  uniqueIndex('acct_fuelman_expenses_line_key').on(t.reportId, t.sourceLine, t.location),
  index('acct_fuelman_expenses_month_location_idx').on(t.month, t.location)
]);

export const fuelState = pgTable('acct_fuelman_state', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull().default(0)
});

/** A month of a scope: which report is published, and whether it's closed. */
export const fuelPeriods = pgTable('acct_fuelman_periods', {
  id: text('id').primaryKey(),
  scopeKey: text('scope_key'),
  month: text('month'),
  publishedReportId: objectId('published_report_id').references(() => fuelReports.id),
  closed: boolean('closed').notNull().default(false),
  closedById: text('closed_by_id'),
  closedByName: text('closed_by_name'),
  closedAt: moment('closed_at')
}, t => [index('acct_fuelman_periods_month_idx').on(t.month, t.publishedReportId)]);

/** What was done to each report (kept when the report is gone). */
export const fuelHistory = pgTable('acct_fuelman_history', {
  id: objectId('id').primaryKey(),
  reportId: objectId('report_id'),
  scopeKey: text('scope_key'),
  action: text('action'),
  at: moment('at'),
  actorId: text('actor_id'),
  actorName: text('actor_name'),
  note: text('note'),
  detail: jsonb('detail')
}, t => [idFormat('acct_fuelman_history'), index('acct_fuelman_history_report_idx').on(t.reportId, t.at)]);

