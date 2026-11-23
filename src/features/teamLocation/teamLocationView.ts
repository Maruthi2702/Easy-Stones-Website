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

export type PeopleFilter = 'all' | 'live' | 'attention' | 'unagreed';
/** Hasn't agreed to the current wording, so nothing is kept for them. */
export const isUnagreed = (p: TeamPerson) => !p.consentedAt;

/** The list narrowed by a search (name, branch or role) and by one filter (a boolean = the old "needs a look" switch). */
export function filterPeople(people: TeamPerson[], query: string, filter: PeopleFilter | boolean): TeamPerson[] {
  const f: PeopleFilter = filter === true ? 'attention' : filter === false ? 'all' : filter;
  const q = query.trim().toLowerCase();
  return people.filter((p) =>
    (f === 'all' || (f === 'live' && p.status === 'live') || (f === 'attention' && needsAttention(p)) || (f === 'unagreed' && isUnagreed(p)))
    && (!q || `${p.name} ${p.branch} ${p.role.replace(/_/g, ' ')}`.toLowerCase().includes(q)));
}

/** What the filter chips count, from the whole team. */
export const filterCounts = (people: TeamPerson[]): Record<PeopleFilter, number> => ({
  all: people.length, live: liveCount(people), attention: attentionCount(people), unagreed: people.filter(isUnagreed).length
});

/** The one short word on a person's row: Live, "12 min ago", Not seen today, Not agreed. */
export const statusLabel = (p: TeamPerson) =>
  isUnagreed(p) ? 'Not agreed' : p.status === 'live' ? 'Live' : p.status === 'earlier' ? p.ago : 'Not seen today';

export type PeopleGroup = { key: string; title: string; people: TeamPerson[] };
/** The list in sections, a person in exactly one: needs a look, live, seen earlier, not seen, hasn't agreed. Empty ones left out. */
export function groupPeople(people: TeamPerson[]): PeopleGroup[] {
  const groups: PeopleGroup[] = [
    { key: 'attention', title: 'Needs a look', people: [] }, { key: 'live', title: 'Live now', people: [] },
    { key: 'earlier', title: 'Seen earlier today', people: [] }, { key: 'none', title: 'Not seen today', people: [] },
    { key: 'unagreed', title: 'Hasn’t agreed yet', people: [] }
  ];
  for (const p of people) {
    const i = isUnagreed(p) ? 4 : needsAttention(p) ? 0 : p.status === 'live' ? 1 : p.status === 'earlier' ? 2 : 3;
    groups[i]!.people.push(p);
  }
  return groups.filter((g) => g.people.length);
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

/** "Always", "While Using", "Denied" or "Not reported" for the permission a phone last reported. */
export const permissionLabel = (permission: string | undefined) =>
  permission === 'always' ? 'Always' : permission === 'when-in-use' ? 'While Using' : permission === 'denied' ? 'Denied' : 'Not reported';

export type DeviceRow = { key: string; label: string; value: string; tone: 'ok' | 'warn' | 'plain' };
/** The Phone tab's rows: what the person's phone last said about itself ([] when it never has). */
export function deviceRows(p: TeamPerson): DeviceRow[] {
  const d = p.device;
  if (!d) return [];
  const rows: DeviceRow[] = [];
  rows.push({ key: 'battery', label: 'Battery', value: d.batteryPct === null ? 'Not reported' : `${d.batteryPct}%${d.charging ? ' (charging)' : ''}`, tone: d.batteryPct !== null && d.batteryPct <= 15 && !d.charging ? 'warn' : 'plain' });
  rows.push({ key: 'permission', label: 'Location permission', value: permissionLabel(d.permission), tone: d.permission === 'always' ? 'ok' : d.permission === 'unknown' ? 'plain' : 'warn' });
  rows.push({ key: 'lowPower', label: 'Low Power Mode', value: d.lowPower ? 'On' : 'Off', tone: d.lowPower ? 'warn' : 'plain' });
  rows.push({ key: 'queued', label: 'Waiting to send', value: String(d.queued), tone: d.queued >= 20 ? 'warn' : 'plain' });
  if (d.appVersion) rows.push({ key: 'app', label: 'App version', value: d.appVersion, tone: 'plain' });
  return rows;
}

/** The distinct branches among these people, A–Z (for the Filters panel's Location field). */
export const branchesOf = (people: TeamPerson[]) => [...new Set(people.map((p) => p.branch).filter(Boolean))].sort((a, b) => a.localeCompare(b));
