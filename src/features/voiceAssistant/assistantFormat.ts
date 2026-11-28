import { formatDateText, isValidISO, shiftDay } from '../../components/shared/calendar/calendarDates';

/** What a day reads as on the card: "Today", "Yesterday", "Tomorrow", else "Fri, Dec 4" (with the year when it isn't this one). */
export function dayLabel(iso: string, today: string): string {
  if (!isValidISO(iso)) return '';
  const day = iso.slice(0, 10);
  if (isValidISO(today)) {
    if (day === today) return 'Today';
    if (day === shiftDay(today, -1)) return 'Yesterday';
    if (day === shiftDay(today, 1)) return 'Tomorrow';
  }
  const text = formatDateText(day); // "Fri, Dec 4, 2026"
  return isValidISO(today) && day.slice(0, 4) === today.slice(0, 4) ? text.replace(/,\s*\d{4}$/, '') : text;
}

/** The live words split so the newest word can be lit: { head: 'log a visit at smith ', last: 'granite' }. */
export function splitLastWord(text: string): { head: string; last: string } {
  const t = String(text ?? '').replace(/\s+$/, '');
  const at = t.search(/\S+$/);
  return at <= 0 ? { head: '', last: t } : { head: t.slice(0, at), last: t.slice(at) };
}
