/**
 * Sales · Permits (src/permits/): permits pulled from each office, their
 * contacts, every pull (runs), the monthly accuracy checks, and the WA L&I
 * contractor registry cache. Source and category ids grow with each new office
 * (src/permits/rules/), so they are text here, not a fixed list.
 */
import { pgTable, text, integer, boolean, jsonb, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { objectId, moment, day, decimal, textArray, idFormat, oneOf } from './columns.ts';

export const permits = pgTable('permits', {
  id: objectId('id').primaryKey(),
  source: text('source').notNull(),
  permitNumber: text('permit_number').notNull(),
  externalId: text('external_id').notNull().default(''),
  category: text('category').notNull(),
  type: text('type').notNull().default(''),
  subtype: text('subtype').notNull().default(''),
  status: text('status').notNull().default(''),
  appliedOn: day('applied_on'),
  /** Null when the office cleared the issue date (kept, out of the leads). */
  issuedOn: day('issued_on'),
  finaledOn: day('finaled_on'),
  expiresOn: day('expires_on'),
  address: text('address').notNull().default(''),
  city: text('city').notNull().default(''),
  zip: text('zip').notNull().default(''),
  parcel: text('parcel').notNull().default(''),
  projectName: text('project_name').notNull().default(''),
  description: text('description').notNull().default(''),
  valuation: decimal('valuation'),
  sqft: decimal('sqft'),
  units: decimal('units'),
  detailsAt: moment('details_at'),
  sourceUrl: text('source_url').notNull().default(''),
  finalOnly: boolean('final_only').notNull().default(false),
  firstSeenAt: moment('first_seen_at').notNull(),
  lastSeenAt: moment('last_seen_at').notNull(),
  /** Only on the permits an older pull saved with timestamps (673 of them). */
  createdAt: moment('created_at'),
  updatedAt: moment('updated_at')
}, t => [
  idFormat('permits'),
  uniqueIndex('permits_source_number_key').on(t.source, t.permitNumber),
  index('permits_issued_idx').on(t.issuedOn, t.permitNumber),
  index('permits_category_issued_idx').on(t.category, t.issuedOn)
]);

/** Who a permit names (contractor, owner, applicant…), as the office wrote it. */
export const permitContacts = pgTable('permit_contacts', {
  permitId: objectId('permit_id').notNull().references(() => permits.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  role: text('role').notNull().default(''),
  kind: text('kind').notNull().default('other'),
  company: text('company').notNull().default(''),
  name: text('name').notNull().default(''),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  address: text('address').notNull().default(''),
  /** The contractor's WA license, when the office gives it. */
  license: text('license')
}, t => [primaryKey({ columns: [t.permitId, t.position] }), index('permit_contacts_license_idx').on(t.license)]);

/** One pull from one office. */
export const permitRuns = pgTable('permit_runs', {
  id: objectId('id').primaryKey(),
  source: text('source').notNull(),
  kind: text('kind').notNull(),
  since: day('since').notNull(),
  startedAt: moment('started_at').notNull(),
  finishedAt: moment('finished_at'),
  ok: boolean('ok').notNull().default(false),
  error: text('error').notNull().default(''),
  by: text('by').notNull().default(''),
  pages: integer('pages').notNull().default(0),
  seen: integer('seen').notNull().default(0),
  leads: integer('leads').notNull().default(0),
  added: integer('added').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  detailErrors: integer('detail_errors').notNull().default(0),
  latestIssuedOn: day('latest_issued_on'),
  /** [{ type, count }] — building types nobody has sorted yet. */
  unsortedTypes: jsonb('unsorted_types').notNull().default(sql`'[]'::jsonb`)
}, t => [
  idFormat('permit_runs'),
  index('permit_runs_source_started_idx').on(t.source, t.startedAt),
  oneOf('permit_runs', 'kind', ['backfill', 'daily', 'manual'])
]);

/** A month checked a second way (the office's report, or a second search). */
export const permitChecks = pgTable('permit_checks', {
  id: objectId('id').primaryKey(),
  source: text('source').notNull(),
  /** 'YYYY-MM' */
  month: text('month').notNull(),
  method: text('method').notNull().default('report'),
  filled: integer('filled').notNull().default(0),
  addedFromReport: textArray('added_from_report'),
  reportTitle: text('report_title').notNull().default(''),
  reportUrl: text('report_url').notNull().default(''),
  checkedAt: moment('checked_at').notNull(),
  inReport: integer('in_report').notNull().default(0),
  matched: integer('matched').notNull().default(0),
  missingFromApp: textArray('missing_from_app'),
  notInReport: textArray('not_in_report'),
  inSearch: integer('in_search').notNull().default(0),
  notFoundAgain: textArray('not_found_again'),
  notInCountySearch: textArray('not_in_county_search'),
  notIssuedYet: textArray('not_issued_yet'),
  datesMoved: textArray('dates_moved'),
  notPublic: textArray('not_public'),
  ok: boolean('ok').notNull().default(false),
  error: text('error').notNull().default('')
}, t => [
  idFormat('permit_checks'),
  uniqueIndex('permit_checks_source_month_key').on(t.source, t.month),
  oneOf('permit_checks', 'method', ['report', 'search'])
]);

/** The WA L&I registry, by license (read live and kept). */
export const permitContractors = pgTable('permit_contractors', {
  id: objectId('id').primaryKey(),
  license: text('license').notNull(),
  businessName: text('business_name').notNull().default(''),
  phone: text('phone').notNull().default(''),
  address: text('address').notNull().default(''),
  city: text('city').notNull().default(''),
  state: text('state').notNull().default(''),
  zip: text('zip').notNull().default(''),
  licenseType: text('license_type').notNull().default(''),
  specialty: text('specialty').notNull().default(''),
  specialty2: text('specialty2').notNull().default(''),
  status: text('status').notNull().default(''),
  expiresOn: day('expires_on'),
  principal: text('principal').notNull().default(''),
  ubi: text('ubi').notNull().default(''),
  notFound: boolean('not_found').notNull().default(false),
  refreshedAt: moment('refreshed_at').notNull()
}, t => [idFormat('permit_contractors'), uniqueIndex('permit_contractors_license_key').on(t.license)]);

/** A business name looked up in the registry: its one active license, or '' (none / several). */
export const permitContractorNames = pgTable('permit_contractor_names', {
  id: objectId('id').primaryKey(),
  name: text('name').notNull(),
  license: text('license').notNull().default(''),
  candidates: integer('candidates').notNull().default(0),
  checkedAt: moment('checked_at').notNull()
}, t => [idFormat('permit_contractor_names'), uniqueIndex('permit_contractor_names_name_key').on(t.name)]);
