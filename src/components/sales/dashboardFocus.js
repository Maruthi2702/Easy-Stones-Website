/**
 * Pure rules for the Dashboard's Focus board (design "Option A", the Dashboard
 * canvas artifact): the Today list, the Follow-ups list and the time-range
 * wording. No DOM — tested in dashboardFocus.test.js.
 */

export const RANGES = [
  { id: '1day', short: 'Today', label: 'Today' },
  { id: '7days', short: '7 days', label: 'Last 7 days' },
  { id: '30days', short: '30 days', label: 'Last 30 days' },
  { id: 'year', short: 'YTD', label: 'Year to date' },
  { id: 'all', short: 'All', label: 'All time' }
];

// What the stat cards print under their number (the old wording, kept).
export const rangeFooter = (id) => ({
  '1day': 'Today', '7days': 'Last 7 days', '30days': 'Last 30 days', year: 'Year-to-date', all: 'All time'
}[id] || '');

export const STOP_COLORS = { Visit: '#16a34a', Call: '#2563eb', 'Drop-off': '#ca8a04', Other: '#64748b' };

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/** Today's calendar entries, earliest first, as { id, time, type, color, company, detail }. */
export const todayStops = (schedules = [], customerName = () => '', now = new Date()) => {
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
export const dueLabel = (value, now = new Date()) => {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return { text: '', tone: 'later' };
  const days = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);
  if (days < 0) return { text: days === -1 ? '1 day late' : `${-days} days late`, tone: 'late' };
  if (days === 0) return { text: 'Today', tone: 'today' };
  if (days === 1) return { text: 'Tomorrow', tone: 'later' };
  return { text: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), tone: 'later' };
};

/** The most pressing follow-ups first (late, then soonest), at most `limit`. */
export const topFollowUps = (items = [], limit = 6, now = new Date()) => items
  .map((v) => ({ v, at: new Date(v.followUpDate || v.displayDate || v.date).getTime() }))
  .filter(({ at }) => Number.isFinite(at))
  .sort((a, b) => a.at - b.at)
  .slice(0, limit)
  .map(({ v, at }) => ({
    id: v._id,
    customerId: v.customerId,
    company: v.company || v.customerName || 'Unknown customer',
    note: (v.followUp || v.nextAction || v.displayNote || '').trim(),
    ...dueLabel(at, now)
  }));
