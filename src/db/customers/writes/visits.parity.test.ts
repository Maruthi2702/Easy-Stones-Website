/**
 * Visit saves (add, edit, follow-up, reaction) leave MongoDB and Postgres the same
 * (writeParity.ts): each runs on both, answers the same, tells the same calendar events
 * and afterwards every table equals the copy of MongoDB.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import Customer from '../../../models/Customer.ts';
import Schedule from '../../../models/Schedule.ts';
import VisitType from '../../../models/VisitType.ts';
import * as data from '../index.ts';
import { normalize } from '../parity.ts';
import { newId } from '../../ids.ts';
import { followUpUpdate } from '../../../utils/followUpList.ts';
import { visitFieldsFor } from '../../../utils/visitForm.ts';
import { openWriteParity, type WriteParity } from './writeParity.ts';
import type { ScheduleEvent } from './visits.types.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const oid = () => new mongoose.Types.ObjectId();
const seattle = oid(), rep = oid(), other = oid();
const acme = newId(), plain = newId(), fan = newId();
const planned = newId();
const NOW = '2026-11-10T09:30:00.000';
const now = () => NOW;
const SALES_CALL = 'Unscheduled in Person Sales Call';
let t: WriteParity;

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertOne({ _id: seattle, name: 'Seattle' });
    await db.collection('roles').insertOne({ _id: oid(), name: 'sales_rep', permissions: [] });
    await db.collection('users').insertMany([
      { _id: rep, username: 'jo', displayName: 'Jo', password: 'x', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle'] },
      { _id: other, username: 'al', displayName: 'Al', password: 'x', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle'] }
    ]);
    await VisitType.insertMany([
      { name: SALES_CALL, label: 'Sales call', order: 1, system: true },
      { name: 'Quick Note', label: 'Quick note', order: 2, system: true, fields: { notes: true, outcome: false, followUp: 'none' } },
      { name: 'Trade Show', label: 'Trade show', order: 3, active: false }
    ]);
    await Customer.insertMany([
      {
        _id: acme, company: 'Acme Stone', contactName: 'Ann', email: 'ann@acme.example', location: 'Seattle', salesRep: rep,
        visits: [
          {
            _id: newId(), date: '2026-11-01', purpose: SALES_CALL, notes: 'First', followUp: 'call back', followUpDate: '2026-11-12',
            createdBy: String(rep), createdByName: 'Jo', createdAt: '2026-11-01T10:00:00.000', image: ['https://cdn.example/old.webp'],
            followUpHistory: [{ action: 'snooze', at: '2026-11-02T08:00:00.000', on: '2026-11-02', by: String(rep), byName: 'Jo', from: '2026-11-05', to: '2026-11-12' }]
          },
          { _id: newId(), date: '2026-01-01', purpose: 'Old Type', notes: 'Legacy', createdBy: String(other), createdByName: 'Al', createdAt: '2026-01-01T10:00:00.000' }
        ]
      },
      { _id: plain, contactName: 'Pat', email: 'pat@plain.example', location: 'Seattle' },
      { _id: fan, contactName: 'Fan', email: 'fan@site.example', location: 'Seattle' }
    ]);
    // The rep planned a visit to Acme for the 12th.
    await Schedule.create({
      _id: planned, userId: rep, customerId: acme, startTime: '2026-11-12T14:00:00.000', endTime: '2026-11-12T14:30:00.000',
      activityType: 'Visit', status: 'Scheduled', source: 'manual'
    });
  });
  expect(await t.differences()).toEqual([]);
}, 60_000);

afterAll(async () => { await t?.close(); });

/** A save's answer with the calendar events it tells (run after answering, as the route does). */
async function settle(r: unknown) {
  const events: ScheduleEvent[] = [];
  const { afterAnswer, ...rest } = (r ?? {}) as { afterAnswer?: (e: (ev: ScheduleEvent) => void) => Promise<void> };
  await afterAnswer?.(e => events.push(e));
  return { ...rest, events };
}

/** What the route builds and hands the save. Ids are made once so both databases get the same. */
function addInput(over: Record<string, unknown> = {}, o: { customerId?: string; userId?: string | null } = {}) {
  const _id = (over._id as string) ?? newId();
  return {
    customerId: o.customerId ?? acme,
    visit: {
      _id, date: '2026-11-10', purpose: SALES_CALL, notes: 'hi', outcome: '', followUp: '', followUpDate: '',
      image: undefined, createdBy: String(rep), createdByName: 'Jo', customerContactName: 'Acme Stone', createdAt: NOW, ...over
    },
    calendar: { userId: o.userId === undefined ? String(rep) : o.userId, dropInId: newId() },
    log: { id: newId(), performedBy: String(rep), performedByName: 'Jo', performedByRole: 'admin', details: { purpose: over.purpose ?? SALES_CALL, date: over.date ?? '2026-11-10' } },
    now
  };
}

async function sameThing<T>(run: () => Promise<T>) {
  const { mongo, postgres } = await t.both(run);
  expect(normalize(postgres)).toEqual(normalize(mongo));
  expect(await t.differences()).toEqual([]);
  return { mongo, postgres };
}

describe('visit types', () => {
  it.each([SALES_CALL, 'Quick Note', 'Trade Show', 'Nope'])('%s: the same rules and visibility', async name => {
    const { mongo, postgres } = await t.both(async () => {
      const type = await data.visitTypeNamed(name);
      return type && { active: type.active, fields: visitFieldsFor(type) };
    });
    expect(normalize(postgres)).toEqual(normalize(mongo));
  });
});

describe('add a visit', () => {
  it('a plain one, with a drop-in added to the logger\'s calendar', async () => {
    const input = addInput();
    const { mongo } = await sameThing(async () => {
      const saved = await settle(await data.addVisit(input));
      return { saved, stored: await data.savedVisit(acme, input.visit._id) };
    });
    expect(mongo.saved.kind).toBe('saved');
    expect(mongo.saved.events).toHaveLength(1);
  });

  it('completes the logger\'s own planned entry that day instead of adding one', async () => {
    const input = addInput({ date: '2026-11-12', followUp: 'call', followUpDate: '2026-11-20', image: ['https://cdn.example/a.webp', 'https://cdn.example/b.pdf'] });
    const { mongo } = await sameThing(async () => ({
      saved: await settle(await data.addVisit(input)), stored: await data.savedVisit(acme, input.visit._id)
    }));
    expect(mongo.saved.events.map(e => e.id)).toEqual([planned]);
    // Put the plan back for the cases after this one.
    await Schedule.updateOne({ _id: planned }, { status: 'Scheduled', $unset: { linkedVisitId: '' } });
    await t.resync();
  });

  it('a later day gets a drop-in at noon; a missing note', async () => {
    const input = addInput({ date: '2026-11-25', image: ['https://cdn.example/one.webp'], notes: undefined });
    await sameThing(async () => ({ saved: await settle(await data.addVisit(input)), stored: await data.savedVisit(acme, input.visit._id) }));
  });

  it('a retried request (same _id) answers with the saved visit and adds nothing', async () => {
    const input = addInput({ notes: 'once' });
    const { mongo } = await sameThing(async () => {
      const first = await settle(await data.addVisit(input));
      const again = await settle(await data.addVisit({ ...input, calendar: { ...input.calendar, dropInId: newId() }, log: { ...input.log, id: newId() } }));
      return { first, again };
    });
    expect(mongo.again.kind).toBe('alreadySaved');
  });

  it('a customer login logged it: no calendar entry', async () => {
    const input = addInput({ createdBy: fan, createdByName: 'Fan' }, { userId: null });
    const { mongo } = await sameThing(async () => ({
      saved: await settle(await data.addVisit(input)), stored: await data.savedVisit(acme, input.visit._id)
    }));
    expect(mongo.saved.events).toEqual([]);
  });

  it('a logger who is neither a user nor a customer is kept as text only on MongoDB: blanked, as the copy does', async () => {
    const input = addInput({ createdBy: 'u1' }, { userId: 'u1' });
    await sameThing(async () => ({ saved: await settle(await data.addVisit(input)) }));
  });

  it('no such customer: not found, nothing written', async () => {
    const input = addInput({}, { customerId: newId() });
    const { mongo } = await sameThing(async () => settle(await data.addVisit(input)));
    expect(mongo.kind).toBe('notFound');
  });

  it('a hidden type\'s visit and a Quick note with its follow-up already cleaned', async () => {
    const input = addInput({ purpose: 'Quick Note', followUp: '', followUpDate: '' });
    await sameThing(async () => ({ saved: await settle(await data.addVisit(input)) }));
  });
});

describe('edit a visit', () => {
  const firstVisit = async () => (await Customer.findById(acme).lean())!.visits[0];
  const second = async () => (await Customer.findById(acme).lean())!.visits[1];

  const edit = async (id: string, set: Record<string, unknown>, over: { userId?: unknown; purpose?: unknown } = {}) => {
    const before = (await data.savedVisit(acme, id))!;
    return settle(await data.editVisit({
      customerId: acme, visitId: id, before, set: { ...set, updatedBy: String(other), updatedByName: 'Al', updatedAt: NOW },
      calendar: { userId: over.userId ?? before.createdBy, purpose: over.purpose ?? before.purpose, dropInId: pick() },
      log: { id: pick(), performedBy: String(other), performedByName: 'Al', performedByRole: 'admin', details: { fields: Object.keys(set) } },
      now
    }));
  };
  // Ids are made before a run, and each run starts again from the first, so both databases get the same ones.
  let cursor = 0;
  const pick = () => ids[cursor++];
  let ids: string[] = [];
  const twice = <T>(run: () => Promise<T>) => {
    ids = Array.from({ length: 20 }, () => newId());
    return sameThing(async () => { cursor = 0; return run(); });
  };

  it('notes, photos replaced and a legacy type kept', async () => {
    const id = String((await second())._id);
    await twice(async () => ({
      edit: await edit(id, { notes: 'changed', purpose: 'Old Type', image: ['https://cdn.example/x.webp'] }),
      stored: await data.savedVisit(acme, id)
    }));
  });

  it('a follow-up changed, then cleared (a type with none)', async () => {
    const id = String((await firstVisit())._id);
    await twice(async () => ({
      a: await edit(id, { followUp: 'send quote', followUpDate: '2026-12-01', outcome: 'good' }),
      b: await edit(id, { followUp: '', followUpDate: '', purpose: 'Quick Note' }),
      stored: await data.savedVisit(acme, id)
    }));
  });

  it('an edit with nothing to set only logs', async () => {
    const id = String((await second())._id);
    await twice(async () => ({ edit: await edit(id, {}), stored: await data.savedVisit(acme, id) }));
  });

  it('a visit with a planned entry, moved to another day: the entry goes back to Scheduled and a drop-in follows', async () => {
    const added = addInput({ date: '2026-11-12', notes: 'to move' });
    const id = added.visit._id;
    await twice(async () => ({
      added: await settle(await data.addVisit(added)),
      moved: await edit(id, { date: '2026-11-14' }),
      stored: await data.savedVisit(acme, id)
    }));
    await Schedule.updateOne({ _id: planned }, { status: 'Scheduled', $unset: { linkedVisitId: '' } });
    await t.resync();
  });

  it('a drop-in visit moved keeps its time of day, then moves again', async () => {
    const added = addInput({ date: '2026-11-10', notes: 'drop in' });
    const id = added.visit._id;
    const { mongo } = await twice(async () => ({
      added: await settle(await data.addVisit(added)),
      moved: await edit(id, { date: '2026-11-18' }),
      again: await edit(id, { date: '2026-11-19' }),
      stored: await data.savedVisit(acme, id)
    }));
    expect(mongo.moved.events.map(e => e.type)).toEqual(['delete', 'upsert']);
  });

  it('no such visit: null from both, nothing changed', async () => {
    const { mongo } = await twice(async () => {
      const before = (await data.savedVisit(acme, String((await firstVisit())._id)))!;
      return data.editVisit({
        customerId: acme, visitId: newId(), before, set: { notes: 'x' }, calendar: { userId: null, purpose: '', dropInId: newId() },
        log: { id: newId(), performedBy: 'x', performedByName: 'x' }, now
      });
    });
    expect(mongo).toBeNull();
  });
});

describe('follow-up', () => {
  /** What the route does: read, ask followUpUpdate what to write, save. */
  const patch = async (id: string, body: Record<string, unknown>, logId: string) => {
    const before = await data.savedVisit(acme, id);
    const ctx = { now: NOW, today: '2026-11-10', userId: String(rep), userName: 'Jo' };
    const update = followUpUpdate(before as never, body, ctx);
    if (!update.ok) return { refused: update.status };
    const saved = await data.setFollowUp({
      customerId: acme, visitId: id, set: update.set as Record<string, string>, event: update.event as Record<string, string> | undefined,
      log: { id: logId, performedBy: String(rep), performedByName: 'Jo', performedByRole: 'admin', details: { followUp: body.action }, timestamp: NOW }
    });
    return saved && { visit: saved.visit, ...(await settle(saved)) };
  };

  it('done with what happened, a note after, reopened, then snoozed twice: every line kept in order', async () => {
    const added = addInput({ date: '2026-11-05', followUp: 'call back', followUpDate: '2026-11-12' });
    const id = added.visit._id;
    const logs = [newId(), newId(), newId(), newId(), newId()];
    const { mongo } = await sameThing(async () => ({
      added: await settle(await data.addVisit(added)),
      done: await patch(id, { action: 'done', outcome: 'Sent the quote' }, logs[0]),
      note: await patch(id, { action: 'note', outcome: 'And called' }, logs[1]),
      reopen: await patch(id, { action: 'reopen' }, logs[2]),
      snooze1: await patch(id, { action: 'snooze', until: '2026-11-20' }, logs[3]),
      snooze2: await patch(id, { action: 'snooze', until: '2026-12-02' }, logs[4])
    }));
    const history = (mongo.snooze2 as { visit: { followUpHistory: { action: string }[] } }).visit.followUpHistory;
    expect(history.map(h => h.action)).toEqual(['done', 'reopen', 'snooze', 'snooze']);
  });

  it('refusals (no follow-up, bad day, unknown action) write nothing', async () => {
    const added = addInput({ date: '2026-11-05', followUp: 'call back', followUpDate: '2026-11-12' });
    const id = added.visit._id;
    await sameThing(async () => settle(await data.addVisit(added)));
    const plainId = String((await Customer.findById(acme).lean())!.visits[1]._id);
    const { mongo } = await sameThing(async () => ({
      none: await patch(plainId, { action: 'done' }, newId()),
      past: await patch(id, { action: 'snooze', until: '2026-10-01' }, newId()),
      unknown: await patch(id, { action: 'archive' }, newId()),
      early: await patch(id, { action: 'note', outcome: 'x' }, newId())
    }));
    expect(mongo.none).toEqual({ refused: 400 });
  });

  it('no such visit: null from both', async () => {
    const { mongo } = await sameThing(async () => data.setFollowUp({
      customerId: acme, visitId: newId(), set: { followUpOutcome: 'x' },
      log: { id: newId(), performedBy: 'x', performedByName: 'x', timestamp: NOW }
    }));
    expect(mongo).toBeNull();
  });
});

describe('reactions', () => {
  const vid = async () => String((await Customer.findById(acme).lean())!.visits[0]._id);
  const react = (id: string, type: unknown, who: string, name: string, rid: string) =>
    data.toggleReaction({ customerId: acme, visitId: id, type, userId: who, userName: name, reactionId: rid, createdAt: NOW });

  it('added, replaced by another type, a second person, taken off — each answer the same', async () => {
    const id = await vid();
    const ids = [newId(), newId(), newId(), newId()];
    const { mongo } = await sameThing(async () => ({
      like: await react(id, 'like', String(rep), 'Jo', ids[0]),
      love: await react(id, 'love', String(rep), 'Jo', ids[1]),
      theirs: await react(id, 'like', String(other), 'Al', ids[2]),
      off: await react(id, 'love', String(rep), 'Jo', ids[3])
    }));
    expect((mongo.off as { reactions: unknown[] }).reactions).toHaveLength(1);
  });

  it('a customer reacting on the website', async () => {
    const id = await vid();
    const rid = newId();
    await sameThing(async () => react(id, 'like', fan, 'Fan', rid));
  });

  it('no such visit / customer', async () => {
    const a = await sameThing(async () => react(newId(), 'like', String(rep), 'Jo', newId()));
    expect(a.mongo).toEqual({ kind: 'noVisit' });
    const b = await sameThing(async () => data.toggleReaction({ customerId: newId(), visitId: newId(), type: 'like', userId: String(rep), userName: 'Jo', reactionId: newId(), createdAt: NOW }));
    expect(b.mongo).toEqual({ kind: 'noCustomer' });
  });

  it('a reaction with no type is refused by both', async () => {
    const id = await vid();
    await expect(t.on('mongo', () => react(id, '', String(other), 'Al', newId()))).rejects.toThrow();
    await expect(t.on('postgres', () => react(id, '', String(other), 'Al', newId()))).rejects.toThrow();
    expect(await t.differences()).toEqual([]);
  });
});
