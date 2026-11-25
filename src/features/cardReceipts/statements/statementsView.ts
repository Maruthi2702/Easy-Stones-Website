import { statusCounts, type Issuer, type LineStatus } from '../../../utils/amexStatement';
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

export const BANK_NAMES: Record<Issuer, string> = { amex: 'Amex', encore: 'Encore' };
export const BANK_KEYS: readonly Issuer[] = ['amex', 'encore'];

/** The Statements tab shows one bank at a time (2026-11-23): its lines only. */
export const linesOfBank = <T extends { issuer: Issuer }>(rows: readonly T[], bank: Issuer) => rows.filter((r) => r.issuer === bank);

/** "2 Encore cards not set up", "1 Amex card not set up". */
export const unsetCardsNote = (count: number, bank: Issuer) => `${count} ${BANK_NAMES[bank]} ${count === 1 ? 'card' : 'cards'} not set up`;

/** Who a line belongs to on screen: the holder we know, else the name the bank printed. */
export const holderOfLine = (l: StatementLine) => l.holderName || l.cardMember || '';

/**
 * What the Status and Cardholder filters count (`base`: the search and the other filter applied) and what's
 * listed (`rows`: every filter). `counts` are by status over `base` without the status filter.
 */
export function visibleLines(lines: readonly StatementLine[], { search, status, holder = '' }: { search: string; status: LineStatus | 'all'; holder?: string }) {
  const q = search.trim().toLowerCase();
  const searched = q ? lines.filter((l) => [l.description, l.cardMember, l.holderName, l.cardLabel, l.digits, l.reference, l.cityState, l.issuer]
    .some((v) => String(v || '').toLowerCase().includes(q))) : [...lines];
  const base = holder ? searched.filter((l) => holderOfLine(l) === holder) : searched;
  const rows = status === 'all' ? base : base.filter((l) => l.status === status);
  return { base, rows, counts: statusCounts(base), holders: holderCounts(status === 'all' ? searched : searched.filter((l) => l.status === status)) };
}

/** Each cardholder on the lines, A–Z, with how many lines they have. */
export function holderCounts(lines: readonly StatementLine[]) {
  const by = new Map<string, number>();
  for (const l of lines) { const h = holderOfLine(l); if (h) by.set(h, (by.get(h) ?? 0) + 1); }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
}

/**
 * The words the Status filter uses (2026-11-24, "Statement row colours" board C): a matched
 * line says Matched; the rest keep the statuses' own words.
 */
export const STATUS_WORDS: Partial<Record<LineStatus, string>> = { matched: 'Matched', missing: 'Waiting for receipt' };
export const statusWord = (s: LineStatus, fallback: string) => STATUS_WORDS[s] ?? fallback;

/** "Transportation-Fuel" → the category and its kind, as the bank prints them. */
export function categoryParts(amexCategory: string) {
  const [main = '', ...rest] = String(amexCategory || '').split('-');
  return { main: main.trim(), sub: rest.join('-').trim() };
}

/** The branch pill's colour: the four branches the Customers tab colours (PartnersSheet.css), else neutral. */
export const branchClass = (branch: string) => {
  const k = branch.trim().toLowerCase().replace(/\s+/g, '-');
  return ['seattle', 'spokane', 'salt-lake-city', 'dallas'].includes(k) ? `is-${k}` : '';
};

/**
 * Who a new card can go to: active staff with no card at that bank yet (one card per person per bank),
 * A–Z, after "Leave it for now".
 */
export const personOptions = (people: readonly StaffPerson[], issuer: Issuer = 'amex') => [
  { value: '', label: 'Leave it for now', description: 'Its charges wait under Cards not set up', keywords: '' },
  ...people
    .filter((p) => p.active)
    .map((p) => ({ value: p.id, label: p.name, description: (issuer === 'encore' ? p.encoreCard : p.card) ? `Has card ${issuer === 'encore' ? p.encoreCard : p.card}: it is replaced` : [p.role.replace(/_/g, ' '), p.location].filter(Boolean).join(' · '), keywords: `${p.name} ${p.location}` }))
    .sort((a, b) => a.label.localeCompare(b.label))
];
