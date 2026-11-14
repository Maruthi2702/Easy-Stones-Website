/**
 * MongoDB → Postgres rows for Operations (src/db/schema/operations.ts):
 * deliveries, trucks, Daily Reports with their lines, Payments with history.
 */
import type { Loose } from '../../types/records.ts';
import type {
  deliveries, trucks, dailyReports, dailyReportTransfers, dailyReportContainers, dailyReportLog,
  paymentsReceived, paymentHistory
} from '../schema/operations.ts';
import { DELIVERY_STATUSES, DELIVERY_TYPES, DAILY_REPORT_STATUSES, PAYMENT_METHODS } from '../schema/operations.ts';
import type { ReferenceIndex } from './referenceRows.ts';
import type { CustomerIndex } from './customerRows.ts';
import { stamp } from './referenceRows.ts';
import {
  idOf, textOf, rowConverter, intOf, pickOf, decimalOf, stringsOf, boolOf, locationIdOf, linkOf, type CopyProblem
} from './values.ts';

type Row<T extends { $inferInsert: unknown }> = T['$inferInsert'];

export interface OperationsSource {
  deliveries: Loose[];
  trucks: Loose[];
  dailyReports: Loose[];
  paymentsReceived: Loose[];
}

export interface OperationsRows {
  deliveries: Row<typeof deliveries>[];
  trucks: Row<typeof trucks>[];
  dailyReports: Row<typeof dailyReports>[];
  dailyReportTransfers: Row<typeof dailyReportTransfers>[];
  dailyReportContainers: Row<typeof dailyReportContainers>[];
  dailyReportLog: Row<typeof dailyReportLog>[];
  paymentsReceived: Row<typeof paymentsReceived>[];
  paymentHistory: Row<typeof paymentHistory>[];
}

export interface OperationsIndex {
  /** Delivery ticket ids ('del_…') → row id, for links from Accounting. */
  deliveryIdByTicket: Map<string, string>;
}

/**
 * One MongoDB delivery → its Postgres row. The copy and the Postgres saves both build rows
 * here, so a save writes exactly what a re-copy of MongoDB would make. `d._id` and `d.id`
 * must be real (the copy checks them first); anything else a ticket lacks takes its default.
 */
export function deliveryRowOf(d: Loose, ref: ReferenceIndex, cust: Pick<CustomerIndex, 'customerIds'>, problems: CopyProblem[]): Row<typeof deliveries> {
  const id = idOf(d._id)!;
  const ticketId = textOf(d.id);
  const c = rowConverter(problems, 'deliveries', id);
  const zone = ref.zoneOfLocation(d.location);
  const pod: Loose = d.pod && typeof d.pod === 'object' ? d.pod : {};
  const arrival: Loose | null = d.arrivalLogged && typeof d.arrivalLogged === 'object' ? d.arrivalLogged : null;
  return {
    id, ticketId,
    customerId: linkOf(c, 'customer_id', d.customerId, cust.customerIds, 'customer'),
    customerName: textOf(d.customerName), address: textOf(d.address), salesRepName: textOf(d.salesRepName),
    truckKey: textOf(d.truckId), day: c.day('day', d.date, zone), time: d.time == null ? '09:00 AM' : textOf(d.time),
    status: pickOf(c, 'status', d.status, DELIVERY_STATUSES, 'pending'), notes: textOf(d.notes),
    soNumber: textOf(d.soNumber), invoiceNumber: textOf(d.invoiceNumber),
    routeNumber: intOf(c, 'route_number', d.routeNumber) ?? 1,
    locationId: locationIdOf(c, 'location_id', d.location, ref.locationIdByName), driver: textOf(d.driver),
    deliveryType: pickOf(c, 'delivery_type', d.deliveryType, DELIVERY_TYPES, 'jobsite'),
    customerDropOff: boolOf(d.customerDropOff),
    transferDestinationId: locationIdOf(c, 'transfer_destination_id', d.transferDestination, ref.locationIdByName),
    expectedArrivalDay: c.day('expected_arrival_day', d.expectedArrivalDate, zone),
    receivedAt: c.moment('received_at', d.receivedAt), receivedBy: textOf(d.receivedBy),
    arrivalLoggedByName: arrival ? textOf(arrival.byName) : null,
    arrivalLoggedByLocation: arrival ? textOf(arrival.byLocation) : null,
    arrivalLoggedAt: arrival ? c.moment('arrival_logged_at', arrival.at) : null,
    pickupInfo: textOf(d.pickupInfo), carrierName: textOf(d.carrierName), proNumber: textOf(d.proNumber),
    freightFee: decimalOf(d.freightFee) ?? '0', numberOfSlabs: intOf(c, 'number_of_slabs', d.numberOfSlabs) ?? 0,
    packingListUrl: textOf(d.packingListUrl), packingListFilename: textOf(d.packingListFilename),
    packingListPublicId: textOf(d.packingListPublicId),
    podSigneeName: textOf(pod.signeeName), podDriverName: textOf(pod.driverName),
    podCustomerSignature: textOf(pod.customerSignature), podDriverSignature: textOf(pod.driverSignature),
    podCustomerSignedAt: c.moment('pod_customer_signed_at', pod.customerSignedAt),
    podDriverSignedAt: c.moment('pod_driver_signed_at', pod.driverSignedAt),
    podSignedAt: c.moment('pod_signed_at', pod.signedAt), podPhotos: stringsOf(pod.photos), podNotes: textOf(pod.notes),
    podSignedPdfUrl: textOf(pod.signedPdfUrl), podSignedPdfFilename: textOf(pod.signedPdfFilename),
    podSignedPdfPublicId: textOf(pod.signedPdfPublicId), podVerified: boolOf(pod.verified),
    podClearedAt: c.moment('pod_cleared_at', pod.clearedAt), podClearedBy: textOf(pod.clearedBy),
    podClearReason: textOf(pod.clearReason),
    ...stamp(c, d)
  };
}

/**
 * One MongoDB payment → its Postgres rows (the payment and its history lines), or null when
 * it can't be one (no id, branch, day, method or amount). The copy and the Postgres saves
 * both build rows here, so a save writes exactly what a re-copy of MongoDB would make.
 */
export function paymentRowsOf(d: Loose, ref: ReferenceIndex, cust: Pick<CustomerIndex, 'customerIds'>, problems: CopyProblem[]):
  { payment: Row<typeof paymentsReceived>; history: Row<typeof paymentHistory>[] } | null {
  const id = idOf(d._id);
  if (!id) return null;
  const c = rowConverter(problems, 'payments_received', id);
  const locationId = locationIdOf(c, 'location_id', d.location, ref.locationIdByName);
  const payDay = c.day('day', d.date, ref.zoneOfLocation(d.location));
  const method = pickOf(c, 'method', d.method, PAYMENT_METHODS, null);
  const cents = intOf(c, 'cents', d.cents);
  if (!locationId || !payDay || !method || cents == null) { c.problem('id', 'no branch, day, method or amount', 'skipped'); return null; }
  const history: Row<typeof paymentHistory>[] = [];
  (Array.isArray(d.history) ? d.history : []).forEach((h: Loose, position: number) => {
    const at = c.moment('history.at', h.at);
    const action = pickOf(c, 'history.action', h.action, ['added', 'edited', 'voided'] as const, null);
    if (!at || !action) { c.problem('history', 'history line with no time or action', 'skipped'); return; }
    history.push({ paymentId: id, position, at, by: textOf(h.by), action, changes: textOf(h.changes) });
  });
  return {
    payment: {
      id, locationId, day: payDay, customerId: linkOf(c, 'customer_id', d.customerId, cust.customerIds, 'customer'),
      customerName: textOf(d.customerName), method, cents, invoice: textOf(d.invoice), reference: textOf(d.reference),
      note: textOf(d.note), enteredBy: textOf(d.enteredBy), updatedBy: textOf(d.updatedBy),
      voidedAt: c.moment('voided_at', d.voidedAt), voidedBy: textOf(d.voidedBy), voidReason: textOf(d.voidReason),
      ...stamp(c, d)
    },
    history
  };
}

/**
 * The rows for one Daily Report and its transfer, container and log lines, or null when it has no
 * id, branch or day. The copy and the Postgres saves (src/db/dailyReports/) both build rows here,
 * so a save writes exactly what a re-copy of MongoDB would.
 */
export function dailyReportRowsOf(d: Loose, ref: ReferenceIndex, problems: CopyProblem[]): {
  report: Row<typeof dailyReports>; transfers: Row<typeof dailyReportTransfers>[];
  containers: Row<typeof dailyReportContainers>[]; log: Row<typeof dailyReportLog>[];
} | null {
  const transfers: Row<typeof dailyReportTransfers>[] = [];
  const containers: Row<typeof dailyReportContainers>[] = [];
  const log: Row<typeof dailyReportLog>[] = [];
  const id = idOf(d._id);
  if (!id) return null;
  const c = rowConverter(problems, 'daily_reports', id);
  const locationId = locationIdOf(c, 'location_id', d.location, ref.locationIdByName);
  const zone = ref.zoneOfLocation(d.location);
  const reportDay = c.day('day', d.date, zone);
  if (!locationId || !reportDay) { c.problem('location_id', 'no branch or no day', 'skipped'); return null; }
  const pair = (v: unknown): Loose => (v && typeof v === 'object' ? v : {}) as Loose;
  const visitors = pair(d.visitors), del = pair(d.deliveries), pick = pair(d.pickups), pay = pair(d.payments);
  const method = (m: string) => pair(pay[m]);
  const report: Row<typeof dailyReports> = {
    id, day: reportDay, locationId,
    status: pickOf(c, 'status', d.status, DAILY_REPORT_STATUSES, 'draft'),
    visitorsHomeowners: intOf(c, 'visitors_homeowners', visitors.homeowners) ?? 0,
    visitorsFabricators: intOf(c, 'visitors_fabricators', visitors.fabricators),
    visitorsDesigners: intOf(c, 'visitors_designers', visitors.designers),
    deliveriesAssigned: intOf(c, 'deliveries_assigned', del.assigned) ?? 0,
    deliveriesCapacity: intOf(c, 'deliveries_capacity', del.capacity),
    pickupsAssigned: intOf(c, 'pickups_assigned', pick.assigned) ?? 0,
    pickupsCapacity: intOf(c, 'pickups_capacity', pick.capacity),
    returns: intOf(c, 'returns', d.returns), returnsSlabs: intOf(c, 'returns_slabs', d.returnsSlabs),
    sinks: intOf(c, 'sinks', d.sinks),
    paymentAchCount: intOf(c, 'payment_ach_count', method('ach').count), paymentAchAmount: decimalOf(method('ach').amount),
    paymentCashCount: intOf(c, 'payment_cash_count', method('cash').count), paymentCashAmount: decimalOf(method('cash').amount),
    paymentCardCount: intOf(c, 'payment_card_count', method('card').count), paymentCardAmount: decimalOf(method('card').amount),
    paymentCheckCount: intOf(c, 'payment_check_count', method('check').count), paymentCheckAmount: decimalOf(method('check').amount),
    paymentReturnCount: intOf(c, 'payment_return_count', method('return').count), paymentReturnAmount: decimalOf(method('return').amount),
    notes: textOf(d.notes), submittedBy: textOf(d.submittedBy), submittedAt: c.moment('submitted_at', d.submittedAt),
    autoSubmitted: boolOf(d.autoSubmitted), reopenedBy: textOf(d.reopenedBy), reopenedAt: c.moment('reopened_at', d.reopenedAt),
    reopenReason: textOf(d.reopenReason), updatedBy: textOf(d.updatedBy),
    ...stamp(c, d)
  };
  (Array.isArray(d.transfers) ? d.transfers : []).forEach((t: Loose, position: number) => {
    transfers.push({
      reportId: id, position, fromTo: textOf(t.fromTo), transferNumber: textOf(t.transferNumber),
      count: intOf(c, 'transfers.count', t.count) ?? 0, slabs: intOf(c, 'transfers.slabs', t.slabs) ?? 0,
      auto: boolOf(t.auto), direction: pickOf(c, 'transfers.direction', t.direction, ['out', 'in'] as const, null),
      received: typeof t.received === 'boolean' ? t.received : null,
      receivedAt: c.moment('transfers.received_at', t.receivedAt), receivedBy: textOf(t.receivedBy),
      ticketIds: stringsOf(t.ticketIds), addedAfterSubmitAt: c.moment('transfers.added_after_submit_at', t.addedAfterSubmitAt)
    });
  });
  (Array.isArray(d.containers) ? d.containers : []).forEach((t: Loose, position: number) => {
    containers.push({
      reportId: id, position, poNumber: textOf(t.poNumber), material: textOf(t.material),
      slabs: intOf(c, 'containers.slabs', t.slabs) ?? 0
    });
  });
  (Array.isArray(d.log) ? d.log : []).forEach((t: Loose, position: number) => {
    const at = c.moment('log.at', t.at);
    if (!at) { c.problem('log.at', 'log line with no time', 'skipped'); return; }
    log.push({
      reportId: id, position, at, by: textOf(t.by), action: textOf(t.action), note: textOf(t.note),
      earlier: typeof t.earlier === 'boolean' ? t.earlier : null
    });
  });
  return { report, transfers, containers, log };
}

export function operationsRows(src: OperationsSource, ref: ReferenceIndex, cust: CustomerIndex, problems: CopyProblem[]):
  { rows: OperationsRows; index: OperationsIndex } {
  const rows: OperationsRows = {
    deliveries: [], trucks: [], dailyReports: [], dailyReportTransfers: [], dailyReportContainers: [], dailyReportLog: [],
    paymentsReceived: [], paymentHistory: []
  };
  const deliveryIdByTicket = new Map<string, string>();

  for (const d of src.deliveries) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'deliveries', id);
    const ticketId = textOf(d.id);
    if (!ticketId) { c.problem('ticket_id', 'no ticket id', 'skipped'); continue; }
    if (deliveryIdByTicket.has(ticketId)) { c.problem('ticket_id', 'ticket id held twice', 'skipped'); continue; }
    deliveryIdByTicket.set(ticketId, id);
    rows.deliveries.push(deliveryRowOf(d, ref, cust, problems));
  }

  for (const d of src.trucks) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'trucks', id);
    rows.trucks.push({
      id, truckKey: textOf(d.id), name: textOf(d.name), driver: textOf(d.driver), color: textOf(d.color) || '#D4AF37',
      location: textOf(d.location), ...stamp(c, d)
    });
  }

  for (const d of src.dailyReports) {
    const built = dailyReportRowsOf(d, ref, problems);
    if (!built) continue;
    rows.dailyReports.push(built.report);
    rows.dailyReportTransfers.push(...built.transfers);
    rows.dailyReportContainers.push(...built.containers);
    rows.dailyReportLog.push(...built.log);
  }

  for (const d of src.paymentsReceived) {
    const built = paymentRowsOf(d, ref, cust, problems);
    if (!built) continue;
    rows.paymentsReceived.push(built.payment);
    rows.paymentHistory.push(...built.history);
  }

  return { rows, index: { deliveryIdByTicket } };
}
