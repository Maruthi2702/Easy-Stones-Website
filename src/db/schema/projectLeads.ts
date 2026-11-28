/**
 * Multifamily leads (2026-11-20, src/utils/projectLeads.ts): construction projects from a
 * ConstructConnect export and the companies on each. Postgres only — new since the
 * cutover, no MongoDB copy, and no link to any copied table, so a copy never touches it.
 *
 * A project's id is ConstructConnect's own Project Id (10 digits, kept as text), so
 * importing the same project again updates it. What staff add — status, who has it,
 * a note, the history — is never written by an import.
 */
import { pgTable, text, integer, jsonb, numeric, index, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { moment, day } from './columns.ts';

export const projectLeads = pgTable('project_leads', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  value: numeric('value'),
  stage: text('stage').notNull().default(''),
  subcategory: text('subcategory').notNull().default(''),
  bidDate: day('bid_date'),
  listedOn: day('listed_on'),
  /** ConstructConnect's "last updated", the day the project last changed there. */
  updatedOn: day('updated_on'),
  address: text('address').notNull().default(''),
  city: text('city').notNull().default(''),
  county: text('county').notNull().default(''),
  state: text('state').notNull().default(''),
  zip: text('zip').notNull().default(''),
  floors: integer('floors'),
  floorArea: numeric('floor_area'),
  floorAreaUnit: text('floor_area_unit').notNull().default(''),
  siteArea: numeric('site_area'),
  siteAreaUnit: text('site_area_unit').notNull().default(''),
  stageNote: text('stage_note').notNull().default(''),
  units: integer('units'),
  ownerType: text('owner_type').notNull().default(''),
  importId: text('import_id').notNull().default(''),
  firstImportedAt: moment('first_imported_at').notNull().defaultNow(),
  importedAt: moment('imported_at').notNull().defaultNow(),
  // What staff add (never written by an import).
  status: text('status').notNull().default('new'),
  assignedTo: text('assigned_to').notNull().default(''),
  /** The assignee's user id: "their superior" is worked out from it (src/utils/projectLeadAccess.ts). */
  assignedToId: text('assigned_to_id').notNull().default(''),
  note: text('note').notNull().default(''),
  statusBy: text('status_by').notNull().default(''),
  statusAt: moment('status_at'),
  /** Every change of status or note, newest last: [{ at, by, status, note }]. Never trimmed. */
  history: jsonb('history').notNull().default(sql`'[]'::jsonb`)
}, t => [
  index('project_leads_updated_idx').on(t.updatedOn),
  index('project_leads_state_idx').on(t.state, t.city),
  index('project_leads_status_idx').on(t.status)
]);

/** The companies named on a project, in the order the file lists them. */
export const projectLeadCompanies = pgTable('project_lead_companies', {
  projectId: text('project_id').notNull().references(() => projectLeads.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  companyId: text('company_id').notNull().default(''),
  name: text('name').notNull(),
  role: text('role').notNull().default(''),
  roleGroup: text('role_group').notNull().default('other'),
  address: text('address').notNull().default(''),
  city: text('city').notNull().default(''),
  state: text('state').notNull().default(''),
  zip: text('zip').notNull().default(''),
  firstName: text('first_name').notNull().default(''),
  lastName: text('last_name').notNull().default(''),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default('')
}, t => [
  primaryKey({ columns: [t.projectId, t.position] }),
  index('project_lead_companies_name_idx').on(t.name)
]);

/** One line per import: who, when, the file, and what it added or changed. */
export const projectLeadImports = pgTable('project_lead_imports', {
  id: text('id').primaryKey(),
  fileName: text('file_name').notNull().default(''),
  projects: integer('projects').notNull(),
  companies: integer('companies').notNull(),
  added: integer('added').notNull(),
  updated: integer('updated').notNull(),
  importedBy: text('imported_by').notNull().default(''),
  importedAt: moment('imported_at').notNull().defaultNow(),
  /** Set when the import was undone (only the latest import can be). */
  undoneAt: moment('undone_at'),
  undoneBy: text('undone_by').notNull().default('')
});

/**
 * What each project looked like just before an import touched it, so the latest import can be undone:
 * `previous` is null when the import added the project, else { lead, companies } (the file-owned
 * columns and the company rows). Only the latest import's backups are kept.
 */
export const projectLeadImportBackups = pgTable('project_lead_import_backups', {
  importId: text('import_id').notNull().references(() => projectLeadImports.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull(),
  previous: jsonb('previous')
}, t => [primaryKey({ columns: [t.importId, t.projectId] })]);

/**
 * What staff add to a **company** on the Companies view (2026-11-27): status, who has it, a note, the history.
 * One row per company across every project it is on, keyed by `companyKey` (the lower-cased ConstructConnect
 * company id, else its name — the same expression the list groups by). An import never touches it; a company that
 * has no row here is "New", with nobody and no note. Separate from the project's own status columns, which stay.
 */
export const projectLeadCompanyWork = pgTable('project_lead_company_work', {
  companyKey: text('company_key').primaryKey(),
  /** The name as last shown, so the row still reads right if the company later leaves every project. */
  name: text('name').notNull().default(''),
  status: text('status').notNull().default('new'),
  assignedTo: text('assigned_to').notNull().default(''),
  assignedToId: text('assigned_to_id').notNull().default(''),
  note: text('note').notNull().default(''),
  statusBy: text('status_by').notNull().default(''),
  statusAt: moment('status_at'),
  /** Every change of status or note, and every take or release, newest last: [{ at, by, status, note, event? }]. Never trimmed. */
  history: jsonb('history').notNull().default(sql`'[]'::jsonb`)
}, t => [
  index('project_lead_company_work_status_idx').on(t.status),
  index('project_lead_company_work_assigned_idx').on(t.assignedTo)
]);
