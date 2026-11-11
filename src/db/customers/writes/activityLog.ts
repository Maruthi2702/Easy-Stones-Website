/**
 * The activity log line every customer, visit, resource and contact change writes.
 *
 * MongoDB: `ActivityLog.create`, after the change, as the routes do today.
 * Postgres: `insertActivityLog(tx, entry)` INSIDE the change's own transaction, so a
 * change and its log line are saved together or not at all.
 *
 * The row is exactly what the copy makes of the MongoDB record
 * (src/db/copy/linkedRows.ts): the log's `timestamp` is the local clock time the route
 * already writes (`getNowLocalISO()`), kept as written.
 */
import ActivityLog from '../../../models/ActivityLog.ts';
import { activityLogs } from '../../schema/customers.ts';
import type { Db } from '../../copy/plan.ts';
import { plainJson } from '../../copy/linkedRows.ts';

export interface ActivityEntry {
  /** newId() from the caller, so both databases hold the same line. */
  id: string;
  entityType: 'Visit' | 'Customer' | 'Resource' | 'Contact' | 'User' | 'Delivery';
  entityId: string;
  customerId?: string | null;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'REACTION_ADD' | 'REACTION_REMOVE';
  performedBy: string;
  performedByName: string;
  performedByRole?: 'admin' | 'customer' | null;
  details?: Record<string, unknown> | null;
  /** Local clock time, `YYYY-MM-DDTHH:mm:ss.sss` (getNowLocalISO()). */
  timestamp: string;
}

export async function logActivityMongo(e: ActivityEntry): Promise<void> {
  await ActivityLog.create({
    _id: e.id, entityType: e.entityType, entityId: e.entityId, customerId: e.customerId ?? undefined,
    action: e.action, performedBy: e.performedBy, performedByName: e.performedByName,
    performedByRole: e.performedByRole ?? undefined, details: e.details ?? undefined, timestamp: e.timestamp
  });
}

export async function insertActivityLog(db: Db, e: ActivityEntry): Promise<void> {
  await db.insert(activityLogs).values({
    id: e.id, entityType: e.entityType, entityId: e.entityId, customerId: e.customerId ?? null,
    action: e.action, performedBy: e.performedBy, performedByName: e.performedByName,
    performedByRole: e.performedByRole ?? null,
    details: e.details == null ? null : plainJson(e.details) as Record<string, unknown>,
    loggedAt: e.timestamp
  });
}
