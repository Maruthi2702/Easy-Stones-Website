import { branchZone } from '../../config/branches';
import type { AccessEntry, SeenStatus, TeamPerson } from './types';

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

/** Who needs a look: tracked today, agreed to share, and something is wrong (quiet). */
export const needsAttention = (p: TeamPerson) => Boolean(p.quiet);
export const attentionCount = (people: TeamPerson[]) => people.filter(needsAttention).length;

/** The list narrowed by a search (name, branch or role) and, optionally, to people who need a look. */
export function filterPeople(people: TeamPerson[], query: string, onlyAttention: boolean): TeamPerson[] {
  const q = query.trim().toLowerCase();
  return people.filter((p) =>
    (!onlyAttention || needsAttention(p))
    && (!q || `${p.name} ${p.branch} ${p.role.replace(/_/g, ' ')}`.toLowerCase().includes(q)));
}

/** "Battery 40% · Low Power Mode" under a person, or '' when their phone hasn't said. */
export function deviceLine(p: TeamPerson): string {
  const d = p.device;
  if (!d) return '';
  const parts: string[] = [];
  if (d.batteryPct !== null) parts.push(`Battery ${d.batteryPct}%${d.charging ? ' (charging)' : ''}`);
  if (d.lowPower) parts.push('Low Power Mode');
  if (d.queued >= 20) parts.push(`${d.queued} waiting to send`);
  return parts.join(' · ');
}

/** "No data 1:10 PM – 2:40 PM (90 min)" for a stretch the phone sent nothing. */
export const gapText = (g: { from: string; to: string; minutes: number }, branch: string) =>
  `No data ${clockText(g.from, branch)} – ${clockText(g.to, branch)} (${g.minutes} min)`;

const KIND_WORDS: Record<AccessEntry['kind'], string> = { live: 'looked at the map for', trail: 'viewed the trail of', locate: 'asked for the location of' };
/** "Mo Manager viewed the trail of Rita Rep · Nov 18" — one line of the access log. */
export function accessLine(e: AccessEntry): string {
  return `${e.viewerName || 'Someone'} ${KIND_WORDS[e.kind] ?? 'looked at'} ${e.subjectName || 'someone'}${e.kind === 'trail' && e.day ? ` · ${e.day}` : ''}`;
}
/** The access log narrowed by a search over both names. */
export const filterAccess = (entries: AccessEntry[], query: string) => {
  const q = query.trim().toLowerCase();
  return q ? entries.filter((e) => `${e.viewerName} ${e.subjectName}`.toLowerCase().includes(q)) : entries;
};
