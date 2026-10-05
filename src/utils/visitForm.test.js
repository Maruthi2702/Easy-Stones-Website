import { describe, it, expect } from 'vitest';
import {
  VISIT_TYPES, visitTypeLabel, visitFieldsFor, hasFollowUp, validateVisitValues,
  countVisitChanges, visitLastChangedText, visitValuesToSave, followUpShown
} from './visitForm.js';

describe('visit types', () => {
  it('keeps the ten stored values, in the old order', () => {
    expect(VISIT_TYPES.map((t) => t.value)).toEqual([
      'Quick Note', 'Follow up Notes', 'Scheduled in Person Sales Meeting', 'Unscheduled in Person Sales Call',
      'Resource Placement', 'Resource Update', 'Formal Presentation', 'Important Remote Meeting/Call',
      'In Office Administration Day', 'Personal Time Off'
    ]);
  });

  it('shows a sentence-case label, and an unknown purpose as stored', () => {
    expect(visitTypeLabel('Scheduled in Person Sales Meeting')).toBe('Scheduled in-person sales meeting');
    expect(visitTypeLabel('Old Type')).toBe('Old Type');
    expect(visitTypeLabel('')).toBe('');
  });
});

describe('visitFieldsFor', () => {
  it('Quick note: notes only', () => {
    expect(visitFieldsFor('Quick Note')).toEqual({ notes: true, outcome: false, followUp: false, followUpToggle: false });
  });

  it('Follow-up notes: follow-up only, always open', () => {
    expect(visitFieldsFor('Follow up Notes')).toEqual({ notes: false, outcome: false, followUp: true, followUpToggle: false });
  });

  it('any other type: notes, outcome, follow-up behind the toggle', () => {
    expect(visitFieldsFor('Formal Presentation')).toEqual({ notes: true, outcome: true, followUp: true, followUpToggle: true });
    expect(visitFieldsFor('')).toEqual({ notes: true, outcome: true, followUp: true, followUpToggle: true });
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
    const typed = { purpose: 'Scheduled in Person Sales Meeting', notes: 'n', followUp: 'Call back', followUpDate: '2026-10-09' };

    it('drops follow-up details the form is hiding', () => {
        expect(visitValuesToSave(typed, false)).toMatchObject({ followUp: '', followUpDate: '', notes: 'n' });
        expect(visitValuesToSave({ ...typed, purpose: 'Quick Note' }, true)).toMatchObject({ followUp: '', followUpDate: '' });
    });

    it('keeps them when they are on screen', () => {
        expect(visitValuesToSave(typed, true)).toBe(typed);
        expect(visitValuesToSave({ ...typed, purpose: 'Follow up Notes' }, false).followUp).toBe('Call back');
    });

    it('followUpShown matches what the form shows', () => {
        expect(followUpShown('Scheduled in Person Sales Meeting', false)).toBe(false);
        expect(followUpShown('Scheduled in Person Sales Meeting', true)).toBe(true);
        expect(followUpShown('Follow up Notes', false)).toBe(true);
        expect(followUpShown('Quick Note', true)).toBe(false);
    });
});
