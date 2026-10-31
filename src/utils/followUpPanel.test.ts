import { describe, it, expect } from 'vitest';
import { pickPanelFollowUps, dayOf } from './followUpPanel.ts';

const today = '2026-10-19';

describe('pickPanelFollowUps', () => {
  it('puts what is due soonest first, then the most recently overdue; skips undated', () => {
    const rows = pickPanelFollowUps([
      { _id: '1', followUpDate: '2026-10-23', followUp: 'later' },
      { _id: '2', followUpDate: '2026-10-17', nextAction: 'late one' },
      { _id: '3' },
      { _id: '4', followUpDate: '2026-10-20' },
      { _id: '5', followUpDate: '2026-10-11', followUp: 'older' }
    ], today, 4);
    expect(rows.map((r) => r.id)).toEqual(['4', '1', '2', '5']);
    expect(rows[2]).toMatchObject({ note: 'late one', dueDate: '2026-10-17' });
  });
  it('leaves off follow-ups ticked done', () => {
    const rows = pickPanelFollowUps([
      { _id: '1', followUpDate: '2026-10-20', followUp: 'x', followUpDoneAt: '2026-10-19T09:00:00.000' },
      { _id: '2', followUpDate: '2026-10-21', followUp: 'y', followUpDoneAt: '' }
    ], today);
    expect(rows.map((r) => r.id)).toEqual(['2']);
  });
  it('limits the list', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ _id: String(i), followUpDate: `2026-10-${20 + i}`, followUp: 'x' }));
    expect(pickPanelFollowUps(many, today)).toHaveLength(6);
  });
  it('leaves off follow-ups overdue for more than 30 days, keeps exactly 30', () => {
    const ids = pickPanelFollowUps([
      { _id: 'old', followUpDate: '2026-09-18', followUp: 'x' },
      { _id: 'edge', followUpDate: '2026-09-19', followUp: 'x' }
    ], today).map((r) => r.id);
    expect(ids).toEqual(['edge']);
  });
  it("reads a saved day as that day: tomorrow's is not today's", () => {
    expect(pickPanelFollowUps([{ _id: 'a', followUpDate: '2026-10-20', followUp: 'x' }], today)[0].dueDate).toBe('2026-10-20');
    expect(pickPanelFollowUps([{ _id: 'a', followUpDate: '2026-10-20T00:00:00.000Z', followUp: 'x' }], today)[0].dueDate).toBe('2026-10-20');
  });
  it('falls back to the visit date, and to the customer name', () => {
    expect(pickPanelFollowUps([{ _id: 'a', date: '2026-10-19', nextAction: ' call ', customerName: 'Acme' }], today)[0])
      .toMatchObject({ company: 'Acme', note: 'call', dueDate: '2026-10-19' });
  });
});

describe('dayOf', () => {
  it('handles strings, dates and junk', () => {
    expect(dayOf('2026-10-20')).toBe('2026-10-20');
    expect(dayOf(new Date('2026-10-20T00:00:00Z'))).toBe('2026-10-20');
    expect(dayOf('soon')).toBe('');
    expect(dayOf(undefined)).toBe('');
  });
});
