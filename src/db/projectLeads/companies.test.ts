import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import type { LeadProject, LeadCompany } from '../../utils/projectLeads.ts';
import { importProjects } from './index.ts';
import { listCompanies, getCompany, updateCompany } from './companies.ts';

const co = (over: Partial<LeadCompany> = {}): LeadCompany => ({
  companyId: 'c1', name: 'Rainier Builders', role: 'General Contractor', group: 'contractor', address: '1 Main', city: 'Tacoma', state: 'WA', zip: '98402',
  firstName: 'Ann', lastName: 'Lee', phone: '2065551234', email: 'ann@rainier.test', ...over
});
const project = (id: string, over: Partial<LeadProject> = {}): LeadProject => ({
  id, title: `Project ${id}`, value: 5_000_000, stage: 'Post Bid', subcategory: 'Apartments', bidDate: '', listedOn: '2026-01-01',
  updatedOn: '2026-06-01', address: '1 Main St', city: 'Seattle', county: 'King', state: 'Washington', zip: '98101',
  floors: 3, floorArea: 60000, floorAreaUnit: 'Square Feet', siteArea: null, siteAreaUnit: '', stageNote: '', units: 40, ownerType: 'Private',
  companies: [co()], ...over
});

describe('multifamily companies', () => {
  let client: PGlite, db: Db;
  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrateDb(db, 'pglite:memory');
    await importProjects({
      projects: [
        // Rainier is a contractor on three projects (and the owner of one); the architect and owner are on one each.
        project('1', { title: 'Alder Lofts', updatedOn: '2026-06-01', value: 5_000_000, companies: [co(), co({ companyId: 'c2', name: 'Studio North', role: 'Architect', group: 'architect', firstName: 'Bo', lastName: 'Park', phone: '', email: 'bo@north.test' })] }),
        project('2', { title: 'Birch Court', updatedOn: '2026-03-01', value: 20_000_000, state: 'Oregon', city: 'Portland', companies: [co({ phone: '', email: '', firstName: '', lastName: '' }), co({ companyId: 'c3', name: 'Civic Owners', role: 'Owner', group: 'owner', firstName: 'Cy', lastName: 'Diaz', phone: '2065550000' })] }),
        project('3', { title: 'Cedar Place', updatedOn: '2025-01-01', value: null, companies: [co({ role: 'Owner', group: 'owner' }), co({ companyId: 'c4', name: 'Eng Co', role: 'Civil Engineer', group: 'other' })] }),
        project('4', { title: 'Dogwood', updatedOn: '2026-05-01', companies: [co({ companyId: '', name: 'No Id Co', role: 'Interior Designer', group: 'designer', phone: '', email: '' })] })
      ], fileName: 'f.xlsx', by: 'krish'
    }, db);
  }, 60_000);
  afterAll(async () => { await client?.close(); });

  it('lists one row per company across its projects, never an engineer', async () => {
    const { items, total, roleCounts } = await listCompanies({}, db);
    expect(items.map((c) => c.name)).toEqual(['Rainier Builders', 'Studio North', 'No Id Co', 'Civic Owners']);
    expect(total).toBe(4);
    const rainier = items[0];
    expect(rainier).toMatchObject({ key: 'c1', projects: 3, roles: ['contractor', 'owner'], lastUpdated: '2026-06-01', topValue: 20_000_000, latestProject: 'Alder Lofts' });
    expect(roleCounts).toMatchObject({ all: 4, contractor: 1, architect: 1, owner: 2, designer: 1 });
  });

  it('shows the contact with the most ways to reach them, not a blank one', async () => {
    const [rainier] = (await listCompanies({}, db)).items;
    expect(rainier.contact).toEqual({ firstName: 'Ann', lastName: 'Lee', phone: '2065551234', email: 'ann@rainier.test' });
    expect(rainier.city).toBe('Tacoma');
  });

  it('keys a company with no id by its name', async () => {
    const found = (await listCompanies({ q: 'no id' }, db)).items;
    expect(found.map((c) => c.key)).toEqual(['no id co']);
  });

  it('filters by role, counting only that role’s projects', async () => {
    const owners = await listCompanies({ role: 'owner' }, db);
    expect(owners.items.map((c) => [c.name, c.projects])).toEqual([['Civic Owners', 1], ['Rainier Builders', 1]]);
    const contractors = await listCompanies({ role: 'contractor' }, db);
    expect(contractors.items.map((c) => [c.name, c.projects])).toEqual([['Rainier Builders', 2]]);
  });

  it('project filters keep companies on a matching project, and count only those', async () => {
    const oregon = await listCompanies({ states: ['Oregon'] }, db);
    expect(oregon.items.map((c) => c.name).sort()).toEqual(['Civic Owners', 'Rainier Builders']);
    expect(oregon.items.find((c) => c.key === 'c1')?.projects).toBe(1);
    expect((await listCompanies({ minValue: 10_000_000 }, db)).items.map((c) => c.name).sort()).toEqual(['Civic Owners', 'Rainier Builders']);
    expect((await listCompanies({ updatedFrom: '2026-05-15' }, db)).items.map((c) => c.name).sort()).toEqual(['Rainier Builders', 'Studio North']);
  });

  it('searches company, contact, email, phone and project title', async () => {
    expect((await listCompanies({ q: 'cedar' }, db)).items.map((c) => c.name)).toEqual(['Rainier Builders']);
    expect((await listCompanies({ q: 'bo@north' }, db)).items.map((c) => c.name)).toEqual(['Studio North']);
    expect((await listCompanies({ q: 'diaz' }, db)).items.map((c) => c.name)).toEqual(['Civic Owners']);
    expect((await listCompanies({ q: '2065551234' }, db)).items.map((c) => c.name)).toEqual(['Rainier Builders']);
  });

  it('can keep only companies someone can phone or email', async () => {
    const reachable = await listCompanies({ reachable: true }, db);
    expect(reachable.items.map((c) => c.name).sort()).toEqual(['Civic Owners', 'Rainier Builders', 'Studio North']);
  });

  it('sorts', async () => {
    expect((await listCompanies({ sort: 'projects_desc' }, db)).items[0].name).toBe('Rainier Builders');
    expect((await listCompanies({ sort: 'name_asc' }, db)).items.map((c) => c.name)).toEqual(['Civic Owners', 'No Id Co', 'Rainier Builders', 'Studio North']);
    expect((await listCompanies({ sort: 'value_desc' }, db)).items[0].name).toBe('Rainier Builders');
  });

  it('pages', async () => {
    const page = await listCompanies({ limit: 2, offset: 2 }, db);
    expect(page.items.length).toBe(2);
    expect(page.total).toBe(4);
  });

  it('details a company: every project with its roles, every person, and an empty history', async () => {
    const c = await getCompany('c1', db);
    expect(c?.projectList.map((p) => p.title)).toEqual(['Alder Lofts', 'Birch Court', 'Cedar Place']);
    expect(c?.projectList[2].roles).toEqual(['Owner']);
    expect(c?.people[0]).toMatchObject({ firstName: 'Ann', lastName: 'Lee', projects: 2 });
    expect(c?.history).toEqual([]);
    expect(await getCompany('nobody', db)).toBeUndefined();
    expect(await getCompany('c4', db)).toBeUndefined();   // an engineer is not part of the list
  });

  it('keeps a status, who has it and a note on the company, in its history', async () => {
    const took = await updateCompany('c1', { assignedTo: 'Sam', assignedToId: 'u1' }, 'Sam', db);
    expect(took).toMatchObject({ assignedTo: 'Sam', assignedToId: 'u1', status: 'new' });
    const done = await updateCompany('c1', { status: 'contacted', note: 'Left a voicemail' }, 'Sam', db);
    expect(done).toMatchObject({ status: 'contacted', note: 'Left a voicemail', statusBy: 'Sam' });
    expect(done?.history.map((h) => h.event ?? h.status)).toEqual(['Took this lead', 'contacted']);
    const released = await updateCompany('c1', { assignedTo: '' }, 'Sam', db);
    expect(released?.history.at(-1)?.event).toBe('Released from Sam');
    expect(await updateCompany('nobody', { status: 'samples' }, 'Sam', db)).toBeUndefined();
  });

  it('filters and counts by the company’s own status and assignee', async () => {
    await updateCompany('c2', { status: 'samples', assignedTo: 'Pat', assignedToId: 'u2' }, 'Pat', db);
    const contacted = await listCompanies({ status: 'contacted' }, db);
    expect(contacted.items.map((c) => c.name)).toEqual(['Rainier Builders']);
    expect(contacted.counts).toMatchObject({ contacted: 1, samples: 1, new: 2 });
    expect((await listCompanies({ assignedTo: 'Pat' }, db)).items.map((c) => c.name)).toEqual(['Studio North']);
    expect((await listCompanies({ assignedTo: 'none' }, db)).items.length).toBe(3);
  });

  it('keeps its work when an import replaces the projects’ companies', async () => {
    await importProjects({ projects: [project('1', { title: 'Alder Lofts' })], fileName: 'g.xlsx', by: 'krish' }, db);
    const c = await getCompany('c1', db);
    expect(c?.status).toBe('contacted');
    expect(c?.note).toBe('Left a voicemail');
  });
});
