/**
 * Which follow-ups the Dashboard's Follow-ups panel (Visits tab) shows, and in
 * what order. Runs on the server (GET /api/dashboard/followups/panel) so the
 * browser is sent six rows, not every follow-up in the range. No DOM, no
 * timezone: days are compared as YYYY-MM-DD strings, so "2026-10-20" is that
 * day for everyone, never UTC midnight the evening before.
 *
 * Due today or later first (soonest), then the recently overdue (most recent
 * first). Overdue for more than STALE_FOLLOW_UP_DAYS stays off the panel (the
 * Follow-ups tab still lists it).
 */
export const STALE_FOLLOW_UP_DAYS = 30;
export const FOLLOW_UP_PANEL_LIMIT = 6;

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** The YYYY-MM-DD a saved value names, or '' (strings keep their date part; a Date is read by its UTC parts). */
export const dayOf = (value) => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : '';
  const m = DAY.exec(String(value || ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};

const dayNumber = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};

/** `rows` are /api/dashboard/visits rows; `today` is YYYY-MM-DD. */
export const pickPanelFollowUps = (rows = [], today, limit = FOLLOW_UP_PANEL_LIMIT) => {
  const todayN = dayNumber(dayOf(today) || dayOf(new Date()));
  return rows
    .filter((v) => v && (v.nextAction || v.followUp || v.followUpDate))
    .map((v) => ({ v, due: dayOf(v.followUpDate) || dayOf(v.date) }))
    .filter(({ due }) => due)
    .map(({ v, due }) => ({ v, due, days: dayNumber(due) - todayN }))
    .filter(({ days }) => -days <= STALE_FOLLOW_UP_DAYS)
    .sort((a, b) => {
      const aLate = a.days < 0;
      const bLate = b.days < 0;
      if (aLate !== bLate) return aLate ? 1 : -1;
      return aLate ? b.days - a.days : a.days - b.days;
    })
    .slice(0, limit)
    .map(({ v, due }) => ({
      id: v._id,
      customerId: v.customerId,
      company: v.company || v.customerName || 'Unknown customer',
      note: String(v.followUp || v.nextAction || '').trim(),
      by: String(v.createdByName || '').trim(),
      dueDate: due
    }));
};
