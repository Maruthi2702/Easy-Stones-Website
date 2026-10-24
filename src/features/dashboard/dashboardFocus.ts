import { parseAsLocal } from '../../utils/dateUtils';
import type { Loose } from '../../types/records';

/**
 * Pure rules for the Dashboard's Focus board (design "Option A", the Dashboard
 * canvas artifact): the Today list, the Follow-ups list and the time-range
 * wording. No DOM — tested in dashboardFocus.test.ts.
 */

export type Range = { id: string; short: string; label: string };

export const RANGES: Range[] = [
  { id: '1day', short: 'Today', label: 'Today' },
  { id: '7days', short: '7 days', label: 'Last 7 days' },
  { id: '30days', short: '30 days', label: 'Last 30 days' },
  { id: 'year', short: 'YTD', label: 'Year to date' },
  { id: 'all', short: 'All', label: 'All time' }
];

// What the stat cards print under their number (the old wording, kept).
export const rangeFooter = (id: string): string => (({
  '1day': 'Today', '7days': 'Last 7 days', '30days': 'Last 30 days', year: 'Year-to-date', all: 'All time'
} as Record<string, string>)[id] || '');

export const STOP_COLORS: Record<string, string> = { Visit: '#16a34a', Call: '#2563eb', 'Drop-off': '#ca8a04', Other: '#64748b' };

const startOfDay = (d: Date | number | string) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/** One row of the Today panel. */
export type TodayStop = { id: string; customerId: string; time: string; type: string; color: string; company: string; detail: string };

/** Today's calendar entries, earliest first, as { id, time, type, color, company, detail }. */
export const todayStops = (schedules: Loose[] = [], customerName: (schedule: Loose) => string = () => '', now: Date = new Date()): TodayStop[] => {
  const from = startOfDay(now).getTime();
  const to = from + 24 * 60 * 60 * 1000;
  return schedules
    .filter((s) => s && s.status !== 'Cancelled')
    .map((s) => ({ s, at: new Date(s.startTime).getTime() }))
    .filter(({ at }) => Number.isFinite(at) && at >= from && at < to)
    .sort((a, b) => a.at - b.at)
    .map(({ s, at }) => {
      const type = STOP_COLORS[s.activityType] ? s.activityType : 'Other';
      return {
        id: s._id,
        customerId: s.customerId?._id || s.customerId,
        time: new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        type,
        color: STOP_COLORS[type],
        company: customerName(s) || 'Unknown customer',
        detail: (s.notes || '').trim()
      };
    });
};

/** How a follow-up's date reads, and how urgent it is: 'late' | 'today' | 'later'. */
export type Due = { text: string; tone: 'late' | 'today' | 'later' };

export const dueLabel = (value?: string, now: Date = new Date()): Due => {
  // A plain saved day is that day here, not UTC midnight (the evening before).
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value as string) ? (parseAsLocal(value) as Date) : new Date(value as string);
  if (!Number.isFinite(d.getTime())) return { text: '', tone: 'later' };
  const days = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86400000);
  if (days < 0) return { text: days === -1 ? '1 day late' : `${-days} days late`, tone: 'late' };
  if (days === 0) return { text: 'Today', tone: 'today' };
  if (days === 1) return { text: 'Tomorrow', tone: 'later' };
  return { text: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), tone: 'later' };
};

/**
 * The Follow-ups panel's rows: the server picks and orders them
 * (src/utils/followUpPanel.js); this only words how late or soon each one is.
 */
export type PanelFollowUp = Due & { id: string; customerId: string; company: string; note: string };

export const panelFollowUps = (rows: Loose[] = [], now: Date = new Date()): PanelFollowUp[] => rows.map((r) => ({
  id: r.id,
  customerId: r.customerId,
  company: r.company,
  note: r.note,
  ...dueLabel(r.dueDate, now)
}));
