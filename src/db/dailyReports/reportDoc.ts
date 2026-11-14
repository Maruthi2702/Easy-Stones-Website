/**
 * Postgres Daily Report rows → the report as MongoDB held it (`_id`, the branch's name in
 * `location`, the day in `date`, payments nested by method, the lines inside it), so the routes,
 * the PDF and the screen never learn which database answered.
 *
 * A field MongoDB would have left out on an old record stays out here (a transfer line with no
 * direction, no `received`, a log line that never said `earlier`), so a hydrated document gets the
 * model's own default for it — exactly as a document read from MongoDB does.
 */
import type { dailyReports, dailyReportTransfers, dailyReportContainers, dailyReportLog } from '../schema/operations.ts';
import { PAYMENT_METHODS } from '../schema/operations.ts';
import type { Loose } from '../../types/records.ts';

export type ReportRow = typeof dailyReports.$inferSelect;
export type TransferRow = typeof dailyReportTransfers.$inferSelect;
export type ContainerRow = typeof dailyReportContainers.$inferSelect;
export type LogRow = typeof dailyReportLog.$inferSelect;

const money = (v: string | null) => (v == null ? null : Number(v));

export function reportDoc(r: ReportRow, locationName: string | null, transfers: TransferRow[],
  containers: ContainerRow[], log: LogRow[]): Loose {
  const byPosition = <T extends { position: number }>(rows: T[]) => [...rows].sort((a, b) => a.position - b.position);
  const pay = (method: (typeof PAYMENT_METHODS)[number]) => {
    const key = method[0].toUpperCase() + method.slice(1);
    const row = r as unknown as Record<string, unknown>;
    return { count: row[`payment${key}Count`] as number | null, amount: money(row[`payment${key}Amount`] as string | null) };
  };
  return {
    _id: r.id,
    date: r.day,
    // Empty only when its stored branch wasn't a location when copied.
    location: locationName ?? '',
    status: r.status,
    visitors: { homeowners: r.visitorsHomeowners, fabricators: r.visitorsFabricators, designers: r.visitorsDesigners },
    deliveries: { assigned: r.deliveriesAssigned, capacity: r.deliveriesCapacity },
    pickups: { assigned: r.pickupsAssigned, capacity: r.pickupsCapacity },
    returns: r.returns,
    returnsSlabs: r.returnsSlabs,
    sinks: r.sinks,
    transfers: byPosition(transfers).map(t => ({
      fromTo: t.fromTo, transferNumber: t.transferNumber, count: t.count, slabs: t.slabs, auto: t.auto,
      ...(t.direction ? { direction: t.direction } : {}),
      ...(t.received == null ? {} : { received: t.received }),
      receivedAt: t.receivedAt, receivedBy: t.receivedBy, ticketIds: t.ticketIds, addedAfterSubmitAt: t.addedAfterSubmitAt
    })),
    containers: byPosition(containers).map(c => ({ poNumber: c.poNumber, material: c.material, slabs: c.slabs })),
    payments: Object.fromEntries(PAYMENT_METHODS.map(m => [m, pay(m)])),
    notes: r.notes,
    submittedBy: r.submittedBy,
    submittedAt: r.submittedAt,
    autoSubmitted: r.autoSubmitted,
    reopenedBy: r.reopenedBy,
    reopenedAt: r.reopenedAt,
    reopenReason: r.reopenReason,
    updatedBy: r.updatedBy,
    log: byPosition(log).map(l => ({ at: l.at, by: l.by, action: l.action, note: l.note, ...(l.earlier == null ? {} : { earlier: l.earlier }) })),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}
