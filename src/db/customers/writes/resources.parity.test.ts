/**
 * Resource saves leave MongoDB and Postgres the same (writeParity.ts): add, edit, move,
 * delete, a visit's delete with its resource, and a type's records moved to another
 * type. Each save runs on both, answers the same and leaves every table equal to the
 * copy of MongoDB. The cases are the awkward ones: Qty, Active vs Archived, towers vs
 * binders, the earlier count, moves between customers, unlinked (legacy) resources and
 * the ambiguous match that changes nothing, permissions, and type replacement.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import Customer from '../../../models/Customer.ts';
import Schedule from '../../../models/Schedule.ts';
import ActivityLog from '../../../models/ActivityLog.ts';
import ResourceType from '../../../models/ResourceType.ts';
import ResourceFamily from '../../../models/ResourceFamily.ts';
import * as data from '../index.ts';
import { normalize } from '../parity.ts';
import { newId } from '../../ids.ts';
import { openWriteParity, type WriteParity } from './writeParity.ts';

const oid = () => new mongoose.Types.ObjectId();
const seattle = oid(), rep = oid(), other = oid();
const acme = newId(), dest = newId(), amb = newId(), blank = newId();
const [r1, r2, r3, rLegacy] = [newId(), newId(), newId(), newId()];
const [v1, v2, v3, vLegacy] = [newId(), newId(), newId(), newId()];
const [a1, a2, av1, av2] = [newId(), newId(), newId(), newId()];
const repId = String(rep), otherId = String(other);
const owner = { id: repId, permissions: ['edit_own_visits', 'delete_own_visits'] };
const manager = { id: otherId, permissions: ['edit_branch_visits', 'delete_branch_visits'] };
const stranger = { id: otherId, permissions: ['edit_own_visits', 'delete_own_visits'] };
const everyone = { id: otherId, permissions: ['edit_all_visits', 'delete_all_visits'] };
const performer = { id: repId, name: 'Jo Rep' };
const now = () => '2026-11-10T09:30:00.000';
let t: WriteParity;

// Each case runs a save twice and compares every table; a busy machine needs room.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

/** What a save answered, or how it refused (the route's status and words). */
const settle = <T>(run: () => Promise<T>) => run().then(
  ok => ({ ok }),
  (e: Error & { status?: number }) => ({ refused: { status: e.status ?? 500, message: e.status ? e.message : 'error' } })
);

/** Both databases, same answer, same data. The type list itself is MongoDB's, so Postgres's copy of it is ignored. */
async function same<T>(run: () => Promise<T>, { typesStay = false } = {}) {
  const { mongo, postgres } = await t.both(() => settle(run));
  expect(normalize(postgres)).toEqual(normalize(mongo));
  const diffs = (await t.differences()).filter(d => !(typesStay && d.startsWith('resource_types')));
  expect(diffs).toEqual([]);
  return mongo;
}

const inTransaction = <T>(run: (session: mongoose.ClientSession) => Promise<T>) => mongoose.connection.transaction(run);

const add = (over: Record<string, unknown> = {}, customerId = acme, scheduleUserId: string | null = repId) => {
  const fields = { title: 'Binder', resourceType: 'Binder', date: '2026-11-10', qty: 1, notes: 'Dropped off', ...over };
  // Made once, so both databases get the same ids.
  const ids = { resourceId: newId(), visitId: newId(), dropInId: newId() };
  return () => data.addResource({ customerId, fields, performer, scheduleUserId, now, ids });
};
const edit = (resourceId: string, fields: Record<string, unknown>, actor = owner, team: unknown = new Set([repId]), customerId = acme) =>
  { const dropInId = newId(); return () => data.updateResource({ customerId, resourceId, fields, actor, team, dropInId }); };
const remove = (resourceId: string, actor = owner, team: unknown = new Set([repId]), customerId = acme) =>
  () => data.deleteResource({ customerId, resourceId, actor, team });
const removeVisit = (visitId: string, actor = owner, team: unknown = new Set([repId]), customerId = acme) => {
  const logId = newId();
  return async () => {
  const events: unknown[] = [];
  const result = await data.deleteVisitWithResource({
    customerId, visitId, actor, team: async () => team, performer, performedByRole: 'admin', logId
  });
  if (result.outcome === 'deleted') await result.after(event => { events.push(event); });
  return { outcome: result.outcome, events };
  };
};

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertOne({ _id: seattle, name: 'Seattle' });
    await db.collection('roles').insertOne({ _id: oid(), name: 'sales_rep', permissions: [] });
    await db.collection('users').insertMany([
      { _id: rep, username: 'jo', displayName: 'Jo Rep', password: 'x', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle'] },
      { _id: other, username: 'sam', displayName: 'Sam', password: 'x', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle'] }
    ]);
    await ResourceFamily.insertMany(['tower', 'binder', 'tabletop', 'samples', 'other'].map((name, order) => ({ name, label: name, order, system: true })));
    await ResourceType.insertMany([
      { name: 'Tower', label: 'Tower', order: 0, family: 'tower' }, { name: 'Tower B', label: 'Tower B', order: 1, family: 'tower' },
      { name: 'Binder', label: 'Binder', order: 2, family: 'binder' }, { name: 'Binder B', label: 'Binder B', order: 3, family: 'binder' },
      { name: 'Tabletop', label: 'Tabletop', order: 4, family: 'tabletop' }, { name: 'Samples', label: 'Samples', order: 5, family: 'samples' }
    ]);
    await Promise.all([Customer.createCollection(), Schedule.createCollection(), ActivityLog.createCollection()]);
    const visit = (id: string, date: string, purpose: string, extra: Record<string, unknown> = {}) => ({
      _id: id, date, purpose, notes: `Added resource: ${purpose}`, createdBy: repId, createdByName: 'Jo Rep',
      createdAt: `${date}T09:00:00.000`, image: ['https://files.example/v.jpg'], ...extra
    });
    await Customer.insertMany([
      {
        _id: acme, company: 'Acme Stone', contactName: 'Ann', email: 'ann@acme.example', location: 'Seattle',
        // Typed before resources existed: 3 binders, no earlier count yet.
        modaDisplay: 'No', modaBinder: '3',
        visits: [
          visit(v1, '2026-10-20', 'Resource Placement: Binder', { resourceId: r1 }),
          visit(v2, '2026-10-21', 'Resource Placement: Tower', { resourceId: r2 }),
          visit(v3, '2026-10-22', 'Resource Placement: Binder', { resourceId: r3 }),
          visit(newId(), '2026-10-23', 'Customer Visit', { resourceId: null }),
          visit(vLegacy, '2026-10-01', 'Resource Placement: Tabletop')
        ],
        resources: [
          { _id: r1, visitId: v1, title: 'Binder', resourceType: 'Binder', qty: 2, status: 'Active', date: '2026-10-20', uploadedBy: repId, createdAt: '2026-10-20T09:00:00.000', image: ['https://files.example/r1.jpg'], notes: 'First' },
          { _id: r2, visitId: v2, title: 'Tower', resourceType: 'Tower', status: 'Active', date: '2026-10-21', uploadedBy: repId, createdAt: '2026-10-21T09:00:00.000' },
          { _id: r3, visitId: v3, title: 'Binder', resourceType: 'Binder', qty: 4, status: 'Archived', date: '2026-10-22', uploadedBy: repId, createdAt: '2026-10-22T09:00:00.000' },
          { _id: rLegacy, title: 'Tabletop', resourceType: 'Tabletop', status: 'Active', date: '2026-10-01', uploadedBy: repId, createdAt: '2026-10-01T09:00:00.000', notes: 'Legacy' }
        ]
      },
      { _id: dest, company: 'Dest Granite', contactName: 'Lee', email: 'lee@dest.example', location: 'Seattle', modaDisplay: 'Yes', modaBinder: '1', modaEarlier: { display: true, binders: 1 } },
      {
        // Two older resources and two placement visits that can't be told apart.
        _id: amb, company: 'Ambiguous Co', contactName: 'Amy', email: 'amy@amb.example', location: 'Seattle',
        visits: [visit(av1, '2026-09-01', 'Resource Placement: Samples', { createdAt: '2026-09-01T09:00:00.000' }), visit(av2, '2026-09-01', 'Resource Placement: Samples', { createdAt: '2026-09-01T09:05:00.000' })],
        resources: [
          { _id: a1, title: 'Samples', resourceType: 'Samples', status: 'Active', date: '2026-09-01', uploadedBy: repId, notes: 'Added resource: Samples' },
          { _id: a2, title: 'Samples', resourceType: 'Samples', status: 'Active', date: '2026-09-01', uploadedBy: repId, notes: 'Added resource: Samples' }
        ]
      },
      { _id: blank, contactName: 'Pat', email: 'pat@plain.example', location: 'Seattle' }
    ]);
    // Calendar: a planned stop for acme on the 10th, a drop-in and a completed planned stop on its placements.
    await Schedule.create([
      { userId: rep, customerId: acme, startTime: '2026-11-10T14:00:00.000', endTime: '2026-11-10T14:30:00.000', status: 'Scheduled', activityType: 'Visit', source: 'manual' },
      { userId: rep, customerId: acme, startTime: '2026-10-20T11:15:00.000', endTime: '2026-10-20T11:45:00.000', status: 'Completed', activityType: 'Drop-off', notes: 'Resource Placement: Binder', linkedVisitId: v1, source: 'visit_log' },
      { userId: other, customerId: acme, startTime: '2026-10-21T10:00:00.000', endTime: '2026-10-21T10:30:00.000', status: 'Completed', activityType: 'Visit', notes: 'Resource Placement: Tower', linkedVisitId: v2, source: 'manual' }
    ]);
  });
  expect(await t.differences()).toEqual([]);
}, 120_000);

afterAll(async () => { await t?.close(); }, 60_000);

describe('add a resource', () => {
  it('a binder with a Qty: the placement visit, a drop-in on the calendar and the binder count', async () => {
    const done = await same(add({ qty: 5, image: ['https://files.example/new.jpg'] }));
    expect(done).toHaveProperty('ok.resource.qty', 5);
  });

  it('a tower turns Display on; the earlier count (3 binders typed) stays', async () => {
    await same(add({ title: 'Tower', resourceType: 'Tower' }));
  });

  it('a type that counts nowhere, with a description for the visit note and a one-string photo', async () => {
    await same(add({ title: 'Tabletop', resourceType: 'Tabletop', notes: undefined, description: 'On the counter', image: 'https://files.example/one.jpg' }));
  });

  it('the logger has a planned stop that day: it is completed instead of a drop-in', async () => {
    await same(add({ date: '2026-11-10', title: 'Binder B', resourceType: 'Binder B' }));
  });

  it('a later day, nobody to put it on the calendar for, and a customer with nothing yet', async () => {
    await same(add({ date: '2026-11-20', qty: 999 }, blank, null));
  });

  it('a customer that is not there: 404 from both; a garbage id: refused by both', async () => {
    const gone = await same(add({}, newId()));
    expect(gone).toHaveProperty('refused.status', 404);
    const garbage = await same(add({}, 'nope'));
    expect(garbage).toHaveProperty('refused.status', 500);
  });
});

describe('edit a resource', () => {
  it('a note only: the same day, its calendar entry just announced; the resource goes last', async () => {
    await same(edit(r1, { notes: 'Edited note' }));
  });

  it('a new day: the drop-in moves to it and keeps its time of day', async () => {
    await same(edit(r1, { date: '2026-10-25' }));
  });

  it('Qty and a photo list; the visit takes the photos', async () => {
    await same(edit(r1, { qty: 7, image: ['https://files.example/a.jpg', 'https://files.example/b.jpg'] }));
  });

  it('Archived stops counting; back to Active counts again', async () => {
    await same(edit(r1, { status: 'Archived' }));
    await same(edit(r1, { status: 'Active' }));
  });

  it('a binder becomes a tower: the title follows, Display turns on, binders drop', async () => {
    await same(edit(r3, { resourceType: 'Tower B', title: 'Tower B', status: 'Active' }));
  });

  it('a resource with no Qty and no photos', async () => {
    await same(edit(r2, { notes: 'Tower note' }));
  });

  it('an older resource with no link is matched to its visit and linked', async () => {
    await same(edit(rLegacy, { notes: 'Linked now', date: '2026-10-02' }));
  });

  it('a move to another customer recounts both and moves the visit and calendar entry', async () => {
    await same(edit(r1, { notes: 'Moved' }, owner, new Set([repId]), dest));
  });

  it('a move to a customer that is not there: 404', async () => {
    expect(await same(edit(r3, {}, owner, new Set([repId]), newId()))).toHaveProperty('refused.status', 404);
  });

  it('no such resource: 404; a garbage id is refused', async () => {
    expect(await same(edit(newId(), { notes: 'x' }))).toHaveProperty('refused.status', 404);
    await same(edit('nope', { notes: 'x' }));
  });

  it('someone else\'s resource: 403 for a person with only their own; fine with the branch (team) or all', async () => {
    expect(await same(edit(r2, { notes: 'No' }, stranger, new Set([otherId])))).toHaveProperty('refused.status', 403);
    expect(await same(edit(r2, { notes: 'Team' }, manager, new Set([repId, otherId])))).toHaveProperty('ok');
    expect(await same(edit(r2, { notes: 'All' }, everyone, new Set()))).toHaveProperty('ok');
    // A manager whose team does not include the owner.
    expect(await same(edit(r2, { notes: 'Not my team' }, manager, new Set([otherId])))).toHaveProperty('refused.status', 403);
  });

  it('two placements that match: 409 and nothing changes', async () => {
    expect(await same(edit(a1, { notes: 'x' }, owner, new Set([repId]), amb))).toHaveProperty('refused.status', 409);
  });
});

describe('delete a resource', () => {
  it('takes its placement visit and calendar entry, and the count follows', async () => {
    const created = await same(add({ qty: 2 }));
    const id = String((created as { ok: { resource: { _id: string } } }).ok.resource._id);
    await same(remove(id));
  });

  it('a legacy resource finds its visit by what they say', async () => {
    await same(remove(rLegacy));
  });

  it('someone else\'s: 403; no such resource: 404; a garbage resource id 404, garbage customer id refused', async () => {
    expect(await same(remove(r2, stranger, new Set([otherId])))).toHaveProperty('refused.status', 403);
    expect(await same(remove(newId()))).toHaveProperty('refused.status', 404);
    expect(await same(remove('nope'))).toHaveProperty('refused.status', 404);
    expect(await same(remove(r2, owner, new Set([repId]), 'nope'))).toHaveProperty('refused.status', 500);
  });

  it('two placements that match: 409 and nothing changes', async () => {
    expect(await same(remove(a2, owner, new Set([repId]), amb))).toHaveProperty('refused.status', 409);
  });

  it('a resource on the customer it moved to', async () => {
    await same(remove(r1, owner, new Set([repId]), dest));
  });
});

describe('delete a visit', () => {
  it('a placement visit takes its resource, recounts, comes off the calendar and is logged', async () => {
    const created = await same(add({ qty: 3, date: '2026-11-11' }));
    const visitId = String((created as { ok: { visit: { _id: string } } }).ok.visit._id);
    await same(removeVisit(visitId));
  });

  it('a plain visit: only itself, no recount', async () => {
    const plain = (await Customer.findById(acme).lean())!.visits.find(v => v.purpose === 'Customer Visit')!;
    await same(removeVisit(String(plain._id)));
  });

  it('a visit that is not there is logged and nothing else; a customer that is not there is 404', async () => {
    expect(await same(removeVisit(newId()))).toHaveProperty('ok.outcome', 'deleted');
    expect(await same(removeVisit(v2, owner, new Set([repId]), newId()))).toHaveProperty('ok.outcome', 'no-customer');
  });

  it('refused for someone else\'s visit, or when the linked resource is someone else\'s', async () => {
    expect(await same(removeVisit(v2, stranger, new Set([otherId])))).toHaveProperty('ok.outcome', 'forbidden-visit');
  });

  it('two placements that match: 409 and nothing changes', async () => {
    expect(await same(removeVisit(av1, owner, new Set([repId]), amb))).toHaveProperty('refused.status', 409);
  });
});

describe('a type\'s records move to another type', () => {
  const resetFamilies = (name: string, family: string) => ResourceType.updateOne({ name }, { $set: { family } });

  it('visit type: the visits and their calendar entries', async () => {
    await same(() => inTransaction(s => data.replaceVisitType('Customer Visit', 'Showroom Visit', s)));
    await same(() => data.countVisitTypeUses('Showroom Visit'));
  });

  it('resource type: title, placement visit, its notes and calendar entry; a legacy placement gets its links', async () => {
    await t.on('mongo', () => add({ title: 'Tower B', resourceType: 'Tower B' })());
    await t.resync();
    await same(() => data.countResourceTypeUses('Tower B'));
    await same(() => inTransaction(s => data.replaceResourceType('Tower B', 'Binder B', s)));
  });

  it('a move between families recounts Display and Binders', async () => {
    await same(() => inTransaction(s => data.replaceResourceType('Tower', 'Binder B', s)));
  });

  it('two placements that match: 409 and nothing changes', async () => {
    expect(await same(() => inTransaction(s => data.replaceResourceType('Samples', 'Tabletop', s)))).toHaveProperty('refused.status', 409);
  });

  it('a family change recounts the customers that hold the type, and only when it matters', async () => {
    await same(() => inTransaction(s => data.recountForFamilyChange('Binder B', 'binder', 'tower', s)));
    await same(() => inTransaction(s => data.recountForFamilyChange('Binder B', 'binder', 'tabletop', s)));
    await same(() => inTransaction(s => data.recountForFamilyChange('Tabletop', 'tabletop', 'samples', s)));
  });

  it('deleting a family moves its types, recounting each in turn', async () => {
    await same(async () => {
      await resetFamilies('Binder B', 'binder');
      await resetFamilies('Binder', 'binder');
      return inTransaction(s => data.replaceFamily('binder', 'tower', s));
    }, { typesStay: true });
  });
});
