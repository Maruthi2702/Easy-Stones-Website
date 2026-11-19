import { describe, it, expect } from 'vitest';
import { importDay, visitTypeFor, looseName, customerMatcher, planActivityImport, importVisitId } from './activityImport.ts';

const customers = [
  { id: 'c1', company: 'To Go Construction LLC', phone: '470-478-6301' },
  { id: 'c2', company: 'Reyes Countertops', phone: '404-759-3644' },
  { id: 'c3', company: 'Reyes Cabinet & Granite', phone: '478-415-4333' },
  { id: 'c4', company: 'Blue Sky Marble and Granite', phone: '' }
];
const staff = [{ id: 'u1', name: 'Cristina' }, { id: 'u2', name: 'Felicia Turner' }];
const visitTypes = ['Scheduled in Person Sales Meeting', 'Important Remote Meeting/Call', 'Quick Note', 'Personal Time Off'];
const row = (o: Record<string, string>) => ({ User: 'Cristina Cousins', Date: '08/25/2026', Tag: 'Activity without tags', Account: 'Reyes Countertops', 'Main Phone': '', Type: 'Daily Route', Description: 'Went by', ...o });

describe('importDay', () => {
  it('reads both date styles and refuses non-days', () => {
    expect(importDay('08/25/2026')).toBe('2026-08-25');
    expect(importDay('Nov 6, 2026 | 7:00 PM - 7:45 PM')).toBe('2026-11-06');
    expect(importDay('02/30/2026')).toBeNull();
    expect(importDay('')).toBeNull();
  });
});

describe('visitTypeFor', () => {
  it('uses the tag first, then the type for untagged rows', () => {
    expect(visitTypeFor(row({ Tag: 'Price Request', Type: 'Phone' }))).toBe('Quick Note');
    expect(visitTypeFor(row({ Type: 'Phone' }))).toBe('Important Remote Meeting/Call');
    expect(visitTypeFor(row({ Type: 'Email' }))).toBe('Important Remote Meeting/Call');
    expect(visitTypeFor(row({ Type: 'Daily Route' }))).toBe('Scheduled in Person Sales Meeting');
    expect(visitTypeFor(row({ Tag: '#vaction' }))).toBe('Personal Time Off');
    expect(visitTypeFor(row({ Tag: '#Home address' }))).toBe('Scheduled in Person Sales Meeting');
    expect(visitTypeFor(row({ Tag: 'Something new' }))).toBeNull();
  });
});

describe('customer matching', () => {
  const m = customerMatcher(customers);
  it('exact name wins; look-alikes and phones only ask', () => {
    expect(m.find('reyes countertops')).toEqual({ kind: 'exact', id: 'c2' });
    expect(m.find('To Go Construction')).toMatchObject({ kind: 'confirm', id: 'c1', how: 'name-ignoring-llc' });
    expect(m.find('Blue Sky Marble & Granite')).toMatchObject({ kind: 'confirm', id: 'c4' });
    expect(m.find('Someone else', '(478) 415-4333')).toMatchObject({ kind: 'confirm', id: 'c3', how: 'phone' });
    expect(m.find('Nobody')).toEqual({ kind: 'none' });
  });
  it('looseName ignores LLC and punctuation', () => {
    expect(looseName('B&M Stone, Inc')).toBe(looseName('b and m stone'));
  });
});

describe('planActivityImport', () => {
  const plan = planActivityImport({
    rows: [
      row({}),
      row({}),                                             // exact repeat
      row({ Account: 'To Go Construction', Type: 'Phone' }), // needs confirming
      row({ Account: 'Atlanta Office', Tag: '#vacation', Type: 'Note' }),
      row({ User: 'Nobody Here' }),
      row({ Account: 'Reyes Countertops', Type: 'Phone', Description: '"Call\r\nback "' })
    ],
    customers, staff, visitTypes
  });
  it('plans the real visits with the rep as the logger and the Description as Notes', () => {
    expect(plan.planned).toHaveLength(2);
    const v = plan.planned[1].visit;
    expect(v).toMatchObject({ purpose: 'Important Remote Meeting/Call', notes: 'Call\nback', createdBy: 'u1', createdByName: 'Cristina', date: '2026-08-25' });
    expect(v._id).toMatch(/^[0-9a-f]{24}$/);
  });
  it('skips with a reason and never guesses', () => {
    expect(plan.repeats).toBe(1);
    expect(plan.toConfirm.map((c) => c.account)).toEqual(['To Go Construction']);
    expect(plan.unknownUsers).toEqual({ 'Nobody Here': 1 });
    expect(plan.skipped.map((s) => s.reason)).toEqual(expect.arrayContaining([
      'Not a customer (Atlanta Office)', 'No staff login for "Nobody Here"'
    ]));
  });
  it('gives the same row the same id every run, and a confirmed customer goes in', () => {
    expect(importVisitId('Cristina', '2026-08-25', 'Reyes Countertops', 'Went by')).toBe(plan.planned[0].visit._id);
    const again = planActivityImport({ rows: [row({ Account: 'To Go Construction' })], customers, staff, visitTypes, confirmed: { 'to go construction': 'c1' } });
    expect(again.planned[0].customerId).toBe('c1');
  });
});
