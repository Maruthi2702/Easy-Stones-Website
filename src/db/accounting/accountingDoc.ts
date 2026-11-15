/** Postgres rows → the records MongoDB holds for Accounting (the shape the router, the sync and the screens read). */
import type {
  acctCarriers, acctCarrierInvoices, acctFreightCharges, acctFreightChargeFlags, acctPayments, acctAudit
} from '../schema/accounting.ts';
import type { Loose } from '../../types/records.ts';

type Row<T extends { $inferSelect: unknown }> = T['$inferSelect'];

const person = (id: string, name: string) => ({ id, name });

/** How a charge or invoice was paid: every field is there, blank until it is paid (MongoDB's `payment` default). */
const paymentOf = (r: Row<typeof acctFreightCharges> | Row<typeof acctCarrierInvoices>) => ({
  paymentId: r.paymentId, paidOn: r.paidOn ?? '', method: r.paymentMethod, reference: r.paymentReference,
  recordedAt: r.paymentRecordedAt, recordedBy: person(r.paymentRecordedById, r.paymentRecordedByName)
});

export const carrierDoc = (r: Row<typeof acctCarriers>): Loose => ({
  _id: r.id, name: r.name, nameKey: r.nameKey, aliases: r.aliases, paymentTerms: r.paymentTerms, active: r.active, notes: r.notes,
  createdBy: person(r.createdById, r.createdByName), updatedBy: person(r.updatedById, r.updatedByName),
  createdAt: r.createdAt, updatedAt: r.updatedAt, __v: r.version
});

export const invoiceDoc = (r: Row<typeof acctCarrierInvoices>, chargeIds: string[]): Loose => ({
  _id: r.id, carrierId: r.carrierId, invoiceNumber: r.invoiceNumber, invoiceDate: r.invoiceDate ?? '', totalCents: r.totalCents,
  chargeIds, locations: r.locations, status: r.status, notes: r.notes,
  approvedAt: r.approvedAt, approvedBy: person(r.approvedById, r.approvedByName), payment: paymentOf(r),
  voidedAt: r.voidedAt, voidedBy: person(r.voidedById, r.voidedByName), voidReason: r.voidReason,
  createdBy: person(r.createdById, r.createdByName), updatedBy: person(r.updatedById, r.updatedByName),
  createdAt: r.createdAt, updatedAt: r.updatedAt, __v: r.version
});

const SNAPSHOT_FIELDS = ['sourceSoNumber', 'sourceCustomerName', 'sourceDeliveryDate', 'sourceLocation', 'sourceCarrierNameRaw', 'sourceBolNumber', 'sourceAmountCents'] as const;

export function chargeDoc(r: Row<typeof acctFreightCharges>, location: string, flags: Row<typeof acctFreightChargeFlags>[]): Loose {
  const doc: Loose = {
    _id: r.id, source: r.source,
    ...(r.deliveryTicketId == null ? {} : { deliveryId: r.deliveryTicketId }),
    soNumber: r.soNumber, customerName: r.customerName, deliveryDate: r.deliveryDay ?? '', location,
    carrierId: r.carrierId, carrierNameRaw: r.carrierNameRaw, bolNumber: r.bolNumber, amountCents: r.amountCents,
    description: r.description, notes: r.notes, status: r.status, invoiceId: r.invoiceId
  };
  // A charge never made from a delivery has no snapshot; one that was has all seven fields.
  if (SNAPSHOT_FIELDS.some(f => r[f] != null)) {
    doc.sourceSnapshot = {
      soNumber: r.sourceSoNumber, customerName: r.sourceCustomerName, deliveryDate: r.sourceDeliveryDate, location: r.sourceLocation,
      carrierNameRaw: r.sourceCarrierNameRaw, bolNumber: r.sourceBolNumber, amountCents: r.sourceAmountCents
    };
  }
  return {
    ...doc,
    handSet: r.handSet,
    flags: [...flags].sort((a, b) => a.position - b.position).map(f => ({
      _id: f.id, code: f.code, detail: f.detail, at: f.at, resolvedAt: f.resolvedAt, resolvedBy: person(f.resolvedById, f.resolvedByName)
    })),
    approvedAt: r.approvedAt, approvedBy: person(r.approvedById, r.approvedByName), payment: paymentOf(r),
    voidedAt: r.voidedAt, voidedBy: person(r.voidedById, r.voidedByName), voidReason: r.voidReason,
    createdBy: person(r.createdById, r.createdByName), updatedBy: person(r.updatedById, r.updatedByName),
    createdAt: r.createdAt, updatedAt: r.updatedAt, __v: r.version
  };
}

export const paymentDoc = (r: Row<typeof acctPayments>, chargeIds: string[]): Loose => ({
  _id: r.id, paymentId: r.paymentId, ...(r.requestId == null ? {} : { requestId: r.requestId }), kind: r.kind,
  carrierId: r.carrierId, invoiceId: r.invoiceId, chargeIds, locations: r.locations, totalCents: r.totalCents,
  paidOn: r.paidOn, method: r.method, reference: r.reference, approvedInSameStep: r.approvedInSameStep,
  recordedAt: r.recordedAt, recordedBy: person(r.recordedById, r.recordedByName)
});

export const auditDoc = (r: Row<typeof acctAudit>): Loose => ({
  _id: r.id, txnId: r.txnId, paymentId: r.paymentId, entityType: r.entityType, entityId: r.entityId, action: r.action,
  by: person(r.byId, r.byName), at: r.at, changes: Array.isArray(r.changes) ? r.changes : [], note: r.note
});
