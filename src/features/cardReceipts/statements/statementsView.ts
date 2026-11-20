import { statusCounts, type LineStatus } from '../../../utils/amexStatement';
import type { StaffPerson, StatementLine } from './statementsApi';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (day: string) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;

/** "Sep 29 – Oct 29, 2026", "Nov 1–7, 2026", "Dec 28, 2026 – Jan 3, 2027". */
export function periodLabel(from: string | null | undefined, to: string | null | undefined) {
  if (!from || !to) return '';
  if (from.slice(0, 4) !== to.slice(0, 4)) return `${short(from)}, ${from.slice(0, 4)} – ${short(to)}, ${to.slice(0, 4)}`;
  if (from.slice(0, 7) === to.slice(0, 7)) return `${short(from)}–${Number(to.slice(8, 10))}, ${to.slice(0, 4)}`;
  return `${short(from)} – ${short(to)}, ${to.slice(0, 4)}`;
}

/** What the tiles count (`base`, the search applied) and what's listed (`rows`, the tile too). */
export function visibleLines(lines: readonly StatementLine[], { search, status }: { search: string; status: LineStatus | 'all' }) {
  const q = search.trim().toLowerCase();
  const base = q ? lines.filter((l) => [l.description, l.cardMember, l.holderName, l.cardLabel, l.digits, l.reference, l.cityState]
    .some((v) => String(v || '').toLowerCase().includes(q))) : [...lines];
  const rows = status === 'all' ? base : base.filter((l) => l.status === status);
  return { base, rows, counts: statusCounts(base) };
}

/**
 * Who a new card can go to: active staff with no card yet (one card per person), A–Z, after
 * "Leave it for now".
 */
export const personOptions = (people: readonly StaffPerson[]) => [
  { value: '', label: 'Leave it for now', description: 'Its charges wait under Cards not set up', keywords: '' },
  ...people
    .filter((p) => p.active && !p.card)
    .map((p) => ({ value: p.id, label: p.name, description: [p.role.replace(/_/g, ' '), p.location].filter(Boolean).join(' · '), keywords: `${p.name} ${p.location}` }))
    .sort((a, b) => a.label.localeCompare(b.label))
];
