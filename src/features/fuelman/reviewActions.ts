import { useState } from 'react';
import type { ExpenseLine, MissingIdentity, MissingReason, ReportDetail } from '../../fuelman/types';
import { fuelApi } from './api';
import type { CardSuggestion } from './monthReview';
// What the monthly review's buttons do. One saving at a time; each save carries the report's version and token.
export const QUICK_ABSENCE: { reason: MissingReason; label: string; note: string }[] = [
  { reason: 'no_activity', label: "Didn't use it", note: 'No card activity this month (monthly review)' },
  { reason: 'leave', label: 'On leave', note: 'On leave this month (monthly review)' },
  { reason: 'retired', label: 'Left', note: 'Left the company, card retired (monthly review)' },
];
export const QUICK_CATEGORIES = ['supplies', 'fuel', 'def'] as const;
export const arrow = { up: '▲', down: '▼', same: '•', none: '' } as const;

export function useReviewActions(report: ReportDetail, onSaved: () => void) {
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const save = async (id: string, action: string, body: Record<string, unknown>) => {
    setBusy(id); setError('');
    try { await fuelApi.command(report.id, action, { version: report.version, token: report.review.token, ...body }); onSaved(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  return {
    busy, error, save,
    accept: (c: CardSuggestion) => save(`card:${c.driver.externalId}`, 'assignments/batch', { note: '',
      assignments: [{ externalId: c.driver.externalId, driverKey: c.user!.key, from: c.driver.suggestedFrom, allocations: [{ location: c.location, percent: '100' }] }] }),
    absent: (m: MissingIdentity, q: typeof QUICK_ABSENCE[number]) => save(`away:${m.externalId}`, 'missing',
      { externalId: m.externalId, reason: q.reason, note: q.note, ...(q.reason === 'retired' ? { effectiveDate: report.start } : {}) }),
    sort: (g: { lines: ExpenseLine[] }, category: string) => save(`charge:${g.lines[0]!.index}`, 'classifications',
      { rows: g.lines.map(l => ({ index: l.index, category, note: 'Sorted in the monthly review' })) }),
  };
}
export type Actions = ReturnType<typeof useReviewActions>;
