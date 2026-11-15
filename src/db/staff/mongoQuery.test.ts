import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { matches, selectFields, sortDocs, applyUpdate } from './mongoQuery.ts';

const dee = { _id: 'a'.repeat(24), username: 'dee', role: 'sales_rep', isActive: true, assignedLocations: ['Seattle', 'Kent'], email: 'Dee@x.com', password: 'h', calendarFeedKey: 'k' };
const gone = { _id: 'b'.repeat(24), username: 'gone', role: 'admin', isActive: false, assignedLocations: ['*'] };

describe('matches', () => {
  it('handles the filters the screens use', () => {
    expect(matches(dee, {})).toBe(true);
    expect(matches(dee, { username: 'dee' })).toBe(true);
    expect(matches(dee, { role: { $in: ['admin', 'sales_rep'] } })).toBe(true);
    expect(matches(gone, { isActive: { $ne: false } })).toBe(false);
    expect(matches(dee, { assignedLocations: 'Kent' })).toBe(true);
    expect(matches(dee, { assignedLocations: { $ne: '*' } })).toBe(true);
    expect(matches(dee, { email: /^dee@x\.com$/i })).toBe(true);
    expect(matches(dee, { $or: [{ username: 'nope' }, { email: 'Dee@x.com' }] })).toBe(true);
    expect(matches(dee, { calendarFeedKey: null })).toBe(false);
    expect(matches(gone, { calendarFeedKey: null })).toBe(true);
    expect(matches(gone, { assignedLocations: { $exists: false } })).toBe(false);
  });
  it('compares ObjectIds with the string ids Postgres holds', () => {
    const oid = new mongoose.Types.ObjectId(dee._id);
    expect(matches(dee, { _id: oid })).toBe(true);
    expect(matches(dee, { _id: { $in: [oid] } })).toBe(true);
    expect(matches(dee, { _id: { $ne: oid } })).toBe(false);
  });
});

describe('selectFields', () => {
  it('keeps only the named fields, and _id', () => {
    expect(selectFields(dee, 'username role')).toEqual({ _id: dee._id, username: 'dee', role: 'sales_rep' });
  });
  it('hides secrets unless asked, and drops what a minus names', () => {
    expect(selectFields(dee, undefined, ['calendarFeedKey']).calendarFeedKey).toBeUndefined();
    expect(selectFields(dee, '+calendarFeedKey', ['calendarFeedKey']).calendarFeedKey).toBe('k');
    expect(selectFields(dee, '-password').password).toBeUndefined();
    expect(selectFields(dee, 'username +calendarFeedKey', ['calendarFeedKey'])).toEqual({ _id: dee._id, username: 'dee', calendarFeedKey: 'k' });
  });
});

describe('sortDocs and applyUpdate', () => {
  it('sorts by several keys, newest first on a date', () => {
    const rows = [{ n: 'b', d: new Date(1) }, { n: 'a', d: new Date(2) }, { n: 'a', d: new Date(3) }];
    expect(sortDocs(rows, { n: 1, d: -1 }).map(r => r.d.getTime())).toEqual([3, 2, 1]);
  });
  it('sets, unsets and increments on a copy', () => {
    const out = applyUpdate({ a: 1, b: 2, n: 1 }, { $set: { a: 9 }, $unset: { b: 1 }, $inc: { n: 2 } });
    expect(out).toEqual({ a: 9, n: 3 });
  });
});
