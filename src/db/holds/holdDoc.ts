/** Postgres rows → the records MongoDB holds (the shape the routes and the screens read). */
import type { salesCarts, salesCartLines, salesHolds, salesHoldLines, salesSlabReservations, salesHoldHistory } from '../schema/checkInsHolds.ts';
import type { Loose } from '../../types/records.ts';

type Row<T extends { $inferSelect: unknown }> = T['$inferSelect'];

export function holdDoc(h: Row<typeof salesHolds>, branch: string, lines: Row<typeof salesHoldLines>[]): Loose {
  return {
    _id: h.id,
    number: h.number,
    status: h.status,
    branch,
    customer: { id: h.customerId ?? '', name: h.customerName, contact: h.customerContact, phone: h.customerPhone, email: h.customerEmail, address: h.customerAddress },
    job: h.job,
    notes: h.notes,
    commissionNotes: h.commissionNotes,
    chanceToClose: h.chanceToClose,
    expiresOn: h.expiresOn,
    expiresAt: h.expiresAt,
    releaseAt: h.releaseAt,
    expiredNotedAt: h.expiredNotedAt,
    lines: [...lines].sort((a, b) => a.position - b.position).map(l => ({
      slabKey: l.slabKey, serial: l.serial, barcode: l.barcode, product: l.product, category: l.category, bundle: l.bundle,
      slabNumber: l.slabNumber, block: l.block, bin: l.bin, location: l.location, dimensions: l.dimensions,
      sfHundredths: l.sfHundredths, priceCentsPerSf: l.priceCentsPerSf, note: l.note
    })),
    slabKeys: h.slabKeys,
    createdBy: { id: h.createdById, name: h.createdByName },
    updatedBy: { id: h.updatedById, name: h.updatedByName },
    releasedAt: h.releasedAt,
    releasedBy: h.releasedById == null ? null : { id: h.releasedById, name: h.releasedByName ?? '' },
    releaseReason: h.releaseReason,
    ...(h.requestId == null ? {} : { requestId: h.requestId }),
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
    __v: h.version
  };
}

export const reservationDoc = (r: Row<typeof salesSlabReservations>): Loose => ({
  _id: r.id, slabKey: r.slabKey, holdId: r.holdId, holdNumber: r.holdNumber, customerName: r.customerName, branch: r.branch,
  by: { id: r.byId, name: r.byName }, expiresOn: r.expiresOn ?? '', createdAt: r.createdAt, updatedAt: r.updatedAt
});

export const historyDoc = (h: Row<typeof salesHoldHistory>): Loose => ({
  _id: h.id, holdId: h.holdId, holdNumber: h.holdNumber, action: h.action, by: { id: h.byId, name: h.byName }, at: h.at,
  changes: Array.isArray(h.changes) ? h.changes : [], note: h.note
});

export const cartDoc = (c: Row<typeof salesCarts>, lines: Row<typeof salesCartLines>[]): Loose => ({
  _id: c.id, userId: c.userId, userName: c.userName,
  customer: c.customerName == null ? null : { id: c.customerId ?? '', name: c.customerName },
  lines: [...lines].sort((a, b) => a.position - b.position).map(l => ({ slabKey: l.slabKey, product: l.product, note: l.note, addedAt: l.addedAt })),
  createdAt: c.createdAt, updatedAt: c.updatedAt
});
