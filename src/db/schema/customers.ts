/**
 * Customers and everything that belongs to one, each in its own table and
 * linked by id (owner, 2026-11-08): a visit's id is its primary key and its
 * `customer_id` points at the customer, and the same for resources and
 * contacts. In MongoDB all of it sat inside the customer document.
 *
 * Kinds of time (src/db/README.md):
 * - `date` for days (a visit's day, a follow-up's due day).
 * - `timestamp` WITHOUT time zone for the local clock times the app saves
 *   today ("2026-10-23T14:05:00.000"): kept exactly as written, never shifted.
 * - `timestamptz` for real moments (createdAt / updatedAt the server stamps).
 *
 * Deleting: contacts, the login, links and a visit's own parts go with their
 * parent (cascade). Visits and resources do not: a customer with visits or
 * resources can't be deleted until they're removed in the same transaction —
 * the delete route backs them up first (customer_delete_backups).
 */
import { sql } from 'drizzle-orm';
import {
  pgTable, text, boolean, integer, smallint, doublePrecision, jsonb, date,
  timestamp, primaryKey, index, uniqueIndex, check
} from 'drizzle-orm/pg-core';
import { objectId, users, locations, resourceTypes } from './reference.ts';

const moment = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
/** A local clock time as the app wrote it, e.g. '2026-10-23 14:05:00'. */
const localTime = (name: string) => timestamp(name, { withTimezone: false, mode: 'string', precision: 3 });
const day = (name: string) => date(name, { mode: 'string' });
const idFormat = (table: string, column = 'id') =>
  check(`${table}_${column}_format`, sql`${sql.identifier(column)} ~ '^[0-9a-f]{24}$'`);
const textArray = (name: string) => text(name).array().notNull().default(sql`'{}'::text[]`);

export const customers = pgTable('customers', {
  id: objectId('id').primaryKey(),
  /** MongoDB's saved collection order for first-match lookups; new/restored customers append. */
  matchOrder: integer('match_order').notNull().generatedByDefaultAsIdentity(),
  company: text('company').notNull().default(''),
  contactName: text('contact_name').notNull(),
  email: text('email').notNull(),
  marketingEmail: text('marketing_email').notNull().default(''),
  receiveMarketing: boolean('receive_marketing').notNull().default(true),
  phone: text('phone').notNull().default(''),

  status: text('status').notNull().default('Onboarded'),
  /** Blank on a few old imports. */
  customerType: text('customer_type'),
  level: text('level').notNull().default('Level - 3'),
  priceLevel: smallint('price_level').notNull().default(1),

  /** The branch the account belongs to. */
  locationId: objectId('location_id').notNull().references(() => locations.id),
  /** Who owns the account (salesRepName is a join now, not a stored copy). */
  salesRepId: objectId('sales_rep_id').references(() => users.id, { onDelete: 'set null' }),
  /** Who typed the record in. */
  createdById: objectId('created_by_id').references(() => users.id, { onDelete: 'set null' }),

  street: text('street').notNull().default(''),
  city: text('city').notNull().default(''),
  state: text('state').notNull().default(''),
  zipCode: text('zip_code').notNull().default(''),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  geocodeStatus: text('geocode_status').notNull().default('pending'),
  geocodePrecision: text('geocode_precision').notNull().default(''),
  geocodeFormattedAddress: text('geocode_formatted_address').notNull().default(''),
  geocodeAddressKey: text('geocode_address_key').notNull().default(''),
  geocodeUpdatedAt: moment('geocode_updated_at'),
  geocodeError: text('geocode_error').notNull().default(''),

  /** Moda Display / Binders as stored ('Yes'/'No' and a count; src/utils/modaTotals.ts). */
  modaDisplay: boolean('moda_display'),
  modaBinders: integer('moda_binders').notNull().default(0),
  /** What was counted before resources were logged; null until the first recount. */
  modaEarlierDisplay: boolean('moda_earlier_display'),
  modaEarlierBinders: integer('moda_earlier_binders'),

  quickNote: text('quick_note').notNull().default(''),
  isVerified: boolean('is_verified').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),

  /** The SPS customer this one is (src/utils/spsSheet.ts); key unique when set. */
  spsKey: text('sps_key'),
  spsName: text('sps_name'),
  spsCode: text('sps_code'),
  spsFirstImportedAt: moment('sps_first_imported_at'),
  spsLastSeenAt: moment('sps_last_seen_at'),
  spsConnectedAt: moment('sps_connected_at'),
  spsConnectedBy: text('sps_connected_by'),
  spsReviewedAs: text('sps_reviewed_as'),
  spsRunId: text('sps_run_id'),

  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('customers'),
  uniqueIndex('customers_email_key').on(t.email),
  uniqueIndex('customers_sps_key_key').on(t.spsKey),
  uniqueIndex('customers_match_order_key').on(t.matchOrder),
  check('customers_price_level', sql`price_level between 1 and 4`),
  check('customers_moda_binders', sql`moda_binders >= 0`),
  index('customers_location_status_idx').on(t.locationId, t.status),
  index('customers_sales_rep_status_idx').on(t.salesRepId, t.status),
  index('customers_company_contact_idx').on(t.company, t.contactName),
  index('customers_city_idx').on(t.city),
  index('customers_type_level_idx').on(t.customerType, t.level),
  index('customers_active_created_idx').on(t.isActive, t.createdAt)
]);

/** A customer's website sign-in, kept apart from sales data. One row per customer that has one. */
export const customerLogins = pgTable('customer_logins', {
  customerId: objectId('customer_id').primaryKey().references(() => customers.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash'),
  loginAttempts: integer('login_attempts').notNull().default(0),
  lockUntil: moment('lock_until'),
  loginIps: textArray('login_ips')
});

export const customerContacts = pgTable('customer_contacts', {
  id: objectId('id').primaryKey(),
  customerId: objectId('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  /** Order on the profile's Contacts tab. */
  position: integer('position').notNull(),
  name: text('name').notNull().default(''),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  role: text('role').notNull().default(''),
  notes: text('notes').notNull().default(''),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt: localTime('created_at')
}, t => [
  idFormat('customer_contacts'),
  index('customer_contacts_customer_idx').on(t.customerId, t.position)
]);

/**
 * Customer ↔ customer: `associated` (partners linked on the profile) and
 * `not_duplicate` (looked at and kept as separate accounts). Stored one way,
 * as MongoDB had it on each customer.
 */
export const customerLinks = pgTable('customer_links', {
  customerId: objectId('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  otherCustomerId: objectId('other_customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  position: integer('position').notNull()
}, t => [
  primaryKey({ columns: [t.customerId, t.kind, t.otherCustomerId] }),
  index('customer_links_other_idx').on(t.otherCustomerId),
  check('customer_links_kind', sql`kind in ('associated', 'not_duplicate')`),
  check('customer_links_not_self', sql`customer_id <> other_customer_id`)
]);

export const visits = pgTable('visits', {
  id: objectId('id').primaryKey(),
  customerId: objectId('customer_id').notNull().references(() => customers.id),
  /** Order the visit had on the customer (oldest saved first). */
  position: integer('position').notNull(),
  visitDate: day('visit_date').notNull(),
  /** The visit type's `name` (visit_types). Not a foreign key yet: older visits carry legacy names. */
  visitType: text('visit_type').notNull().default(''),
  customerContactName: text('customer_contact_name').notNull().default(''),
  notes: text('notes').notNull().default(''),
  outcome: text('outcome').notNull().default(''),
  managerComment: text('manager_comment').notNull().default(''),
  headquartersComment: text('headquarters_comment').notNull().default(''),

  followUp: text('follow_up').notNull().default(''),
  followUpDate: day('follow_up_date'),
  followUpDoneAt: localTime('follow_up_done_at'),
  followUpDoneOn: day('follow_up_done_on'),
  followUpDoneById: objectId('follow_up_done_by_id').references(() => users.id, { onDelete: 'set null' }),
  followUpDoneByName: text('follow_up_done_by_name').notNull().default(''),
  followUpOutcome: text('follow_up_outcome').notNull().default(''),

  /** Staff who logged it, or the customer themselves from the website. */
  createdById: objectId('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdByCustomerId: objectId('created_by_customer_id').references(() => customers.id, { onDelete: 'set null' }),
  createdByName: text('created_by_name').notNull().default(''),
  createdAt: localTime('created_at').notNull(),
  updatedById: objectId('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
  updatedByCustomerId: objectId('updated_by_customer_id').references(() => customers.id, { onDelete: 'set null' }),
  updatedByName: text('updated_by_name').notNull().default(''),
  updatedAt: localTime('updated_at')
}, t => [
  idFormat('visits'),
  index('visits_customer_date_idx').on(t.customerId, t.visitDate),
  index('visits_date_idx').on(t.visitDate),
  index('visits_created_by_date_idx').on(t.createdById, t.visitDate),
  index('visits_follow_up_due_idx').on(t.followUpDate).where(sql`follow_up_date is not null`)
]);

/** A visit's photos / PDFs, in the order they were added. */
export const visitAttachments = pgTable('visit_attachments', {
  visitId: objectId('visit_id').notNull().references(() => visits.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  url: text('url').notNull()
}, t => [primaryKey({ columns: [t.visitId, t.position] })]);

export const visitReactions = pgTable('visit_reactions', {
  id: objectId('id').primaryKey(),
  visitId: objectId('visit_id').notNull().references(() => visits.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  type: text('type').notNull(),
  userId: objectId('user_id').references(() => users.id, { onDelete: 'set null' }),
  customerId: objectId('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  userName: text('user_name').notNull().default(''),
  createdAt: localTime('created_at')
}, t => [
  idFormat('visit_reactions'),
  index('visit_reactions_visit_idx').on(t.visitId)
]);

/** Every snooze, tick and reopen of a visit's follow-up, oldest first — never trimmed. */
export const visitFollowUpEvents = pgTable('visit_follow_up_events', {
  visitId: objectId('visit_id').notNull().references(() => visits.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  action: text('action').notNull(),
  at: localTime('at').notNull(),
  onDay: day('on_day'),
  byId: objectId('by_id').references(() => users.id, { onDelete: 'set null' }),
  byName: text('by_name').notNull().default(''),
  fromDay: day('from_day'),
  toDay: day('to_day')
}, t => [primaryKey({ columns: [t.visitId, t.position] })]);

export const resources = pgTable('resources', {
  id: objectId('id').primaryKey(),
  customerId: objectId('customer_id').notNull().references(() => customers.id),
  position: integer('position').notNull(),
  /** The visit that placed it (the durable link both ways had in MongoDB). One resource per visit. */
  placementVisitId: objectId('placement_visit_id').references(() => visits.id, { onDelete: 'set null' }),
  resourceType: text('resource_type').references(() => resourceTypes.name, { onUpdate: 'cascade' }),
  resourceDate: day('resource_date'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  notes: text('notes').notNull().default(''),
  status: text('status').notNull().default('Active'),
  /** How many were left; null = saved before Qty existed (read as 1). */
  qty: integer('qty'),
  url: text('url').notNull().default(''),
  uploadedById: objectId('uploaded_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: localTime('created_at')
}, t => [
  idFormat('resources'),
  index('resources_customer_idx').on(t.customerId),
  index('resources_type_idx').on(t.resourceType),
  uniqueIndex('resources_placement_visit_key').on(t.placementVisitId),
  check('resources_qty', sql`qty between 1 and 999`)
]);

export const resourceAttachments = pgTable('resource_attachments', {
  resourceId: objectId('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  url: text('url').notNull()
}, t => [primaryKey({ columns: [t.resourceId, t.position] })]);

export interface LegacyScheduleClock {
  kind: 'string' | 'date';
  value: string;
}

/** A rep's calendar entry at a customer (Sales Planner, Route Planner, visit log). */
export const schedules = pgTable('schedules', {
  id: objectId('id').primaryKey(),
  userId: objectId('user_id').notNull().references(() => users.id),
  /** Null when the customer was deleted: the entry stays on the rep's calendar, as it does on MongoDB. */
  customerId: objectId('customer_id').references(() => customers.id),
  startsAt: localTime('starts_at').notNull(),
  /** Raw legacy clock spelling/type keeps MongoDB's range membership and BSON sort order. */
  legacyStartTime: jsonb('legacy_start_time').$type<LegacyScheduleClock>(),
  /** Null on old entries: counted as 30 minutes (DEFAULT_VISIT_MINUTES). */
  endsAt: localTime('ends_at'),
  /** Raw end spelling is required by the ICS feed so a UTC instant cannot become a local time. */
  legacyEndTime: jsonb('legacy_end_time').$type<LegacyScheduleClock>(),
  activityType: text('activity_type').notNull().default('Visit'),
  notes: text('notes').notNull().default(''),
  status: text('status').notNull().default('Scheduled'),
  visitId: objectId('visit_id').references(() => visits.id, { onDelete: 'set null' }),
  source: text('source').notNull().default('manual'),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('schedules'),
  index('schedules_user_start_idx').on(t.userId, t.startsAt),
  index('schedules_customer_idx').on(t.customerId),
  index('schedules_start_idx').on(t.startsAt),
  check('schedules_activity_type', sql`activity_type in ('Visit', 'Call', 'Drop-off', 'Other')`),
  check('schedules_status', sql`status in ('Scheduled', 'Completed', 'Cancelled')`),
  check('schedules_source', sql`source in ('manual', 'route_planner', 'visit_log')`)
]);

/**
 * Who did what to a customer, visit, resource or contact. History outlives
 * what it describes, so `customer_id` and `performed_by` are plain ids here,
 * not foreign keys: an entry for a deleted customer stays readable.
 */
export const activityLogs = pgTable('activity_logs', {
  id: objectId('id').primaryKey(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  customerId: text('customer_id'),
  action: text('action').notNull(),
  performedBy: text('performed_by').notNull(),
  performedByName: text('performed_by_name').notNull(),
  performedByRole: text('performed_by_role'),
  details: jsonb('details'),
  loggedAt: localTime('logged_at')
}, t => [
  idFormat('activity_logs'),
  index('activity_logs_entity_idx').on(t.entityType, t.entityId),
  index('activity_logs_customer_idx').on(t.customerId),
  index('activity_logs_logged_at_idx').on(t.loggedAt)
]);

/**
 * A customer removed by bulk delete, saved whole first — Undo's source.
 * `customer` is the snapshot as it was (MongoDB extended JSON for records
 * deleted before the move), so it keeps fields the tables no longer have.
 */
export const customerDeleteBackups = pgTable('customer_delete_backups', {
  id: objectId('id').primaryKey(),
  batchId: text('batch_id').notNull(),
  customerId: text('customer_id').notNull(),
  customer: jsonb('customer').notNull(),
  source: text('source').notNull().default('bulk'),
  deletedBy: text('deleted_by').notNull().default(''),
  spsKeepDeleted: boolean('sps_keep_deleted').notNull().default(false),
  spsKeepRun: text('sps_keep_run').notNull().default(''),
  undoneAt: moment('undone_at'),
  undoneBy: text('undone_by').notNull().default(''),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('customer_delete_backups'),
  index('customer_delete_backups_batch_idx').on(t.batchId),
  index('customer_delete_backups_customer_idx').on(t.customerId)
]);

/** What a duplicate merge removed and changed, saved before it ran — Undo's source. */
export const customerMergeBackups = pgTable('customer_merge_backups', {
  id: objectId('id').primaryKey(),
  group: jsonb('group').notNull(),
  action: text('action').notNull().default(''),
  createdBy: text('created_by').notNull().default(''),
  undoneAt: moment('undone_at'),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, () => [idFormat('customer_merge_backups')]);
