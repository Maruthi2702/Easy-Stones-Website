import { branchZone } from '../../config/branches';
import type { SeenStatus, TeamPerson } from './types';

/** "7:04 AM" on the person's branch clock. */
export const clockText = (iso: string | null | undefined, branch: string) =>
  iso ? new Intl.DateTimeFormat('en-US', { timeZone: branchZone(branch), hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '';

/** The people, live ones first, then earlier today, then nobody seen; each group A–Z. */
export const sortPeople = (people: TeamPerson[]) => {
  const rank: Record<SeenStatus, number> = { live: 0, earlier: 1, none: 2 };
  return [...people].sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
};

export const liveCount = (people: TeamPerson[]) => people.filter((p) => p.status === 'live').length;

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/** "Rita Rep · 11.4 mi · 7:04 AM – 4:52 PM", or why there is nothing. */
export const trailSummary = (name: string, branch: string, miles: number, first: string | null, last: string | null, count: number) =>
  count === 0
    ? `No location points for ${name} on this day.`
    : `${count} point${count === 1 ? '' : 's'} · ${miles} mi · ${clockText(first, branch)} – ${clockText(last, branch)}`;
