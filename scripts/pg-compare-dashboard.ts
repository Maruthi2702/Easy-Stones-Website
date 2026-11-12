/** Register dashboard reads with pg-compare; MongoDB is only read, never changed. */
import * as customers from '../src/db/customers/index.ts';
import type { DashboardReadQuery } from '../src/db/customers/types.ts';
import type { Loose } from '../src/types/records.ts';

export interface DashboardCompareRead {
  name: string;
  read: () => Promise<unknown>;
  prepare?: (value: unknown, mongo: unknown) => unknown;
}

/** Only ties proved by the source may change relative order (MongoDB has no id tie-break). */
function equalKeyTies(value: unknown, mongo: unknown): unknown {
  const source = mongo as Loose[];
  const key = (row: Loose) => JSON.stringify([row.date, row.createdAt]);
  const groups = new Map<string, string[]>();
  for (const row of source) { const list = groups.get(key(row)) ?? []; list.push(String(row._id)); groups.set(key(row), list); }
  const tied = new Map<string, string>();
  for (const [k, ids] of groups) if (ids.length > 1) for (const id of ids) tied.set(id, k);
  const out = [...value as Loose[]];
  for (let index = 0; index < out.length;) {
    const tie = tied.get(String(out[index]._id));
    if (!tie) { index++; continue; }
    let end = index + 1;
    while (end < out.length && tied.get(String(out[end]._id)) === tie) end++;
    out.splice(index, end - index, ...out.slice(index, end).sort((a, b) => String(a._id).localeCompare(String(b._id))));
    index = end;
  }
  return out;
}

export function dashboardCompareReads(owner: string | undefined, today: string): DashboardCompareRead[] {
  const reads: DashboardCompareRead[] = [];
  const scopes = [['all', '*'], ['own', new Set(owner ? [owner] : [])], ['empty', new Set<string>()]] as const;
  const at = (date: string, end = false) => new Date(`${date}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
  const monthAgo = new Date(at(today).getTime() - 30 * 86400_000).toISOString().slice(0, 10);
  const ranges = [['all', null, null], ['today', at(today), at(today, true)],
    ['last 30 days', at(monthAgo), at(today, true)], ['through today', null, at(today, true)]] as const;
  for (const [scope, people] of scopes) for (const [range, startDate, endDate] of ranges) {
    const q: DashboardReadQuery = { people, startDate, endDate };
    for (const [name, read] of [
      ['visits', () => customers.dashboardVisits(q)],
      ['follow-up loader', () => customers.dashboardVisits({ ...q, filterType: 'followup' })],
      ['resources', () => customers.dashboardResources(q)]
    ] as const) reads.push({ name: `dashboard ${name}: ${scope}, ${range}`, read, prepare: equalKeyTies });
    reads.push({ name: `dashboard rollups: ${scope}, ${range}`,
      read: () => customers.dashboardRollups({ ...q, today, userId: owner }) });
  }
  return reads;
}
