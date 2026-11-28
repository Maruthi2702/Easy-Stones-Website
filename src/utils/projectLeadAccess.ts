/**
 * Multifamily leads (Sales → Multifamily Leads, 2026-11-20): who may do what. Every action is its own
 * switch on the Users & Roles card "Multifamily Leads" (src/features/users/roles/pagePermissions.ts),
 * never a role name. Admin holds all four at start-up (server.ts); an admin hands the rest out.
 * Shared by the server (src/routes/projectLeads.ts), the side nav and the screen.
 */
import type { PermissionUser } from '../types/permissions.ts';
import { canModifyVisit } from './visitAccess.ts';

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

/**
 * Who may take and release a lead (owner's call, 2026-11-20). A lead is taken by the person taking it, and only
 * while nobody has it. It is released by **the person it's with, or their superior**. "Superior" is the app's
 * existing rule for acting on someone else's work (src/utils/visitAccess.ts, canModifyVisit): the Users & Roles
 * Visits switch **Edit all** (anyone's), or **Edit branch** when the assignee is on the viewer's team
 * (src/utils/teamScope.ts). Shared by the server (which enforces it) and the screen (which hides what it refuses).
 *
 * `lead.assignedToId` is the assignee's user id; a lead whose id is missing falls back to the name.
 */
export type LeadAssignment = { assignedTo?: string; assignedToId?: string };

const userIdOf = (u: { id?: unknown; _id?: unknown } | null | undefined) => String(u?.id ?? u?._id ?? '');

export const canTakeLead = (u: PermissionUser, lead: LeadAssignment) => canEditProjectLeads(u) && !lead.assignedTo;

export function canReleaseLead(
  u: PermissionUser & { id?: unknown; _id?: unknown; name?: string; username?: string },
  lead: LeadAssignment,
  team?: unknown
): boolean {
  if (!canEditProjectLeads(u) || !lead.assignedTo) return false;
  const me = userIdOf(u);
  if (lead.assignedToId ? lead.assignedToId === me : (!!u && (u.name === lead.assignedTo || u.username === lead.assignedTo))) return true;
  return canModifyVisit(u, { createdBy: lead.assignedToId || undefined }, team);
}
