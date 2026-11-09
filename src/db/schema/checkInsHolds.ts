/**
 * Check In (the front desk's visitors and their Selection Sheets) and
 * Cart & Holds (each person's cart, holds on slabs for a customer, the
 * one-hold-per-slab reservations, and every hold's history).
 *
 * People on holds are kept as id + name, not foreign keys: the hold job and
 * imports act as 'system', and history outlives a deleted user.
 */
import { pgTable, text, integer, bigint, jsonb, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { objectId, moment, day, textArray, idFormat, oneOf } from './columns.ts';
import { locations, users } from './reference.ts';
import { customers } from './customers.ts';

export const CHECK_IN_STATUSES = ['New', 'Processed'] as const;

export const officeCheckIns = pgTable('office_check_ins', {
  id: objectId('id').primaryKey(),
  name: text('name').notNull(),
  /** Null only if its stored branch isn't a location (reported). */
  locationId: objectId('location_id').references(() => locations.id),
  phone: text('phone').notNull(),
  email: text('email').notNull().default(''),
  fabricatorCompany: text('fabricator_company').notNull().default(''),
  fabricatorName: text('fabricator_name').notNull().default(''),
  fabricatorPhone: text('fabricator_phone').notNull().default(''),
  status: text('status').notNull().default('New'),
  builderName: text('builder_name').notNull().default(''),
  builderPhone: text('builder_phone').notNull().default(''),
  /** Printed on the Selection Sheet. */
  specialNotes: text('special_notes').notNull().default(''),
  /** Staff only, never printed. */
  internalNotes: text('internal_notes').notNull().default(''),
  /** The rep is a name, as the Selection Sheet's dropdown saves it. */
  salesRepName: text('sales_rep_name').notNull().default(''),
  salesRepEmail: text('sales_rep_email').notNull().default(''),
  sheetEditedBy: text('sheet_edited_by').notNull().default(''),
  sheetEditedAt: moment('sheet_edited_at'),
  /** Who logged the visitor (blank on the oldest check-ins). */
  loggedByUserId: objectId('logged_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  loggedByUsername: text('logged_by_username').notNull().default(''),
  loggedByDisplayName: text('logged_by_display_name').notNull().default(''),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('office_check_ins'),
  index('office_check_ins_location_created_idx').on(t.locationId, t.createdAt),
  index('office_check_ins_phone_idx').on(t.phone),
  oneOf('office_check_ins', 'status', CHECK_IN_STATUSES)
]);

/** A Selection Sheet's lines, in order. */
export const checkInSelections = pgTable('check_in_selections', {
  id: objectId('id').primaryKey(),
  checkInId: objectId('check_in_id').notNull().references(() => officeCheckIns.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  material: text('material').notNull().default(''),
  details: text('details').notNull().default(''),
  size: text('size').notNull().default(''),
  lot: text('lot').notNull().default(''),
  priceCentsPerSf: integer('price_cents_per_sf')
}, t => [
  idFormat('check_in_selections'),
  uniqueIndex('check_in_selections_position_key').on(t.checkInId, t.position),
  check('check_in_selections_price', sql`price_cents_per_sf is null or price_cents_per_sf >= 1`)
]);

/** One cart per person. */
export const salesCarts = pgTable('sales_carts', {
  id: objectId('id').primaryKey(),
  userId: objectId('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userName: text('user_name').notNull().default(''),
  /** The cart's customer, if one is picked (null = none). */
  customerId: objectId('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  customerName: text('customer_name'),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [idFormat('sales_carts'), uniqueIndex('sales_carts_user_key').on(t.userId)]);

export const salesCartLines = pgTable('sales_cart_lines', {
  cartId: objectId('cart_id').notNull().references(() => salesCarts.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  slabKey: text('slab_key').notNull(),
  product: text('product').notNull().default(''),
  note: text('note').notNull().default(''),
  addedAt: moment('added_at').notNull().defaultNow()
}, t => [primaryKey({ columns: [t.cartId, t.position] }), index('sales_cart_lines_slab_idx').on(t.slabKey)]);

export const HOLD_STATUSES = ['active', 'released', 'converted'] as const;

export const salesHolds = pgTable('sales_holds', {
  id: objectId('id').primaryKey(),
  number: integer('number').notNull(),
  status: text('status').notNull().default('active'),
  locationId: objectId('location_id').notNull().references(() => locations.id),
  /** The customer as it was when held (the snapshot prints on the letter). */
  customerId: objectId('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  customerName: text('customer_name').notNull().default(''),
  customerContact: text('customer_contact').notNull().default(''),
  customerPhone: text('customer_phone').notNull().default(''),
  customerEmail: text('customer_email').notNull().default(''),
  customerAddress: text('customer_address').notNull().default(''),
  job: text('job').notNull().default(''),
  notes: text('notes').notNull().default(''),
  commissionNotes: text('commission_notes').notNull().default(''),
  chanceToClose: integer('chance_to_close'),
  expiresOn: day('expires_on').notNull(),
  expiresAt: moment('expires_at').notNull(),
  releaseAt: moment('release_at').notNull(),
  expiredNotedAt: moment('expired_noted_at'),
  /** The slabs it reserves (sales_slab_reservations holds the lock). */
  slabKeys: textArray('slab_keys'),
  createdById: text('created_by_id').notNull().default(''),
  createdByName: text('created_by_name').notNull().default(''),
  updatedById: text('updated_by_id').notNull().default(''),
  updatedByName: text('updated_by_name').notNull().default(''),
  releasedAt: moment('released_at'),
  releasedById: text('released_by_id'),
  releasedByName: text('released_by_name'),
  releaseReason: text('release_reason').notNull().default(''),
  /** The screen's own id for the create, so a repeat doesn't make a second hold. */
  requestId: text('request_id'),
  /** MongoDB's optimistic-concurrency counter (__v). */
  version: integer('version').notNull().default(0),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('sales_holds'),
  uniqueIndex('sales_holds_number_key').on(t.number),
  uniqueIndex('sales_holds_request_key').on(t.requestId).where(sql`request_id is not null`),
  index('sales_holds_status_location_idx').on(t.status, t.locationId, t.createdAt),
  index('sales_holds_created_by_idx').on(t.createdById, t.createdAt),
  oneOf('sales_holds', 'status', HOLD_STATUSES),
  check('sales_holds_chance', sql`chance_to_close is null or chance_to_close between 0 and 100`)
]);

export const salesHoldLines = pgTable('sales_hold_lines', {
  holdId: objectId('hold_id').notNull().references(() => salesHolds.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  slabKey: text('slab_key').notNull(),
  serial: text('serial').notNull().default(''),
  barcode: text('barcode').notNull().default(''),
  product: text('product').notNull().default(''),
  category: text('category').notNull().default(''),
  bundle: text('bundle').notNull().default(''),
  slabNumber: text('slab_number').notNull().default(''),
  block: text('block').notNull().default(''),
  bin: text('bin').notNull().default(''),
  location: text('location').notNull().default(''),
  dimensions: text('dimensions').notNull().default(''),
  sfHundredths: integer('sf_hundredths').notNull(),
  priceCentsPerSf: integer('price_cents_per_sf'),
  note: text('note').notNull().default('')
}, t => [primaryKey({ columns: [t.holdId, t.position] }), index('sales_hold_lines_slab_idx').on(t.slabKey)]);

/** The lock: a slab is on at most one hold. */
export const salesSlabReservations = pgTable('sales_slab_reservations', {
  id: objectId('id').primaryKey(),
  slabKey: text('slab_key').notNull(),
  holdId: objectId('hold_id').notNull().references(() => salesHolds.id, { onDelete: 'cascade' }),
  holdNumber: integer('hold_number').notNull(),
  customerName: text('customer_name').notNull().default(''),
  branch: text('branch').notNull().default(''),
  byId: text('by_id').notNull().default(''),
  byName: text('by_name').notNull().default(''),
  expiresOn: day('expires_on'),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [idFormat('sales_slab_reservations'), uniqueIndex('sales_slab_reservations_slab_key').on(t.slabKey)]);

/** Running numbers (hold numbers). */
export const salesCounters = pgTable('sales_counters', {
  name: text('name').primaryKey(),
  seq: bigint('seq', { mode: 'number' }).notNull().default(0)
});

/** Every change to a hold. Kept when the hold is gone, so hold_id is not a foreign key. */
export const salesHoldHistory = pgTable('sales_hold_history', {
  id: objectId('id').primaryKey(),
  holdId: objectId('hold_id').notNull(),
  holdNumber: integer('hold_number').notNull(),
  action: text('action').notNull(),
  byId: text('by_id').notNull().default(''),
  byName: text('by_name').notNull().default(''),
  at: moment('at').notNull(),
  /** [{ field, from, to }] — from / to are whatever the field holds (text, number, null). */
  changes: jsonb('changes').notNull().default(sql`'[]'::jsonb`),
  note: text('note').notNull().default('')
}, t => [idFormat('sales_hold_history'), index('sales_hold_history_hold_idx').on(t.holdId, t.at)]);
