/**
 * Credit Card Receipts (one company card per person, receipt categories, the
 * expenses with their approval and history) and the Supplier POs / portal
 * (suppliers, their portal logins, POs with lines, blocks with bundles).
 *
 * A supplier note ({ text, lang, translations, by, at }) is one value and is
 * kept whole as jsonb wherever it appears. History lines get their own tables.
 */
import { pgTable, text, integer, bigint, boolean, jsonb, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { objectId, moment, day, decimal, textArray, idFormat, oneOf } from './columns.ts';
import { locations, users } from './reference.ts';
import { customers } from './customers.ts';

/* ---- Credit Card Receipts ---- */

export const companyCards = pgTable('company_cards', {
  id: objectId('id').primaryKey(),
  userId: objectId('user_id').notNull().references(() => users.id),
  /** The card's id as accounting writes it, e.g. 'MARU92069'. */
  label: text('label').notNull(),
  issuer: text('issuer').notNull().default('amex'),
  lastDigits: text('last_digits').notNull(),
  active: boolean('active').notNull().default(true),
  updatedBy: text('updated_by').notNull().default(''),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('company_cards'),
  uniqueIndex('company_cards_active_user_key').on(t.userId).where(sql`active`),
  uniqueIndex('company_cards_active_label_key').on(t.label).where(sql`active`),
  oneOf('company_cards', 'issuer', ['amex', 'other'])
]);

export const receiptCategories = pgTable('receipt_categories', {
  id: objectId('id').primaryKey(),
  /** What expenses store; never changes. */
  name: text('name').notNull().unique('receipt_categories_name_key'),
  label: text('label').notNull(),
  order: integer('order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  needsCustomer: boolean('needs_customer').notNull().default(false),
  needsAttendees: boolean('needs_attendees').notNull().default(false),
  needsPurpose: boolean('needs_purpose').notNull().default(false),
  needsRecurring: boolean('needs_recurring').notNull().default(false),
  updatedBy: text('updated_by').notNull().default(''),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, () => [idFormat('receipt_categories')]);

export const CARD_EXPENSE_STATUSES = ['missing', 'draft', 'waiting', 'sent_back', 'approved'] as const;

/** One card expense: the uploaded receipt is the expense (CLAUDE.md, Credit Card Receipts). */
export const cardExpenses = pgTable('card_expenses', {
  id: objectId('id').primaryKey(),
  userId: objectId('user_id').references(() => users.id),
  holderName: text('holder_name').notNull().default(''),
  cardId: objectId('card_id').references(() => companyCards.id),
  cardLabel: text('card_label').notNull(),
  /** The holder's home location, saved on the expense (null = none). */
  locationId: objectId('location_id').references(() => locations.id),
  day: day('day').notNull(),
  /** 'YYYY-MM' */
  month: text('month').notNull(),
  merchant: text('merchant').notNull(),
  cents: bigint('cents', { mode: 'number' }).notNull(),
  subtotalCents: bigint('subtotal_cents', { mode: 'number' }),
  taxCents: bigint('tax_cents', { mode: 'number' }),
  tipCents: bigint('tip_cents', { mode: 'number' }),
  /** Null until a category is picked (a draft). */
  category: text('category').references(() => receiptCategories.name),
  customerId: objectId('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  customerName: text('customer_name').notNull().default(''),
  attendees: textArray('attendees'),
  purpose: text('purpose').notNull().default(''),
  note: text('note').notNull().default(''),
  recurring: boolean('recurring').notNull().default(false),
  receiptUrl: text('receipt_url').notNull().default(''),
  lostReason: text('lost_reason').notNull().default(''),
  status: text('status').notNull(),
  approvedById: text('approved_by_id'),
  approvedByName: text('approved_by_name'),
  approvedAt: moment('approved_at'),
  approvalComment: text('approval_comment'),
  sentBackById: text('sent_back_by_id'),
  sentBackByName: text('sent_back_by_name'),
  sentBackAt: moment('sent_back_at'),
  sentBackComment: text('sent_back_comment'),
  createdBy: text('created_by').notNull().default(''),
  voidedAt: moment('voided_at'),
  voidedBy: text('voided_by').notNull().default(''),
  voidReason: text('void_reason').notNull().default(''),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('card_expenses'),
  index('card_expenses_month_day_idx').on(t.month, t.day),
  index('card_expenses_user_month_idx').on(t.userId, t.month),
  index('card_expenses_status_user_idx').on(t.status, t.userId),
  oneOf('card_expenses', 'status', CARD_EXPENSE_STATUSES)
]);

export const cardExpenseHistory = pgTable('card_expense_history', {
  expenseId: objectId('expense_id').notNull().references(() => cardExpenses.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  at: moment('at').notNull(),
  by: text('by').notNull().default(''),
  action: text('action').notNull(),
  changes: text('changes').notNull().default('')
}, t => [primaryKey({ columns: [t.expenseId, t.position] })]);

/* ---- Suppliers ---- */

export const suppliers = pgTable('suppliers', {
  id: objectId('id').primaryKey(),
  name: text('name').notNull(),
  spsName: text('sps_name').notNull().default(''),
  spsKey: text('sps_key').notNull().default(''),
  country: text('country').notNull().default(''),
  language: text('language').notNull().default('en'),
  timeZone: text('time_zone').notNull().default(''),
  contactName: text('contact_name').notNull().default(''),
  email: text('email').notNull().default(''),
  phone: text('phone').notNull().default(''),
  notes: text('notes').notNull().default(''),
  active: boolean('active').notNull().default(true),
  createdBy: text('created_by').notNull().default(''),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('suppliers'),
  uniqueIndex('suppliers_sps_key_key').on(t.spsKey).where(sql`sps_key > ''`),
  index('suppliers_name_idx').on(t.name)
]);

/** History lines shared by suppliers, POs and blocks: who (staff or supplier side) did what. */
const historyTable = (name: string, parent: string, ref: () => { id: ReturnType<typeof objectId> }) => pgTable(name, {
  parentId: objectId(parent).notNull().references(ref as never, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  at: moment('at').notNull(),
  by: text('by').notNull().default(''),
  side: text('side').notNull().default('staff'),
  action: text('action').notNull(),
  changes: text('changes').notNull().default('')
}, t => [primaryKey({ columns: [t.parentId, t.position] })]);

export const supplierHistory = historyTable('supplier_history', 'supplier_id', () => suppliers.id as never);

/** One portal login per supplier (src/services/supplierSession.ts). */
export const supplierLogins = pgTable('supplier_logins', {
  id: objectId('id').primaryKey(),
  supplierId: objectId('supplier_id').notNull().references(() => suppliers.id),
  name: text('name').notNull(),
  email: text('email').notNull(),
  /** bcrypt hash ('' until they choose one). */
  password: text('password').notNull().default(''),
  language: text('language').notNull().default('en'),
  active: boolean('active').notNull().default(true),
  sessionVersion: integer('session_version').notNull().default(0),
  linkTokenHash: text('link_token_hash').notNull().default(''),
  linkExpiresAt: moment('link_expires_at'),
  loginAttempts: integer('login_attempts').notNull().default(0),
  lockUntil: moment('lock_until'),
  lastLoginAt: moment('last_login_at'),
  lastSeenAt: moment('last_seen_at'),
  invitedAt: moment('invited_at'),
  invitedBy: text('invited_by').notNull().default(''),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('supplier_logins'),
  uniqueIndex('supplier_logins_email_key').on(t.email),
  index('supplier_logins_supplier_idx').on(t.supplierId),
  index('supplier_logins_link_idx').on(t.linkTokenHash).where(sql`link_token_hash > ''`)
]);

export const supplierPos = pgTable('supplier_pos', {
  id: objectId('id').primaryKey(),
  poNumber: text('po_number').notNull(),
  supplierId: objectId('supplier_id').notNull().references(() => suppliers.id),
  supplierName: text('supplier_name').notNull().default(''),
  shipTo: text('ship_to').notNull().default(''),
  readyBy: day('ready_by'),
  buyerId: text('buyer_id').notNull().default(''),
  buyerName: text('buyer_name').notNull().default(''),
  note: jsonb('note'),
  source: text('source').notNull().default('typed'),
  status: text('status').notNull().default('open'),
  statusReason: text('status_reason').notNull().default(''),
  assignedAt: moment('assigned_at'),
  createdBy: text('created_by').notNull().default(''),
  version: integer('version').notNull().default(0),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('supplier_pos'),
  uniqueIndex('supplier_pos_number_key').on(t.poNumber),
  index('supplier_pos_supplier_status_idx').on(t.supplierId, t.status),
  index('supplier_pos_status_updated_idx').on(t.status, t.updatedAt),
  oneOf('supplier_pos', 'source', ['typed', 'sps']),
  oneOf('supplier_pos', 'status', ['open', 'closed', 'cancelled'])
]);

/** A PO's material lines; a block is offered against one. */
export const supplierPoLines = pgTable('supplier_po_lines', {
  poId: objectId('po_id').notNull().references(() => supplierPos.id, { onDelete: 'cascade' }),
  /** The line's own id (blocks name it). */
  id: text('id').notNull(),
  position: integer('position').notNull(),
  material: text('material').notNull(),
  thickness: text('thickness').notNull().default(''),
  finish: text('finish').notNull().default(''),
  slabs: integer('slabs').notNull(),
  note: text('note').notNull().default('')
}, t => [primaryKey({ columns: [t.poId, t.id] }), uniqueIndex('supplier_po_lines_position_key').on(t.poId, t.position)]);

export const supplierPoHistory = historyTable('supplier_po_history', 'po_id', () => supplierPos.id as never);

export const supplierBlocks = pgTable('supplier_blocks', {
  id: objectId('id').primaryKey(),
  poId: objectId('po_id').notNull().references(() => supplierPos.id),
  poNumber: text('po_number').notNull(),
  supplierId: objectId('supplier_id').notNull().references(() => suppliers.id),
  lineId: text('line_id').notNull(),
  material: text('material').notNull().default(''),
  thickness: text('thickness').notNull().default(''),
  finish: text('finish').notNull().default(''),
  blockNumber: text('block_number').notNull().default(''),
  sizeLength: decimal('size_length'),
  sizeHeight: decimal('size_height'),
  sizeUnit: text('size_unit'),
  note: jsonb('note'),
  decisionNote: jsonb('decision_note'),
  stage: text('stage').notNull().default('draft'),
  firstSentAt: moment('first_sent_at'),
  /** Purchasing entered it for the supplier ('Added by …', never shown to them). */
  enteredBy: text('entered_by').notNull().default(''),
  enteredById: text('entered_by_id').notNull().default(''),
  sentAt: moment('sent_at'),
  createdBy: text('created_by').notNull().default(''),
  version: integer('version').notNull().default(0),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('supplier_blocks'),
  index('supplier_blocks_po_idx').on(t.poId),
  index('supplier_blocks_supplier_stage_idx').on(t.supplierId, t.stage),
  index('supplier_blocks_stage_sent_idx').on(t.stage, t.sentAt),
  oneOf('supplier_blocks', 'size_unit', ['in', 'cm'])
]);

export const BUNDLE_STATUSES = ['draft', 'review', 'final', 'approved', 'rejected', 'retake', 'unlocked'] as const;

/** A block's bundles, one photo each, through the two approval steps. */
export const supplierBundles = pgTable('supplier_bundles', {
  blockId: objectId('block_id').notNull().references(() => supplierBlocks.id, { onDelete: 'cascade' }),
  id: text('id').notNull(),
  position: integer('position').notNull(),
  n: integer('n').notNull(),
  slabs: integer('slabs'),
  photoUrl: text('photo_url').notNull().default(''),
  photoAt: moment('photo_at'),
  /** [{ url, at }] — photos it replaced. */
  previousPhotos: jsonb('previous_photos').notNull().default(sql`'[]'::jsonb`),
  status: text('status').notNull().default('draft'),
  round: integer('round').notNull().default(0),
  sentAt: moment('sent_at'),
  step1Decision: text('step1_decision'),
  step1By: text('step1_by'),
  step1ByName: text('step1_by_name'),
  step1At: moment('step1_at'),
  step1Reason: text('step1_reason'),
  step2Decision: text('step2_decision'),
  step2By: text('step2_by'),
  step2ByName: text('step2_by_name'),
  step2At: moment('step2_at'),
  step2Reason: text('step2_reason'),
  reason: text('reason').notNull().default(''),
  comment: jsonb('comment'),
  unlockBy: text('unlock_by'),
  unlockAt: moment('unlock_at'),
  unlockReason: text('unlock_reason')
}, t => [
  primaryKey({ columns: [t.blockId, t.id] }),
  index('supplier_bundles_status_idx').on(t.status),
  oneOf('supplier_bundles', 'status', BUNDLE_STATUSES),
  oneOf('supplier_bundles', 'step1_decision', ['approve', 'reject', 'retake']),
  oneOf('supplier_bundles', 'step2_decision', ['approve', 'reject', 'retake'])
]);

export const supplierBlockHistory = historyTable('supplier_block_history', 'block_id', () => supplierBlocks.id as never);
