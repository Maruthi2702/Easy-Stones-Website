// The Visit Types / Resource Types routes and their first-start seed
// (src/routes/typeLists.ts, src/services/seedTypeLists.ts), on an in-memory MongoDB.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { NextFunction, Request, Response } from 'express';
import type { Loose } from '../types/records.ts';

const { default: createTypeListRouter } = await import('./typeLists.ts');
const { default: VisitType } = await import('../models/VisitType.ts');
const { default: ResourceType } = await import('../models/ResourceType.ts');
const { default: Customer } = await import('../models/Customer.ts');
const { default: Schedule } = await import('../models/Schedule.ts');
const { seedTypeLists } = await import('../services/seedTypeLists.ts');
const { countVisitTypeUses, countResourceTypeUses, replaceVisitType, replaceResourceType } = await import('../services/typeReplacement.ts');

let mongo: MongoMemoryReplSet;
let app: express.Express;
const ACTIONS = (p: string) => ({ add: `add_${p}`, edit: `edit_${p}`, reorder: `reorder_${p}`, delete: `delete_${p}` });
const ALL = ['add', 'edit', 'reorder', 'delete'].flatMap((a) => [`${a}_visit_types`, `${a}_resource_types`]);
const send = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, body?: Loose, permissions: string[] = ALL) =>
  request(app)[method](url).set('x-test-user', JSON.stringify({ _id: 'u1', username: 'amy', permissions })).send(body);

beforeAll(async () => {
  // A replica set: a delete that moves records runs in a transaction.
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([Customer.createCollection(), Schedule.createCollection(), VisitType.createCollection(), ResourceType.createCollection()]);
  app = express();
  app.use(express.json());
  type TestRequest = Request & { user?: Loose; userId?: string };
  const authenticate = (req: TestRequest, _res: Response, next: NextFunction) => { req.user = JSON.parse(String(req.headers['x-test-user'] || '{}')); req.userId = req.user?._id; next(); };
  const requireAction = (key: string) => (req: TestRequest, res: Response, next: NextFunction) => ((req.user?.permissions || []).includes(key) ? next() : void res.status(403).json({}));
  app.use('/api/visit-types', createTypeListRouter({
    kind: 'visit', Model: VisitType, actions: ACTIONS('visit_types'), authenticate, requireAction,
    countUses: countVisitTypeUses, replaceUses: replaceVisitType
  }));
  app.use('/api/resource-types', createTypeListRouter({
    kind: 'resource', Model: ResourceType, actions: ACTIONS('resource_types'), authenticate, requireAction,
    countUses: countResourceTypeUses, replaceUses: replaceResourceType
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await Customer.deleteMany({});
  await Schedule.deleteMany({});
  await VisitType.deleteMany({});
  await ResourceType.deleteMany({});
  await seedTypeLists();
});

const list = async (path: string): Promise<Loose[]> => (await send('get', path)).body.types;

describe('first-start seed', () => {
  it('fills both lists once, in the old order, and never overwrites a manager’s changes', async () => {
    const visits = await list('/api/visit-types');
    expect(visits).toHaveLength(10);
    expect(visits[0]).toMatchObject({ name: 'Quick Note', label: 'Quick note', system: true, fields: { followUp: 'none', outcome: false } });
    expect(visits[1].fields).toEqual({ notes: false, outcome: false, followUp: 'always' });
    const resources = await list('/api/resource-types');
    expect(resources).toHaveLength(16);
    expect(resources.find((t: Loose) => t.name === '2025V3 Moda Tower')?.family).toBe('tower');
    expect(resources.find((t: Loose) => t.name === 'Moda Sample Binder SouthV1 12')?.family).toBe('binder');

    await send('put', `/api/visit-types/${visits[0]._id}`, { label: 'Quick note!' });
    await seedTypeLists();
    expect((await list('/api/visit-types'))[0].label).toBe('Quick note!');
    expect(await list('/api/visit-types')).toHaveLength(10);
  });

  it('adds names old records already carry as hidden types', async () => {
    await VisitType.deleteMany({});
    await ResourceType.deleteMany({});
    await Customer.create({
      contactName: 'Sam', company: 'Sam Homes', email: 'sam@x.com',
      visits: [{ date: '2026-01-01', purpose: 'Chat', createdBy: 'u1' }, { date: '2026-01-02', purpose: 'Resource Placement: Moda Tower', createdBy: 'u1' }],
      resources: [{ title: 'Old rack', resourceType: 'Old rack', date: '2026-01-01' }]
    });
    await seedTypeLists();
    const visits = await list('/api/visit-types');
    expect(visits.find((t: Loose) => t.name === 'Chat')).toMatchObject({ active: false, system: false });
    expect(visits.find((t: Loose) => t.name.startsWith('Resource Placement:'))).toBeUndefined();
    expect((await list('/api/resource-types')).find((t: Loose) => t.name === 'Old rack')).toMatchObject({ active: false, family: 'other' });
  });
});

describe('add', () => {
  it('adds at the bottom with the name as its stored value, and refuses a repeat', async () => {
    const res = await send('post', '/api/resource-types', { label: 'Radianz Tower 2026', family: 'tower' });
    expect(res.status).toBe(201);
    expect(res.body.type).toMatchObject({ name: 'Radianz Tower 2026', family: 'tower', active: true, order: 16 });
    const again = await send('post', '/api/resource-types', { label: 'radianz tower 2026' });
    expect(again.status).toBe(400);
  });

  it('a visit type takes the fields it uses', async () => {
    const res = await send('post', '/api/visit-types', { label: 'Site walk', fields: { notes: true, outcome: false, followUp: 'none' } });
    expect(res.body.type.fields).toEqual({ notes: true, outcome: false, followUp: 'none' });
  });

  it('needs the Add action', async () => {
    expect((await send('post', '/api/visit-types', { label: 'X' }, ['edit_visit_types'])).status).toBe(403);
    expect((await send('post', '/api/visit-types', { label: 'X' }, ['add_resource_types'])).status).toBe(403);
  });
});

describe('edit', () => {
  it('renames the label but never the stored name; hides and shows', async () => {
    const [first] = await list('/api/visit-types');
    const res = await send('put', `/api/visit-types/${first._id}`, { label: 'Note', active: false });
    expect(res.body.type).toMatchObject({ name: 'Quick Note', label: 'Note', active: false });
    expect((await send('put', `/api/visit-types/${first._id}`, { label: 'Follow-up notes' })).status).toBe(400);
  });

  it('keeping the same label is fine', async () => {
    const [first] = await list('/api/visit-types');
    expect((await send('put', `/api/visit-types/${first._id}`, { label: first.label, active: true })).status).toBe(200);
  });

  it('404 for an unknown id, and needs the Edit action', async () => {
    expect((await send('put', `/api/visit-types/${new mongoose.Types.ObjectId()}`, { active: false })).status).toBe(404);
    expect((await send('put', '/api/visit-types/nope', { active: false })).status).toBe(404);
    const [first] = await list('/api/visit-types');
    expect((await send('put', `/api/visit-types/${first._id}`, { active: false }, ['add_visit_types'])).status).toBe(403);
  });
});

describe('reorder', () => {
  it('saves the whole list in the order sent, and everyone reads it', async () => {
    const types = await list('/api/resource-types');
    const ids = types.map((t: Loose) => t._id);
    const moved = [ids[5], ...ids.slice(0, 5), ...ids.slice(6)];
    const res = await send('patch', '/api/resource-types/reorder', { ids: moved });
    expect(res.status).toBe(200);
    expect(res.body.types.map((t: Loose) => t._id)).toEqual(moved);
    expect((await list('/api/resource-types')).map((t: Loose) => t._id)).toEqual(moved);
  });

  it('refuses a list missing a type or repeating one', async () => {
    const ids = (await list('/api/resource-types')).map((t: Loose) => t._id);
    expect((await send('patch', '/api/resource-types/reorder', { ids: ids.slice(1) })).status).toBe(400);
    expect((await send('patch', '/api/resource-types/reorder', { ids: [ids[0], ...ids.slice(0, -1)] })).status).toBe(400);
  });

  it('needs the Reorder action', async () => {
    expect((await send('patch', '/api/visit-types/reorder', { ids: [] }, ['edit_visit_types'])).status).toBe(403);
  });
});

describe('delete', () => {
  it('deletes a type nothing uses', async () => {
    const { body } = await send('post', '/api/resource-types', { label: 'Temp rack' });
    expect((await send('delete', `/api/resource-types/${body.type._id}`)).status).toBe(200);
    expect((await list('/api/resource-types')).some((t: Loose) => t.name === 'Temp rack')).toBe(false);
  });

  it('keeps a type a resource uses unless a type to move them to is chosen', async () => {
    const { body } = await send('post', '/api/resource-types', { label: 'Used rack' });
    await Customer.create({ contactName: 'Sam', company: 'Sam Homes', email: 'sam@x.com', resources: [{ title: 'Used rack', resourceType: 'Used rack' }, { title: 'Used rack', resourceType: 'Used rack' }] });
    expect((await send('get', `/api/resource-types/${body.type._id}/uses`)).body).toEqual({ uses: 2 });
    const res = await send('delete', `/api/resource-types/${body.type._id}`);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ uses: 2 });
    expect(res.body.message).toMatch(/2 resources use/);
    expect((await list('/api/resource-types')).some((t: Loose) => t.name === 'Used rack')).toBe(true);
  });

  it('the count needs the Delete action', async () => {
    const { body } = await send('post', '/api/resource-types', { label: 'Counted rack' });
    expect((await send('get', `/api/resource-types/${body.type._id}/uses`, undefined, ['add_resource_types'])).status).toBe(403);
  });

  it('moves every resource to the chosen type, with its title, placement visit and calendar entry, then deletes', async () => {
    const old = (await send('post', '/api/resource-types', { label: 'Tower v2' })).body.type;
    const keep = (await send('post', '/api/resource-types', { label: 'Tower v3' })).body.type;
    const [linkedVisit, legacyVisit, otherVisit] = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    const [linked, legacy, renamed, other] = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    const author = new mongoose.Types.ObjectId();
    const customer = await Customer.create({
      contactName: 'Sam', company: 'Sam Homes', email: 'sam@x.com',
      resources: [
        { _id: linked, title: 'Tower v2', resourceType: 'Tower v2', date: '2026-01-14', visitId: linkedVisit, uploadedBy: author },
        // Older: no links, matched to its visit by title, day and author.
        { _id: legacy, title: 'Tower v2', resourceType: 'Tower v2', date: '2026-02-01', uploadedBy: author },
        { _id: renamed, title: 'Front window tower', resourceType: 'Tower v2', date: '2026-03-01' },
        { _id: other, title: 'Binder', resourceType: 'Binder', date: '2026-01-14', visitId: otherVisit }
      ],
      visits: [
        { _id: linkedVisit, resourceId: linked, date: '2026-01-14', purpose: 'Resource Placement: Tower v2', notes: 'Added resource: Tower v2', createdBy: author },
        { _id: legacyVisit, date: '2026-02-01', purpose: 'Resource Placement: Tower v2', notes: 'Dropped it at the front', createdBy: author },
        { _id: otherVisit, resourceId: other, date: '2026-01-14', purpose: 'Resource Placement: Binder' }
      ]
    });
    await Schedule.create([
      { userId: author, customerId: customer._id, startTime: '2026-01-14T12:00:00.000', linkedVisitId: linkedVisit, notes: 'Resource Placement: Tower v2' },
      { userId: author, customerId: customer._id, startTime: '2026-02-01T12:00:00.000', linkedVisitId: legacyVisit, notes: 'Bring the brochure' }
    ]);

    const res = await send('delete', `/api/resource-types/${old._id}`, { replaceWith: keep._id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, moved: 3, movedTo: 'Tower v3' });
    expect((await list('/api/resource-types')).some((t: Loose) => t.name === 'Tower v2')).toBe(false);

    const after = (await Customer.findById(customer._id).lean()) as Loose;
    const resource = (id: unknown) => after.resources.find((r: Loose) => String(r._id) === String(id));
    const visit = (id: unknown) => after.visits.find((v: Loose) => String(v._id) === String(id));
    expect(resource(linked)).toMatchObject({ resourceType: 'Tower v3', title: 'Tower v3' });
    expect(resource(legacy)).toMatchObject({ resourceType: 'Tower v3', title: 'Tower v3' });
    // A title someone typed stays.
    expect(resource(renamed)).toMatchObject({ resourceType: 'Tower v3', title: 'Front window tower' });
    expect(resource(other)).toMatchObject({ resourceType: 'Binder', title: 'Binder' });
    expect(visit(linkedVisit)).toMatchObject({ purpose: 'Resource Placement: Tower v3', notes: 'Added resource: Tower v3' });
    expect(visit(legacyVisit)).toMatchObject({ purpose: 'Resource Placement: Tower v3', notes: 'Dropped it at the front' });
    // The older pair is linked now, so the next change finds it by id.
    expect(String(resource(legacy).visitId)).toBe(String(legacyVisit));
    expect(String(visit(legacyVisit).resourceId)).toBe(String(legacy));
    expect(visit(otherVisit).purpose).toBe('Resource Placement: Binder');
    expect((await Schedule.findOne({ linkedVisitId: linkedVisit }).lean())!.notes).toBe('Resource Placement: Tower v3');
    expect((await Schedule.findOne({ linkedVisitId: legacyVisit }).lean())!.notes).toBe('Bring the brochure');
  });

  it('changes nothing when an older resource matches two placement visits', async () => {
    const old = (await send('post', '/api/resource-types', { label: 'Twin rack' })).body.type;
    const keep = (await send('post', '/api/resource-types', { label: 'Single rack' })).body.type;
    await Customer.create({
      contactName: 'Sam', company: 'Sam Homes', email: 'sam@x.com',
      resources: [{ title: 'Twin rack', resourceType: 'Twin rack', date: '2026-02-01' }],
      visits: [
        { date: '2026-02-01', purpose: 'Resource Placement: Twin rack', notes: 'one' },
        { date: '2026-02-01', purpose: 'Resource Placement: Twin rack', notes: 'two' }
      ]
    });
    const res = await send('delete', `/api/resource-types/${old._id}`, { replaceWith: keep._id });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/nothing was saved/);
    expect((await list('/api/resource-types')).some((t: Loose) => t.name === 'Twin rack')).toBe(true);
    const after = (await Customer.findOne({ company: 'Sam Homes' }).lean()) as Loose;
    expect(after.resources[0].resourceType).toBe('Twin rack');
    expect(after.visits.map((v: Loose) => v.purpose)).toEqual(['Resource Placement: Twin rack', 'Resource Placement: Twin rack']);
  });

  it('refuses to move them to itself, a hidden type or one that isn’t there', async () => {
    const old = (await send('post', '/api/resource-types', { label: 'Moving rack' })).body.type;
    const hidden = (await send('post', '/api/resource-types', { label: 'Hidden rack' })).body.type;
    await send('put', `/api/resource-types/${hidden._id}`, { active: false });
    await Customer.create({ contactName: 'Sam', company: 'Sam Homes', email: 'sam@x.com', resources: [{ title: 'Moving rack', resourceType: 'Moving rack' }] });
    for (const replaceWith of [old._id, hidden._id, String(new mongoose.Types.ObjectId()), 'nope']) {
      const res = await send('delete', `/api/resource-types/${old._id}`, { replaceWith });
      expect(res.status).toBe(400);
    }
    expect((await Customer.findOne({ company: 'Sam Homes' }).lean() as Loose).resources[0].resourceType).toBe('Moving rack');
  });

  it('moves visits to the chosen visit type, with their calendar entries, then deletes', async () => {
    const old = (await send('post', '/api/visit-types', { label: 'Lunch and learn' })).body.type;
    const [keep] = await list('/api/visit-types');
    const visitId = new mongoose.Types.ObjectId();
    const customer = await Customer.create({
      contactName: 'Sam', company: 'Sam Homes', email: 'sam@x.com',
      visits: [{ _id: visitId, date: '2026-02-01', purpose: 'Lunch and learn' }, { date: '2026-02-02', purpose: keep.name }]
    });
    await Schedule.create({ userId: new mongoose.Types.ObjectId(), customerId: customer._id, startTime: '2026-02-01T12:00:00.000', linkedVisitId: visitId, notes: 'Lunch and learn' });
    expect((await send('get', `/api/visit-types/${old._id}/uses`)).body).toEqual({ uses: 1 });
    const res = await send('delete', `/api/visit-types/${old._id}`, { replaceWith: keep._id });
    expect(res.body).toMatchObject({ ok: true, moved: 1 });
    const after = (await Customer.findById(customer._id).lean()) as Loose;
    expect(after.visits.map((v: Loose) => v.purpose)).toEqual([keep.name, keep.name]);
    expect((await Schedule.findOne({ linkedVisitId: visitId }).lean())!.notes).toBe(keep.name);
  });

  it('never deletes a built-in visit type', async () => {
    const [first] = await list('/api/visit-types');
    expect((await send('delete', `/api/visit-types/${first._id}`)).status).toBe(409);
  });
});
