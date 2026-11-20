import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import type { LeadProject, LeadCompany } from '../../utils/projectLeads.ts';
import { importProjects, listLeads, leadMeta, getLead, updateLead } from './index.ts';

const co = (over: Partial<LeadCompany> = {}): LeadCompany => ({
  companyId: '1', name: 'Acme Owners', role: 'Owner', group: 'owner', address: '', city: '', state: '', zip: '',
  firstName: 'Ann', lastName: 'Lee', phone: '2065551234', email: 'ann@acme.test', ...over
});
const project = (id: string, over: Partial<LeadProject> = {}): LeadProject => ({
  id, title: `Project ${id}`, value: 5_000_000, stage: 'Post Bid', subcategory: 'Apartments', bidDate: '', listedOn: '2026-01-01',
  updatedOn: '2026-06-01', address: '1 Main St', city: 'Seattle', county: 'King', state: 'Washington', zip: '98101',
  floors: 3, floorArea: 60000, floorAreaUnit: 'Square Feet', siteArea: null, siteAreaUnit: '', stageNote: '', units: 40, ownerType: 'Private',
  companies: [co(), co({ companyId: '2', name: 'Eng Co', role: 'Civil Engineer', group: 'other', phone: '', email: '' })], ...over
});

describe('project leads data layer', () => {
  let client: PGlite, db: Db;
  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrateDb(db, 'pglite:memory');
  }, 60_000);
  afterAll(async () => { await client?.close(); });

  it('adds projects with their companies, owners first', async () => {
    const done = await importProjects({
      projects: [
        project('1001', { companies: [co({ companyId: '2', name: 'Eng Co', role: 'Civil Engineer', group: 'other' }), co()] }),
        project('1002', { title: 'Oregon Lofts', state: 'Oregon', city: 'Portland', value: 20_000_000, updatedOn: '2026-03-01', companies: [co({ name: 'Builder Bob', group: 'contractor', phone: '', email: '' })] }),
        project('1003', { title: 'Old Court', state: 'Texas', city: 'Austin', value: null, updatedOn: '2013-01-01', companies: [] })
      ], fileName: 'f.xlsx', by: 'krish'
    }, db);
    expect(done).toMatchObject({ projects: 3, companies: 3, added: 3, updated: 0 });
    const one = await getLead('1001', db);
    expect(one?.companies.map(c => c.name)).toEqual(['Acme Owners', 'Eng Co']);
    expect(one).toMatchObject({ status: 'new', value: 5_000_000, floors: 3, updatedOn: '2026-06-01', units: 40 });
  });

  it('lists newest-updated first and filters by state, value, date, text and contactability', async () => {
    const all = await listLeads({}, db);
    expect(all.items.map(i => i.id)).toEqual(['1001', '1002', '1003']);
    expect(all.total).toBe(3);
    expect(all.counts).toEqual({ new: 3 });
    expect((await listLeads({ states: ['Oregon'] }, db)).items.map(i => i.id)).toEqual(['1002']);
    expect((await listLeads({ minValue: 10_000_000 }, db)).items.map(i => i.id)).toEqual(['1002']);
    expect((await listLeads({ updatedFrom: '2026-01-01' }, db)).total).toBe(2);
    expect((await listLeads({ q: 'lofts' }, db)).items.map(i => i.id)).toEqual(['1002']);
    expect((await listLeads({ q: 'builder bob' }, db)).items.map(i => i.id)).toEqual(['1002']);
    expect((await listLeads({ q: 'ann@acme' }, db)).items.map(i => i.id)).toEqual(['1001']);
    expect((await listLeads({ q: '100%' }, db)).total).toBe(0);
    // 1002's only company has no phone or email, 1003 has none at all.
    expect((await listLeads({ reachable: true }, db)).items.map(i => i.id)).toEqual(['1001']);
    expect((await listLeads({ sort: 'value_desc' }, db)).items.map(i => i.id)).toEqual(['1002', '1001', '1003']);
    expect((await listLeads({ limit: 1, offset: 1 }, db)).items.map(i => i.id)).toEqual(['1002']);
  });

  it('keeps a status and its history, counts per status, and filters by status and assignee', async () => {
    const saved = await updateLead('1001', { status: 'contacted', note: 'Left a voicemail', assignedTo: 'Krish' }, 'Krish', db);
    expect(saved).toMatchObject({ status: 'contacted', note: 'Left a voicemail', assignedTo: 'Krish', statusBy: 'Krish' });
    expect(saved?.history).toHaveLength(1);
    expect(saved?.history[0]).toMatchObject({ by: 'Krish', status: 'contacted', note: 'Left a voicemail' });
    // Assigning alone is not a history line.
    expect((await updateLead('1001', { assignedTo: 'Sam' }, 'Krish', db))?.history).toHaveLength(1);
    expect((await updateLead('1001', { status: 'samples' }, 'Sam', db))?.history).toHaveLength(2);
    const c = await listLeads({ status: 'samples' }, db);
    expect(c.items.map(i => i.id)).toEqual(['1001']);
    expect(c.counts).toEqual({ samples: 1, new: 2 });   // counts ignore the status filter itself
    expect((await listLeads({ assignedTo: 'Sam' }, db)).total).toBe(1);
    expect((await listLeads({ assignedTo: 'none' }, db)).total).toBe(2);
    expect(await updateLead('nope', { status: 'new' }, 'x', db)).toBeUndefined();
  });

  it('a re-import refreshes the file’s fields and companies but never what staff added', async () => {
    const done = await importProjects({
      projects: [project('1001', { title: 'Renamed', stage: 'Construction Underway', companies: [co({ name: 'New Owner' })] }), project('1004')],
      fileName: 'g.xlsx', by: 'krish'
    }, db);
    expect(done).toMatchObject({ projects: 2, added: 1, updated: 1 });
    const one = await getLead('1001', db);
    expect(one).toMatchObject({ title: 'Renamed', stage: 'Construction Underway', status: 'samples', assignedTo: 'Sam', note: 'Left a voicemail' });
    expect(one?.history).toHaveLength(2);
    expect(one?.companies.map(c => c.name)).toEqual(['New Owner']);
    expect((await listLeads({}, db)).total).toBe(4);   // 1002 and 1003 weren't in this file and stay
  });

  it('says what the filters offer', async () => {
    const m = await leadMeta(db);
    expect(m.total).toBe(4);
    expect(m.states.map(s => s.name)).toEqual(['Oregon', 'Texas', 'Washington']);
    expect(m.cities.Oregon).toEqual(['Portland']);
    expect(m.assignees).toEqual(['Sam']);
    expect(m.lastImport).toMatchObject({ fileName: 'g.xlsx', added: 1, updated: 1 });
  });
});
