/**
 * Project leads (Sales → Project Leads, 2026-11-20): who may do what. Every action is its own
 * switch on the Users & Roles card "Project Leads" (src/features/users/roles/pagePermissions.ts),
 * never a role name. Admin holds all four at start-up (server.ts); an admin hands the rest out.
 * Shared by the server (src/routes/projectLeads.ts), the side nav and the screen.
 */
import type { PermissionUser } from '../types/permissions.ts';

export const PROJECT_LEADS = Object.freeze({
  /** See the projects and the companies on them, with their phones and emails. */
  VIEW: 'view_project_leads',
  /** Set a lead's status (Contacted, Samples sent…), who has it, and its note. */
  EDIT: 'edit_project_leads',
  /** Upload a ConstructConnect file. */
  IMPORT: 'import_project_leads',
  /** Download the list as Excel. */
  EXPORT: 'export_project_leads'
});

export const ALL_PROJECT_LEAD_PERMISSIONS = Object.freeze(Object.values(PROJECT_LEADS));

const has = (user: PermissionUser, key: string) => !!user?.permissions?.includes(key);

export const canViewProjectLeads = (u: PermissionUser) => has(u, PROJECT_LEADS.VIEW);
export const canEditProjectLeads = (u: PermissionUser) => canViewProjectLeads(u) && has(u, PROJECT_LEADS.EDIT);
export const canImportProjectLeads = (u: PermissionUser) => canViewProjectLeads(u) && has(u, PROJECT_LEADS.IMPORT);
export const canExportProjectLeads = (u: PermissionUser) => canViewProjectLeads(u) && has(u, PROJECT_LEADS.EXPORT);
