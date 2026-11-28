/**
 * Multifamily Leads → Companies (src/utils/projectLeadCompanies.ts): the imported projects listed by company.
 *
 * A company is one row across every project it is on. Its key is the lower-cased ConstructConnect company id, else
 * its name (`KEY`). The list is worked out in SQL from `project_lead_companies` joined to its project, so a new import
 * shows up at once; what staff add — status, who has it, a note, the history — lives in `project_lead_company_work`,
 * which an import never touches. Engineers and other consultants (role group "other") are not part of this list.
 * Project-level filters (state, city, stage, type, value, updated) keep a company that is on at least one matching project.
 */
import { eq, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { appDb } from '../appDb.ts';
import { projectLeadCompanyWork as work } from '../schema/projectLeads.ts';
import { isLeadStatus, type LeadStatus } from '../../utils/projectLeads.ts';
import {
  COMPANY_ROLES, type CompanyRole, type CompanySort, type CompanyItem, type CompaniesPage, type CompanyDetail,
  type CompanyPerson, type CompanyProject, type HistoryEntry
} from '../../utils/projectLeadCompanies.ts';

export type CompanyFilter = {
  q?: string;
  /** Only companies that play this role (on a matching project). */
  role?: CompanyRole;
  states?: string[];
  city?: string;
  stage?: string;
  subcategory?: string;
  /** The company's own status. */
  status?: LeadStatus;
  /** A rep's name, or 'none' for companies nobody has. */
  assignedTo?: string;
  minValue?: number;
  updatedFrom?: string;
  /** Only companies with a phone or an email on a matching project. */
  reachable?: boolean;
  sort?: CompanySort;
  limit?: number;
  offset?: number;
};

/** The company's key, as SQL over `project_lead_companies c`. */
const KEY = sql`lower(btrim(coalesce(nullif(c.company_id, ''), c.name)))`;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
const list = (values: string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);
const and = (parts: SQL[]) => sql.join(parts, sql` and `);

type Rows<T> = { rows: T[] };
const run = async <T>(d: Db, q: SQL) => ((await d.execute(q)) as unknown as Rows<T>).rows;

/** The rows a company list is built from: one per company row on a matching project (never an engineer). */
function hits(f: CompanyFilter, skipRole = false): SQL {
  const w: SQL[] = [sql`c.role_group <> 'other'`];
  if (f.role && !skipRole) w.push(sql`c.role_group = ${f.role}`);
  if (f.states?.length) w.push(sql`l.state in (${list(f.states)})`);
  if (f.city) w.push(sql`l.city = ${f.city}`);
  if (f.stage) w.push(sql`l.stage = ${f.stage}`);
  if (f.subcategory) w.push(sql`l.subcategory = ${f.subcategory}`);
  if (f.minValue != null) w.push(sql`l.value >= ${String(f.minValue)}::numeric`);
  if (f.updatedFrom) w.push(sql`l.updated_on >= ${f.updatedFrom}::date`);
  const q = (f.q ?? '').trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    w.push(sql`(c.name ilike ${like} or c.first_name ilike ${like} or c.last_name ilike ${like}
      or c.email ilike ${like} or c.phone ilike ${like} or l.title ilike ${like})`);
  }
  return sql`select ${KEY} as key, c.name, c.role_group, c.first_name, c.last_name, c.phone, c.email, c.address, c.city, c.state, c.zip,
      c.project_id, l.title, l.updated_on, l.value
    from project_lead_companies c join project_leads l on l.id = c.project_id where ${and(w)}`;
}

/** The staff-side conditions, over the work row `w`. */
function workWhere(f: CompanyFilter, skipStatus: boolean): SQL[] {
  const w: SQL[] = [];
  if (f.status && !skipStatus) w.push(sql`coalesce(w.status, 'new') = ${f.status}`);
  if (f.assignedTo) w.push(f.assignedTo === 'none' ? sql`coalesce(w.assigned_to, '') = ''` : sql`coalesce(w.assigned_to, '') = ${f.assignedTo}`);
  return w;
}

/** One row per company for these filters (the list's page, total and status counts all read it). */
function grouped(f: CompanyFilter, skipStatus = false): SQL {
  const w = workWhere(f, skipStatus);
  if (f.reachable) w.push(sql`g.reachable`);
  return sql`with hits as (${hits(f)}),
    best as (
      select distinct on (key) key, first_name, last_name, phone, email, address, city, state, zip from hits
      order by key, (phone <> '' and email <> '') desc, (phone <> '') desc, (email <> '') desc, updated_on desc nulls last
    ),
    g as (
      select key,
        (array_agg(name order by updated_on desc nulls last, name))[1] as name,
        array_agg(distinct role_group) as groups,
        count(distinct project_id)::int as projects,
        to_char(max(updated_on), 'YYYY-MM-DD') as last_updated,
        max(value) as top_value,
        (array_agg(title order by updated_on desc nulls last, title))[1] as latest_title,
        bool_or(phone <> '' or email <> '') as reachable
      from hits group by key
    )
    select g.key, g.name, g.groups, g.projects, g.last_updated, g.top_value, g.latest_title,
      b.first_name, b.last_name, b.phone, b.email, b.address, b.city, b.state, b.zip,
      coalesce(w.status, 'new') as status, coalesce(w.assigned_to, '') as assigned_to, coalesce(w.assigned_to_id, '') as assigned_to_id,
      coalesce(w.note, '') as note, coalesce(w.status_by, '') as status_by, w.status_at
    from g join best b on b.key = g.key left join project_lead_company_work w on w.company_key = g.key
    ${w.length ? sql`where ${and(w)}` : sql``}`;
}

const orderOf = (sort: CompanySort | undefined): SQL => {
  switch (sort) {
    case 'projects_desc': return sql`projects desc, last_updated desc nulls last, lower(name)`;
    case 'value_desc': return sql`top_value desc nulls last, last_updated desc nulls last, lower(name)`;
    case 'name_asc': return sql`lower(name), key`;
    default: return sql`last_updated desc nulls last, projects desc, lower(name), key`;
  }
};

type GroupedRow = {
  key: string; name: string; groups: string[]; projects: number; last_updated: string | null; top_value: string | null; latest_title: string;
  first_name: string; last_name: string; phone: string; email: string; address: string; city: string; state: string; zip: string;
  status: string; assigned_to: string; assigned_to_id: string; note: string; status_by: string; status_at: Date | string | null;
};

const rolesOf = (groups: string[]): CompanyRole[] => COMPANY_ROLES.filter((r) => groups.includes(r));
const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : '');

const shape = (r: GroupedRow): CompanyItem => ({
  key: r.key, name: r.name, roles: rolesOf(r.groups), projects: r.projects, lastUpdated: r.last_updated ?? '',
  topValue: r.top_value == null ? null : Number(r.top_value), latestProject: r.latest_title,
  contact: { firstName: r.first_name, lastName: r.last_name, phone: r.phone, email: r.email },
  address: r.address, city: r.city, state: r.state, zip: r.zip,
  status: isLeadStatus(r.status) ? r.status : 'new', assignedTo: r.assigned_to, assignedToId: r.assigned_to_id, note: r.note,
  statusBy: r.status_by, statusAt: iso(r.status_at)
});

/** One page of companies, the total, the count per status and the count per role — all under the same filters. */
export async function listCompanies(f: CompanyFilter, db?: Db): Promise<CompaniesPage> {
  const d = db ?? await appDb();
  const limit = Math.min(Math.max(Math.trunc(f.limit ?? 50), 1), 5000);
  const offset = Math.max(Math.trunc(f.offset ?? 0), 0);
  const rows = await run<GroupedRow>(d, sql`select * from (${grouped(f)}) x order by ${orderOf(f.sort)} limit ${limit} offset ${offset}`);
  const [{ total }] = await run<{ total: number }>(d, sql`select count(*)::int as total from (${grouped(f)}) x`);
  const counted = await run<{ status: string; n: number }>(d, sql`select status, count(*)::int as n from (${grouped(f, true)}) x group by status`);
  const counts: Record<string, number> = {};
  for (const c of counted) counts[c.status] = c.n;

  // Companies per role (the role tabs) under every other filter; "all" counts a company once however many roles it plays.
  const w = workWhere(f, false);
  if (f.reachable) w.push(sql`(h.phone <> '' or h.email <> '')`);
  const roleWhere = w.length ? sql`where ${and(w)}` : sql``;
  const byRole = await run<{ role_group: string; n: number }>(d, sql`
    select h.role_group, count(distinct h.key)::int as n from (${hits(f, true)}) h
    left join project_lead_company_work w on w.company_key = h.key ${roleWhere} group by h.role_group`);
  const [{ n: all }] = await run<{ n: number }>(d, sql`
    select count(distinct h.key)::int as n from (${hits(f, true)}) h
    left join project_lead_company_work w on w.company_key = h.key ${roleWhere}`);
  const roleCounts: Record<string, number> = { all };
  for (const r of byRole) roleCounts[r.role_group] = r.n;
  return { items: rows.map(shape), total, counts, roleCounts };
}

type DetailRow = {
  key: string; company_id: string; name: string; role: string; role_group: string; first_name: string; last_name: string;
  phone: string; email: string; address: string; city: string; state: string; zip: string;
  project_id: string; title: string; p_city: string; p_state: string; value: string | null; stage: string; subcategory: string;
  units: number | null; updated_on: string | null;
};

/** One company with every project it is on, every person at it, and its own history. undefined when it isn't on any project. */
export async function getCompany(key: string, db?: Db): Promise<CompanyDetail | undefined> {
  const d = db ?? await appDb();
  const rows = await run<DetailRow>(d, sql`
    select ${KEY} as key, c.company_id, c.name, c.role, c.role_group, c.first_name, c.last_name, c.phone, c.email,
      c.address, c.city, c.state, c.zip, l.id as project_id, l.title, l.city as p_city, l.state as p_state, l.value, l.stage,
      l.subcategory, l.units, to_char(l.updated_on, 'YYYY-MM-DD') as updated_on
    from project_lead_companies c join project_leads l on l.id = c.project_id
    where ${KEY} = ${key} and c.role_group <> 'other'
    order by l.updated_on desc nulls last, l.id, c.position`);
  if (!rows.length) return undefined;

  const projects = new Map<string, CompanyProject>();
  const people = new Map<string, CompanyPerson>();
  const personProjects = new Map<string, Set<string>>();
  for (const r of rows) {
    const p = projects.get(r.project_id) ?? {
      id: r.project_id, title: r.title, city: r.p_city, state: r.p_state, value: r.value == null ? null : Number(r.value),
      stage: r.stage, subcategory: r.subcategory, units: r.units, updatedOn: r.updated_on ?? '', roles: []
    };
    if (r.role && !p.roles.includes(r.role)) p.roles.push(r.role);
    projects.set(r.project_id, p);
    const k = `${r.first_name}|${r.last_name}|${r.phone}|${r.email}`.toLowerCase();
    const person = people.get(k) ?? {
      firstName: r.first_name, lastName: r.last_name, phone: r.phone, email: r.email, roles: [], projects: 0,
      latest: { id: r.project_id, title: r.title, city: r.p_city, state: r.p_state }
    };
    if (r.role && !person.roles.includes(r.role)) person.roles.push(r.role);
    const seen = personProjects.get(k) ?? new Set<string>();
    seen.add(r.project_id);
    personProjects.set(k, seen);
    person.projects = seen.size;
    people.set(k, person);
  }

  const reach = (p: CompanyPerson) => (p.phone && p.email ? 3 : p.email ? 2 : p.phone ? 1 : 0);
  const ordered = [...people.values()].sort((a, b) => reach(b) - reach(a) || b.projects - a.projects);
  const best = ordered[0];
  const [w] = await d.select().from(work).where(eq(work.companyKey, key));
  const top = rows[0];
  const groups = [...new Set(rows.map((r) => r.role_group))];
  const values = [...projects.values()].map((p) => p.value).filter((v): v is number => v != null);
  const history = (Array.isArray(w?.history) ? w!.history : []) as HistoryEntry[];
  return {
    key, name: top.name, roles: rolesOf(groups), projects: projects.size, lastUpdated: top.updated_on ?? '',
    topValue: values.length ? Math.max(...values) : null, latestProject: top.title,
    contact: { firstName: best.firstName, lastName: best.lastName, phone: best.phone, email: best.email },
    address: top.address, city: top.city, state: top.state, zip: top.zip,
    status: w && isLeadStatus(w.status) ? w.status : 'new', assignedTo: w?.assignedTo ?? '', assignedToId: w?.assignedToId ?? '',
    note: w?.note ?? '', statusBy: w?.statusBy ?? '', statusAt: w?.statusAt ? w.statusAt.toISOString() : '',
    projectList: [...projects.values()], people: ordered, history
  };
}

/**
 * Sets a company's status, assignee and/or note (its own work row is made on the first change). A change of status or
 * note, and every take or release, is kept in its history. `assignedTo: ''` releases it; a name takes it, with the taker's
 * user id. Who may is the route's decision (src/utils/projectLeadAccess.ts). undefined when the company doesn't exist.
 */
export async function updateCompany(
  key: string,
  change: { status?: LeadStatus; note?: string; assignedTo?: string; assignedToId?: string },
  by: string,
  db?: Db
): Promise<CompanyDetail | undefined> {
  const d = db ?? await appDb();
  const ok = await d.transaction(async (tx) => {
    const [named] = await run<{ name: string }>(tx as unknown as Db, sql`select c.name from project_lead_companies c where ${KEY} = ${key} limit 1`);
    if (!named) return false;
    await tx.insert(work).values({ companyKey: key, name: named.name }).onConflictDoNothing();
    const [r] = await tx.select().from(work).where(eq(work.companyKey, key)).for('update');
    const set: Partial<typeof work.$inferInsert> = { name: named.name };
    const status = change.status ?? (isLeadStatus(r.status) ? r.status : 'new');
    const statusChanged = change.status !== undefined && change.status !== r.status;
    const noteChanged = change.note !== undefined && change.note !== r.note;
    const assignChanged = change.assignedTo !== undefined && change.assignedTo !== r.assignedTo;
    if (change.status !== undefined) set.status = change.status;
    if (change.note !== undefined) set.note = change.note;
    if (assignChanged) {
      set.assignedTo = change.assignedTo;
      set.assignedToId = change.assignedTo ? (change.assignedToId ?? '') : '';
    }
    const history = Array.isArray(r.history) ? [...r.history] as HistoryEntry[] : [];
    const at = new Date().toISOString();
    if (statusChanged || noteChanged) {
      history.push({ at, by, status, note: change.note ?? '' });
      set.statusBy = by;
      set.statusAt = new Date();
    }
    if (assignChanged) history.push({ at, by, status, note: '', event: change.assignedTo ? 'Took this lead' : `Released from ${r.assignedTo}` });
    if (statusChanged || noteChanged || assignChanged) set.history = history;
    await tx.update(work).set(set).where(eq(work.companyKey, key));
    return true;
  });
  return ok ? getCompany(key, d) : undefined;
}
