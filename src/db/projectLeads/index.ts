/**
 * Project leads (src/utils/projectLeads.ts): the data layer. Postgres only.
 *
 * An import adds new projects and refreshes ConstructConnect's fields on the ones it
 * already has (matched by Project Id), replacing their companies; status, assignee,
 * note and history are staff's and are never touched. Projects missing from a file stay.
 */
import { and, asc, desc, eq, gte, inArray, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { appDb } from '../appDb.ts';
import { newId } from '../ids.ts';
import { projectLeads as leads, projectLeadCompanies as companies, projectLeadImports as imports, projectLeadImportBackups as backups } from '../schema/projectLeads.ts';
import { orderCompanies, isLeadStatus, type LeadProject, type LeadStatus, type RoleGroup, type LeadCompany } from '../../utils/projectLeads.ts';

export const SORTS = ['updated_desc', 'value_desc', 'value_asc', 'title_asc'] as const;
export type Sort = typeof SORTS[number];

export type LeadFilter = {
  q?: string;
  states?: string[];
  city?: string;
  stage?: string;
  subcategory?: string;
  status?: LeadStatus;
  /** A rep's name, or 'none' for leads nobody has. */
  assignedTo?: string;
  minValue?: number;
  /** Updated on ConstructConnect on or after this day (YYYY-MM-DD). */
  updatedFrom?: string;
  /** Only projects with an owner, architect, designer or contractor we can phone or email. */
  reachable?: boolean;
  sort?: Sort;
  limit?: number;
  offset?: number;
};

/** `event` is set when the line records taking or releasing a lead ("Took this lead", "Released from Sam"). */
export type HistoryLine = { at: string; by: string; status: LeadStatus; note: string; event?: string };

const CHUNK = 500;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`);
const numberOrNull = (v: string | null) => (v == null ? null : Number(v));

type LeadRow = typeof leads.$inferSelect;
type CompanyRow = typeof companies.$inferSelect;

/** The columns an import owns: everything but status, assignee, note, statusBy, statusAt and history. */
const FILE_COLUMNS = [
  'title', 'value', 'stage', 'subcategory', 'bidDate', 'listedOn', 'updatedOn', 'address', 'city', 'county', 'state', 'zip',
  'floors', 'floorArea', 'floorAreaUnit', 'siteArea', 'siteAreaUnit', 'stageNote', 'units', 'ownerType', 'importId', 'importedAt'
] as const;

const companyKey = (c: { companyId: string; name: string; role: string; firstName: string; lastName: string }) =>
  `${c.companyId || c.name}|${c.role}|${c.firstName}|${c.lastName}`.toLowerCase();

/** The projects (and their companies) already stored under these ids. */
async function readExisting(d: Db, ids: string[]) {
  const rows = new Map<string, LeadRow>();
  const cos = new Map<string, CompanyRow[]>();
  for (let i = 0; i < ids.length; i += 2000) {
    const part = ids.slice(i, i + 2000);
    for (const r of await d.select().from(leads).where(inArray(leads.id, part))) rows.set(r.id, r);
    for (const c of await d.select().from(companies).where(inArray(companies.projectId, part)).orderBy(asc(companies.position))) {
      cos.set(c.projectId, [...(cos.get(c.projectId) ?? []), c]);
    }
  }
  return { rows, cos };
}

/** What changes on a stored project when the file's version replaces it, as readable lines. */
function changesOf(old: LeadRow, p: LeadProject): { label: string; from: string; to: string }[] {
  const out: { label: string; from: string; to: string }[] = [];
  const check = (label: string, from: unknown, to: unknown) => {
    const f = from == null ? '' : String(from);
    const t = to == null ? '' : String(to);
    if (f !== t) out.push({ label, from: f, to: t });
  };
  check('Title', old.title, p.title);
  check('Value', numberOrNull(old.value), p.value);
  check('Stage', old.stage, p.stage);
  check('Type', old.subcategory, p.subcategory);
  check('Updated', old.updatedOn ?? '', p.updatedOn);
  check('Address', old.address, p.address);
  check('City', old.city, p.city);
  check('State', old.state, p.state);
  check('Units', old.units, p.units);
  return out;
}

export type ImportPreview = {
  projects: number; companies: number; added: number; refreshed: number; unchanged: number;
  contactsAdded: number; contactsRemoved: number;
  /** Projects whose "updated" day in the file is earlier than the one stored: the file may be older than what's here. */
  older: number;
  /** Up to 10 projects that would change, with what changes. */
  samples: { id: string; title: string; changes: { label: string; from: string; to: string }[] }[];
  /** Projects already here that this file doesn't mention (they stay as they are). */
  notInFile: number;
};

/** Nothing written: what importing these projects would add, refresh and drop. */
export async function previewImport(projects: LeadProject[], db?: Db): Promise<ImportPreview> {
  const d = db ?? await appDb();
  const ids = projects.map(p => p.id);
  const { rows, cos } = await readExisting(d, ids);
  const [{ total }] = await d.select({ total: sql<number>`count(*)::int` }).from(leads);
  const out: ImportPreview = {
    projects: projects.length, companies: projects.reduce((n, p) => n + p.companies.length, 0), added: 0, refreshed: 0, unchanged: 0,
    contactsAdded: 0, contactsRemoved: 0, older: 0, samples: [], notInFile: Math.max(0, total - rows.size)
  };
  for (const p of projects) {
    const old = rows.get(p.id);
    const fileKeys = new Set(p.companies.map(companyKey));
    if (!old) { out.added++; out.contactsAdded += p.companies.length; continue; }
    const oldKeys = new Set((cos.get(p.id) ?? []).map(companyKey));
    const added = [...fileKeys].filter(k => !oldKeys.has(k)).length;
    const removed = [...oldKeys].filter(k => !fileKeys.has(k)).length;
    out.contactsAdded += added;
    out.contactsRemoved += removed;
    const changes = changesOf(old, p);
    if (old.updatedOn && p.updatedOn && p.updatedOn < old.updatedOn) out.older++;
    if (changes.length || added || removed) {
      out.refreshed++;
      if (out.samples.length < 10) out.samples.push({ id: p.id, title: old.title, changes });
    } else out.unchanged++;
  }
  return out;
}

/**
 * Adds and refreshes projects in one transaction. What each touched project looked like before is saved
 * (project_lead_import_backups) so this import can be undone; backups of earlier imports are dropped,
 * so only the latest import can be undone.
 */
export async function importProjects(input: { projects: LeadProject[]; fileName: string; by: string }, db?: Db) {
  const d = db ?? await appDb();
  const importId = newId();
  const ids = input.projects.map(p => p.id);
  const { rows: existing, cos: existingCompanies } = await readExisting(d, ids);
  const now = new Date();
  const rows = input.projects.map(p => ({
    id: p.id, title: p.title, value: p.value == null ? null : String(p.value), stage: p.stage, subcategory: p.subcategory,
    bidDate: p.bidDate || null, listedOn: p.listedOn || null, updatedOn: p.updatedOn || null,
    address: p.address, city: p.city, county: p.county, state: p.state, zip: p.zip,
    floors: p.floors, floorArea: p.floorArea == null ? null : String(p.floorArea), floorAreaUnit: p.floorAreaUnit,
    siteArea: p.siteArea == null ? null : String(p.siteArea), siteAreaUnit: p.siteAreaUnit,
    stageNote: p.stageNote, units: p.units, ownerType: p.ownerType, importId, importedAt: now
  }));
  const companyRows = input.projects.flatMap(p => p.companies.map((c, position) => ({
    projectId: p.id, position, companyId: c.companyId, name: c.name, role: c.role, roleGroup: c.group,
    address: c.address, city: c.city, state: c.state, zip: c.zip, firstName: c.firstName, lastName: c.lastName,
    phone: c.phone, email: c.email
  })));
  const backupRows = ids.map(id => {
    const old = existing.get(id);
    if (!old) return { importId, projectId: id, previous: null };
    const lead = Object.fromEntries(FILE_COLUMNS.map(k => [k, old[k] instanceof Date ? (old[k] as Date).toISOString() : old[k]]));
    return { importId, projectId: id, previous: { lead, companies: existingCompanies.get(id) ?? [] } };
  });
  await d.transaction(async tx => {
    // Only the latest import can be undone.
    await tx.delete(backups);
    for (let i = 0; i < rows.length; i += CHUNK) {
      await tx.insert(leads).values(rows.slice(i, i + CHUNK)).onConflictDoUpdate({
        target: leads.id,
        // Everything ConstructConnect owns; never status, assignedTo, note, statusBy, statusAt, history.
        set: {
          title: sql`excluded.title`, value: sql`excluded.value`, stage: sql`excluded.stage`, subcategory: sql`excluded.subcategory`,
          bidDate: sql`excluded.bid_date`, listedOn: sql`excluded.listed_on`, updatedOn: sql`excluded.updated_on`,
          address: sql`excluded.address`, city: sql`excluded.city`, county: sql`excluded.county`, state: sql`excluded.state`, zip: sql`excluded.zip`,
          floors: sql`excluded.floors`, floorArea: sql`excluded.floor_area`, floorAreaUnit: sql`excluded.floor_area_unit`,
          siteArea: sql`excluded.site_area`, siteAreaUnit: sql`excluded.site_area_unit`, stageNote: sql`excluded.stage_note`,
          units: sql`excluded.units`, ownerType: sql`excluded.owner_type`, importId: sql`excluded.import_id`, importedAt: sql`excluded.imported_at`
        }
      });
    }
    for (let i = 0; i < ids.length; i += 5000) await tx.delete(companies).where(inArray(companies.projectId, ids.slice(i, i + 5000)));
    for (let i = 0; i < companyRows.length; i += CHUNK) await tx.insert(companies).values(companyRows.slice(i, i + CHUNK));
    await tx.insert(imports).values({
      id: importId, fileName: input.fileName, projects: rows.length, companies: companyRows.length,
      added: rows.length - existing.size, updated: existing.size, importedBy: input.by
    });
    for (let i = 0; i < backupRows.length; i += CHUNK) await tx.insert(backups).values(backupRows.slice(i, i + CHUNK));
  });
  return { importId, projects: rows.length, companies: companyRows.length, added: rows.length - existing.size, updated: existing.size };
}

/**
 * Undoes the latest import (and only that one, once): projects it refreshed go back to what they were,
 * with their companies; projects it added are removed unless staff have already worked them (a status, a
 * note, an assignee) — those are kept and counted. Returns undefined when there is nothing to undo.
 */
export async function undoImport(importId: string, by: string, db?: Db) {
  const d = db ?? await appDb();
  return d.transaction(async tx => {
    const [latest] = await tx.select().from(imports).orderBy(desc(imports.importedAt)).limit(1).for('update');
    if (!latest || latest.id !== importId || latest.undoneAt) return undefined;
    const saved = await tx.select().from(backups).where(eq(backups.importId, importId));
    let restored = 0, removed = 0, kept = 0;
    for (const b of saved) {
      const prev = b.previous as null | { lead: Record<string, unknown>; companies: CompanyRow[] };
      if (!prev) {
        const [r] = await tx.select().from(leads).where(eq(leads.id, b.projectId));
        if (!r) continue;
        const worked = r.status !== 'new' || r.note !== '' || r.assignedTo !== '' || (Array.isArray(r.history) && r.history.length > 0);
        if (worked) { kept++; continue; }
        await tx.delete(leads).where(eq(leads.id, b.projectId));   // its companies go with it
        removed++;
        continue;
      }
      const lead = { ...prev.lead } as Record<string, unknown>;
      if (typeof lead.importedAt === 'string') lead.importedAt = new Date(lead.importedAt);
      await tx.update(leads).set(lead as Partial<typeof leads.$inferInsert>).where(eq(leads.id, b.projectId));
      await tx.delete(companies).where(eq(companies.projectId, b.projectId));
      for (let i = 0; i < prev.companies.length; i += CHUNK) await tx.insert(companies).values(prev.companies.slice(i, i + CHUNK));
      restored++;
    }
    await tx.delete(backups).where(eq(backups.importId, importId));
    await tx.update(imports).set({ undoneAt: new Date(), undoneBy: by }).where(eq(imports.id, importId));
    return { restored, removed, kept };
  });
}

/** The list's filters as one condition; `skipStatus` leaves the status out (for the counts beside it). */
function whereOf(f: LeadFilter, skipStatus = false): SQL | undefined {
  const parts: (SQL | undefined)[] = [];
  const q = (f.q ?? '').trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    parts.push(or(
      ilike(leads.title, like), ilike(leads.address, like), ilike(leads.city, like), ilike(leads.county, like),
      sql`exists (select 1 from ${companies} where ${companies.projectId} = ${leads.id} and (
        ${companies.name} ilike ${like} or ${companies.firstName} ilike ${like} or ${companies.lastName} ilike ${like}
        or ${companies.email} ilike ${like} or ${companies.phone} ilike ${like}))`
    ));
  }
  if (f.states?.length) parts.push(inArray(leads.state, f.states));
  if (f.city) parts.push(eq(leads.city, f.city));
  if (f.stage) parts.push(eq(leads.stage, f.stage));
  if (f.subcategory) parts.push(eq(leads.subcategory, f.subcategory));
  if (f.status && !skipStatus) parts.push(eq(leads.status, f.status));
  if (f.assignedTo) parts.push(f.assignedTo === 'none' ? eq(leads.assignedTo, '') : eq(leads.assignedTo, f.assignedTo));
  if (f.minValue != null) parts.push(gte(leads.value, String(f.minValue)));
  if (f.updatedFrom) parts.push(gte(leads.updatedOn, f.updatedFrom));
  if (f.reachable) {
    parts.push(sql`exists (select 1 from ${companies} where ${companies.projectId} = ${leads.id}
      and ${companies.roleGroup} <> 'other' and (${companies.phone} <> '' or ${companies.email} <> ''))`);
  }
  return and(...parts.filter((p): p is SQL => !!p));
}

const orderOf = (sort: Sort | undefined) => {
  switch (sort) {
    case 'value_desc': return [sql`${leads.value} desc nulls last`, desc(leads.updatedOn), asc(leads.id)];
    case 'value_asc': return [sql`${leads.value} asc nulls last`, desc(leads.updatedOn), asc(leads.id)];
    case 'title_asc': return [asc(leads.title), asc(leads.id)];
    default: return [sql`${leads.updatedOn} desc nulls last`, desc(leads.value), asc(leads.id)];
  }
};

const shapeCompany = (c: typeof companies.$inferSelect): LeadCompany => ({
  companyId: c.companyId, name: c.name, role: c.role, group: c.roleGroup as RoleGroup, address: c.address, city: c.city,
  state: c.state, zip: c.zip, firstName: c.firstName, lastName: c.lastName, phone: c.phone, email: c.email
});

const shapeLead = (r: typeof leads.$inferSelect) => ({
  id: r.id, title: r.title, value: numberOrNull(r.value), stage: r.stage, subcategory: r.subcategory,
  bidDate: r.bidDate ?? '', listedOn: r.listedOn ?? '', updatedOn: r.updatedOn ?? '',
  address: r.address, city: r.city, county: r.county, state: r.state, zip: r.zip,
  floors: r.floors, floorArea: numberOrNull(r.floorArea), floorAreaUnit: r.floorAreaUnit,
  siteArea: numberOrNull(r.siteArea), siteAreaUnit: r.siteAreaUnit, stageNote: r.stageNote,
  units: r.units, ownerType: r.ownerType,
  status: (isLeadStatus(r.status) ? r.status : 'new') as LeadStatus, assignedTo: r.assignedTo, assignedToId: r.assignedToId, note: r.note,
  statusBy: r.statusBy, statusAt: r.statusAt ? r.statusAt.toISOString() : '',
  history: (Array.isArray(r.history) ? r.history : []) as HistoryLine[]
});

export type LeadItem = ReturnType<typeof shapeLead> & { companies: LeadCompany[] };

/** One page of projects with their companies (best contacts first), the total, and the count per status for these filters. */
export async function listLeads(f: LeadFilter, db?: Db) {
  const d = db ?? await appDb();
  const where = whereOf(f);
  const limit = Math.min(Math.max(Math.trunc(f.limit ?? 50), 1), 5000);
  const offset = Math.max(Math.trunc(f.offset ?? 0), 0);
  const rows = await d.select().from(leads).where(where).orderBy(...orderOf(f.sort)).limit(limit).offset(offset);
  const [{ total }] = await d.select({ total: sql<number>`count(*)::int` }).from(leads).where(where);
  const counted = await d.select({ status: leads.status, n: sql<number>`count(*)::int` }).from(leads).where(whereOf(f, true)).groupBy(leads.status);
  const counts: Record<string, number> = {};
  for (const c of counted) counts[c.status] = c.n;
  const ids = rows.map(r => r.id);
  const byProject = new Map<string, LeadCompany[]>();
  if (ids.length) {
    const found: (typeof companies.$inferSelect)[] = [];
    for (let i = 0; i < ids.length; i += 2000) {
      found.push(...await d.select().from(companies).where(inArray(companies.projectId, ids.slice(i, i + 2000))).orderBy(asc(companies.projectId), asc(companies.position)));
    }
    for (const c of found) byProject.set(c.projectId, [...(byProject.get(c.projectId) ?? []), shapeCompany(c)]);
  }
  const items: LeadItem[] = rows.map(r => ({ ...shapeLead(r), companies: orderCompanies(byProject.get(r.id) ?? []) }));
  return { items, total, counts };
}

/** What the filters offer: states and stages and subcategories that exist, cities per state, and the last import. */
export async function leadMeta(db?: Db) {
  const d = db ?? await appDb();
  const states = await d.select({ state: leads.state, n: sql<number>`count(*)::int` }).from(leads).groupBy(leads.state).orderBy(asc(leads.state));
  const stages = await d.selectDistinct({ stage: leads.stage }).from(leads).orderBy(asc(leads.stage));
  const subs = await d.select({ subcategory: leads.subcategory, n: sql<number>`count(*)::int` }).from(leads).groupBy(leads.subcategory).orderBy(desc(sql`count(*)`)).limit(40);
  const cities = await d.selectDistinct({ state: leads.state, city: leads.city }).from(leads).orderBy(asc(leads.state), asc(leads.city));
  const assignees = await d.selectDistinct({ name: leads.assignedTo }).from(leads).orderBy(asc(leads.assignedTo));
  const [last] = await d.select().from(imports).orderBy(desc(imports.importedAt)).limit(1);
  const [{ total }] = await d.select({ total: sql<number>`count(*)::int` }).from(leads);
  const cityMap: Record<string, string[]> = {};
  for (const c of cities) if (c.city) (cityMap[c.state] ||= []).push(c.city);
  return {
    total,
    states: states.filter(s => s.state).map(s => ({ name: s.state, count: s.n })),
    stages: stages.map(s => s.stage).filter(Boolean),
    subcategories: subs.filter(s => s.subcategory).map(s => ({ name: s.subcategory, count: s.n })),
    cities: cityMap,
    assignees: assignees.map(a => a.name).filter(Boolean),
    lastImport: last ? { id: last.id, canUndo: !last.undoneAt, undone: !!last.undoneAt, fileName: last.fileName, projects: last.projects, added: last.added, updated: last.updated, importedBy: last.importedBy, importedAt: last.importedAt.toISOString() } : null
  };
}

/** One lead with its companies, or undefined. */
export async function getLead(id: string, db?: Db): Promise<LeadItem | undefined> {
  const d = db ?? await appDb();
  const [r] = await d.select().from(leads).where(eq(leads.id, id));
  if (!r) return undefined;
  const cs = await d.select().from(companies).where(eq(companies.projectId, id)).orderBy(asc(companies.position));
  return { ...shapeLead(r), companies: orderCompanies(cs.map(shapeCompany)) };
}

/**
 * Sets a lead's status, assignee and/or note. A change of status or note, and every take or release, is kept in
 * its history (who, when, what). `assignedTo: ''` releases it; a name takes it, with the taker's user id
 * (`assignedToId`). Who may is the route's decision (src/utils/projectLeadAccess.ts). Returns the lead as saved,
 * or undefined when it doesn't exist.
 */
export async function updateLead(
  id: string,
  change: { status?: LeadStatus; note?: string; assignedTo?: string; assignedToId?: string },
  by: string,
  db?: Db
): Promise<LeadItem | undefined> {
  const d = db ?? await appDb();
  const ok = await d.transaction(async tx => {
    const [r] = await tx.select().from(leads).where(eq(leads.id, id)).for('update');
    if (!r) return false;
    const set: Partial<typeof leads.$inferInsert> = {};
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
    const history = Array.isArray(r.history) ? [...r.history] as HistoryLine[] : [];
    const at = new Date().toISOString();
    if (statusChanged || noteChanged) {
      history.push({ at, by, status, note: change.note ?? '' });
      set.statusBy = by;
      set.statusAt = new Date();
    }
    if (assignChanged) {
      history.push({ at, by, status, note: '', event: change.assignedTo ? 'Took this lead' : `Released from ${r.assignedTo}` });
    }
    if (statusChanged || noteChanged || assignChanged) set.history = history;
    if (Object.keys(set).length) await tx.update(leads).set(set).where(eq(leads.id, id));
    return true;
  });
  return ok ? getLead(id, d) : undefined;
}
