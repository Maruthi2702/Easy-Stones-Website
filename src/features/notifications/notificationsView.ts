import type { Person } from './notificationsApi';

/** People matching the search (name, role or branch), A–Z by name. */
export function matchPeople(people: Person[], query: string): Person[] {
  const q = query.trim().toLowerCase();
  return people
    .filter(p => !q || `${p.name} ${p.role.replace(/_/g, ' ')} ${p.branch}`.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The people under a heading per branch, branches A–Z. */
export function groupByBranch(people: Person[]): { branch: string; people: Person[] }[] {
  const by = new Map<string, Person[]>();
  for (const p of people) by.set(p.branch, [...(by.get(p.branch) || []), p]);
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([branch, list]) => ({ branch, people: list }));
}

/** The ticked ids after ticking or unticking a whole group (only people with a phone are ticked by a group). */
export function toggleGroup(selected: ReadonlySet<string>, group: Person[], on: boolean): Set<string> {
  const next = new Set(selected);
  for (const p of group) { if (on && p.phones > 0) next.add(p.id); else if (!on) next.delete(p.id); }
  return next;
}

export const groupState = (selected: ReadonlySet<string>, group: Person[]): 'all' | 'some' | 'none' => {
  const withPhone = group.filter(p => p.phones > 0);
  const n = withPhone.filter(p => selected.has(p.id)).length;
  return n === 0 ? 'none' : n === withPhone.length ? 'all' : 'some';
};

/** "3 people ticked" / "Nobody ticked". */
export const tickedLine = (n: number) => (n === 0 ? 'Nobody ticked' : `${n} ${n === 1 ? 'person' : 'people'} ticked`);
