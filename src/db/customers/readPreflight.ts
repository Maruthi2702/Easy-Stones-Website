/** Source shapes whose copy defaults would change dashboard counts or range membership. */
import type { Loose } from '../../types/records.ts';
import { branchZone } from '../../config/branches.ts';
import { toDay, toLocalTime } from '../copy/values.ts';

/**
 * Keep numeric/range parity strict. These legacy shapes need source cleanup or an
 * explicit schema decision before cutover; they must never become parity allowances.
 */
export function customerReadPreflight(source: Loose[]): string[] {
  const problems: string[] = [];
  for (const customer of source) {
    if (!Object.hasOwn(customer, 'status')) problems.push(`customer ${customer._id}: missing status would change the dashboard lead count`);
    const zone = branchZone(customer.location);
    for (const kind of ['visits', 'resources'] as const) for (const entry of customer[kind] || []) {
      // This is the original getAggregationDateRef rule, before any copy conversion.
      const sourceDay = typeof entry.date === 'string' ? entry.date
        : entry.createdAt instanceof Date ? entry.createdAt.toISOString().slice(0, 10) : String(entry.createdAt ?? '').slice(0, 10);
      const date = toDay(entry.date, zone), clock = toLocalTime(entry.createdAt, zone);
      const copiedDay = date.ok && date.value ? date.value
        : kind === 'resources' && clock.ok ? clock.value?.slice(0, 10) ?? '' : '';
      if (sourceDay !== copiedDay || (kind === 'visits' && !copiedDay)) {
        problems.push(`${kind} ${entry._id}: dashboard range day would change from ${JSON.stringify(sourceDay)} to ${JSON.stringify(copiedDay)}`);
      }
    }
  }
  return problems;
}
