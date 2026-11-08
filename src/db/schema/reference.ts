/**
 * The tables everything customer-side points at: branches, roles, staff and
 * the visit / resource type lists. Copied from MongoDB as they are (see
 * src/db/README.md); ids are the records' existing 24-character ids so links,
 * saved filters and socket messages keep working after the move.
 *
 * Times: `timestamptz` for real moments the server recorded (createdAt,
 * sign-in locks…). Names stay where the app looks things up by name today
 * (a role's `name`, a type's `name`), with the foreign key on that name.
 */
import { sql } from 'drizzle-orm';
import {
  pgTable, text, boolean, integer, smallint, doublePrecision, numeric, jsonb,
  timestamp, primaryKey, index, uniqueIndex, check
} from 'drizzle-orm/pg-core';

/** A record's id: today's MongoDB ObjectId as 24 lowercase hex characters. */
export const objectId = (name: string) => text(name);
const idCheck = (table: string, column: { name: string }) =>
  check(`${table}_${column.name}_format`, sql`${sql.identifier(column.name)} ~ '^[0-9a-f]{24}$'`);

const moment = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => moment('created_at').notNull().defaultNow();
const updatedAt = () => moment('updated_at').notNull().defaultNow();

export const locations = pgTable('locations', {
  id: objectId('id').primaryKey(),
  name: text('name').notNull(),
  shortCode: text('short_code').notNull().default(''),
  fullName: text('full_name').notNull().default(''),
  region: text('region').notNull().default(''),
  /** The branch's own clock (src/config/branches.ts), new here: days and local times are read on it. */
  timeZone: text('time_zone').notNull().default('America/Los_Angeles'),
  /** Name of the location this one is supplied from ('' = none). */
  rdc: text('rdc').notNull().default(''),
  profitCenter: boolean('profit_center').notNull().default(false),
  warehouse: boolean('warehouse').notNull().default(false),

  primaryName: text('primary_name').notNull().default(''),
  primaryEmail: text('primary_email').notNull().default(''),
  primaryPhone: text('primary_phone').notNull().default(''),
  primaryFax: text('primary_fax').notNull().default(''),
  primaryWebsite: text('primary_website').notNull().default(''),
  street: text('street').notNull().default(''),
  suite: text('suite').notNull().default(''),
  city: text('city').notNull().default(''),
  state: text('state').notNull().default(''),
  zipCode: text('zip_code').notNull().default(''),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  geocodeStatus: text('geocode_status').notNull().default(''),
  geocodePrecision: text('geocode_precision').notNull().default(''),
  geocodeFormattedAddress: text('geocode_formatted_address').notNull().default(''),
  geocodeAddressKey: text('geocode_address_key').notNull().default(''),
  geocodeUpdatedAt: moment('geocode_updated_at'),
  geocodeError: text('geocode_error').notNull().default(''),

  accountingSameAsPrimary: boolean('accounting_same_as_primary').notNull().default(true),
  accountingName: text('accounting_name').notNull().default(''),
  accountingEmail: text('accounting_email').notNull().default(''),
  accountingPhone: text('accounting_phone').notNull().default(''),
  accountingStreet: text('accounting_street').notNull().default(''),
  accountingSuite: text('accounting_suite').notNull().default(''),
  accountingCity: text('accounting_city').notNull().default(''),
  accountingState: text('accounting_state').notNull().default(''),
  accountingZipCode: text('accounting_zip_code').notNull().default(''),

  /** Sales defaults. The rep is a name today (the Location form's dropdown saves names). */
  defaultSalesRepName: text('default_sales_rep_name').notNull().default(''),
  defaultPriceLevel: smallint('default_price_level'),
  paymentTerms: text('payment_terms').notNull().default(''),
  salesTaxArea: text('sales_tax_area').notNull().default(''),
  salesTaxRate: numeric('sales_tax_rate', { precision: 6, scale: 3 }),
  avgUnitFreight: numeric('avg_unit_freight', { precision: 12, scale: 2 }),
  unitOverheadPct: numeric('unit_overhead_pct', { precision: 6, scale: 2 }),

  /** Extra Daily Report PDF addresses; staff recipients are location_report_recipients. */
  reportExtraEmails: text('report_extra_emails').array().notNull().default(sql`'{}'::text[]`),
  /** The Delivery Schedule's column order for this branch (driver / column keys). */
  deliveryColumns: text('delivery_columns').array().notNull().default(sql`'{}'::text[]`),
  editedBy: text('edited_by').notNull().default(''),
  editedAt: moment('edited_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, t => [
  idCheck('locations', t.id),
  uniqueIndex('locations_name_key').on(t.name),
  check('locations_default_price_level', sql`default_price_level between 1 and 4`)
]);

export const roles = pgTable('roles', {
  id: objectId('id').primaryKey(),
  /** Lowercase key users store (`users.role`); never renamed. A constraint, not an index: users.role references it. */
  name: text('name').notNull().unique('roles_name_key'),
  displayName: text('display_name').notNull(),
  permissions: text('permissions').array().notNull().default(sql`'{}'::text[]`),
  seededPermissions: text('seeded_permissions').array().notNull().default(sql`'{}'::text[]`),
  /** Role names whose people this role may manage (team access). */
  manageableRoles: text('manageable_roles').array().notNull().default(sql`'{}'::text[]`),
  /** Role names whose card receipts this role approves. */
  approvesCardReceiptsOf: text('approves_card_receipts_of').array().notNull().default(sql`'{}'::text[]`),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, t => [
  idCheck('roles', t.id)
]);

export const users = pgTable('users', {
  id: objectId('id').primaryKey(),
  username: text('username').notNull(),
  displayName: text('display_name').notNull().default(''),
  passwordHash: text('password_hash').notNull(),
  email: text('email'),
  role: text('role').notNull().default('sales_rep').references(() => roles.name, { onUpdate: 'cascade' }),
  /** Home location. Assigned locations are user_locations; '*' (every location) is all_locations. */
  homeLocationId: objectId('home_location_id').references(() => locations.id, { onDelete: 'set null' }),
  allLocations: boolean('all_locations').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  deactivatedAt: moment('deactivated_at'),
  deactivatedBy: text('deactivated_by').notNull().default(''),
  joiningDate: moment('joining_date'),
  loginAttempts: integer('login_attempts').notNull().default(0),
  lockUntil: moment('lock_until'),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  tempPasswordExpiresAt: moment('temp_password_expires_at'),
  sessionVersion: integer('session_version').notNull().default(0),
  inviteTokenHash: text('invite_token_hash'),
  inviteExpiresAt: moment('invite_expires_at'),
  calendarFeedKey: text('calendar_feed_key'),
  googleAccessToken: text('google_access_token'),
  googleRefreshToken: text('google_refresh_token'),
  googleEmail: text('google_email'),
  googleCalendarSyncEnabled: boolean('google_calendar_sync_enabled').notNull().default(false),
  icloudUsername: text('icloud_username'),
  icloudPassword: text('icloud_password'),
  icloudCalendarUrl: text('icloud_calendar_url'),
  icloudCalendarName: text('icloud_calendar_name'),
  icloudSyncEnabled: boolean('icloud_sync_enabled').notNull().default(false),
  routePlannerFilters: jsonb('route_planner_filters').notNull().default({}),
  pinnedTabs: text('pinned_tabs').array().notNull().default(sql`'{}'::text[]`),
  editedBy: text('edited_by').notNull().default(''),
  editedAt: moment('edited_at'),
  lastSeenAt: moment('last_seen_at'),
  lastLoginAt: moment('last_login_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, t => [
  idCheck('users', t.id),
  uniqueIndex('users_username_key').on(t.username),
  uniqueIndex('users_email_key').on(t.email),
  index('users_role_idx').on(t.role)
]);

/** A user's assigned locations (Users & Roles → Locations). */
export const userLocations = pgTable('user_locations', {
  userId: objectId('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  locationId: objectId('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' })
}, t => [
  primaryKey({ columns: [t.userId, t.locationId] }),
  index('user_locations_location_idx').on(t.locationId)
]);

/** Staff who get a branch's Daily Report PDF (Location form). */
export const locationReportRecipients = pgTable('location_report_recipients', {
  locationId: objectId('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
  userId: objectId('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** Order in the Location form's list. */
  position: integer('position').notNull()
}, t => [primaryKey({ columns: [t.locationId, t.userId] })]);

/** Admin → Visit Types. `name` is what a visit stores and never changes; `label` is shown. */
export const visitTypes = pgTable('visit_types', {
  id: objectId('id').primaryKey(),
  name: text('name').notNull(),
  label: text('label').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  system: boolean('system').notNull().default(false),
  usesNotes: boolean('uses_notes').notNull().default(true),
  usesOutcome: boolean('uses_outcome').notNull().default(true),
  followUp: text('follow_up').notNull().default('optional'),
  updatedBy: text('updated_by').notNull().default(''),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, t => [
  idCheck('visit_types', t.id),
  uniqueIndex('visit_types_name_key').on(t.name),
  check('visit_types_follow_up', sql`follow_up in ('none', 'optional', 'always')`)
]);

/** Admin → Resource Types → Families. `tower` and `binder` drive the Moda counts. */
export const resourceFamilies = pgTable('resource_families', {
  id: objectId('id').primaryKey(),
  name: text('name').notNull().unique('resource_families_name_key'),
  label: text('label').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  system: boolean('system').notNull().default(false),
  updatedBy: text('updated_by').notNull().default(''),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, t => [
  idCheck('resource_families', t.id)
]);

/** Admin → Resource Types. A resource stores the type's `name`. */
export const resourceTypes = pgTable('resource_types', {
  id: objectId('id').primaryKey(),
  name: text('name').notNull().unique('resource_types_name_key'),
  label: text('label').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  family: text('family').notNull().default('other').references(() => resourceFamilies.name, { onUpdate: 'cascade' }),
  updatedBy: text('updated_by').notNull().default(''),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, t => [
  idCheck('resource_types', t.id),
  index('resource_types_family_idx').on(t.family)
]);

/** One row: whether this database still takes copies from MongoDB (src/db/copy). */
export const mongoCopyState = pgTable('mongo_copy_state', {
  id: integer('id').primaryKey().default(1),
  lastCopyAt: moment('last_copy_at'),
  lastCopyReport: jsonb('last_copy_report'),
  /** Set at cutover: from then on Postgres is the live data and a copy would overwrite it. */
  lockedAt: moment('locked_at'),
  lockedBy: text('locked_by').notNull().default('')
}, () => [check('mongo_copy_state_single_row', sql`id = 1`)]);
