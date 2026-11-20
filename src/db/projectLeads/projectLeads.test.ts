import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import type { LeadProject, LeadCompany } from '../../utils/projectLeads.ts';
import { importProjects, listLeads, leadMeta, getLead, updateLead, previewImport, undoImport } from './index.ts';

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
    expect(saved?.history).toHaveLength(2);   // the status + note, and "Took this lead"
    expect(saved?.history[0]).toMatchObject({ by: 'Krish', status: 'contacted', note: 'Left a voicemail' });
    expect(saved?.history[1]).toMatchObject({ by: 'Krish', event: 'Took this lead' });
    // Every take and release is a line, with the assignee's id kept beside the name.
    const moved = await updateLead('1001', { assignedTo: 'Sam', assignedToId: 'u-sam' }, 'Krish', db);
    expect(moved).toMatchObject({ assignedTo: 'Sam', assignedToId: 'u-sam' });
    expect(moved?.history).toHaveLength(3);
    expect((await updateLead('1001', { status: 'samples' }, 'Sam', db))?.history).toHaveLength(4);
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
    expect(one?.history).toHaveLength(4);
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

describe('preview and undo', () => {
  let client: PGlite, db: Db;
  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrateDb(db, 'pglite:memory');
  }, 60_000);
  afterAll(async () => { await client?.close(); });

  it('previews what would be added, changed, left the same and dropped, and writes nothing', async () => {
    const first = await importProjects({ projects: [project('1'), project('2', { title: 'Two' }), project('3', { title: 'Three' })], fileName: 'a.xlsx', by: 'k' }, db);
    const p = await previewImport([
      project('1'),                                                           // the same
      project('2', { title: 'Two', stage: 'Construction Underway', companies: [co({ name: 'New Owner' })] }),   // changed, contact swapped
      project('9', { title: 'Nine' })                                         // new
    ], db);
    expect(p).toMatchObject({ projects: 3, added: 1, refreshed: 1, unchanged: 1, notInFile: 1, older: 0, contactsRemoved: 1, contactsAdded: 2 });   // Eng Co dropped from 2; the new owner has the old owner's id, role and contact, so it's the same contact renamed; 9 brings 2
    expect(p.samples).toEqual([{ id: '2', title: 'Two', changes: [{ label: 'Stage', from: 'Post Bid', to: 'Construction Underway' }] }]);
    expect((await listLeads({}, db)).total).toBe(3);                          // nothing written
    expect(first.added).toBe(3);
  });

  it('notices a file that is older than what is stored', async () => {
    const p = await previewImport([project('1', { updatedOn: '2020-01-01' }), project('2', { title: 'Two', updatedOn: '2020-01-01' })], db);
    expect(p.older).toBe(2);
  });

  it('undoes the latest import: refreshed projects go back, added ones go unless they were worked', async () => {
    await updateLead('2', { status: 'contacted' }, 'k', db);
    const imp = await importProjects({
      projects: [project('1', { title: 'One renamed', companies: [co({ name: 'Other Owner' })] }), project('7', { title: 'Seven' }), project('8', { title: 'Eight' })],
      fileName: 'b.xlsx', by: 'k'
    }, db);
    await updateLead('8', { note: 'called them' }, 'k', db);                  // worked since the import
    expect((await getLead('1', db))?.title).toBe('One renamed');
    const done = await undoImport(imp.importId, 'k', db);
    expect(done).toEqual({ restored: 1, removed: 1, kept: 1 });
    expect(await getLead('7', db)).toBeUndefined();
    expect((await getLead('8', db))?.note).toBe('called them');
    const one = await getLead('1', db);
    expect(one?.title).toBe('Project 1');
    expect(one?.companies.map(c => c.name)).toEqual(['Acme Owners', 'Eng Co']);
    expect((await getLead('2', db))?.status).toBe('contacted');              // staff's work untouched throughout
    // Once only, and never an older import.
    expect(await undoImport(imp.importId, 'k', db)).toBeUndefined();
    expect((await leadMeta(db)).lastImport).toMatchObject({ canUndo: false, undone: true });
  });

  it('only the latest import can be undone', async () => {
    const a = await importProjects({ projects: [project('20')], fileName: 'c.xlsx', by: 'k' }, db);
    const b = await importProjects({ projects: [project('21')], fileName: 'd.xlsx', by: 'k' }, db);
    expect(await undoImport(a.importId, 'k', db)).toBeUndefined();
    expect(await undoImport(b.importId, 'k', db)).toMatchObject({ removed: 1 });
  });
});

describe('releasing a lead', () => {
  let client: PGlite, db: Db;
  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrateDb(db, 'pglite:memory');
    await importProjects({ projects: [project('1')], fileName: 'a.xlsx', by: 'k' }, db);
  }, 60_000);
  afterAll(async () => { await client?.close(); });

  it('clears the assignee and its id, and says who released it from whom', async () => {
    await updateLead('1', { assignedTo: 'Sam', assignedToId: 'u-sam' }, 'Sam', db);
    const out = await updateLead('1', { assignedTo: '' }, 'Max', db);
    expect(out).toMatchObject({ assignedTo: '', assignedToId: '' });
    expect(out?.history.map(h => [h.by, h.event])).toEqual([['Sam', 'Took this lead'], ['Max', 'Released from Sam']]);
  });
});
