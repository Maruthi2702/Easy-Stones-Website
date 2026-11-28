import { describe, it, expect } from 'vitest';
import { cleanSpokenVisit, nextQuestion, spokenIsEmpty, spokenVisitPrompt, spokenVisitSchema, weekdayOf, type SpokenType } from './assistantVisit.ts';

const FULL = { notes: true, outcome: true, followUp: 'optional' as const };
const types: SpokenType[] = [
  { name: 'Quick Note', label: 'Quick note', active: true, fields: { notes: true, outcome: false, followUp: 'none' } },
  { name: 'Follow up Notes', label: 'Follow-up notes', active: true, fields: { notes: false, outcome: false, followUp: 'always' } },
  { name: 'Formal Presentation', label: 'Formal presentation', active: true, fields: FULL },
  { name: 'Old Type', label: 'Old type', active: false, fields: FULL }
];
const today = '2026-11-27'; // a Friday

describe('weekdayOf', () => {
  it('names the day', () => expect(weekdayOf('2026-11-27')).toBe('Friday'));
  it('is blank for nonsense', () => expect(weekdayOf('nope')).toBe(''));
});

describe('the schema and prompt', () => {
  it('offer only visit types that are still shown', () => {
    const names = (spokenVisitSchema(types).properties.visitType as { enum: string[] }).enum;
    expect(names).toEqual(['Quick Note', 'Follow up Notes', 'Formal Presentation', '']);
    expect(spokenVisitPrompt(types, today)).not.toContain('Old Type');
  });
  it('tell Claude today\'s weekday so "Friday" resolves', () => {
    expect(spokenVisitPrompt(types, today)).toContain('Friday 2026-11-27');
  });
});

describe('cleanSpokenVisit', () => {
  const good = { customerQuery: ' Smith  Granite ', cityHint: 'Kent', visitType: 'Formal Presentation', visitDate: '2026-11-26', notes: 'Dropped samples.', outcome: '', followUp: 'Send quote', followUpDate: '2026-12-04' };
  it('keeps a good answer, tidying spaces', () => {
    expect(cleanSpokenVisit(good, { types, today })).toEqual({ ...good, customerQuery: 'Smith Granite' });
  });
  it('blanks a type that is not on the shown list', () => {
    expect(cleanSpokenVisit({ ...good, visitType: 'Old Type' }, { types, today }).visitType).toBe('');
    expect(cleanSpokenVisit({ ...good, visitType: 'Made Up' }, { types, today }).visitType).toBe('');
  });
  it('blanks dates that are not real days, and visits in the future or long ago', () => {
    expect(cleanSpokenVisit({ ...good, visitDate: '2026-02-31' }, { types, today }).visitDate).toBe('');
    expect(cleanSpokenVisit({ ...good, visitDate: '2026-11-28' }, { types, today }).visitDate).toBe('');
    expect(cleanSpokenVisit({ ...good, visitDate: '2026-10-01' }, { types, today }).visitDate).toBe('');
    expect(cleanSpokenVisit({ ...good, visitDate: today }, { types, today }).visitDate).toBe(today);
  });
  it('blanks a follow-up that is already past or over a year out', () => {
    expect(cleanSpokenVisit({ ...good, followUpDate: '2026-11-20' }, { types, today }).followUpDate).toBe('');
    expect(cleanSpokenVisit({ ...good, followUpDate: '2028-01-01' }, { types, today }).followUpDate).toBe('');
    expect(cleanSpokenVisit({ ...good, followUpDate: today }, { types, today }).followUpDate).toBe(today);
  });
  it('turns garbage into blanks', () => {
    expect(spokenIsEmpty(cleanSpokenVisit(null, { types, today }))).toBe(true);
    expect(spokenIsEmpty(cleanSpokenVisit({ notes: 5, customerQuery: {} }, { types, today }))).toBe(true);
  });
});

describe('nextQuestion', () => {
  const full = types[2];
  const quick = types[0];
  const followOnly = types[1];
  it('asks for the customer, then the type', () => {
    expect(nextQuestion({}, null)).toBe('customer');
    expect(nextQuestion({ customerId: 'c1' }, null)).toBe('type');
    expect(nextQuestion({ customerId: 'c1', visitType: 'Nope' }, null)).toBe('type');
  });
  it('asks only for what the type uses', () => {
    expect(nextQuestion({ customerId: 'c1', visitType: 'Formal Presentation' }, full)).toBe('notes');
    expect(nextQuestion({ customerId: 'c1', visitType: 'Formal Presentation', notes: 'x' }, full)).toBe('outcome');
    expect(nextQuestion({ customerId: 'c1', visitType: 'Formal Presentation', notes: 'x', outcome: 'y' }, full)).toBeNull();
    // A quick note has no outcome and no follow-up.
    expect(nextQuestion({ customerId: 'c1', visitType: 'Quick Note', notes: 'x' }, quick)).toBeNull();
  });
  it('asks for a follow-up only when the type requires one, and a date alone is enough', () => {
    expect(nextQuestion({ customerId: 'c1', visitType: 'Follow up Notes' }, followOnly)).toBe('followUp');
    expect(nextQuestion({ customerId: 'c1', visitType: 'Follow up Notes', followUpDate: '2026-12-04' }, followOnly)).toBeNull();
    expect(nextQuestion({ customerId: 'c1', visitType: 'Formal Presentation', notes: 'x', outcome: 'y' }, full)).toBeNull();
  });
  it('never asks again about what the person skipped', () => {
    expect(nextQuestion({ customerId: 'c1', visitType: 'Formal Presentation', notes: 'x' }, full, ['outcome'])).toBeNull();
    expect(nextQuestion({ customerId: 'c1', visitType: 'Formal Presentation' }, full, ['notes'])).toBe('outcome');
  });
});
