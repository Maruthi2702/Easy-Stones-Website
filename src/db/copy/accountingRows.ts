/** MongoDB → Postgres rows for Accounting and Fuel Man (src/db/schema/accounting.ts). */
import type { Loose } from '../../types/records.ts';
import type {
  acctCarriers, acctCarrierInvoices, acctFreightCharges, acctFreightChargeFlags, acctInvoiceCharges, acctPayments,
  acctPaymentCharges, acctAudit, fuelReports, fuelAssignments, fuelAssignmentAllocations, fuelProfiles, fuelSources,
  fuelExpenses, fuelState, fuelPeriods, fuelHistory
} from '../schema/accounting.ts';
import { CHARGE_STATUSES, ACCT_PAYMENT_METHODS, PAYMENT_TERMS, FUEL_REPORT_STATUSES } from '../schema/accounting.ts';
import type { ReferenceIndex } from './referenceRows.ts';
import type { OperationsIndex } from './operationsRows.ts';
import { stamp } from './referenceRows.ts';
import { plainJson } from './linkedRows.ts';
import {
  idOf, idTime, textOf, rowConverter, intOf, pickOf, stringsOf, boolOf, locationIdOf, linkOf, type CopyProblem
} from './values.ts';

type Row<T extends { $inferInsert: unknown }> = T['$inferInsert'];

export interface AccountingSource {
  acctCarriers: Loose[];
  acctCarrierInvoices: Loose[];
  acctFreightCharges: Loose[];
  acctPayments: Loose[];
  acctAudit: Loose[];
  fuelReports: Loose[];
  fuelAssignments: Loose[];
  fuelProfiles: Loose[];
  fuelSources: Loose[];
  fuelExpenses: Loose[];
  fuelState: Loose[];
  fuelPeriods: Loose[];
  fuelHistory: Loose[];
}

export interface AccountingRows {
  acctCarriers: Row<typeof acctCarriers>[];
  acctCarrierInvoices: Row<typeof acctCarrierInvoices>[];
  acctFreightCharges: Row<typeof acctFreightCharges>[];
  acctFreightChargeFlags: Row<typeof acctFreightChargeFlags>[];
  acctInvoiceCharges: Row<typeof acctInvoiceCharges>[];
  acctPayments: Row<typeof acctPayments>[];
  acctPaymentCharges: Row<typeof acctPaymentCharges>[];
  acctAudit: Row<typeof acctAudit>[];
  fuelReports: Row<typeof fuelReports>[];
  fuelAssignments: Row<typeof fuelAssignments>[];
  fuelAssignmentAllocations: Row<typeof fuelAssignmentAllocations>[];
  fuelProfiles: Row<typeof fuelProfiles>[];
  fuelSources: Row<typeof fuelSources>[];
  fuelExpenses: Row<typeof fuelExpenses>[];
  fuelState: Row<typeof fuelState>[];
  fuelPeriods: Row<typeof fuelPeriods>[];
  fuelHistory: Row<typeof fuelHistory>[];
}

const obj = (v: unknown): Loose => (v && typeof v === 'object' ? v : {}) as Loose;
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const optText = (v: unknown): string | null => v == null ? null : String(v);
const who = (v: unknown, prefix: string) => {
  const p = obj(v);
  return { [`${prefix}Id`]: textOf(p.id), [`${prefix}Name`]: textOf(p.name) };
};
const optWho = (v: unknown, prefix: string) => {
  const p = v && typeof v === 'object' ? v as Loose : null;
  return { [`${prefix}Id`]: p ? optText(p.id) : null, [`${prefix}Name`]: p ? optText(p.name) : null };
};
/** A Buffer, or BSON Binary as a snapshot hands it back. */
const bytesOf = (v: unknown): Buffer | null => {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v);
  const inner = (v as { buffer?: unknown })?.buffer;
  return inner instanceof Uint8Array ? Buffer.from(inner) : null;
};
const ZONE = 'America/Los_Angeles';

export function accountingRows(src: AccountingSource, ref: ReferenceIndex, ops: OperationsIndex, problems: CopyProblem[]): AccountingRows {
  const rows: AccountingRows = {
    acctCarriers: [], acctCarrierInvoices: [], acctFreightCharges: [], acctFreightChargeFlags: [], acctInvoiceCharges: [],
    acctPayments: [], acctPaymentCharges: [], acctAudit: [], fuelReports: [], fuelAssignments: [], fuelAssignmentAllocations: [],
    fuelProfiles: [], fuelSources: [], fuelExpenses: [], fuelState: [], fuelPeriods: [], fuelHistory: []
  };
  const carrierIds = new Set<string>(), invoiceIds = new Set<string>(), chargeIds = new Set<string>(), reportIds = new Set<string>();
  const payment = (c: ReturnType<typeof rowConverter>, v: unknown) => {
    const p = obj(v);
    return {
      paymentId: textOf(p.paymentId), paidOn: c.day('paid_on', p.paidOn, ZONE),
      paymentMethod: p.method ? pickOf(c, 'payment_method', p.method, ACCT_PAYMENT_METHODS, null) ?? '' : '',
      paymentReference: textOf(p.reference), paymentRecordedAt: c.moment('payment_recorded_at', p.recordedAt),
      ...who(p.recordedBy, 'paymentRecordedBy')
    } as const;
  };

  for (const d of src.acctCarriers) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'acct_carriers', id);
    carrierIds.add(id);
    rows.acctCarriers.push({
      id, name: textOf(d.name), nameKey: textOf(d.nameKey), aliases: stringsOf(d.aliases),
      paymentTerms: pickOf(c, 'payment_terms', d.paymentTerms, PAYMENT_TERMS, 'per_delivery'), active: boolOf(d.active, true),
      notes: textOf(d.notes), ...who(d.createdBy, 'createdBy'), ...who(d.updatedBy, 'updatedBy'),
      version: intOf(c, 'version', d.__v) ?? 0, ...stamp(c, d)
    } as Row<typeof acctCarriers>);
  }

  for (const d of src.acctCarrierInvoices) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'acct_carrier_invoices', id);
    const carrierId = linkOf(c, 'carrier_id', d.carrierId, carrierIds, 'carrier');
    const totalCents = intOf(c, 'total_cents', d.totalCents);
    if (!carrierId || totalCents == null) { c.problem('id', 'no carrier or total', 'skipped'); continue; }
    invoiceIds.add(id);
    rows.acctCarrierInvoices.push({
      id, carrierId, invoiceNumber: textOf(d.invoiceNumber), invoiceDate: c.day('invoice_date', d.invoiceDate, ZONE), totalCents,
      locations: stringsOf(d.locations), status: pickOf(c, 'status', d.status, CHARGE_STATUSES, 'draft'), notes: textOf(d.notes),
      approvedAt: c.moment('approved_at', d.approvedAt), ...who(d.approvedBy, 'approvedBy'), ...payment(c, d.payment),
      voidedAt: c.moment('voided_at', d.voidedAt), ...who(d.voidedBy, 'voidedBy'), voidReason: textOf(d.voidReason),
      ...who(d.createdBy, 'createdBy'), ...who(d.updatedBy, 'updatedBy'), version: intOf(c, 'version', d.__v) ?? 0,
      ...stamp(c, d)
    } as Row<typeof acctCarrierInvoices>);
  }

  for (const d of src.acctFreightCharges) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'acct_freight_charges', id);
    const sourceKind = pickOf(c, 'source', d.source, ['delivery', 'manual'] as const, null);
    if (!sourceKind) { c.problem('source', 'no source', 'skipped'); continue; }
    chargeIds.add(id);
    const ticket = typeof d.deliveryId === 'string' ? d.deliveryId : null;
    if (ticket && !ops.deliveryIdByTicket.has(ticket)) c.problem('delivery_ticket_id', 'delivery no longer exists', 'kept');
    const snap = d.sourceSnapshot && typeof d.sourceSnapshot === 'object' ? d.sourceSnapshot as Loose : {};
    rows.acctFreightCharges.push({
      id, source: sourceKind, deliveryTicketId: ticket, soNumber: textOf(d.soNumber), customerName: textOf(d.customerName),
      deliveryDay: c.day('delivery_day', d.deliveryDate, ref.zoneOfLocation(d.location)),
      locationId: locationIdOf(c, 'location_id', d.location, ref.locationIdByName),
      carrierId: linkOf(c, 'carrier_id', d.carrierId, carrierIds, 'carrier'), carrierNameRaw: textOf(d.carrierNameRaw),
      bolNumber: textOf(d.bolNumber), amountCents: intOf(c, 'amount_cents', d.amountCents), description: textOf(d.description),
      notes: textOf(d.notes), status: pickOf(c, 'status', d.status, CHARGE_STATUSES, 'draft'),
      invoiceId: linkOf(c, 'invoice_id', d.invoiceId, invoiceIds, 'invoice'),
      sourceSoNumber: optText(snap.soNumber), sourceCustomerName: optText(snap.customerName),
      sourceDeliveryDate: optText(snap.deliveryDate), sourceLocation: optText(snap.location),
      sourceCarrierNameRaw: optText(snap.carrierNameRaw), sourceBolNumber: optText(snap.bolNumber),
      sourceAmountCents: intOf(c, 'source_amount_cents', snap.amountCents), handSet: stringsOf(d.handSet),
      approvedAt: c.moment('approved_at', d.approvedAt), ...who(d.approvedBy, 'approvedBy'), ...payment(c, d.payment),
      voidedAt: c.moment('voided_at', d.voidedAt), ...who(d.voidedBy, 'voidedBy'), voidReason: textOf(d.voidReason),
      ...who(d.createdBy, 'createdBy'), ...who(d.updatedBy, 'updatedBy'), version: intOf(c, 'version', d.__v) ?? 0,
      ...stamp(c, d)
    } as Row<typeof acctFreightCharges>);
    list(d.flags).forEach((f, position) => {
      const x = obj(f), fid = idOf(x._id);
      const code = pickOf(c, 'flags.code', x.code, ['delivery_reopened', 'delivery_changed'] as const, null);
      if (!fid || !code) { c.problem('flags', 'flag with no id or code', 'skipped'); return; }
      rows.acctFreightChargeFlags.push({
        id: fid, chargeId: id, position, code, detail: textOf(x.detail), at: c.moment('flags.at', x.at) ?? idTime(x._id),
        resolvedAt: c.moment('flags.resolved_at', x.resolvedAt), ...who(x.resolvedBy, 'resolvedBy')
      } as Row<typeof acctFreightChargeFlags>);
    });
  }

  // Invoices list their charges; joined after every charge is known.
  for (const d of src.acctCarrierInvoices) {
    const id = idOf(d._id);
    if (!id || !invoiceIds.has(id)) continue;
    const c = rowConverter(problems, 'acct_carrier_invoices', id);
    list(d.chargeIds).forEach((v, position) => {
      const chargeId = linkOf(c, 'charge_ids', v, chargeIds, 'charge');
      if (chargeId) rows.acctInvoiceCharges.push({ invoiceId: id, position, chargeId });
    });
  }

  for (const d of src.acctPayments) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'acct_payments', id);
    const kind = pickOf(c, 'kind', d.kind, ['charges', 'invoice'] as const, null);
    const method = pickOf(c, 'method', d.method, ACCT_PAYMENT_METHODS, null);
    const totalCents = intOf(c, 'total_cents', d.totalCents), paidOn = c.day('paid_on', d.paidOn, ZONE);
    if (!kind || !method || totalCents == null || !paidOn) { c.problem('id', 'no kind, method, total or day', 'skipped'); continue; }
    rows.acctPayments.push({
      id, paymentId: textOf(d.paymentId), requestId: typeof d.requestId === 'string' ? d.requestId : null, kind,
      carrierId: linkOf(c, 'carrier_id', d.carrierId, carrierIds, 'carrier'),
      invoiceId: linkOf(c, 'invoice_id', d.invoiceId, invoiceIds, 'invoice'),
      locations: stringsOf(d.locations), totalCents, paidOn, method, reference: textOf(d.reference),
      approvedInSameStep: boolOf(d.approvedInSameStep), recordedAt: c.moment('recorded_at', d.recordedAt) ?? idTime(d._id),
      ...who(d.recordedBy, 'recordedBy')
    } as Row<typeof acctPayments>);
    list(d.chargeIds).forEach((v, position) => {
      const chargeId = linkOf(c, 'charge_ids', v, chargeIds, 'charge');
      if (chargeId) rows.acctPaymentCharges.push({ paymentRowId: id, position, chargeId });
    });
  }

  for (const d of src.acctAudit) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'acct_audit', id);
    const entityType = pickOf(c, 'entity_type', d.entityType, ['charge', 'invoice', 'carrier'] as const, null);
    if (!entityType || !d.txnId) { c.problem('id', 'no entity type or transaction id', 'skipped'); continue; }
    rows.acctAudit.push({
      id, txnId: textOf(d.txnId), paymentId: textOf(d.paymentId), entityType, entityId: textOf(idOf(d.entityId) ?? d.entityId),
      action: textOf(d.action), ...who(d.by, 'by'), at: c.moment('at', d.at) ?? idTime(d._id),
      changes: list(d.changes).map(x => plainJson({ field: obj(x).field ?? null, from: obj(x).from ?? null, to: obj(x).to ?? null })),
      note: textOf(d.note)
    } as Row<typeof acctAudit>);
  }

  for (const d of src.fuelReports) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'acct_fuelman_reports', id);
    reportIds.add(id);
    rows.fuelReports.push({
      id, scopeKey: textOf(d.scopeKey), fileHash: textOf(d.fileHash), contentHash: textOf(d.contentHash),
      periodKey: textOf(d.periodKey), filename: optText(d.filename), parsed: d.parsed == null ? null : plainJson(d.parsed),
      revision: intOf(c, 'revision', d.revision), status: pickOf(c, 'status', d.status, FUEL_REPORT_STATUSES, 'draft'),
      dispositions: plainJson(list(d.dispositions)), overrides: plainJson(list(d.overrides)),
      importedAt: c.moment('imported_at', d.importedAt), ...optWho(d.importedBy, 'importedBy'),
      frozenReview: d.frozenReview == null ? null : plainJson(d.frozenReview), publishedAt: c.moment('published_at', d.publishedAt),
      note: optText(d.note), version: intOf(c, 'version', d.__v) ?? 0
    } as Row<typeof fuelReports>);
  }

  for (const d of src.fuelAssignments) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'acct_fuelman_assignments', id);
    rows.fuelAssignments.push({
      id, scopeKey: textOf(d.scopeKey), externalId: textOf(d.externalId), reportedName: optText(d.reportedName),
      driverKey: optText(d.driverKey), driverName: optText(d.driverName),
      fromDay: c.day('from_day', d.from, ZONE), toDay: c.day('to_day', d.to, ZONE),
      ...optWho(d.updatedBy, 'updatedBy'), updatedAt: c.moment('updated_at', d.updatedAt)
    } as Row<typeof fuelAssignments>);
    list(d.allocations).forEach((a, position) => {
      const x = obj(a);
      rows.fuelAssignmentAllocations.push({
        assignmentId: id, position, location: optText(x.location), basisPoints: intOf(c, 'allocations.basis_points', x.basisPoints)
      });
    });
  }

  for (const d of src.fuelProfiles) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'acct_fuelman_profiles', id);
    const kind = pickOf(c, 'kind', d.kind, ['driver', 'shared'] as const, null);
    if (!kind) { c.problem('kind', 'no kind', 'skipped'); continue; }
    rows.fuelProfiles.push({ id, name: textOf(d.name), kind, ...optWho(d.createdBy, 'createdBy') } as Row<typeof fuelProfiles>);
  }

  for (const d of src.fuelSources) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'acct_fuelman_sources', id);
    const reportId = linkOf(c, 'report_id', d.reportId, reportIds, 'report'), pdf = bytesOf(d.pdf);
    if (!reportId || !pdf) { c.problem('id', 'no report or no PDF', 'skipped'); continue; }
    rows.fuelSources.push({ id, reportId, pdf });
  }

  for (const d of src.fuelExpenses) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'acct_fuelman_expenses', id);
    const reportId = linkOf(c, 'report_id', d.reportId, reportIds, 'report');
    if (!reportId) { c.problem('report_id', 'cost of no report', 'skipped'); continue; }
    rows.fuelExpenses.push({
      id, reportId, month: optText(d.month), scopeKey: optText(d.scopeKey), externalId: optText(d.externalId),
      driverKey: optText(d.driverKey), driverName: optText(d.driverName), location: optText(d.location),
      category: optText(d.category), amountCents: intOf(c, 'amount_cents', d.amountCents),
      sourceLine: intOf(c, 'source_line', d.sourceLine), day: c.day('day', d.date, ZONE)
    });
  }

  for (const d of src.fuelState) {
    if (typeof d._id !== 'string') continue;
    const c = rowConverter(problems, 'acct_fuelman_state', d._id);
    rows.fuelState.push({ id: d._id, revision: intOf(c, 'revision', d.revision) ?? 0 });
  }

  for (const d of src.fuelPeriods) {
    if (typeof d._id !== 'string') continue;
    const c = rowConverter(problems, 'acct_fuelman_periods', d._id);
    rows.fuelPeriods.push({
      id: d._id, scopeKey: optText(d.scopeKey), month: optText(d.month),
      publishedReportId: linkOf(c, 'published_report_id', d.publishedReportId, reportIds, 'report'),
      closed: boolOf(d.closed), ...optWho(d.closedBy, 'closedBy'), closedAt: c.moment('closed_at', d.closedAt)
    } as Row<typeof fuelPeriods>);
  }

  for (const d of src.fuelHistory) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'acct_fuelman_history', id);
    rows.fuelHistory.push({
      id, reportId: idOf(d.reportId), scopeKey: optText(d.scopeKey), action: optText(d.action), at: c.moment('at', d.at),
      ...optWho(d.actor, 'actor'), note: optText(d.note), detail: d.detail == null ? null : plainJson(d.detail)
    } as Row<typeof fuelHistory>);
  }

  return rows;
}
