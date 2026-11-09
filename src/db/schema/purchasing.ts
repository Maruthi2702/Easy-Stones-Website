/**
 * Purchasing: a scope (which branches, the policy per product, the container),
 * the inbound imports it reads, the order drafts it builds, and the locks /
 * PO links that stop two drafts claiming one PO line. Imported rows and draft
 * lines are free-form in MongoDB (Mixed) and stay jsonb here.
 */
import { pgTable, text, integer, boolean, jsonb, index, primaryKey } from 'drizzle-orm/pg-core';
import { objectId, moment, day, decimal, textArray, idFormat, oneOf } from './columns.ts';

export const purchasingScopes = pgTable('purchasing_scopes', {
  id: objectId('id').primaryKey(),
  name: text('name'),
  branches: textArray('branches'),
  cohortId: text('cohort_id'),
  cohortRevision: text('cohort_revision'),
  observedThrough: day('observed_through'),
  /** Who confirmed sales coverage, through which day (null = not confirmed). */
  salesCoverageCohortId: text('sales_coverage_cohort_id'),
  salesCoverageThrough: day('sales_coverage_through'),
  salesCoverageConfirmedAt: moment('sales_coverage_confirmed_at'),
  salesCoverageConfirmedById: text('sales_coverage_confirmed_by_id'),
  salesCoverageConfirmedByName: text('sales_coverage_confirmed_by_name'),
  salesCoverageSource: text('sales_coverage_source'),
  fullSalesCoverage: boolean('full_sales_coverage'),
  stockSnapshotId: text('stock_snapshot_id'),
  stockCoverageConfirmed: boolean('stock_coverage_confirmed'),
  freeStockValidated: boolean('free_stock_validated'),
  policyConfirmed: boolean('policy_confirmed'),
  reviewDays: integer('review_days').notNull().default(7),
  bufferDays: integer('buffer_days').notNull().default(21),
  stockMaxHours: integer('stock_max_hours').notNull().default(24),
  salesMaxDays: integer('sales_max_days').notNull().default(14),
  containerPayloadKg: decimal('container_payload_kg'),
  containerTareKg: decimal('container_tare_kg'),
  containerMaxSlabs: integer('container_max_slabs'),
  containerLayoutConfirmed: boolean('container_layout_confirmed'),
  containerMixingConfirmed: boolean('container_mixing_confirmed'),
  updatedBy: text('updated_by'),
  version: integer('version').notNull().default(0),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('purchasing_scopes'),
  oneOf('purchasing_scopes', 'sales_coverage_source', ['scope-form', 'owner-confirmation'])
]);

/** A sales product name ↔ the stock product it is. */
export const purchasingScopeAliases = pgTable('purchasing_scope_aliases', {
  scopeId: objectId('scope_id').notNull().references(() => purchasingScopes.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  salesProduct: text('sales_product'),
  stockProduct: text('stock_product')
}, t => [primaryKey({ columns: [t.scopeId, t.position] })]);

/** How one product is bought (bundle, minimum, weight, mixing group). */
export const purchasingScopePolicies = pgTable('purchasing_scope_policies', {
  scopeId: objectId('scope_id').notNull().references(() => purchasingScopes.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  product: text('product'),
  supplier: text('supplier'),
  bundleSlabs: decimal('bundle_slabs'),
  minimumSlabs: decimal('minimum_slabs'),
  sfPerSlab: decimal('sf_per_slab'),
  weightKg: decimal('weight_kg'),
  mixGroup: text('mix_group'),
  active: boolean('active')
}, t => [primaryKey({ columns: [t.scopeId, t.position] })]);

export const purchasingInbound = pgTable('purchasing_inbound', {
  id: objectId('id').primaryKey(),
  scopeId: objectId('scope_id').notNull().references(() => purchasingScopes.id),
  complete: boolean('complete'),
  /** Null when the import named no branches (it then covers the scope's). */
  branches: text('branches').array(),
  importedBy: text('imported_by'),
  rows: jsonb('rows').notNull(),
  receipts: jsonb('receipts').notNull(),
  version: integer('version').notNull().default(0),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [idFormat('purchasing_inbound'), index('purchasing_inbound_scope_idx').on(t.scopeId, t.createdAt)]);

export const PURCHASING_DRAFT_STATUSES = ['draft', 'approved', 'ordered', 'cancelled'] as const;

export const purchasingDrafts = pgTable('purchasing_drafts', {
  id: objectId('id').primaryKey(),
  scopeId: objectId('scope_id').notNull().references(() => purchasingScopes.id),
  status: text('status').notNull().default('draft'),
  fingerprint: text('fingerprint'),
  inputSnapshot: jsonb('input_snapshot'),
  lines: jsonb('lines').notNull(),
  loads: jsonb('loads').notNull(),
  note: text('note'),
  createdById: text('created_by_id'),
  createdByName: text('created_by_name'),
  existingPoLines: textArray('existing_po_lines'),
  existingTransitParents: textArray('existing_transit_parents'),
  linkedPoLines: textArray('linked_po_lines'),
  version: integer('version').notNull().default(0),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('purchasing_drafts'),
  index('purchasing_drafts_scope_idx').on(t.scopeId, t.createdAt),
  oneOf('purchasing_drafts', 'status', PURCHASING_DRAFT_STATUSES)
]);

export const purchasingDraftHistory = pgTable('purchasing_draft_history', {
  draftId: objectId('draft_id').notNull().references(() => purchasingDrafts.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  action: text('action'),
  at: moment('at'),
  name: text('name'),
  note: text('note')
}, t => [primaryKey({ columns: [t.draftId, t.position] })]);

/** One PO line claimed by a draft (the id is the line's key). */
export const purchasingLocks = pgTable('purchasing_locks', {
  id: text('id').primaryKey(),
  draftId: objectId('draft_id').notNull().references(() => purchasingDrafts.id, { onDelete: 'cascade' }),
  scopeId: objectId('scope_id')
}, t => [index('purchasing_locks_draft_idx').on(t.draftId)]);

export const purchasingPoLinks = pgTable('purchasing_po_links', {
  id: text('id').primaryKey(),
  draftId: objectId('draft_id').notNull().references(() => purchasingDrafts.id, { onDelete: 'cascade' })
});
