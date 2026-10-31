import { describe, it, expect } from 'vitest';
import {
  visitTypeLabel, visitFieldsFor, hasFollowUp, validateVisitValues,
  countVisitChanges, visitLastChangedText, visitValuesToSave, followUpShown
} from './visitForm.ts';

// Visit types come from the database (Admin → Visit Types); these are records as the API sends them.
const full = { name: 'Formal Presentation', label: 'Formal presentation', fields: { notes: true, outcome: true, followUp: 'optional' } };
const quick = { name: 'Quick Note', label: 'Quick note', fields: { notes: true, outcome: false, followUp: 'none' } };
const followOnly = { name: 'Follow up Notes', label: 'Follow-up notes', fields: { notes: false, outcome: false, followUp: 'always' } };

describe('visit type labels', () => {
  it('shows the list’s label, and an unknown purpose as stored', () => {
    expect(visitTypeLabel('Quick Note', [quick, full])).toBe('Quick note');
    expect(visitTypeLabel('Old Type', [quick])).toBe('Old Type');
    expect(visitTypeLabel('')).toBe('');
  });
});

describe('visitFieldsFor', () => {
  it('a type with no follow-up: notes only', () => {
    expect(visitFieldsFor(quick)).toEqual({ notes: true, outcome: false, followUp: false, followUpToggle: false });
  });

  it('a follow-up-only type: follow-up always open', () => {
    expect(visitFieldsFor(followOnly)).toEqual({ notes: false, outcome: false, followUp: true, followUpToggle: false });
  });

  it('an optional follow-up sits behind the toggle', () => {
    expect(visitFieldsFor(full)).toEqual({ notes: true, outcome: true, followUp: true, followUpToggle: true });
  });

  it('a type no longer in the list (undefined) gets every field, follow-up behind the toggle', () => {
    expect(visitFieldsFor(undefined)).toEqual({ notes: true, outcome: true, followUp: true, followUpToggle: true });
  });

  it('follows the settings a manager chose, not the name', () => {
    const renamed = { name: 'Quick Note', label: 'Quick note', fields: { notes: true, outcome: true, followUp: 'always' } };
    expect(visitFieldsFor(renamed)).toEqual({ notes: true, outcome: true, followUp: true, followUpToggle: false });
  });
});

describe('hasFollowUp', () => {
  it('is true when either follow-up field has something in it', () => {
    expect(hasFollowUp({ followUp: 'Call back' })).toBe(true);
    expect(hasFollowUp({ followUpDate: '2026-10-09' })).toBe(true);
    expect(hasFollowUp({ followUp: '  ', followUpDate: '' })).toBe(false);
    expect(hasFollowUp()).toBe(false);
  });
});

describe('validateVisitValues', () => {
  it('requires customer, visit type and date', () => {
    expect(validateVisitValues({})).toEqual({
      customerId: 'Choose a customer',
      purpose: 'Choose a visit type',
      date: 'Enter the visit date'
    });
    expect(validateVisitValues({ customerId: 'c1', purpose: 'Quick Note', date: '2026-10-04' })).toEqual({});
  });
});

describe('countVisitChanges', () => {
  const start = { customerId: 'c1', purpose: 'Quick Note', date: '2026-10-04', notes: 'Hi', image: ['a.jpg'] };

  it('counts each changed field once, ignoring surrounding spaces', () => {
    expect(countVisitChanges({ ...start }, start)).toBe(0);
    expect(countVisitChanges({ ...start, notes: 'Hi ' }, start)).toBe(0);
    expect(countVisitChanges({ ...start, notes: 'Hello', outcome: 'Order' }, start)).toBe(2);
  });

  it('counts attachments added or removed as one change', () => {
    expect(countVisitChanges({ ...start, image: ['a.jpg', 'b.pdf'] }, start)).toBe(1);
    expect(countVisitChanges({ ...start, image: [] }, start)).toBe(1);
    expect(countVisitChanges({ ...start, image: 'a.jpg' }, start)).toBe(0);
  });
});

describe('visitLastChangedText', () => {
  const now = new Date('2026-10-04T12:00:00');

  it('names the last editor', () => {
    expect(visitLastChangedText({ updatedAt: '2026-10-02T09:00:00', updatedByName: 'Alex Rivera' }, now))
      .toBe('Last changed by Alex Rivera · Oct 2');
  });

  it('falls back to who logged it, then to nothing', () => {
    expect(visitLastChangedText({ createdAt: '2026-09-28T09:00:00', createdByName: 'Sam' }, now)).toBe('Logged by Sam · Sep 28');
    expect(visitLastChangedText({ createdAt: '2025-09-28T09:00:00' }, now)).toBe('Added Sep 28, 2025');
    expect(visitLastChangedText({}, now)).toBe('');
  });
});

describe('visitValuesToSave', () => {
    const typed = { purpose: 'Formal Presentation', notes: 'n', followUp: 'Call back', followUpDate: '2026-10-09' };

    it('drops follow-up details the form is hiding', () => {
        expect(visitValuesToSave(typed, full, false)).toMatchObject({ followUp: '', followUpDate: '', notes: 'n' });
        expect(visitValuesToSave({ ...typed, purpose: 'Quick Note' }, quick, true)).toMatchObject({ followUp: '', followUpDate: '' });
    });

    it('keeps them when they are on screen', () => {
        expect(visitValuesToSave(typed, full, true)).toBe(typed);
        expect(visitValuesToSave({ ...typed, purpose: 'Follow up Notes' }, followOnly, false).followUp).toBe('Call back');
    });

    it('followUpShown matches what the form shows', () => {
        expect(followUpShown(full, false)).toBe(false);
        expect(followUpShown(full, true)).toBe(true);
        expect(followUpShown(followOnly, false)).toBe(true);
        expect(followUpShown(quick, true)).toBe(false);
    });
});

import { cleanVisitFields, newVisitId } from './visitForm';

describe('server-side visit rules', () => {
    it('a type with no follow-up stores none, but only for the fields that were sent', () => {
        expect(cleanVisitFields(quick, { followUp: 'x', followUpDate: '2026-11-01' })).toEqual({ followUp: '', followUpDate: '' });
        expect(cleanVisitFields(quick, { followUp: undefined, followUpDate: undefined })).toEqual({ followUp: undefined, followUpDate: undefined });
    });
    it('other types keep it', () => {
        const f = { followUp: 'x', followUpDate: '2026-11-01' };
        expect(cleanVisitFields(followOnly, f)).toEqual(f);
        expect(cleanVisitFields(full, f)).toEqual(f);
        expect(cleanVisitFields(undefined, f)).toEqual(f);
    });
});

describe('newVisitId', () => {
    it('is 24 hex characters and differs each time', () => {
        const a = newVisitId();
        expect(a).toMatch(/^[0-9a-f]{24}$/);
        expect(newVisitId()).not.toBe(a);
    });
    it('starts with the time in seconds', () => {
        expect(newVisitId(1_700_000_000_000, () => new Uint8Array(8)).slice(0, 8)).toBe((1_700_000_000).toString(16));
    });
});
