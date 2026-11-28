/**
 * Multifamily Leads → Companies (2026-11-27): the same ConstructConnect data as the Projects view, listed by
 * **company** instead of by project — one row per company across every project it is on (owner's call), with the
 * best person to call, which roles it plays, how many projects, and a status / who has it / note of its own.
 * Shapes and words shared by the server (src/db/projectLeads/companies.ts, the routes) and the screen.
 */
import { STATUS_LABELS, formatPhone, roleLabel, ROLE_GROUP_LABELS, type LeadStatus } from './projectLeads.ts';

/** The roles a company list is about, in tab order. Engineers and other consultants are left out. */
export const COMPANY_ROLES = ['contractor', 'architect', 'designer', 'owner'] as const;
export type CompanyRole = typeof COMPANY_ROLES[number];
export const isCompanyRole = (v: unknown): v is CompanyRole => COMPANY_ROLES.includes(v as CompanyRole);

/** What a tab says: "Contractors", "Architects", "Interior designers", "Owners & developers". */
export const COMPANY_ROLE_TABS: Record<CompanyRole, string> = {
  contractor: ROLE_GROUP_LABELS.contractor,
  architect: ROLE_GROUP_LABELS.architect,
  designer: ROLE_GROUP_LABELS.designer,
  owner: ROLE_GROUP_LABELS.owner
};
/** One company's role chip: "Contractor", "Architect", "Interior designer", "Owner / developer". */
export const COMPANY_ROLE_CHIPS: Record<CompanyRole, string> = { contractor: 'Contractor', architect: 'Architect', designer: 'Interior designer', owner: 'Owner / developer' };

export const COMPANY_SORTS = [
  { id: 'updated_desc', label: 'Recently updated' },
  { id: 'projects_desc', label: 'Most projects' },
  { id: 'value_desc', label: 'Biggest project' },
  { id: 'name_asc', label: 'Name A–Z' }
] as const;
export type CompanySort = typeof COMPANY_SORTS[number]['id'];
export const isCompanySort = (v: unknown): v is CompanySort => COMPANY_SORTS.some((s) => s.id === v);

export type HistoryEntry = { at: string; by: string; status: LeadStatus; note: string; event?: string };

/** The person worth calling at a company: the contact with the most ways to reach them. */
export type CompanyContact = { firstName: string; lastName: string; phone: string; email: string };

/** One company in the list. `key` is what everything about it is looked up by (the lower-cased company id, else its name). */
export type CompanyItem = {
  key: string;
  name: string;
  roles: CompanyRole[];
  projects: number;
  lastUpdated: string;
  topValue: number | null;
  latestProject: string;
  contact: CompanyContact;
  address: string;
  city: string;
  state: string;
  zip: string;
  status: LeadStatus;
  assignedTo: string;
  assignedToId: string;
  note: string;
  statusBy: string;
  statusAt: string;
  canTake?: boolean;
  canRelease?: boolean;
};

export type CompaniesPage = {
  items: CompanyItem[];
  total: number;
  counts: Record<string, number>;
  /** Companies per role under the other filters, and across all roles. */
  roleCounts: Record<string, number>;
};

/** A person at a company, with the roles they appear under and the latest project they are on. */
export type CompanyPerson = CompanyContact & {
  roles: string[];
  projects: number;
  latest: { id: string; title: string; city: string; state: string };
};

export type CompanyProject = {
  id: string; title: string; city: string; state: string; value: number | null; stage: string; subcategory: string;
  units: number | null; updatedOn: string; roles: string[];
};

export type CompanyDetail = CompanyItem & {
  /** Every project it is on, newest first, with the role it plays there. */
  projectList: CompanyProject[];
  people: CompanyPerson[];
  history: HistoryEntry[];
};

/** "Contractor · Architect" — the roles a company plays, in tab order. */
export const rolesText = (roles: CompanyRole[]) => roles.map((r) => COMPANY_ROLE_CHIPS[r]).join(' · ');

export const projectsText = (n: number) => (n === 1 ? '1 project' : `${n} projects`);

/** The Excel export: one row per company. */
export function companyExportRows(items: CompanyItem[]) {
  return items.map((c) => ({
    Company: c.name,
    Roles: rolesText(c.roles),
    Contact: `${c.contact.firstName} ${c.contact.lastName}`.trim(),
    Phone: formatPhone(c.contact.phone),
    Email: c.contact.email,
    City: c.city,
    State: c.state,
    Projects: c.projects,
    'Latest Project': c.latestProject,
    'Biggest Project Value': c.topValue ?? '',
    Updated: c.lastUpdated,
    'Lead Status': STATUS_LABELS[c.status] ?? c.status,
    'Assigned To': c.assignedTo,
    Note: c.note
  }));
}

/** "Subcontractor (awarded), General Contractor" for a project row's roles. */
export const projectRolesText = (roles: string[]) => [...new Set(roles.map(roleLabel))].join(', ');
