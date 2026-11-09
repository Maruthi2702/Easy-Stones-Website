/**
 * MongoDB → Postgres rows for what points at a customer from outside its
 * document: calendar entries (schedules), the activity log, and the delete /
 * merge backups (src/db/schema/customers.ts).
 */
import { EJSON } from 'bson';
import type { Loose } from '../../types/records.ts';
import type { schedules, activityLogs, customerDeleteBackups, customerMergeBackups } from '../schema/customers.ts';
import type { ReferenceIndex } from './referenceRows.ts';
import type { CustomerIndex } from './customerRows.ts';
import { stamp } from './referenceRows.ts';
import { idOf, textOf, rowConverter, type CopyProblem } from './values.ts';

type Row<T extends { $inferInsert: unknown }> = T['$inferInsert'];

export interface LinkedRows {
  schedules: Row<typeof schedules>[];
  activityLogs: Row<typeof activityLogs>[];
  customerDeleteBackups: Row<typeof customerDeleteBackups>[];
  customerMergeBackups: Row<typeof customerMergeBackups>[];
}

export interface LinkedSource {
  schedules: Loose[];
  activityLogs: Loose[];
  customerDeleteBackups: Loose[];
  customerMergeBackups: Loose[];
}

const ACTIVITY_TYPES = ['Visit', 'Call', 'Drop-off', 'Other'];
const STATUSES = ['Scheduled', 'Completed', 'Cancelled'];
const SOURCES = ['manual', 'route_planner', 'visit_log'];

/** Free-form details as plain JSON: ids as hex text, dates as ISO text (what the screens read). */
export function plainJson(value: unknown): unknown {
  if (value == null) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  const id = typeof (value as { toHexString?: unknown }).toHexString === 'function' ? idOf(value) : null;
  if (id) return id;
  if (Array.isArray(value)) return value.map(plainJson);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Loose).map(([k, v]) => [k, plainJson(v)]));
  return value;
}

/** A whole snapshot in MongoDB extended JSON, so Undo can rebuild exactly what was there. */
export const snapshotJson = (value: unknown) => EJSON.serialize(value as Loose, { relaxed: true }) as Loose;

export function linkedRows(src: LinkedSource, ref: ReferenceIndex, cust: CustomerIndex, problems: CopyProblem[]): LinkedRows {
  const rows: LinkedRows = { schedules: [], activityLogs: [], customerDeleteBackups: [], customerMergeBackups: [] };

  for (const d of src.schedules) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'schedules', id);
    const userId = idOf(d.userId); let customerId = idOf(d.customerId);
    if (!userId || !ref.userIds.has(userId)) { c.problem('user_id', 'not a user', 'skipped'); continue; }
    // The live calendar still shows an entry whose customer was deleted (no name), so it's kept.
    if (customerId && !cust.customerIds.has(customerId)) { c.problem('customer_id', 'customer does not exist', 'blanked'); customerId = null; }
    const zone = ref.zoneOfUser(userId);
    const startsAt = c.localTime('starts_at', d.startTime, zone);
    if (!startsAt) { c.problem('starts_at', 'no start time', 'skipped'); continue; }
    let visitId = idOf(d.linkedVisitId);
    if (visitId && !cust.visitIds.has(visitId)) { c.problem('visit_id', 'linked visit does not exist', 'blanked'); visitId = null; }
    const pick = (field: string, v: unknown, allowed: string[], fallback: string) => {
      if (v == null || v === '') return fallback;
      if (allowed.includes(String(v))) return String(v);
      c.problem(field, 'not an allowed value', 'converted');
      return fallback;
    };
    rows.schedules.push({
      id, userId, customerId, startsAt, endsAt: c.localTime('ends_at', d.endTime, zone),
      activityType: pick('activity_type', d.activityType, ACTIVITY_TYPES, 'Visit'), notes: textOf(d.notes),
      status: pick('status', d.status, STATUSES, 'Scheduled'), visitId, source: pick('source', d.source, SOURCES, 'manual'),
      ...stamp(c, d)
    });
  }

  for (const d of src.activityLogs) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'activity_logs', id);
    const customerId = idOf(d.customerId);
    rows.activityLogs.push({
      id, entityType: textOf(d.entityType), entityId: idOf(d.entityId) ?? textOf(d.entityId), customerId,
      action: textOf(d.action), performedBy: idOf(d.performedBy) ?? textOf(d.performedBy),
      performedByName: textOf(d.performedByName), performedByRole: d.performedByRole ?? null,
      details: d.details == null ? null : plainJson(d.details),
      loggedAt: c.localTime('logged_at', d.timestamp, customerId ? cust.zoneOfCustomer(customerId) : ref.zoneOfUser(idOf(d.performedBy)))
    });
  }

  for (const d of src.customerDeleteBackups) {
    const id = idOf(d._id);
    const customerId = idOf(d.customerId);
    if (!id || !customerId || !d.customer) continue;
    const c = rowConverter(problems, 'customer_delete_backups', id);
    rows.customerDeleteBackups.push({
      id, batchId: textOf(d.batchId), customerId, customer: snapshotJson(d.customer), source: textOf(d.source) || 'bulk',
      deletedBy: textOf(d.deletedBy), spsKeepDeleted: !!d.spsKeepDeleted, spsKeepRun: textOf(d.spsKeepRun),
      undoneAt: c.moment('undone_at', d.undoneAt), undoneBy: textOf(d.undoneBy), ...stamp(c, d)
    });
  }

  for (const d of src.customerMergeBackups) {
    const id = idOf(d._id);
    if (!id || !d.group) continue;
    const c = rowConverter(problems, 'customer_merge_backups', id);
    rows.customerMergeBackups.push({
      id, group: snapshotJson(d.group), action: textOf(d.action), createdBy: textOf(d.createdBy),
      undoneAt: c.moment('undone_at', d.undoneAt), ...stamp(c, d)
    });
  }

  return rows;
}
