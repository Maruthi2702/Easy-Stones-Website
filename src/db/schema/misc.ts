/**
 * Everything else: Lost Sales, the public site's products and colours, the
 * crossover list, settings, import memory, contact-form messages, Team Files,
 * the SPS customer import's runs and items, the Cloudinary → S3 undo backups,
 * and two collections from an older app (leads, salescustomers) that no code
 * reads any more but that still hold records.
 *
 * Not copied: `admins` and `crossoversheets` (empty; the crossover model uses
 * `CrossoverList`).
 */
import { pgTable, text, integer, boolean, jsonb, index, uniqueIndex, primaryKey, customType } from 'drizzle-orm/pg-core';
import { objectId, moment, decimal, textArray, idFormat, oneOf } from './columns.ts';
import { locations, users } from './reference.ts';
import { customers } from './customers.ts';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const lostSales = pgTable('lost_sales', {
  id: objectId('id').primaryKey(),
  customerName: text('customer_name').notNull(),
  customerId: objectId('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  productName: text('product_name').notNull(),
  productId: text('product_id'),
  lengthInches: decimal('length_inches'),
  widthInches: decimal('width_inches'),
  sfPerSlab: decimal('sf_per_slab'),
  slabsCount: decimal('slabs_count'),
  totalSf: decimal('total_sf'),
  pricePerSf: decimal('price_per_sf'),
  totalLostValue: decimal('total_lost_value'),
  /** One of the form's reasons (the app keeps the list). */
  reason: text('reason').notNull(),
  locationId: objectId('location_id').references(() => locations.id),
  competitorName: text('competitor_name').notNull().default(''),
  notes: text('notes').notNull().default(''),
  salesRepName: text('sales_rep_name').notNull().default(''),
  salesRepId: objectId('sales_rep_id').references(() => users.id, { onDelete: 'set null' }),
  /** When the sale was lost (a moment, as the form saves it). */
  lostAt: moment('lost_at').notNull(),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('lost_sales'),
  index('lost_sales_lost_at_idx').on(t.lostAt),
  index('lost_sales_location_idx').on(t.locationId),
  index('lost_sales_reason_idx').on(t.reason)
]);

/** The public website's products. */
export const products = pgTable('products', {
  id: objectId('id').primaryKey(),
  /** The number the site's links use. */
  productNumber: integer('product_number').notNull(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  collectionType: text('collection_type'),
  availability: text('availability').notNull().default('In Stock'),
  image: text('image'),
  installedImages: textArray('installed_images'),
  isNewArrival: boolean('is_new_arrival').notNull().default(false),
  showInSlider: boolean('show_in_slider').notNull().default(false),
  thickness: textArray('thickness'),
  sizes: textArray('sizes'),
  description: text('description'),
  primaryColor: text('primary_color'),
  accentColor: text('accent_color'),
  style: text('style'),
  variations: text('variations').notNull().default('Low'),
  finishes: textArray('finishes'),
  applications: textArray('applications'),
  bookMatch: text('book_match').notNull().default('N/A'),
  landingCost: decimal('landing_cost'),
  priceLevel1: decimal('price_level1'),
  priceLevel2: decimal('price_level2'),
  priceLevel3: decimal('price_level3'),
  priceLevel4: decimal('price_level4'),
  /** An older field still on most records (not in the model any more). */
  price: text('price'),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('products'),
  uniqueIndex('products_number_key').on(t.productNumber),
  index('products_category_idx').on(t.category, t.availability, t.productNumber),
  oneOf('products', 'book_match', ['N/A', 'Yes', 'No'])
]);

export const productColors = pgTable('product_colors', {
  productId: objectId('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  image: text('image')
}, t => [primaryKey({ columns: [t.productId, t.position] })]);

export const productBundles = pgTable('product_bundles', {
  id: objectId('id').primaryKey(),
  productId: objectId('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  bundleNumber: text('bundle_number'),
  serial: text('serial'),
  avgSize: text('avg_size'),
  qty: text('qty'),
  location: text('location'),
  images: textArray('images')
}, t => [idFormat('product_bundles'), uniqueIndex('product_bundles_position_key').on(t.productId, t.position)]);

export const easyStonesColors = pgTable('easy_stones_colors', {
  id: objectId('id').primaryKey(),
  name: text('name').notNull(),
  order: integer('order').notNull().default(0),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [idFormat('easy_stones_colors'), uniqueIndex('easy_stones_colors_name_key').on(t.name)]);

/** Crossover: our colour name → other distributors' names for it. */
export const crossoverColors = pgTable('crossover_colors', {
  id: objectId('id').primaryKey(),
  easyStonesName: text('easy_stones_name').notNull(),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [idFormat('crossover_colors'), uniqueIndex('crossover_colors_name_key').on(t.easyStonesName)]);

export const crossovers = pgTable('crossovers', {
  id: objectId('id').primaryKey(),
  colorId: objectId('color_id').notNull().references(() => crossoverColors.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  distributorName: text('distributor_name').notNull(),
  distributorColorName: text('distributor_color_name').notNull(),
  matchType: text('match_type').notNull(),
  notes: text('notes').notNull().default(''),
  addedByName: text('added_by_name').notNull().default(''),
  addedById: text('added_by_id').notNull().default(''),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('crossovers'),
  index('crossovers_distributor_idx').on(t.distributorName),
  oneOf('crossovers', 'match_type', ['Direct Crossover', 'Similar'])
]);

/** App-wide settings by key (the side nav order today); each value is its own shape. */
export const appSettings = pgTable('app_settings', {
  id: objectId('id').primaryKey(),
  key: text('key').notNull(),
  value: jsonb('value'),
  updatedBy: text('updated_by').notNull().default(''),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [idFormat('app_settings'), uniqueIndex('app_settings_key_key').on(t.key)]);

/** What the customer import remembers between runs (rep / branch spellings, decisions). */
export const importMemories = pgTable('import_memories', {
  id: objectId('id').primaryKey(),
  kind: text('kind').notNull(),
  repAliases: jsonb('rep_aliases').notNull(),
  branchAliases: jsonb('branch_aliases').notNull(),
  decisions: jsonb('decisions').notNull(),
  updatedBy: text('updated_by').notNull().default(''),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [idFormat('import_memories'), uniqueIndex('import_memories_kind_key').on(t.kind)]);

/** The public site's contact form. */
export const contactSubmissions = pgTable('contact_submissions', {
  id: objectId('id').primaryKey(),
  name: text('name').notNull(),
  company: text('company'),
  email: text('email').notNull(),
  phone: text('phone'),
  message: text('message').notNull(),
  status: text('status').notNull().default('new'),
  emailSent: boolean('email_sent').notNull().default(false),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [idFormat('contact_submissions'), oneOf('contact_submissions', 'status', ['new', 'read', 'replied'])]);

/** Team Files: folders and files (a file's content is base64 or a link). */
export const teamFiles = pgTable('team_files', {
  id: objectId('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  content: text('content').notNull().default(''),
  thumbnail: text('thumbnail').notNull().default(''),
  contentType: text('content_type').notNull().default(''),
  isFolder: boolean('is_folder').notNull().default(false),
  parentId: objectId('parent_id'),
  uploadedBy: objectId('uploaded_by'),
  size: integer('size'),
  pinned: boolean('pinned').notNull().default(false),
  pinnedAt: text('pinned_at'),
  pinnedBy: objectId('pinned_by'),
  updatedBy: objectId('updated_by'),
  /** Written as text by the screen (an ISO time). */
  updatedAt: text('updated_at'),
  createdAt: moment('created_at').notNull().defaultNow()
}, t => [
  idFormat('team_files'),
  index('team_files_parent_idx').on(t.parentId, t.isFolder, t.createdAt),
  index('team_files_pinned_idx').on(t.pinned, t.pinnedAt)
]);

/** The older Sales resources list (empty today). */
export const salesResources = pgTable('sales_resources', {
  id: objectId('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  content: text('content').notNull().default(''),
  contentType: text('content_type').notNull().default(''),
  uploadedBy: objectId('uploaded_by'),
  createdAt: moment('created_at').notNull().defaultNow()
}, t => [idFormat('sales_resources')]);

/** Customers → Import from SPS: one run (its plan and results stay jsonb, the planner's shapes). */
export const spsImportRuns = pgTable('sps_import_runs', {
  id: objectId('id').primaryKey(),
  fileName: text('file_name').notNull().default(''),
  fingerprint: text('fingerprint').notNull().default(''),
  file: bytea('file'),
  createdBy: text('created_by').notNull().default(''),
  createdById: text('created_by_id').notNull().default(''),
  status: text('status').notNull().default('draft'),
  mapping: jsonb('mapping').notNull(),
  repAliases: jsonb('rep_aliases').notNull(),
  branchAliases: jsonb('branch_aliases').notNull(),
  answers: jsonb('answers').notNull(),
  fileCheck: jsonb('file_check'),
  rowsRead: integer('rows_read').notNull().default(0),
  total: integer('total').notNull().default(0),
  done: integer('done').notNull().default(0),
  results: jsonb('results').notNull(),
  planCounts: jsonb('plan_counts').notNull(),
  verify: jsonb('verify'),
  error: text('error').notNull().default(''),
  startedAt: moment('started_at'),
  finishedAt: moment('finished_at'),
  undoneAt: moment('undone_at'),
  undoneBy: text('undone_by').notNull().default(''),
  version: integer('version').notNull().default(0),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [idFormat('sps_import_runs'), index('sps_import_runs_status_idx').on(t.status)]);

/** One SPS name's outcome in a run, frozen at Start (spsImportRunner.ts writes them). */
export const spsImportItems = pgTable('sps_import_items', {
  id: objectId('id').primaryKey(),
  runId: objectId('run_id').notNull().references(() => spsImportRuns.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  key: text('key').notNull(),
  rowNumber: integer('row_number').notNull().default(0),
  name: text('name').notNull().default(''),
  action: text('action').notNull(),
  /** The customer it touched (a record of the import, not a link). */
  customerId: text('customer_id').notNull().default(''),
  connect: boolean('connect').notNull().default(false),
  create: jsonb('create'),
  apply: jsonb('apply'),
  before: jsonb('before'),
  unset: textArray('unset'),
  changes: jsonb('changes'),
  deleted: jsonb('deleted'),
  warnings: textArray('warnings'),
  state: text('state').notNull().default('pending'),
  result: text('result').notNull().default(''),
  reason: text('reason').notNull().default(''),
  createdId: text('created_id').notNull().default(''),
  version: integer('version').notNull().default(0)
}, t => [
  idFormat('sps_import_items'),
  index('sps_import_items_run_seq_idx').on(t.runId, t.seq),
  index('sps_import_items_run_state_idx').on(t.runId, t.state, t.seq)
]);

/** Undo for the 2026-11-08 move of files from Cloudinary to S3: each record's old links. */
export const cloudinaryToS3Backups = pgTable('cloudinary_to_s3_backups', {
  id: objectId('id').primaryKey(),
  runId: text('run_id').notNull(),
  collection: text('collection').notNull(),
  docId: text('doc_id').notNull(),
  /** The fields as they were, in MongoDB extended JSON (an undo writes them back exactly). */
  fields: jsonb('fields').notNull(),
  at: moment('at')
}, t => [idFormat('cloudinary_to_s3_backups'), index('cloudinary_to_s3_backups_run_idx').on(t.runId)]);

/** From an older app version, no longer read by any code; kept so nothing is lost. */
export const legacyLeads = pgTable('legacy_leads', {
  id: objectId('id').primaryKey(),
  name: text('name').notNull().default(''),
  company: text('company').notNull().default(''),
  email: text('email').notNull().default(''),
  phone: text('phone').notNull().default(''),
  city: text('city').notNull().default(''),
  notes: text('notes').notNull().default(''),
  status: text('status').notNull().default(''),
  customerType: text('customer_type'),
  priority: text('priority'),
  segment: text('segment'),
  modaBinder: text('moda_binder'),
  modaDisplay: text('moda_display'),
  followUpDate: moment('follow_up_date'),
  createdBy: objectId('created_by'),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [idFormat('legacy_leads')]);

export const legacySalesCustomers = pgTable('legacy_sales_customers', {
  id: objectId('id').primaryKey(),
  userId: objectId('user_id'),
  customerName: text('customer_name').notNull().default(''),
  company: text('company').notNull().default(''),
  address: text('address').notNull().default(''),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  notes: text('notes').notNull().default(''),
  lastVisit: moment('last_visit'),
  nextVisit: moment('next_visit'),
  status: text('status').notNull().default(''),
  tags: textArray('tags'),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [idFormat('legacy_sales_customers')]);
